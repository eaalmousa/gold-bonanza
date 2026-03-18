import { globalDebugLogs } from '../src/engines/sniperEngine';
import { Kline, ModeConfig, MarketRegime, OrderFlowSnapshot, Signal } from '../src/types/trading';
import { calcEMA, calcRSI, calcATR, calcSMA, calcMACD, calcBollingerBands, detectDoublePattern } from '../src/engines/indicators';
import { validateOrderFlow } from '../src/engines/regimeFilter';

const activeMode: ModeConfig = {
  key: 'BALANCED', maxTrades: 3, leverage: 5, riskPct: 0.02,
  pullback: { rsiMin: 22, rsiMax: 65, atrPctMin: 0.05, atrPctMax: 5.0, volMult: 1.3, volSpikeMult: 0, scoreMin: 10, accelPctMin: 0.0001, valueZoneSlack: 0.003, minDollarVol15m: 1000 },
  breakout: { breakPct: 0.003, minDollarVol15m: 1000, coilBars: 8, coilRangePctMax: 2.0, scoreMin: 12, rsiMin: 30, rsiMax: 70, accelPctMin: 0.0001, volMult: 1.5, volSpikeMult: 1.5 }
};

interface RelaxFlags {
  weakBearish?: boolean;
  contNotConf?: boolean;
  contStructure?: boolean;
  score?: boolean;
}

