
import { evaluateSniperSignal } from '../../src/engines/sniperEngine';
import type { Kline, Signal } from '../../src/types/trading';
import { MODES } from '../../src/types/trading';

const BINANCE_FUTURES = 'https://fapi.binance.com';
const TEST_SYMBOLS = [
  'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'AVAXUSDT',
  'LINKUSDT', 'ARBUSDT', 'OPUSDT', 'NEARUSDT', 'INJUSDT',
  'STXUSDT', 'LDOUSDT', 'RNDRUSDT', 'APTUSDT', 'ORDIUSDT',
  'FTMUSDT', 'MATICUSDT', 'DOGEUSDT', 'DOTUSDT', 'ATOMUSDT',
  'SUIUSDT', 'SEIUSDT', 'TIAUSDT', 'ADAUSDT', 'FILUSDT',
  'TRXUSDT', 'GALAUSDT', 'SANDUSDT', 'MANAUSDT', 'LTCUSDT'
];
const HISTORY_LIMIT = 1500; // ~15 days of 15m candles

async function fetchKlines(symbol: string, interval: string, limit: number): Promise<Kline[]> {
  const url = `${BINANCE_FUTURES}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${symbol} fetch failed: ${res.status}`);
  const raw: any[][] = await res.json();
  return raw.map(r => ({
    openTime: r[0], open: parseFloat(r[1]), high: parseFloat(r[2]),
    low: parseFloat(r[3]), close: parseFloat(r[4]), volume: parseFloat(r[5]),
    closeTime: r[6]
  }));
}

// Replicate the exact AutoTrader logic
function checkBtcConfirmation(btcKlines: Kline[], side: 'LONG' | 'SHORT', currentIndex: number) {
    // We need the 20 candles up to currentIndex
    const slice = btcKlines.slice(Math.max(0, currentIndex - 20), currentIndex + 1);
    if(slice.length < 5) return { ok: true, reason: 'Not enough data' };

    const closes = slice.map((k: any) => k.close);
    const highs = slice.map((k: any) => k.high);
    const lows = slice.map((k: any) => k.low);
    const opens = slice.map((k: any) => k.open);
    
    const c1 = closes[closes.length - 2]; 
    const o1 = opens[opens.length - 2];
    const c2 = closes[closes.length - 3];
    const o2 = opens[opens.length - 3];

    const recentLows = lows.slice(-16, -2);
    const recentHighs = highs.slice(-16, -2);
    const localFloor = Math.min(...recentLows);
    const localCeiling = Math.max(...recentHighs);

    if (side === 'LONG') {
        const distToCeilingPct = ((localCeiling - c1) / c1) * 100;
        const consecutiveRed = (c1 < o1) && (c2 < o2);
        if (c1 < localCeiling && distToCeilingPct < 0.15) {
             return { ok: false, reason: `BTC compressing at local resistance (dist: ${distToCeilingPct.toFixed(2)}%)` };
        }
        if (consecutiveRed) return { ok: false, reason: 'BTC printing consecutive red 15m candles (no continuation)' };
        return { ok: true, reason: '' };
    } else {
        const distToFloorPct = ((c1 - localFloor) / c1) * 100;
        const consecutiveGreen = (c1 > o1) && (c2 > o2);
        if (c1 > localFloor && distToFloorPct < 0.15) {
             return { ok: false, reason: `BTC compressing at local support (dist: ${distToFloorPct.toFixed(2)}%)` };
        }
        if (consecutiveGreen) return { ok: false, reason: 'BTC printing consecutive green 15m candles (no continuation)' };
        return { ok: true, reason: '' };
    }
}

