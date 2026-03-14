/**
 * Gold Bonanza Entry Engine Backtest
 * =====================================
 * Measures OLD (v2) vs NEW (v3) engine signal quality
 * using real historical Binance 15m kline data.
 *
 * For each signal, it looks forward N candles and measures:
 *  - MAE: Maximum Adverse Excursion (max drawdown against direction)
 *  - MFE: Maximum Favorable Excursion (max profit toward target)
 *  - first_move: did price go to profit first, or to loss first?
 *  - went_red_1c / went_red_3c / went_red_6c: did trade go negative in first N candles?
 *
 * Run with: npx tsx server/scripts/backtest.ts
 */

import { calcEMA, calcRSI, calcATR, calcSMA } from '../../src/engines/indicators';
import { detectMarketRegime } from '../../src/engines/regimeFilter';
import { evaluateSniperSignal as evalV3 } from '../../src/engines/sniperEngine';
import type { Kline, Signal, ModeConfig } from '../../src/types/trading';
import { MODES } from '../../src/types/trading';

const BINANCE_FUTURES = 'https://fapi.binance.com';
const TEST_SYMBOLS    = [
  'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'AVAXUSDT',
  'LINKUSDT', 'ARBUSDT', 'OPUSDT', 'NEARUSDT', 'INJUSDT',
  'STXUSDT', 'LDOUSDT', 'BLURUSDT', 'RNDRUSDT', 'APTUSDT'
];
const LOOKFORWARD_CANDLES = 6;
const HISTORY_LIMIT       = 500; // 500 x 15m = ~5 days of history per symbol

// ─── FETCH HELPER ──────────────────────────────────────────────────────
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

// ─── OLD ENGINE (v2 inline replica) ────────────────────────────────────
// Simplified replica of the original logic to compare against.
function evalV2Old(
  tf1h: Kline[], tf15m: Kline[], activeMode: ModeConfig, balance: number
): Signal | null {
  const modeKey: string = activeMode.key;
  if (!tf1h || tf1h.length < 210 || !tf15m || tf15m.length < 90) return null;

  const closes1h  = tf1h.map(c => c.close);
  const ema20_1h  = calcEMA(closes1h, 20);
  const ema50_1h  = calcEMA(closes1h, 50);
  const ema200_1h = calcEMA(closes1h, 200);
  const idx1h     = closes1h.length - 1;
  const close1h   = closes1h[idx1h];
  const e20_1h    = ema20_1h[idx1h];
  const e50_1h    = ema50_1h[idx1h];
  const e200_1h   = ema200_1h[idx1h];
  if ([e20_1h, e50_1h, e200_1h].some(v => v == null)) return null;

  const isUptrend   = close1h > e200_1h! && e20_1h! > e50_1h! && e50_1h! > e200_1h!;
  const isDowntrend = close1h < e200_1h! && e20_1h! < e50_1h! && e50_1h! < e200_1h!;
  let side: 'LONG' | 'SHORT';
  if (modeKey === 'AGGRESSIVE') {
    side = close1h > e50_1h! ? 'LONG' : 'SHORT';
  } else if (isUptrend) { side = 'LONG'; }
  else if (isDowntrend) { side = 'SHORT'; }
  else return null;

  const closes15    = tf15m.map(c => c.close);
  const highs15     = tf15m.map(c => c.high);
  const lows15      = tf15m.map(c => c.low);
  const vols15      = tf15m.map(c => c.volume);
  const ema20_15    = calcEMA(closes15, 20);
  const ema50_15    = calcEMA(closes15, 50);
  const rsi14_15    = calcRSI(closes15, 14);
  const atr14_15    = calcATR(highs15, lows15, closes15, 14);
  const volSMA20_15 = calcSMA(vols15, 20);
  const lastIdx     = closes15.length - 2;
  if (lastIdx <= 60) return null;

  const candle  = tf15m[lastIdx];
  const close15 = candle.close;
  const open15  = candle.open;
  const high15  = candle.high;
  const low15   = candle.low;
  const e20_15  = ema20_15[lastIdx];
  const e50_15  = ema50_15[lastIdx];
  const rsiNow  = rsi14_15[lastIdx];
  const rsiPrev = rsi14_15[lastIdx - 1];
  const atr     = atr14_15[lastIdx];
  const vol     = vols15[lastIdx];
  const volAvg  = volSMA20_15[lastIdx];

  if ([e20_15, e50_15, rsiNow, rsiPrev, atr, volAvg].some(v => v == null)) return null;

  const cfg   = activeMode.pullback;
  const slack = 0.02; // OLD 2% slack

  let score = 0;

  if (side === 'LONG') {
    // OLD value zone (loose 2%)
    const inZone = low15 <= e20_15! * 1.02 && high15 >= e50_15! * 0.98;
    if (!inZone) return null;
    score += 3;

    if (!(rsiNow! >= cfg.rsiMin && rsiNow! <= cfg.rsiMax)) return null;
    if (!(rsiNow! > rsiPrev!)) return null;
    score += 3;

    const volRatio = vol / volAvg!;
    if (volRatio < 1.0) return null;
    score += 2;

    const range     = Math.max(1e-9, high15 - low15);
    const body      = Math.abs(close15 - open15);
    const bodyPct   = (body / range) * 100;
    const closePos  = (close15 - low15) / range;
    const isBull    = close15 > open15;
    // OLD: very loose anatomy check in aggressive mode
    if (modeKey !== 'AGGRESSIVE' && !(isBull && bodyPct >= 55 && closePos >= 0.70)) return null;
    score += 2;

    // OLD: no expansion candle check, no late-entry check
    if (score < cfg.scoreMin) return null;

    const triggerPrice = high15 * 1.0025; // OLD: 0.25% above high
    const riskPerTrade = balance * activeMode.riskPct;
    const stopLoss     = Math.min(low15, e50_15!) * 0.9988;
    const stopDistance = Math.max(triggerPrice - stopLoss, triggerPrice * 0.0035);
    const takeProfit   = triggerPrice + 1.25 * stopDistance;
    const qty          = riskPerTrade / stopDistance;
    return {
      kind: 'SNIPER', side: 'LONG', score, reasons: ['old-engine'],
      entryPrice: triggerPrice, stopLoss, takeProfit,
      qty, sizeUSDT: qty * triggerPrice, atr15: atr!, volRatio
    };
  }
  return null;
}