export function evaluateSniperSignalDiag(
  tf1h: Kline[],
  tf15m: Kline[],
  mode: ModeConfig,
  balance: number,
  regime: MarketRegime,
  regimeScoreBonus: number,
  orderFlow: OrderFlowSnapshot | undefined,
  btc4hTrend: 'UP' | 'DOWN' | 'RANGING',
  btcRegimeLabel: string,
  symbol: string,
  relax: RelaxFlags
): { sig: Signal | null, stats: any } {
  const modeKey = mode.key;
  const cfg = mode.pullback;
  const debugLog: string[] = [];
  const reasons: string[] = [];
  let score = 0;
  let stats: any = {};

  if (!tf1h || tf1h.length < 210 || !tf15m || tf15m.length < 90) return { sig: null, stats };

  const closes1h  = tf1h.map(c => c.close);
  const ema20_1h  = calcEMA(closes1h, 20);
  const ema50_1h  = calcEMA(closes1h, 50);
  const ema200_1h = calcEMA(closes1h, 200);
  const idx1h     = closes1h.length - 1;
  const close1h   = closes1h[idx1h];
  const e20_1h    = ema20_1h[idx1h];
  const e50_1h    = ema50_1h[idx1h];
  const e200_1h   = ema200_1h[idx1h];

  const isUptrend   = close1h > e200_1h! && e20_1h! > e50_1h! && e50_1h! > e200_1h!;
  const isDowntrend = close1h < e200_1h! && e20_1h! < e50_1h! && e50_1h! < e200_1h!;
  const e20Slope1h  = e20_1h! - (ema20_1h[idx1h - 3] ?? e20_1h!);
  const e50Slope1h  = e50_1h! - (ema50_1h[idx1h - 3] ?? e50_1h!);
  const isBreakingDown = close1h < e20_1h! && close1h < e50_1h! && e20Slope1h < 0 && e50Slope1h < 0;

  let side: 'LONG' | 'SHORT';
  if (isBreakingDown) side = 'SHORT';
  else if (isUptrend && e20Slope1h > 0 && e50Slope1h >= 0) side = 'LONG';
  else if (isDowntrend && e20Slope1h < 0 && e50Slope1h <= 0) side = 'SHORT';
  else return { sig: null, stats };

  if (side === 'LONG') return { sig: null, stats };

  const closes15      = tf15m.map(c => c.close);
  const highs15       = tf15m.map(c => c.high);
  const lows15        = tf15m.map(c => c.low);
  const vols15        = tf15m.map(c => c.volume);
  const ema20_15      = calcEMA(closes15, 20);
  const ema50_15      = calcEMA(closes15, 50);
  const rsi14_15      = calcRSI(closes15, 14);
  const atr14_15      = calcATR(highs15, lows15, closes15, 14);
  const volSMA20_15   = calcSMA(vols15, 20);

  const lastIdx = closes15.length - 2;
  const candle  = tf15m[lastIdx];
  const prev    = tf15m[lastIdx - 1];
  const prev2   = tf15m[lastIdx - 2];
  const close15 = candle.close;
  const open15  = candle.open;
  const high15  = candle.high;
  const low15   = candle.low;

  const e20_15    = ema20_15[lastIdx];
  const e50_15    = ema50_15[lastIdx];
  const rsiNow    = rsi14_15[lastIdx];
  const rsiPrev   = rsi14_15[lastIdx - 1];
  const atr       = atr14_15[lastIdx];
  const vol       = vols15[lastIdx];
  const volAvg    = volSMA20_15[lastIdx];

  const slack  = cfg.valueZoneSlack;
  const range  = Math.max(1e-9, high15 - low15);
  const body   = Math.abs(close15 - open15);

  const isBearCandleEarly = candle.close < candle.open;
  const breakdownZoneBypass = isBreakingDown && close15 < e20_15! && close15 < e50_15! && isBearCandleEarly && rsiNow! < 50;
  const inZone = high15 >= e20_15! * (1 - slack) && low15 <= e50_15! * (1 + slack);
  if (!inZone && !breakdownZoneBypass) return { sig: null, stats };

  const extensionBelowZone = (e20_15! - close15) / atr!;
  const lateCap = breakdownZoneBypass ? 1.8 : 1.0;
  if (extensionBelowZone > lateCap) return { sig: null, stats };

  const rsiMaxShort = 100 - cfg.rsiMin;
  const rsiMinShort = Math.min(15, cfg.rsiMin);
  if (!(rsiNow! >= rsiMinShort && rsiNow! <= rsiMaxShort)) return { sig: null, stats };

  const rsiTurningDown = (rsiNow! < rsiPrev! && (rsiPrev! - rsiNow!) >= 0.7);
  if (!rsiTurningDown) return { sig: null, stats };
  score += 2;

  // We relaxed volume globally for this diagnostic to avoid getting filtered before structural test
  const volRatio = vol / volAvg!;
  let volScore = 2;
  if (volRatio > 2.0) volScore += 2;
  if (volRatio > 3.5) volScore += 2;
  score += volScore;

  // Anatomy
  const bodyPct  = (body / range) * 100;
  const closePos = (high15 - close15) / range;
  const isBearCandle = close15 < open15;
  const minBody    = 55;
  const minClosePos = 0.70;

  stats.bodyPct = bodyPct;
  stats.closePos = closePos;
  stats.isBearCandle = isBearCandle;

  if (!(isBearCandle && bodyPct >= minBody && closePos >= minClosePos)) {
    stats.failedGate = 'Weak bearish confirmation';
    if (!relax.weakBearish) return { sig: null, stats };
  }

  const atrPct = (atr! / close15) * 100;
  if (!(atrPct > cfg.atrPctMin && atrPct < cfg.atrPctMax)) return { sig: null, stats };

  const prevE20     = ema20_15[lastIdx - 1];
  const lostE20     = (prevE20 != null) && (prev.close < prevE20) && (close15 < e20_15!);
  const upperWick   = high15 - Math.max(open15, close15);
  const upperWickRatio = upperWick / Math.max(1e-9, body);
  const nearE50     = high15 >= e50_15! * (1 - slack * 1.2);
  const reversalCandle = isBearCandle && nearE50 && (upperWickRatio >= 1.35);
  const lowerHigh   = (high15 < prev.high) && (high15 <= e50_15! * (1 + slack)) && (close15 < e20_15!);
  const prevCandleBear = prev.close < prev.open;
  const twoBarReversal = prevCandleBear && isBearCandle && (prev.high > e20_15!) && (close15 < e20_15!);

  const wasAboveE50Recently = highs15.slice(lastIdx - 5, lastIdx).some(h => h > e50_15!);
  const shortEntryType = wasAboveE50Recently && close15 < e20_15! ? 'REVERSAL' : 'CONTINUATION';

  stats.lostE20 = lostE20;
  stats.lowerHigh = lowerHigh;
  stats.twoBarReversal = twoBarReversal;
  const closedBelowPrevLow  = close15 < prev.low;
  const heldBelowE20ByClose = close15 <= e20_15! * 0.999;
  stats.closedBelowPrevLow = closedBelowPrevLow;
  stats.heldBelowE20ByClose = heldBelowE20ByClose;

  if (shortEntryType === 'REVERSAL') {
    const doublePattern = detectDoublePattern(highs15, lows15, closes15);
    const hasStrongReversal = reversalCandle || twoBarReversal || doublePattern === 'DOUBLE_TOP';
    if (!hasStrongReversal) {
        stats.failedGate = 'Short reversal not confirmed'; // Treat as cont for relax
        if (!relax.contNotConf) return { sig: null, stats };
    }
    score += reversalCandle || twoBarReversal ? 4 : 2;
  } else {
    const confirmed = lostE20 || (lowerHigh && rsiNow! < 50) || twoBarReversal;
    if (!confirmed) {
        stats.failedGate = 'Continuation not confirmed';
        if (!relax.contNotConf) return { sig: null, stats };
    }
    
    if (!(closedBelowPrevLow && heldBelowE20ByClose)) {
        stats.failedGate = 'Short continuation failed 15m structure hold';
        if (!relax.contStructure) return { sig: null, stats };
    }
    score += 2;
  }

  // Regime bonus
  score += regime === 'TRENDING_DOWN' ? 2 : -2;

  const effectiveScoreMin = cfg.scoreMin;
  stats.score = score;
  stats.scoreDeficit = effectiveScoreMin - score;

  if (score < effectiveScoreMin) {
    if (!stats.failedGate) stats.failedGate = 'Score below minimum threshold';
    if (!relax.score) return { sig: null, stats };
  }

  const triggerPrice   = low15 * (1 - 0.0012);
  const chasePct       = ((close15 - triggerPrice) / close15) * 100;
  if (chasePct > 0.45 || (close15 - triggerPrice) > atr! * 0.35) return { sig: null, stats };

  const structureStop  = Math.max(high15, e50_15!) * (1 + 0.0012);
  const atrStop        = triggerPrice + (atr! * 1.6);
  const minAtrStop     = triggerPrice + (atr! * 1.2);
  const stopLoss       = Math.max(Math.max(structureStop, atrStop), minAtrStop);
  const stopDistance   = Math.max(stopLoss - triggerPrice, triggerPrice * 0.0035);
  
  const stopPctVal     = (stopDistance / triggerPrice) * 100;
  if (stopPctVal > 2.5 || stopPctVal < 0.4) return { sig: null, stats };

  const takeProfit  = triggerPrice - 1.25 * stopDistance;
  const takeProfit2 = triggerPrice - 2.5  * stopDistance;

  return {
    sig: {
      kind: 'SNIPER', side: 'SHORT', score, reasons,
      entryPrice: triggerPrice, stopLoss, takeProfit, takeProfit2,
      qty: 1, sizeUSDT: 100, atr15: atr!, volRatio,
      entryType: shortEntryType, entryTiming: 'OPTIMAL',
      zoneDistancePct: 0, btcRegimeAtEntry: btcRegimeLabel, debugLog
    },
    stats
  };
}

