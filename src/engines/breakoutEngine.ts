// ============================================
// Breakout Engine v2 — Super Sniper Detection
// Now with 1H trend gate, regime filter,
// order flow confluence, false breakout shield,
// and SHORT support.
// ============================================

import type { Kline, Signal, ModeConfig, MarketRegime, OrderFlowSnapshot } from '../types/trading';
import { calcEMA, calcRSI, calcATR, calcSMA } from './indicators';
import { validateOrderFlow } from './regimeFilter';

export function evaluateBreakoutSignal(
  tf1h: Kline[],
  tf15m: Kline[],
  activeMode: ModeConfig,
  balance: number,
  regime?: MarketRegime,
  regimeScoreBonus?: number,
  orderFlow?: OrderFlowSnapshot,
  btc4hTrend?: 'UP' | 'DOWN' | 'RANGING'
): Signal | null {
  // modeKey extracted as string to avoid TypeScript narrowing in non-AGGRESSIVE path
  const modeKey: string = activeMode.key;



  if (!tf1h || tf1h.length < 210 || !tf15m || tf15m.length < 90) return null;

  // ─── REGIME GATE ────────────────────────────────
  if (regime === 'CRASH' && modeKey !== 'AGGRESSIVE') return null;

  // ─── P4: 1H TREND GATE (was missing!) ───────────
  const closes1h = tf1h.map(c => c.close);
  const ema20_1h = calcEMA(closes1h, 20);
  const ema50_1h = calcEMA(closes1h, 50);
  const ema200_1h = calcEMA(closes1h, 200);
  const idx1h = closes1h.length - 1;
  const close1h = closes1h[idx1h];
  const e20_1h = ema20_1h[idx1h];
  const e50_1h = ema50_1h[idx1h];
  const e200_1h = ema200_1h[idx1h];

  if ([e20_1h, e50_1h, e200_1h].some(v => v == null)) return null;

  // Determine direction from 1H structure
  const isUptrend1h = close1h > e200_1h! && e20_1h! > e50_1h!;
  const isDowntrend1h = close1h < e200_1h! && e20_1h! < e50_1h!;

  let side: 'LONG' | 'SHORT';
  if (modeKey === 'AGGRESSIVE') {
    side = close1h > e50_1h! ? 'LONG' : 'SHORT';
  } else if (isUptrend1h) {
    side = 'LONG';
    if (regime === 'TRENDING_DOWN') return null; // Don't go long in bear regime
  } else if (isDowntrend1h) {
    side = 'SHORT';
    if (regime === 'TRENDING_UP') return null; // Don't go short in bull regime
  } else {
    // No clear 1H direction — require RANGING regime to be lenient
    if (regime !== 'RANGING') return null;
    // Default to LONG if above EMA200, SHORT if below
    side = close1h > e200_1h! ? 'LONG' : 'SHORT';
  }

  // ─── 4H MACRO TREND GATE ────────────────────────
  if (modeKey !== 'AGGRESSIVE' && btc4hTrend) {
    if (side === 'LONG' && btc4hTrend === 'DOWN') return null;
    if (side === 'SHORT' && btc4hTrend === 'UP') return null;
  }

  // ─── 15m DATA ───────────────────────────────────
  const closes15 = tf15m.map(c => c.close);
  const highs15 = tf15m.map(c => c.high);
  const lows15 = tf15m.map(c => c.low);
  const vols15 = tf15m.map(c => c.volume);

  const ema20_15 = calcEMA(closes15, 20);
  const rsi14_15 = calcRSI(closes15, 14);
  const atr14_15 = calcATR(highs15, lows15, closes15, 14);
  const volSMA20_15 = calcSMA(vols15, 20);
  const volSMA50_15 = calcSMA(vols15, 50);
  const dollarVols15 = vols15.map((v, i) => v * closes15[i]);
  const dollarVolSMA20_15 = calcSMA(dollarVols15, 20);

  const lastIdx = closes15.length - 2;
  if (lastIdx < 60) return null;

  const cfg = activeMode.breakout;
  const candle = tf15m[lastIdx];
  const prev = tf15m[lastIdx - 1];
  const prev2 = tf15m[lastIdx - 2];

  const close15 = candle.close;
  const open15 = candle.open;
  const high15 = candle.high;
  const low15 = candle.low;

  const rsiNow = rsi14_15[lastIdx];
  const atr = atr14_15[lastIdx];
  const volNow = vols15[lastIdx];
  const volAvg = volSMA20_15[lastIdx];
  const volLongAvg = volSMA50_15[lastIdx] ?? volAvg;
  const e20 = ema20_15[lastIdx];

  if ([rsiNow, atr, volAvg, volLongAvg, e20].some(v => v == null)) return null;

  const reasons: string[] = [];
  let score = 0;

  if (side === 'LONG') {
    // ═══════════════════════════════════════════════
    //  LONG BREAKOUT
    // ═══════════════════════════════════════════════

    // RSI range
    if (!(rsiNow! >= cfg.rsiMin && rsiNow! <= cfg.rsiMax)) return null;
    score += 1; // Reduced from 2
    reasons.push(`RSI in breakout zone (${rsiNow!.toFixed(1)})`);

    // Coil (compression)
    const coilBars = Math.max(cfg.coilBars, 4);
    let hiCoil = -Infinity, loCoil = Infinity;
    for (let i = lastIdx - coilBars; i < lastIdx; i++) {
      if (i < 0) continue;
      hiCoil = Math.max(hiCoil, highs15[i]);
      loCoil = Math.min(loCoil, lows15[i]);
    }
    const coilRange = hiCoil > 0 ? ((hiCoil - loCoil) / hiCoil) * 100 : 100;
    if (coilRange > cfg.coilRangePctMax) return null;
    score += 3;
    reasons.push(`Compression detected (${coilRange.toFixed(2)}% range)`);

    // Breakout above coil high
    const breakLevel = hiCoil * (1 + cfg.breakPct);
    if (modeKey !== 'AGGRESSIVE' && close15 < breakLevel) return null;
    score += 3;
    reasons.push('Breakout above compression range');

    // ─── FALSE BREAKOUT SHIELD (P7) ───────────────
    // The breakout candle close must be >60% of the way from breakLevel to candle high
    const breakoutQuality = (close15 - breakLevel) / Math.max(1e-9, high15 - breakLevel);
    if (modeKey !== 'AGGRESSIVE' && breakoutQuality < 0.60) return null;
    score += 1;
    reasons.push('Strong breakout close (clean break)');

    // Check that the PREVIOUS candle wasn't already above the break level (avoid late entries)
    if (modeKey !== 'AGGRESSIVE' && prev.close > breakLevel) return null;

    // Volume confirmation
    const volRatio = volNow / volAvg!;
    const volSpike = volLongAvg ? (volNow / volLongAvg!) : 0;
    if (volRatio < cfg.volMult || volSpike < cfg.volSpikeMult) return null;
    
    // Progressive volume scoring
    let volScore = 2; // base
    if (volRatio > 2.0) volScore += 2;
    if (volRatio > 3.0) volScore += 1;
    score += volScore;
    reasons.push(`Volume surge (${volRatio.toFixed(2)}x)`);

    // Dollar volume floor (Gate only, 0 points)
    const dollarVolAvg = dollarVolSMA20_15[lastIdx];
    if (cfg.minDollarVol15m && dollarVolAvg != null && dollarVolAvg < cfg.minDollarVol15m) return null;
    // Removed score += 1.

    // Candle anatomy
    const range = Math.max(1e-9, high15 - low15);
    const body = Math.abs(close15 - open15);
    const bodyPct = (body / range) * 100;
    const closePos = (close15 - low15) / range;
    const isBullCandle = close15 > open15;
    
    // In aggressive mode, we are extremely lenient on candle anatomy
    const minBody = modeKey === 'AGGRESSIVE' ? 10 : 65;
    const minClosePos = modeKey === 'AGGRESSIVE' ? 0.20 : 0.78;
    
    if (modeKey !== 'AGGRESSIVE' && !(isBullCandle && bodyPct >= minBody && closePos >= minClosePos)) return null;
    score += 1; // Reduced from 2
    reasons.push('Strong candle close');

    // Acceleration (0 points, just a gate)
    if (prev2) {
      const accel = (close15 - prev.close) - (prev.close - prev2.close);
      const accelPct = accel / close15;
      if (modeKey !== 'AGGRESSIVE' && cfg.accelPctMin && accelPct < cfg.accelPctMin) return null;
      // Removed score += 1
      if (accelPct > 0.002) {
         score += 1;
         reasons.push(`Acceleration (+${(accelPct * 100).toFixed(3)}%)`);
      }
    }

    // ─── ORDER FLOW CONFLUENCE ─────────────────────
    const flowCheck = validateOrderFlow(orderFlow, 'LONG');
    if (!flowCheck.ok && modeKey !== 'AGGRESSIVE') return null;
    
    score += flowCheck.score;
    if (flowCheck.reasons.length > 0) {
      reasons.push(flowCheck.reasons[0]);
    }

    // ─── 1H TREND BONUS ───────────────────────────
    score += 1; // Bonus for having passed 1H gate
    reasons.push('1H trend confirmed');

    // ─── REGIME BONUS ─────────────────────────────
    score += (regimeScoreBonus || 0);
    if (regimeScoreBonus && regimeScoreBonus > 0) {
      reasons.push('Market regime supportive');
    }

    if (score < cfg.scoreMin) return null;

    // Entry/risk calculations
    const triggerBuffer = 0.0015;
    const triggerPrice = close15 * (1 + triggerBuffer);
    const riskPerTrade = balance * activeMode.riskPct;
    const stopBase = Math.max(loCoil, e20! * (1 - 0.002));
    const atrStop = triggerPrice - (atr! * 1.8);
    const stopLoss = Math.max(stopBase, atrStop);
    const stopDistance = Math.max(triggerPrice - stopLoss, triggerPrice * 0.004);
    const stopPctVal = (stopDistance / triggerPrice) * 100;
    if (modeKey !== 'AGGRESSIVE' && (stopPctVal > 2.2 || stopPctVal < 0.4)) return null;
    const takeProfit = triggerPrice + 1.25 * stopDistance;
    const takeProfit2 = triggerPrice + 2.5 * stopDistance;

    const qty = riskPerTrade / stopDistance;
    const sizeUSDT = qty * triggerPrice;

    return {
      kind: 'SUPER_SNIPER', side: 'LONG', score, reasons,
      entryPrice: triggerPrice, stopLoss, takeProfit, takeProfit2,
      qty, sizeUSDT, atr15: atr!, volRatio
    };

  } else {
    // ═══════════════════════════════════════════════
    //  SHORT BREAKOUT (P2 — new)
    // ═══════════════════════════════════════════════

    // RSI range (inverted for shorts: bearish momentum)
    const rsiMinShort = 100 - cfg.rsiMax;
    const rsiMaxShort = 100 - cfg.rsiMin;
    if (!(rsiNow! >= rsiMinShort && rsiNow! <= rsiMaxShort)) return null;
    score += 1; // Reduced from 2
    reasons.push(`RSI in short breakout zone (${rsiNow!.toFixed(1)})`);

    // Coil (compression)
    const coilBars = Math.max(cfg.coilBars, 4);
    let hiCoil = -Infinity, loCoil = Infinity;
    for (let i = lastIdx - coilBars; i < lastIdx; i++) {
      if (i < 0) continue;
      hiCoil = Math.max(hiCoil, highs15[i]);
      loCoil = Math.min(loCoil, lows15[i]);
    }
    const coilRange = hiCoil > 0 ? ((hiCoil - loCoil) / hiCoil) * 100 : 100;
    if (coilRange > cfg.coilRangePctMax) return null;
    score += 3;
    reasons.push(`Compression detected (${coilRange.toFixed(2)}% range)`);

    // Breakdown below coil low
    const breakLevel = loCoil * (1 - cfg.breakPct);
    if (modeKey !== 'AGGRESSIVE' && close15 > breakLevel) return null;
    score += 3;
    reasons.push('Breakdown below compression range');

    // ─── FALSE BREAKOUT SHIELD (P7 - inverted) ────────
    const breakoutQuality = (breakLevel - close15) / Math.max(1e-9, breakLevel - low15);
    if (modeKey !== 'AGGRESSIVE' && breakoutQuality < 0.60) return null;
    score += 1;
    reasons.push('Strong breakdown close (clean break)');

    if (modeKey !== 'AGGRESSIVE' && prev.close < breakLevel) return null; // Previous candle already broken

    // Volume confirmation
    const volRatio = volNow / volAvg!;
    const volSpike = volLongAvg ? (volNow / volLongAvg!) : 0;
    if (volRatio < cfg.volMult || volSpike < cfg.volSpikeMult) return null;
    
    // Progressive volume scoring
    let volScore = 2; // base
    if (volRatio > 2.0) volScore += 2;
    if (volRatio > 3.0) volScore += 1;
    score += volScore;
    reasons.push(`Volume surge (${volRatio.toFixed(2)}x)`);

    // Dollar volume floor (Gate only, 0 points)
    const dollarVolAvg = dollarVolSMA20_15[lastIdx];
    if (cfg.minDollarVol15m && dollarVolAvg != null && dollarVolAvg < cfg.minDollarVol15m) return null;
    // Removed score += 1.

    // Candle anatomy
    const range = Math.max(1e-9, high15 - low15);
    const body = Math.abs(close15 - open15);
    const bodyPct = (body / range) * 100;
    const closePos = (close15 - low15) / range;
    const isBearCandle = close15 < open15;
    
    const minBody = modeKey === 'AGGRESSIVE' ? 10 : 65;
    const maxClosePos = modeKey === 'AGGRESSIVE' ? 0.80 : 0.22;

    if (modeKey !== 'AGGRESSIVE' && !(isBearCandle && bodyPct >= minBody && closePos <= maxClosePos)) return null;
    score += 1; // Reduced from 2
    reasons.push('Strong bearish candle close');

    // Acceleration (downward) (0 points, just a gate)
    if (prev2) {
      const accel = (prev.close - close15) - (prev2.close - prev.close);
      const accelPct = accel / close15;
      if (modeKey !== 'AGGRESSIVE' && cfg.accelPctMin && accelPct < cfg.accelPctMin) return null;
      // Removed score += 1
      if (accelPct > 0.002) {
         score += 1;
         reasons.push(`Acceleration (-${(accelPct * 100).toFixed(3)}%)`);
      }
    }

    // Order flow
    const flowCheck = validateOrderFlow(orderFlow, 'SHORT');
    if (!flowCheck.ok && modeKey !== 'AGGRESSIVE') return null;
    score += flowCheck.score;
    if (flowCheck.reasons.length > 0) reasons.push(flowCheck.reasons[0]);

    score += 1; // 1H trend gate bonus
    reasons.push('1H trend confirmed (bearish)');

    const shortRegimeBonus = regime === 'TRENDING_DOWN' ? Math.abs(regimeScoreBonus || 0) : -(regimeScoreBonus || 0);
    score += shortRegimeBonus;

    if (score < cfg.scoreMin) return null;

    // Entry/risk calculations (SHORT)
    const triggerBuffer = 0.0015;
    const triggerPrice = close15 * (1 - triggerBuffer);
    const riskPerTrade = balance * activeMode.riskPct;
    const stopBase = Math.min(hiCoil, e20! * (1 + 0.002));
    const atrStop = triggerPrice + (atr! * 1.8);
    const stopLoss = Math.min(stopBase, atrStop);
    const stopDistance = Math.max(stopLoss - triggerPrice, triggerPrice * 0.004);
    const stopPctVal = (stopDistance / triggerPrice) * 100;
    if (modeKey !== 'AGGRESSIVE' && (stopPctVal > 2.2 || stopPctVal < 0.4)) return null;
    const takeProfit = triggerPrice - 1.25 * stopDistance;
    const takeProfit2 = triggerPrice - 2.5 * stopDistance;

    const qty = riskPerTrade / stopDistance;
    const sizeUSDT = qty * triggerPrice;

    return {
      kind: 'SUPER_SNIPER', side: 'SHORT', score, reasons,
      entryPrice: triggerPrice, stopLoss, takeProfit, takeProfit2,
      qty, sizeUSDT, atr15: atr!, volRatio
    };
  }
}

