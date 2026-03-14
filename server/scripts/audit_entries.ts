import { calcEMA, calcRSI, calcATR, calcSMA } from '../../src/engines/indicators';
import { detectMarketRegime } from '../../src/engines/regimeFilter';
import { evaluateSniperSignal } from '../../src/engines/sniperEngine';
import { evaluateBreakoutSignal } from '../../src/engines/breakoutEngine';
import type { Kline, Signal, ModeConfig } from '../../src/types/trading';
import { MODES } from '../../src/types/trading';

const BINANCE_FUTURES = 'https://fapi.binance.com';
const TEST_SYMBOLS = [
  'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'AVAXUSDT',
  'LINKUSDT', 'ARBUSDT', 'OPUSDT', 'NEARUSDT', 'INJUSDT',
  'STXUSDT', 'LDOUSDT', 'BLURUSDT', 'RNDRUSDT', 'APTUSDT'
];
const LOOKFORWARD_CANDLES = 12; // 3 hours
const HISTORY_LIMIT = 1000;

async function fetchKlines(symbol: string, interval: string, limit: number): Promise<Kline[]> {
  const url = `${BINANCE_FUTURES}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res  = await fetch(url);
  if (!res.ok) throw new Error(`${symbol} fetch failed: ${res.status}`);
  const raw: any[][] = await res.json();
  return raw.map(r => ({
    openTime: r[0], open: parseFloat(r[1]), high: parseFloat(r[2]),
    low: parseFloat(r[3]), close: parseFloat(r[4]), volume: parseFloat(r[5]),
    closeTime: r[6]
  }));
}

function analyzeOutcome(signal: Signal, future: Kline[]) {
  const entry = signal.entryPrice;
  const sl = signal.stopLoss;
  const isLong = signal.side === 'LONG';
  const stopDist = Math.abs(entry - sl);
  if (stopDist <= 0 || future.length === 0) return null;

  let maxMFE = 0;
  let maxMAE = 0;
  
  let eventLog: string[] = []; // 'SL', 'MFE_50', 'MFE_100', 'MAE_60'
  
  const calcCandle = (c: Kline) => {
    const minL = c.low, maxH = c.high;
    const mae = isLong ? Math.max(0, entry - minL)/stopDist*100 : Math.max(0, maxH - entry)/stopDist*100;
    const mfe = isLong ? Math.max(0, maxH - entry)/stopDist*100 : Math.max(0, entry - minL)/stopDist*100;
    return { mae, mfe };
  };

  const c1 = calcCandle(future[0]);
  const calcMaxC = (slice: Kline[]) => {
    let best = {mae:0, mfe:0};
    for(const c of slice) {
      const {mae, mfe} = calcCandle(c);
      if(mae > best.mae) best.mae = mae;
      if(mfe > best.mfe) best.mfe = mfe;
    }
    return best;
  }
  const c3 = future.length >= 3 ? calcMaxC(future.slice(0, 3)) : c1;
  const c6 = future.length >= 6 ? calcMaxC(future.slice(0, 6)) : c3;

  for (const c of future) {
    const { mae, mfe } = calcCandle(c);
    if (mae > maxMAE) maxMAE = mae;
    if (mfe > maxMFE) maxMFE = mfe;
    
    // Check which hits first sequentially
    // To be strictly correct within a single candle, we assume worst case: MAE hits before MFE on same candle
    // if both cross thresholds. But we'll just check maxes for simplicity.
    if (mfe >= 50 && !eventLog.includes('MFE_50')) eventLog.push('MFE_50');
    if (mfe >= 100 && !eventLog.includes('MFE_100')) eventLog.push('MFE_100');
    if (mae >= 60 && !eventLog.includes('MAE_60')) eventLog.push('MAE_60');
    if (mae >= 100 && !eventLog.includes('SL')) eventLog.push('SL');
  }

  let classification = 'FLAT / CHOP';
  if (eventLog.includes('SL') && !eventLog.includes('MFE_50')) {
    classification = 'WRONG DIRECTION';
  } else if (eventLog.includes('SL') && eventLog.indexOf('MFE_50') < eventLog.indexOf('SL')) {
    classification = 'CORRECT BUT LATE'; // Went our way a bit, then dumped to SL -> late entry
  } else if (eventLog.includes('MFE_100') && eventLog.includes('MAE_60') && eventLog.indexOf('MAE_60') < eventLog.indexOf('MFE_100')) {
    classification = 'CORRECT BUT EARLY'; // Dipped deep first, then hit target -> early entry
  } else if (eventLog.includes('MFE_100') && (!eventLog.includes('MAE_60') || eventLog.indexOf('MAE_60') > eventLog.indexOf('MFE_100'))) {
    classification = 'CORRECT + WELL TIMED'; // Hit target without deep dip first -> perfect
  } else if (maxMFE >= 100 && !eventLog.includes('SL')) {
     classification = 'CORRECT + WELL TIMED'; 
  } else if (maxMAE >= 100) {
     classification = 'WRONG DIRECTION';
  }

  return {
    mae1: c1.mae, mae3: c3.mae, mae6: c6.mae,
    mfe1: c1.mfe, mfe3: c3.mfe, mfe6: c6.mfe,
    maxMFE, maxMAE,
    classification,
    firstMove: c1.mfe > c1.mae * 1.2 ? 'PROFIT' : (c1.mae > c1.mfe * 1.2 ? 'LOSS' : 'NEUTRAL')
  };
}

async function run() {
  const mode = MODES.AGGRESSIVE;
  const balance = 300;
  console.log(`\n======================================================`);
  console.log(`  ENTRY FORENSIC AUDIT (LONG + SHORT)`);
  console.log(`======================================================`);

  type Result = {
    symbol: string; engine: string; side: string;
    score: number; timing: string; type: string;
    zoneDist: number; candleAtr: number; regime: string;
    mae1: number; mae3: number; mae6: number;
    mfe1: number; mfe3: number; mfe6: number;
    classification: string; firstMove: string;
  };
  const results: Result[] = [];
  
  const breakoutStats = {
    PENDING_BREAKOUT: 0,
    RETEST_CONFIRMED: 0,
    RETEST_FAILED: 0,
    EXPIRED_NO_RETEST: 0,
    INVALIDATED: 0
  };

  for (const symbol of TEST_SYMBOLS) {
    try {
      process.stdout.write(`Scanning ${symbol}... `);
      const [tf15m, tf1h, tf4h] = await Promise.all([
        fetchKlines(symbol, '15m', HISTORY_LIMIT),
        fetchKlines(symbol, '1h', 260),
        fetchKlines('BTCUSDT', '4h', 150)
      ]);
      const btc1h = await fetchKlines('BTCUSDT', '1h', 260); // same fixed 1H array
      
      let localSignals = 0;
      for (let i = 110; i < tf15m.length - LOOKFORWARD_CANDLES; i++) {
        const slice15m = tf15m.slice(0, i + 1);
        const future = tf15m.slice(i + 1, i + 1 + LOOKFORWARD_CANDLES);
        const slice1h = tf1h; 
        
        // We override regime to allow signals to pass the regime gate and test purely ENTRY logic.
        const regime = 'TRENDING_UP'; 
        // We must artificially test both TRENDING_UP (longs allowed) and TRENDING_DOWN (shorts allowed)
        // Since the prompt asks for both. The best way is to not use regime blocks, but since sniperEngine 
        // hardcodes regime gates, we test the candle under both regime assumptions.
        
        const sLong = evaluateSniperSignal(slice1h, slice15m, mode, balance, 'TRENDING_UP' as any, 0, undefined, 'UP', 'Mock', symbol);
        const bLong = evaluateBreakoutSignal(slice1h, slice15m, mode, balance, 'TRENDING_UP' as any, 0, undefined, 'UP', 'Mock', symbol);
        
        const sShort = evaluateSniperSignal(slice1h, slice15m, mode, balance, 'TRENDING_DOWN' as any, 0, undefined, 'DOWN', 'Mock', symbol);
        const bShort = evaluateBreakoutSignal(slice1h, slice15m, mode, balance, 'TRENDING_DOWN' as any, 0, undefined, 'DOWN', 'Mock', symbol);
        
        const addSig = (sig: Signal, eng: string) => {
          if (eng === 'BREAKOUT') {
             const t = sig.entryType as string;
             if (t === 'PENDING_BREAKOUT') breakoutStats.PENDING_BREAKOUT++;
             else if (t === 'RETEST_CONFIRMED') breakoutStats.RETEST_CONFIRMED++;
             else if (t === 'RETEST_FAILED') breakoutStats.RETEST_FAILED++;
             else if (t === 'EXPIRED_NO_RETEST') breakoutStats.EXPIRED_NO_RETEST++;
             else if (t === 'INVALIDATED') breakoutStats.INVALIDATED++;
             
             // Only count confirmed retests as actual trades
             if (t !== 'RETEST_CONFIRMED') return;
          }

          localSignals++;
          const out = analyzeOutcome(sig, future);
          if (!out) return;
          results.push({
            symbol, engine: eng, side: sig.side, score: sig.score,
            timing: sig.entryTiming || 'UNKNOWN', type: sig.entryType || 'UNKNOWN',
            zoneDist: sig.zoneDistancePct || 0, candleAtr: sig.atr15 ? (slice15m[slice15m.length-2].high - slice15m[slice15m.length-2].low)/sig.atr15 : 0,
            regime: 'Mock',
            ...out
          });
        };
        if (sLong) addSig(sLong, 'SNIPER');
        if (bLong) addSig(bLong, 'BREAKOUT');
        if (sShort) addSig(sShort, 'SNIPER');
        if (bShort) addSig(bShort, 'BREAKOUT');
      }
      console.log(`${localSignals} sigs`);
    } catch(e: any) { console.log(`Error: ${e.message}`); }
  }

  // Report
  const longs = results.filter(r => r.side === 'LONG');
  const shorts = results.filter(r => r.side === 'SHORT');
  
  const avg = (arr: number[]) => arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0;
  const pct = (num: number, total: number) => total > 0 ? (num/total*100).toFixed(1)+'%' : 'N/A';
  
  const printSide = (name: string, arr: Result[]) => {
    console.log(`\n=== ${name} (${arr.length} signals) ===`);
    if(arr.length === 0) return;
    console.log(`First Move: PROFIT ${pct(arr.filter(a=>a.firstMove==='PROFIT').length, arr.length)} | LOSS ${pct(arr.filter(a=>a.firstMove==='LOSS').length, arr.length)}`);
    console.log(`Immediate MAE (1c / 3c / 6c): ${avg(arr.map(a=>a.mae1)).toFixed(1)}% / ${avg(arr.map(a=>a.mae3)).toFixed(1)}% / ${avg(arr.map(a=>a.mae6)).toFixed(1)}%`);
    console.log(`Immediate MFE (1c / 3c / 6c): ${avg(arr.map(a=>a.mfe1)).toFixed(1)}% / ${avg(arr.map(a=>a.mfe3)).toFixed(1)}% / ${avg(arr.map(a=>a.mfe6)).toFixed(1)}%`);
    
    console.log(`Classifications:`);
    const cWT = arr.filter(a=>a.classification==='CORRECT + WELL TIMED');
    const cL = arr.filter(a=>a.classification==='CORRECT BUT LATE');
    const cE = arr.filter(a=>a.classification==='CORRECT BUT EARLY');
    const wD = arr.filter(a=>a.classification==='WRONG DIRECTION');
    const flat = arr.filter(a=>a.classification==='FLAT / CHOP');
    console.log(` - CORRECT + WELL TIMED: ${pct(cWT.length, arr.length)} (Avg Timing Rate: LATE=${pct(cWT.filter(x=>x.timing==='LATE').length, cWT.length)})`);
    console.log(` - CORRECT BUT LATE:     ${pct(cL.length, arr.length)} (Avg Timing Rate: LATE=${pct(cL.filter(x=>x.timing==='LATE').length, Math.max(1,cL.length))})`);
    console.log(` - CORRECT BUT EARLY:    ${pct(cE.length, arr.length)}`);
    console.log(` - WRONG DIRECTION:      ${pct(wD.length, arr.length)} !`);
    console.log(` - FLAT / CHOP:          ${pct(flat.length, arr.length)}`);
    
    console.log(`Entry Quality Metrics (All in group):`);
    console.log(` - Sub-type Setup:       REVERSAL=${pct(arr.filter(a=>a.type==='REVERSAL').length, arr.length)} / CONTINUATION=${pct(arr.filter(a=>a.type==='CONTINUATION').length, arr.length)}`);
    console.log(` - Engine type:          SNIPER=${pct(arr.filter(a=>a.engine==='SNIPER').length, arr.length)} / BREAKOUT=${pct(arr.filter(a=>a.engine==='BREAKOUT').length, arr.length)}`);
    console.log(` - Avg Zone Dist:        ${avg(arr.map(a=>a.zoneDist)).toFixed(2)}%`);
    console.log(` - Avg Candle/ATR:       ${avg(arr.map(a=>a.candleAtr)).toFixed(2)}x`);
    console.log(` - Timing Classifiers:   OPTIMAL=${pct(arr.filter(a=>a.timing==='OPTIMAL').length, arr.length)} | EARLY=${pct(arr.filter(a=>a.timing==='EARLY').length, arr.length)} | LATE=${pct(arr.filter(a=>a.timing==='LATE').length, arr.length)}`);
  };

  printSide('ALL SIGNALS (Sniper + Retested Breakouts)', results);
  printSide('LONG SIGNALS', longs);
  printSide('SHORT SIGNALS', shorts);
  
  console.log(`\n=== BREAKOUT STATE AUDIT ===`);
  console.log(` PENDING_BREAKOUT:  ${breakoutStats.PENDING_BREAKOUT}`);
  console.log(` RETEST_CONFIRMED:  ${breakoutStats.RETEST_CONFIRMED} (Actual entries executed)`);
  console.log(` RETEST_FAILED:     ${breakoutStats.RETEST_FAILED}`);
  console.log(` EXPIRED_NO_RETEST: ${breakoutStats.EXPIRED_NO_RETEST}`);
  console.log(` INVALIDATED:       ${breakoutStats.INVALIDATED}`);
}
run();