// ─── MAE / MFE CALCULATOR ──────────────────────────────────────────────
function calcMaeMfe(
  signal: Signal,
  futureCandles: Kline[]
): {
  mae1: number; mae3: number; mae6: number;
  mfe1: number; mfe3: number; mfe6: number;
  firstMoveDirection: 'PROFIT' | 'LOSS' | 'NEUTRAL';
  wentRed1c: boolean; wentRed3c: boolean; wentRed6c: boolean;
} {
  const entry     = signal.entryPrice;
  const isLong    = signal.side === 'LONG';
  const sl        = signal.stopLoss;
  const stopDist  = Math.abs(entry - sl);

  const calc     = (n: number) => {
    const slice  = futureCandles.slice(0, n);
    if (!slice.length) return { mae: 0, mfe: 0 };
    const maxH   = Math.max(...slice.map(c => c.high));
    const minL   = Math.min(...slice.map(c => c.low));
    if (isLong) {
      const mae = Math.max(0, entry - minL) / stopDist * 100; // as % of stop distance
      const mfe = Math.max(0, maxH - entry) / stopDist * 100;
      return { mae, mfe };
    } else {
      const mae = Math.max(0, maxH - entry) / stopDist * 100;
      const mfe = Math.max(0, entry - minL) / stopDist * 100;
      return { mae, mfe };
    }
  };

  const r1 = calc(1), r3 = calc(3), r6 = calc(6);

  // First move: check first candle after entry
  let firstMoveDirection: 'PROFIT' | 'LOSS' | 'NEUTRAL' = 'NEUTRAL';
  if (futureCandles.length > 0) {
    const c1     = futureCandles[0];
    const profitMove = isLong ? (c1.high - entry) : (entry - c1.low);
    const lossMove   = isLong ? (entry - c1.low)   : (c1.high - entry);
    if (profitMove > lossMove * 1.2)  firstMoveDirection = 'PROFIT';
    else if (lossMove > profitMove * 1.2) firstMoveDirection = 'LOSS';
  }

  return {
    mae1: r1.mae, mae3: r3.mae, mae6: r6.mae,
    mfe1: r1.mfe, mfe3: r3.mfe, mfe6: r6.mfe,
    firstMoveDirection,
    wentRed1c: r1.mae > 25, // > 25% of stop distance = meaningful drawdown
    wentRed3c: r3.mae > 50,
    wentRed6c: r6.mae > 75,
  };
}