async function run() {
  console.log(`\n======================================================`);
  console.log(`  PORTFOLIO DEPLOYMENT DISCIPLINE SIMULATION`);
  console.log(`======================================================\n`);

  console.log(`Fetching market data...`);
  const data: Record<string, { tf15m: Kline[], tf1h: Kline[] }> = {};
  for (const sym of [...TEST_SYMBOLS, 'BTCUSDT']) {
    data[sym] = {
      tf15m: await fetchKlines(sym, '15m', HISTORY_LIMIT),
      tf1h: await fetchKlines(sym, '1h', Math.ceil(HISTORY_LIMIT / 4) + 150)
    };
  }

  const MAX_SAME_SIDE_POSITIONS = 2;
  const MAX_DEPLOY_PER_SCAN = 1;

  let metrics = {
    totalSignals: 0,
    blockedByWaveCap: 0,
    blockedByBTC: 0,
    blockedByCircuitBreaker: 0,
    blockedByClusterRank: 0,
    actuallyDeployed: 0
  };

  const sampleLogs: {
    waveCap: string[],
    btc: string[],
    circuitBreaker: string[],
    cluster: string[],
    deployed: string[]
  } = { waveCap: [], btc: [], circuitBreaker: [], cluster: [], deployed: [] };

  function logEvent(category: keyof typeof sampleLogs, msg: string) {
      if (sampleLogs[category].length < 3) sampleLogs[category].push(msg);
  }

  type MockPosition = { symbol: string, side: string, entryPrice: number, openIndex: number };
  let activePositions: MockPosition[] = [];

  // Simulate looping through time
  const totalCandles = data['BTCUSDT'].tf15m.length;
  const startIndex = 150; 
  
  for (let i = startIndex; i < totalCandles - 1; i++) {
    // For this audit loop, we temporarily evaluate all positive signals (score > 5) 
    // to intentionally overload the pipeline and force every single deployment-protection circuit breaker to fire.
    const minScore = 5; 
    const mode = { ...MODES.AGGRESSIVE, pullback: { ...MODES.AGGRESSIVE.pullback, scoreMin: 1 } }; 


    const rawTime = new Date(data['BTCUSDT'].tf15m[i].closeTime).toISOString().replace('T', ' ').substring(0, 16);

    let scanSignals: { symbol: string, signal: Signal }[] = [];

    // 1. Generate signals for this "minute" (using 15m candle close as proxy)
    for (const sym of TEST_SYMBOLS) {
      const slice15m = data[sym].tf15m.slice(0, i + 1);
      const currentTime = data[sym].tf15m[i].closeTime;
      const tf1h = data[sym].tf1h.filter(k => k.closeTime <= currentTime);
      
      const sLong = evaluateSniperSignal(tf1h, slice15m, mode, 300, 'TRENDING_UP' as any, 0, undefined, 'UP', 'Mock', sym);
      if (sLong && sLong.score >= minScore) scanSignals.push({ symbol: sym, signal: sLong });

      const sShort = evaluateSniperSignal(tf1h, slice15m, mode, 300, 'TRENDING_DOWN' as any, 0, undefined, 'DOWN', 'Mock', sym);
      if (sShort && sShort.score >= minScore) scanSignals.push({ symbol: sym, signal: sShort });
    }

    if (scanSignals.length === 0) continue;

    metrics.totalSignals += scanSignals.length;

    // Sort by score desc (Deployment cluster ranking)
    scanSignals.sort((a, b) => b.signal.score - a.signal.score);

    const activeLongs = activePositions.filter(p => p.side === 'LONG');
    const activeShorts = activePositions.filter(p => p.side === 'SHORT');

    // Simulate Deep Red check (Circuit Breaker)
    let longsInDeepRed = 0;
    activeLongs.forEach(p => {
      const currentPrice = data[p.symbol].tf15m[i].close;
      const roi = ((currentPrice - p.entryPrice) / p.entryPrice) * 10; // assuming 10x leverage
      if (roi < -0.10) longsInDeepRed++;
    });

    let shortsInDeepRed = 0;
    activeShorts.forEach(p => {
      const currentPrice = data[p.symbol].tf15m[i].close;
      const roi = ((p.entryPrice - currentPrice) / p.entryPrice) * 10;
      if (roi < -0.10) shortsInDeepRed++;
    });

    let deployedLongsThisScan = 0;
    let deployedShortsThisScan = 0;

    for (const row of scanSignals) {
      const sym = row.symbol;
      const sig = row.signal;

      // Skip if already open
      if (activePositions.some(p => p.symbol === sym)) continue;

      if (sig.side === 'LONG') {
         if (activeLongs.length + deployedLongsThisScan >= MAX_SAME_SIDE_POSITIONS) {
            metrics.blockedByWaveCap++; 
            logEvent('waveCap', `[${rawTime}] Blocked ${sym} LONG: Wave cap of ${MAX_SAME_SIDE_POSITIONS} active LONGs reached.`);
            continue;
         }
         if (longsInDeepRed >= 1) {
            metrics.blockedByCircuitBreaker++; 
            logEvent('circuitBreaker', `[${rawTime}] Blocked ${sym} LONG: Circuit breaker tripped by deep red LONG (${longsInDeepRed} active).`);
            continue;
         }
         if (deployedLongsThisScan >= MAX_DEPLOY_PER_SCAN) {
            metrics.blockedByClusterRank++; 
            logEvent('cluster', `[${rawTime}] Blocked ${sym} LONG: Cluster limits reached, already deployed #1 rank.`);
            continue;
         }
         const btcCheck = checkBtcConfirmation(data['BTCUSDT'].tf15m, 'LONG', i);
         if (!btcCheck.ok) {
            metrics.blockedByBTC++; 
            logEvent('btc', `[${rawTime}] Blocked ${sym} LONG: BTC Gating - ${btcCheck.reason}`);
            continue;
         }
         
         // Passed all tests!
         deployedLongsThisScan++;
         metrics.actuallyDeployed++;
         logEvent('deployed', `[${rawTime}] ✅ Deployed ${sym} LONG successfully.`);
         activePositions.push({ symbol: sym, side: 'LONG', entryPrice: sig.entryPrice, openIndex: i });
      } else {
         if (activeShorts.length + deployedShortsThisScan >= MAX_SAME_SIDE_POSITIONS) {
            metrics.blockedByWaveCap++; 
            logEvent('waveCap', `[${rawTime}] Blocked ${sym} SHORT: Wave cap of ${MAX_SAME_SIDE_POSITIONS} active SHORTs reached.`);
            continue;
         }
         if (shortsInDeepRed >= 1) {
            metrics.blockedByCircuitBreaker++; 
            logEvent('circuitBreaker', `[${rawTime}] Blocked ${sym} SHORT: Circuit breaker tripped by deep red SHORT (${shortsInDeepRed} active).`);
            continue;
         }
         if (deployedShortsThisScan >= MAX_DEPLOY_PER_SCAN) {
            metrics.blockedByClusterRank++; 
            logEvent('cluster', `[${rawTime}] Blocked ${sym} SHORT: Cluster limits reached, already deployed #1 rank.`);
            continue;
         }
         const btcCheck = checkBtcConfirmation(data['BTCUSDT'].tf15m, 'SHORT', i);
         if (!btcCheck.ok) {
            metrics.blockedByBTC++; 
            logEvent('btc', `[${rawTime}] Blocked ${sym} SHORT: BTC Gating - ${btcCheck.reason}`);
            continue;
         }

         // Passed all tests!
         deployedShortsThisScan++;
         metrics.actuallyDeployed++;
         logEvent('deployed', `[${rawTime}] ✅ Deployed ${sym} SHORT successfully.`);
         activePositions.push({ symbol: sym, side: 'SHORT', entryPrice: sig.entryPrice, openIndex: i });
      }
    }

    // Fast-forward close logic: hold position randomly between 24 and 50 candles (6-12 hours) to simulate real trade lifecycle
    activePositions = activePositions.filter(p => i - p.openIndex < 40);
  }

  console.log(`\n=== DEPLOYMENT DISCIPLINE SIMULATION RESULTS ===`);
  console.log(`Total Valid Signals Generated: ${metrics.totalSignals}`);
  console.log(`\n--- PROTECTIVE BLOCKS STATS ---`);
  console.log(`Blocked by Wave/Directional Cap:      ${metrics.blockedByWaveCap}`);
  console.log(`Blocked by Cluster Ranking (>1):      ${metrics.blockedByClusterRank}`);
  console.log(`Blocked by Deep-Red Circuit Breaker:  ${metrics.blockedByCircuitBreaker}`);
  console.log(`Blocked by BTC Gating Weakness:       ${metrics.blockedByBTC}`);
  console.log(`---------------------------------`);
  console.log(`Actually Deployed Trades:             ${metrics.actuallyDeployed}`);
  console.log(`% Blocked by Deployment Discipline:   ${((metrics.totalSignals - metrics.actuallyDeployed) / Math.max(1, metrics.totalSignals) * 100).toFixed(1)}%`);

  console.log(`\n--- LOG SAMPLES: CLUSTER RANKING ---`);
  sampleLogs.cluster.forEach(l => console.log(l));

  console.log(`\n--- LOG SAMPLES: WAVE CAP REACHED ---`);
  sampleLogs.waveCap.forEach(l => console.log(l));

  console.log(`\n--- LOG SAMPLES: DEEP RED CIRCUIT BREAKER ---`);
  sampleLogs.circuitBreaker.forEach(l => console.log(l));

  console.log(`\n--- LOG SAMPLES: BTC GATING ---`);
  sampleLogs.btc.forEach(l => console.log(l));

  console.log(`\n--- LOG SAMPLES: SUCCESSFUL DEPLOYMENTS ---`);
  sampleLogs.deployed.forEach(l => console.log(l));
}

run();