async function fetchBinanceKlines(symbol: string, interval: string, startTime: number, endTime: number): Promise<Kline[]> {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${startTime}&endTime=${endTime}&limit=1000`;
  const res = await fetch(url);
  const data = await res.json() as any[][];
  return data.map(d => ({
    openTime: d[0], open: parseFloat(d[1]), high: parseFloat(d[2]),
    low: parseFloat(d[3]), close: parseFloat(d[4]), volume: parseFloat(d[5]), closeTime: d[6]
  }));
}

async function runDiagnostic() {
  console.log('\n======================================================');
  console.log('--- STRUCTURAL GATE DIAGNOSTIC ---');
  console.log('======================================================');

  const crashEvents = [
    { type: 'ALT', name: 'LUNA Crash Altcoin Dump (AVAX)', symbol: 'AVAXUSDT', startT: 1652054400000, endT: 1652313600000 },
    { type: 'ALT', name: 'FTX Crash Sol Ecosystem (SOL)', symbol: 'SOLUSDT', startT: 1667865600000, endT: 1668124800000 },
    { type: 'ALT', name: 'Aug 2024 Flash Crash Altcoin (ETH)', symbol: 'ETHUSDT', startT: 1722729600000, endT: 1722988800000 }
  ];

  let resA = [];
  let resB = [];
  let resC = [];
  let resD = [];

  for (const ev of crashEvents) {
    const primeTime = ev.startT - (14 * 24 * 60 * 60 * 1000);
    const k1h = [...await fetchBinanceKlines(ev.symbol, '1h', primeTime, ev.startT), ...await fetchBinanceKlines(ev.symbol, '1h', ev.startT, ev.endT)];
    const k15 = [...await fetchBinanceKlines(ev.symbol, '15m', ev.startT - (7*24*3600*1000), ev.startT), ...await fetchBinanceKlines(ev.symbol, '15m', ev.startT, ev.endT)];

    let startIndex15 = k15.findIndex(k => k.openTime >= ev.startT);
    if(startIndex15 === -1) startIndex15 = 100;
    if(startIndex15 < 100) startIndex15 = 100;

    for (let i = startIndex15; i < k15.length; i++) {
        const cur15 = k15[i];
        const cur1HBase = k1h.filter(h => h.openTime <= cur15.openTime);
        if (cur1HBase.length < 210) continue;

        const slice15 = k15.slice(0, i + 1);
        
        // Strict Evaluation
        const strict = evaluateSniperSignalDiag(cur1HBase, slice15, activeMode, 10000, 'TRENDING_DOWN', 2, undefined, 'DOWN', 'NORMAL', ev.symbol, {});
        
        if (strict.sig === null && strict.stats.failedGate) {
            const relaxFlag = 
                strict.stats.failedGate === 'Weak bearish confirmation' ? {weakBearish:true} :
                strict.stats.failedGate.includes('not confirmed') ? {contNotConf:true} :
                strict.stats.failedGate === 'Short continuation failed 15m structure hold' ? {contStructure:true} :
                strict.stats.failedGate === 'Score below minimum threshold' ? {score:true} : {};

            const relaxed = evaluateSniperSignalDiag(cur1HBase, slice15, activeMode, 10000, 'TRENDING_DOWN', 2, undefined, 'DOWN', 'NORMAL', ev.symbol, relaxFlag);

            const futurePrice = slice15.length + 12 < k15.length ? k15[slice15.length + 12].close : k15[k15.length-1].close;
            const entryPrice = cur15.close;
            const isProfitable = futurePrice < entryPrice;

            const entryStr = `  Time: ${new Date(cur15.openTime).toISOString()} | Price: ${entryPrice.toFixed(2)}\n` +
                             `    - Anatomy: body=${strict.stats.bodyPct?.toFixed(0)}% (req 55%), closePos=${strict.stats.closePos?.toFixed(2)} (req 0.70), bearCdl=${strict.stats.isBearCandle}\n` +
                             `    - Flags: lostE20=${strict.stats.lostE20}, lowerHigh=${strict.stats.lowerHigh}, 2BarRev=${strict.stats.twoBarReversal}, closedBelowPrevLow=${strict.stats.closedBelowPrevLow}, heldBelowE20=${strict.stats.heldBelowE20ByClose}\n` +
                             `    - Score: ${strict.stats.score} (Deficit: ${strict.stats.scoreDeficit})\n` +
                             `    - Relaxed Outcome: ${relaxed.sig ? 'VALID SHORT' : 'STILL REJECTED downstream'}\n` +
                             `    - Future Price (3H): ${futurePrice.toFixed(2)} -> ${isProfitable ? 'PROFITABLE/SAFE' : 'DANGEROUS (Price Rose)'}`;

            if (strict.stats.failedGate === 'Weak bearish confirmation') resA.push(entryStr);
            else if (strict.stats.failedGate.includes('not confirmed')) resB.push(entryStr);
            else if (strict.stats.failedGate === 'Short continuation failed 15m structure hold') resC.push(entryStr);
            else if (strict.stats.failedGate === 'Score below minimum threshold') resD.push(entryStr);
        }
    }
  }

  console.log('\n======================================================');
  console.log(`A. Cases blocked by weak bearish confirmation (${resA.length}x)`);
  resA.slice(0, 3).forEach(l => console.log(l));

  console.log('\n======================================================');
  console.log(`B. Cases blocked by continuation confirmation (${resB.length}x)`);
  resB.slice(0, 3).forEach(l => console.log(l));

  console.log('\n======================================================');
  console.log(`C. Cases blocked by 15m structure hold (${resC.length}x)`);
  resC.slice(0, 3).forEach(l => console.log(l));

  console.log('\n======================================================');
  console.log(`D. Cases blocked only by score deficit (${resD.length}x)`);
  resD.slice(0, 3).forEach(l => console.log(l));

}

runDiagnostic().catch(console.error);