// ─── MAIN BACKTEST RUNNER ──────────────────────────────────────────────
async function runBacktest() {
  const mode   = MODES.AGGRESSIVE;
  const balance = 300;

  type Result = {
    symbol: string;
    engine: 'OLD' | 'NEW';
    score: number;
    entryTiming?: string;
    entryType?: string;
    zoneDistPct?: number;
    candleAtrRatio?: number;
    mae1: number; mae3: number; mae6: number;
    mfe1: number; mfe3: number; mfe6: number;
    firstMove: string;
    wentRed1c: boolean; wentRed3c: boolean; wentRed6c: boolean;
    blockedByNewEngine: boolean;
  };

  const results: Result[] = [];

  console.log('\n======================================================');
  console.log('  GOLD BONANZA ENTRY QUALITY BACKTEST — v2 vs v3');
  console.log('======================================================');
  console.log(`Mode: ${mode.key} | Balance: $${balance} | Symbols: ${TEST_SYMBOLS.length}`);
  console.log(`Lookforward: ${LOOKFORWARD_CANDLES} candles | History: ${HISTORY_LIMIT} x 15m candles\n`);

  // Fetch BTC data for regime detection
  let regime = 'TRENDING_UP'; // Force for comparison: CHOP produces 0 signals in both engines
  let btc4hTrend: 'UP' | 'DOWN' | 'RANGING' = 'UP';
  let regimeBonus = 1;
  let regimeLabel = 'TRENDING_UP (forced for backtest comparison)';
  try {
    const [btc1h, btc4h] = await Promise.all([
      fetchKlines('BTCUSDT', '1h', 220),
      fetchKlines('BTCUSDT', '4h', 100)
    ]);
    const det = detectMarketRegime(btc1h, btc4h);
    // Use real regime only if it has signals. If CHOP, override to RANGING for fair comparison.
    if (det.regime !== 'CHOP' && det.regime !== 'CRASH') {
      regime       = det.regime;
      btc4hTrend   = det.btc4hTrend;
      regimeBonus  = det.scoreBonus;
      regimeLabel  = `${det.regime}: ${det.reason}`;
    } else {
      console.log(`Real regime is ${det.regime} — overriding to TRENDING_UP for comparison test`);
    }
    console.log(`BTC Regime used: ${regimeLabel}`);
  } catch(e) {
    console.warn('BTC regime fetch failed, using TRENDING_UP');
  }

  for (const symbol of TEST_SYMBOLS) {
    try {
      process.stdout.write(`  Scanning ${symbol}...`);
      const [tf15m, tf1h] = await Promise.all([
        fetchKlines(symbol, '15m', HISTORY_LIMIT),
        fetchKlines(symbol, '1h', 220)
      ]);

      // Slide a window through 15m history, testing each candle as a potential signal
      const windowSize = 110; // minimum candles engine needs
      for (let i = windowSize; i < tf15m.length - LOOKFORWARD_CANDLES; i++) {
        const slice15m    = tf15m.slice(0, i + 1);
        const futureSlice = tf15m.slice(i + 1, i + 1 + LOOKFORWARD_CANDLES);

        // Use full 1H array — it represents ~9 days at 1H which is always sufficient
        // The engine only needs the most recent 210 candles of 1H data.
        const slice1h = tf1h;

        const signalOld = evalV2Old(slice1h, slice15m, mode, balance);
        const signalNew = evalV3(
          slice1h, slice15m, mode, balance,
          regime as any, regimeBonus, undefined, btc4hTrend as any,
          regimeLabel, symbol
        );

        // ── OLD engine result ────────────────────────────
        if (signalOld) {
          const mf = calcMaeMfe(signalOld, futureSlice);
          results.push({
            symbol, engine: 'OLD',
            score: signalOld.score,
            mae1: mf.mae1, mae3: mf.mae3, mae6: mf.mae6,
            mfe1: mf.mfe1, mfe3: mf.mfe3, mfe6: mf.mfe6,
            firstMove: mf.firstMoveDirection,
            wentRed1c: mf.wentRed1c, wentRed3c: mf.wentRed3c, wentRed6c: mf.wentRed6c,
            blockedByNewEngine: !signalNew
          });
        }

        // ── NEW engine result ────────────────────────────
        if (signalNew) {
          const atr       = signalNew.atr15;
          const close15   = slice15m[slice15m.length - 2].close;
          const high15    = slice15m[slice15m.length - 2].high;
          const low15     = slice15m[slice15m.length - 2].low;
          const range     = high15 - low15;
          const mf        = calcMaeMfe(signalNew, futureSlice);
          results.push({
            symbol, engine: 'NEW',
            score: signalNew.score,
            entryTiming:   signalNew.entryTiming,
            entryType:     signalNew.entryType,
            zoneDistPct:   signalNew.zoneDistancePct,
            candleAtrRatio: atr > 0 ? range / atr : 0,
            mae1: mf.mae1, mae3: mf.mae3, mae6: mf.mae6,
            mfe1: mf.mfe1, mfe3: mf.mfe3, mfe6: mf.mfe6,
            firstMove: mf.firstMoveDirection,
            wentRed1c: mf.wentRed1c, wentRed3c: mf.wentRed3c, wentRed6c: mf.wentRed6c,
            blockedByNewEngine: false
          });
        }
      }

      process.stdout.write(` done\n`);
    } catch (e: any) {
      console.error(`  ${symbol} ERROR: ${e.message}`);
    }
  }

  // ─── AGGREGATE RESULTS ─────────────────────────────────────────
  const oldResults = results.filter(r => r.engine === 'OLD');
  const newResults = results.filter(r => r.engine === 'NEW');

  const avg = (arr: number[]) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
  const pct = (n: number, total: number) => total > 0 ? ((n / total) * 100).toFixed(1) + '%' : 'N/A';

  const oldBlocked = oldResults.filter(r => r.blockedByNewEngine).length;

  console.log('\n======================================================');
  console.log('  BACKTEST RESULTS SUMMARY');
  console.log('======================================================\n');

  console.log(`SIGNAL COUNTS`);
  console.log(`  OLD engine: ${oldResults.length} signals`);
  console.log(`  NEW engine: ${newResults.length} signals`);
  console.log(`  Reduction:  ${((1 - newResults.length / Math.max(1, oldResults.length)) * 100).toFixed(1)}% fewer signals`);
  console.log(`  Old signals blocked by new rules: ${oldBlocked} (${pct(oldBlocked, oldResults.length)})\n`);

  console.log(`MAXIMUM ADVERSE EXCURSION (as % of stop distance, lower = better)`);
  console.log(`             1 candle   3 candles   6 candles`);
  console.log(`  OLD:       ${avg(oldResults.map(r=>r.mae1)).toFixed(1).padStart(8)}%  ${avg(oldResults.map(r=>r.mae3)).toFixed(1).padStart(9)}%  ${avg(oldResults.map(r=>r.mae6)).toFixed(1).padStart(9)}%`);
  console.log(`  NEW:       ${avg(newResults.map(r=>r.mae1)).toFixed(1).padStart(8)}%  ${avg(newResults.map(r=>r.mae3)).toFixed(1).padStart(9)}%  ${avg(newResults.map(r=>r.mae6)).toFixed(1).padStart(9)}%\n`);

  console.log(`MAXIMUM FAVORABLE EXCURSION (as % of stop distance, higher = better)`);
  console.log(`             1 candle   3 candles   6 candles`);
  console.log(`  OLD:       ${avg(oldResults.map(r=>r.mfe1)).toFixed(1).padStart(8)}%  ${avg(oldResults.map(r=>r.mfe3)).toFixed(1).padStart(9)}%  ${avg(oldResults.map(r=>r.mfe6)).toFixed(1).padStart(9)}%`);
  console.log(`  NEW:       ${avg(newResults.map(r=>r.mfe1)).toFixed(1).padStart(8)}%  ${avg(newResults.map(r=>r.mfe3)).toFixed(1).padStart(9)}%  ${avg(newResults.map(r=>r.mfe6)).toFixed(1).padStart(9)}%\n`);

  console.log(`IMMEDIATE DRAWDOWN RATE (% of trades going red quickly)`);
  console.log(`                   After 1c     After 3c     After 6c`);
  const oldRed1 = oldResults.filter(r=>r.wentRed1c).length;
  const oldRed3 = oldResults.filter(r=>r.wentRed3c).length;
  const oldRed6 = oldResults.filter(r=>r.wentRed6c).length;
  const newRed1 = newResults.filter(r=>r.wentRed1c).length;
  const newRed3 = newResults.filter(r=>r.wentRed3c).length;
  const newRed6 = newResults.filter(r=>r.wentRed6c).length;
  console.log(`  OLD:               ${pct(oldRed1,oldResults.length).padEnd(12)} ${pct(oldRed3,oldResults.length).padEnd(12)} ${pct(oldRed6,oldResults.length)}`);
  console.log(`  NEW:               ${pct(newRed1,newResults.length).padEnd(12)} ${pct(newRed3,newResults.length).padEnd(12)} ${pct(newRed6,newResults.length)}\n`);

  console.log(`FIRST MOVE DIRECTION`);
  const fmStat = (arr: Result[]) => {
    const p = arr.filter(r=>r.firstMove==='PROFIT').length;
    const l = arr.filter(r=>r.firstMove==='LOSS').length;
    return `PROFIT-first: ${pct(p,arr.length)}  LOSS-first: ${pct(l,arr.length)}`;
  };
  console.log(`  OLD: ${fmStat(oldResults)}`);
  console.log(`  NEW: ${fmStat(newResults)}\n`);

  console.log(`NEW ENGINE ENTRY QUALITY BREAKDOWN`);
  const optimalCount = newResults.filter(r=>r.entryTiming==='OPTIMAL').length;
  const earlyCount   = newResults.filter(r=>r.entryTiming==='EARLY').length;
  const lateCount    = newResults.filter(r=>r.entryTiming==='LATE').length;
  const revCount     = newResults.filter(r=>r.entryType==='REVERSAL').length;
  const contCount    = newResults.filter(r=>r.entryType==='CONTINUATION').length;
  console.log(`  Timing:   OPTIMAL=${pct(optimalCount,newResults.length)}  EARLY=${pct(earlyCount,newResults.length)}  LATE=${pct(lateCount,newResults.length)}`);
  console.log(`  Setup:    REVERSAL=${pct(revCount,newResults.length)}  CONTINUATION=${pct(contCount,newResults.length)}`);
  console.log(`  Avg Zone Distance: ${avg(newResults.map(r=>r.zoneDistPct??0)).toFixed(3)}%`);
  console.log(`  Avg Candle/ATR ratio: ${avg(newResults.map(r=>r.candleAtrRatio??0)).toFixed(2)}x\n`);

  console.log(`DIAGNOSIS`);
  const maeImprovement = avg(oldResults.map(r=>r.mae3)) - avg(newResults.map(r=>r.mae3));
  console.log(`  Average 3-candle MAE improvement: ${maeImprovement > 0 ? '+' : ''}${maeImprovement.toFixed(1)}% of stop distance`);
  const signalReduction = 1 - newResults.length / Math.max(1, oldResults.length);
  console.log(`  Signal count reduction: ${(signalReduction*100).toFixed(0)}% (target: quality > quantity)`);
  if (lateCount / Math.max(1, newResults.length) > 0.2) {
    console.log(`  ⚠️  WARNING: ${pct(lateCount,newResults.length)} of new signals still classified as LATE — consider tightening extension threshold`);
  } else {
    console.log(`  ✅ Late entry rate acceptable (<20%)`);
  }
  if (newRed1 / Math.max(1, newResults.length) < oldRed1 / Math.max(1, oldResults.length) - 0.05) {
    console.log(`  ✅ Immediate (1-candle) drawdown rate reduced`);
  }
  console.log('\n======================================================\n');
}

runBacktest().catch(console.error);
