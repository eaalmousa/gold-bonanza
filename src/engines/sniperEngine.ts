// ============================================
// Sniper Engine v2 — Pullback Signal Detection
// Now with SHORT support, regime filter,
// order flow confluence, and improved accuracy.
// ============================================

import type { Kline, Signal, ModeConfig, MarketRegime, OrderFlowSnapshot } from '../types/trading';
import { calcEMA, calcRSI, calcATR, calcSMA, calcMACD, calcBollingerBands, detectDoublePattern } from './indicators';
import { validateOrderFlow } from './regimeFilter';

export function evaluateSniperSignal(
  tf1h: Kline[],
  tf15m: Kline[],
  activeMode: ModeConfig,
  balance: number,
  regime?: MarketRegime,
  regimeScoreBonus?: number,
  orderFlow?: OrderFlowSnapshot,
  btc4hTrend?: 'UP' | 'DOWN' | 'RANGING'
): Signal | null {
  // modeKey extracted as string to avoid TypeScript narrowing after the aggressive early-return
  const modeKey: string = activeMode.key;
  if (!tf1h || tf1h.length < 210 || !tf15m || tf15m.length < 90) return null;

  // ─── REGIME GATE ────────────────────────────────
  // Block all sniper signals during a crash (unless aggressive mode for testing)
  if (regime === 'CRASH' && modeKey !== 'AGGRESSIVE') return null;

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

  // ─── DETERMINE DIRECTION ─────────────────────────
  const isUptrend = close1h > e200_1h! && e20_1h! > e50_1h! && e50_1h! > e200_1h!;
  const isDowntrend = close1h < e200_1h! && e20_1h! < e50_1h! && e50_1h! < e200_1h!;

  // Check EMA slopes (over 3 bars)
  const e20Slope1h = e20_1h! - ema20_1h[idx1h - 3]!;
  const e50Slope1h = e50_1h! - ema50_1h[idx1h - 3]!;

  let side: 'LONG' | 'SHORT';

  if (modeKey === 'AGGRESSIVE') {
    side = close1h > e50_1h! ? 'LONG' : 'SHORT';
  } else if (isUptrend && e20Slope1h > 0 && e50Slope1h >= 0) {
    side = 'LONG';
    // Block LONGs during downtrend regime
    if (regime === 'TRENDING_DOWN') return null;
  } else if (isDowntrend && e20Slope1h < 0 && e50Slope1h <= 0) {
    side = 'SHORT';
    // Block SHORTs during uptrend regime
    if (regime === 'TRENDING_UP') return null;
  } else {
    return null;
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
  const ema50_15 = calcEMA(closes15, 50);
  const rsi14_15 = calcRSI(closes15, 14);
  const atr14_15 = calcATR(highs15, lows15, closes15, 14);
  const volSMA20_15 = calcSMA(vols15, 20);
  const volSMA50_15 = calcSMA(vols15, 50);
  const dollarVols15 = vols15.map((v, i) => v * closes15[i]);
  const dollarVolSMA20_15 = calcSMA(dollarVols15, 20);

  // ─── NEW: MACD + BOLLINGER + PATTERN ────────────
  const macdResult = calcMACD(closes15);
  const bbResult = calcBollingerBands(closes15, 20, 2.0);
  const doublePattern = detectDoublePattern(highs15, lows15, closes15);

  const lastIdx = closes15.length - 2;
  if (lastIdx <= 60) return null;

  const candle = tf15m[lastIdx];
  const prev = tf15m[lastIdx - 1];
  const prev2 = tf15m[lastIdx - 2];

  const close15 = candle.close;
  const open15 = candle.open;
  const high15 = candle.high;
  const low15 = candle.low;

  const e20_15 = ema20_15[lastIdx];
  const e50_15 = ema50_15[lastIdx];
  const rsiNow = rsi14_15[lastIdx];
  const rsiPrev = rsi14_15[lastIdx - 1];
  const atr = atr14_15[lastIdx];
  const vol = vols15[lastIdx];
  const volAvg = volSMA20_15[lastIdx];
  const volLongAvg = (volSMA50_15[lastIdx] != null ? volSMA50_15[lastIdx] : volAvg);

  if ([e20_15, e50_15, rsiNow, rsiPrev, atr, volAvg, volLongAvg].some(v => v == null)) return null;

  const cfg = activeMode.pullback;
  const reasons: string[] = [];
  let score = 0;
  const slack = cfg.valueZoneSlack || 0.005;

  if (side === 'LONG') {
    // ═══════════════════════════════════════════════
    //  LONG PULLBACK LOGIC
    // ═══════════════════════════════════════════════

    // Value zone check
    const tradedIntoZone = (low15 <= e20_15! * (1 + slack)) && (high15 >= e50_15! * (1 - slack));
    const closesNearZone = (close15 <= e20_15! * (1 + slack)) && (close15 >= e50_15! * (1 - slack));
    const closeInsideUpperHalf = close15 >= (e50_15! + (e20_15! - e50_15!) * 0.55);
    if (modeKey !== 'AGGRESSIVE' && !(tradedIntoZone && closesNearZone && closeInsideUpperHalf)) return null;
    score += 2; // Reduced from 3
    reasons.push('Pullback into upper EMA zone');

    // 1h structure guard (Gate only, 0 points)
    const guard = (modeKey === 'CONSERVATIVE') ? 0.0025 : (modeKey === 'BALANCED' ? 0.004 : 0.0055);
    const distFrom1hE20 = (close15 - e20_1h!) / e20_1h!;
    const distFrom1hE50 = (close15 - e50_1h!) / e50_1h!;
    if (modeKey !== 'AGGRESSIVE' && (distFrom1hE20 < -guard || distFrom1hE50 < -guard * 1.4)) return null;
    // Removed score += 2.

    // RSI check
    if (!(rsiNow! >= cfg.rsiMin && rsiNow! <= cfg.rsiMax)) return null;
    if (modeKey !== 'AGGRESSIVE') {
      if (!(rsiNow! > rsiPrev! && (rsiNow! - rsiPrev!) >= 0.7)) return null;
    } else {
      if (!(rsiNow! > rsiPrev!)) return null;
    }
    score += 2; // Reduced from 3
    reasons.push(`RSI turning up (${rsiNow!.toFixed(1)})`);

    // Dollar volume check (Gate only, 0 points)
    const dollarVolAvg = dollarVolSMA20_15[lastIdx];
    if (cfg.minDollarVol15m && dollarVolAvg != null && dollarVolAvg < cfg.minDollarVol15m) return null;
    // Removed score += 1.

    // Volume spike
    const volSpike = volLongAvg ? (vol / volLongAvg!) : 0;
    if (cfg.volSpikeMult && volSpike < cfg.volSpikeMult) return null;
    const volRatio = vol / volAvg!;
    if (volRatio < cfg.volMult) return null;

    // Candle anatomy — bullish
    const range = Math.max(1e-9, high15 - low15);
    const body = Math.abs(close15 - open15);
    const bodyPct = (body / range) * 100;
    const closePos = (close15 - low15) / range;
    const isBullCandle = close15 > open15;
    const minBody = modeKey === 'AGGRESSIVE' ? 10 : 55;
    const minClosePos = modeKey === 'AGGRESSIVE' ? 0.20 : 0.70;
    if (modeKey !== 'AGGRESSIVE' && !(isBullCandle && bodyPct >= minBody && closePos >= minClosePos)) return null;
    
    // Reward extreme volume spikes heavily
    let volScore = 2;
    if (volRatio > 2.0) volScore += 2;
    if (volRatio > 3.5) volScore += 2;
    score += volScore;
    reasons.push(`Bull impulse + vol (${volRatio.toFixed(2)}x)`);

    // Acceleration
    if (prev2) {
      const accel = (close15 - prev.close) - (prev.close - prev2.close);
      const accelPct = accel / close15;
      if (modeKey !== 'AGGRESSIVE' && cfg.accelPctMin && accelPct < cfg.accelPctMin) return null;
      
      // Reward extreme acceleration
      if (accelPct > 0.0015) {
        score += 2;
        reasons.push(`Strong Accel (+${(accelPct * 100).toFixed(3)}%)`);
      } else if (accelPct > 0) {
        score += 1;
      }
    }

    // ATR check (Gate only, 0 points)
    const atrPct = (atr! / close15) * 100;
    if (!(atrPct > cfg.atrPctMin && atrPct < cfg.atrPctMax)) return null;
    // Removed score += 1.

    // Reversal confirmation
    const prevClose = prev.close;
    const prevE20 = ema20_15[lastIdx - 1];
    const reclaimHold = (prevE20 != null) && (prevClose > prevE20) && (close15 > e20_15!) &&
      (prev.low <= prevE20 * (1 + slack) || low15 <= e20_15! * (1 + slack));

    const lowerWick = Math.min(open15, close15) - low15;
    const lowerWickToBody = lowerWick / Math.max(1e-9, body);
    const nearE50 = low15 <= e50_15! * (1 + slack * 1.2);
    const reversalCandle = isBullCandle && nearE50 && (lowerWickToBody >= 1.35) && (closePos >= 0.62);
    const higherLow = (low15 > prev.low) && (low15 >= e50_15! * (1 - slack)) && (close15 > e20_15!);
    const prevCandleBull = prev.close > prev.open;
    const twoBarReversal = prevCandleBull && isBullCandle && (prev.low < e20_15!) && (close15 > e20_15!);

    const confirmed = (modeKey === 'AGGRESSIVE') || reclaimHold || reversalCandle || (higherLow && rsiNow! > 50) || twoBarReversal;
    if (!confirmed) return null;
    const closedAbovePrevHigh = close15 > prev.high;
    const heldAboveE20ByClose = close15 >= e20_15! * 1.001;
    if (modeKey !== 'AGGRESSIVE' && !(closedAbovePrevHigh && heldAboveE20ByClose)) return null;
    
    // Reward perfect reversals heavily
    score += (reversalCandle || twoBarReversal) ? 4 : 2;
    reasons.push('Reversal confirmed');

    // ─── ORDER FLOW CONFLUENCE ──────────────────────────────
    const flowCheck = validateOrderFlow(orderFlow, 'LONG');
    if (!flowCheck.ok && modeKey !== 'AGGRESSIVE') return null;
    
    score += flowCheck.score; // Up to +5 possible
    if (flowCheck.reasons.length > 0) {
      reasons.push(flowCheck.reasons[0]);
    }

    // ─── MACD CONFLUENCE BONUS ────────────────────────────
    const macdHist     = macdResult.histogram[lastIdx];
    const macdHistPrev = macdResult.histogram[lastIdx - 1];
    if (macdHist != null && macdHistPrev != null) {
      if (macdHist > 0 && macdHist > macdHistPrev) {
        score += 2;
        reasons.push('MACD histogram turning bullish');
      } else if (macdHist > macdHistPrev && macdHistPrev < 0) {
        score += 1;
        reasons.push('MACD bullish divergence developing');
      }
    }

    // ─── BOLLINGER BANDS CONFLUENCE BONUS ──────────────────
    const pctB = bbResult.percentB[lastIdx];
    if (pctB != null) {
      if (pctB <= 0.15) {
        score += 2;
        reasons.push(`Price at BB lower band (%B=${(pctB * 100).toFixed(0)}%) — oversold`);
      } else if (pctB <= 0.30) {
        score += 1;
        reasons.push(`Price near BB lower band (%B=${(pctB * 100).toFixed(0)}%)`);
      }
    }
    // Squeeze bonus: very tight bandwidth signals impending breakout
    const bw = bbResult.bandwidth[lastIdx];
    const bwPrev5 = bbResult.bandwidth[lastIdx - 5];
    if (bw != null && bwPrev5 != null && bw < bwPrev5 * 0.75) {
      score += 1;
      reasons.push('BB squeeze — compression building');
    }

    // ─── DOUBLE BOTTOM PATTERN BONUS ────────────────────────
    if (doublePattern === 'DOUBLE_BOTTOM') {
      score += 3;
      reasons.push('Double Bottom (W) pattern confirmed — neckline breakout');
    }

    // ─── REGIME SCORE BONUS ──────────────────────────────
    score += (regimeScoreBonus || 0); // Can be +2 for trending
    if (regimeScoreBonus && regimeScoreBonus > 0) {
      reasons.push('Market regime supportive');
    }

    if (score < cfg.scoreMin) return null;

    // ─── ENTRY/EXIT CALCULATIONS ───────────────────
    const triggerBuffer = (modeKey === 'CONSERVATIVE') ? 0.0025 : (modeKey === 'BALANCED' ? 0.0020 : 0.0015);
    const triggerPrice = high15 * (1 + triggerBuffer);
    const chasePct = ((triggerPrice - close15) / close15) * 100;
    if (modeKey !== 'AGGRESSIVE' && (chasePct > 0.55 || (triggerPrice - close15) > atr! * 0.40)) return null;

    const riskPerTrade = balance * activeMode.riskPct;
    const stopBase = Math.min(low15, e50_15!);
    const atrStop = triggerPrice - (atr! * 1.6);
    const structureStop = stopBase * (1 - 0.0012);
    const stopLoss = Math.min(structureStop, atrStop);
    const stopDistance = Math.max(triggerPrice - stopLoss, triggerPrice * 0.0035);
    const stopPctVal = (stopDistance / triggerPrice) * 100;
    if (modeKey !== 'AGGRESSIVE' && (stopPctVal > 2.2 || stopPctVal < 0.4)) return null;
    const takeProfit = triggerPrice + 1.25 * stopDistance;
    const takeProfit2 = triggerPrice + 2.5 * stopDistance;

    const qty = riskPerTrade / stopDistance;
    const sizeUSDT = qty * triggerPrice;

    return {
      kind: 'SNIPER', side: 'LONG', score, reasons,
      entryPrice: triggerPrice, stopLoss, takeProfit, takeProfit2,
      qty, sizeUSDT, atr15: atr!, volRatio
    };

  } else {
    // ═══════════════════════════════════════════════
    //  SHORT PULLBACK LOGIC (P2 — new)
    // ═══════════════════════════════════════════════

    // Value zone check (inverted — price rallies UP into EMA zone from below)
    const tradedIntoZone = (high15 >= e20_15! * (1 - slack)) && (low15 <= e50_15! * (1 + slack));
    const closesNearZone = (close15 >= e20_15! * (1 - slack)) && (close15 <= e50_15! * (1 + slack));
    // Close in lower half of the zone (bearish resolution)
    const closeInsideLowerHalf = close15 <= (e20_15! + (e50_15! - e20_15!) * 0.45);
    if (modeKey !== 'AGGRESSIVE' && !(tradedIntoZone && closesNearZone && closeInsideLowerHalf)) return null;
    score += 2; // Reduced from 3
    reasons.push('Rally into lower EMA zone');

    // 1h structure guard (inverted) (Gate only, 0 points)
    const guard = (modeKey === 'CONSERVATIVE') ? 0.0025 : (modeKey === 'BALANCED' ? 0.004 : 0.0055);
    const distFrom1hE20 = (e20_1h! - close15) / e20_1h!;
    const distFrom1hE50 = (e50_1h! - close15) / e50_1h!;
    if (modeKey !== 'AGGRESSIVE' && (distFrom1hE20 < -guard || distFrom1hE50 < -guard * 1.4)) return null;
    // Removed score += 2.

    // RSI check — must be overbought but turning down
    const rsiMinShort = 100 - cfg.rsiMax;
    const rsiMaxShort = 100 - cfg.rsiMin;
    if (!(rsiNow! >= rsiMinShort && rsiNow! <= rsiMaxShort)) return null;
    if (modeKey !== 'AGGRESSIVE') {
      if (!(rsiNow! < rsiPrev! && (rsiPrev! - rsiNow!) >= 0.7)) return null;
    } else {
      if (!(rsiNow! < rsiPrev!)) return null;
    }
    score += 2; // Reduced from 3
    reasons.push(`RSI turning down (${rsiNow!.toFixed(1)})`);

    // Dollar volume check (Gate only, 0 points)
    const dollarVolAvg = dollarVolSMA20_15[lastIdx];
    if (cfg.minDollarVol15m && dollarVolAvg != null && dollarVolAvg < cfg.minDollarVol15m) return null;
    // Removed score += 1.

    // Volume spike
    const volSpike = volLongAvg ? (vol / volLongAvg!) : 0;
    if (cfg.volSpikeMult && volSpike < cfg.volSpikeMult) return null;
    const volRatio = vol / volAvg!;
    if (volRatio < cfg.volMult) return null;

    // Candle anatomy — bearish
    const range = Math.max(1e-9, high15 - low15);
    const body = Math.abs(close15 - open15);
    const bodyPct = (body / range) * 100;
    const closePos = (high15 - close15) / range; // Distance from high (inverted)
    const isBearCandle = close15 < open15;
    
    const minBody = modeKey === 'AGGRESSIVE' ? 10 : 55;
    const minClosePos = modeKey === 'AGGRESSIVE' ? 0.20 : 0.70;
    if (modeKey !== 'AGGRESSIVE' && !(isBearCandle && bodyPct >= minBody && closePos >= minClosePos)) return null;
    
    // Reward extreme volume spikes heavily
    let volScore = 2;
    if (volRatio > 2.0) volScore += 2;
    if (volRatio > 3.5) volScore += 2;
    score += volScore;
    reasons.push(`Bear impulse + vol (${volRatio.toFixed(2)}x)`);

    // Acceleration (downward)
    if (prev2) {
      const accel = (prev.close - close15) - (prev2.close - prev.close);
      const accelPct = accel / close15;
      if (modeKey !== 'AGGRESSIVE' && cfg.accelPctMin && accelPct < cfg.accelPctMin) return null;
      
      // Reward extreme acceleration
      if (accelPct > 0.0015) {
        score += 2;
        reasons.push(`Strong Accel (+${(accelPct * 100).toFixed(3)}%)`);
      } else if (accelPct > 0) {
        score += 1;
      }
    }

    // ATR check (Gate only, 0 points)
    const atrPct = (atr! / close15) * 100;
    if (!(atrPct > cfg.atrPctMin && atrPct < cfg.atrPctMax)) return null;
    // Removed score += 1.

    // Reversal confirmation (bearish)
    const prevClose = prev.close;
    const prevE20 = ema20_15[lastIdx - 1];
    const lostE20 = (prevE20 != null) && (prevClose < prevE20) && (close15 < e20_15!);
    const upperWick = high15 - Math.max(open15, close15);
    const upperWickToBody = upperWick / Math.max(1e-9, body);
    const nearE50 = high15 >= e50_15! * (1 - slack * 1.2);
    const reversalCandle = isBearCandle && nearE50 && (upperWickToBody >= 1.35);
    const lowerHigh = (high15 < prev.high) && (high15 <= e50_15! * (1 + slack)) && (close15 < e20_15!);

    // New multi-bar verification for shorts (mirroring longing logic)
    const prevCandleBear = prev.close < prev.open;
    const twoBarReversal = prevCandleBear && isBearCandle && (prev.high > e20_15!) && (close15 < e20_15!);

    const confirmed = (modeKey === 'AGGRESSIVE') || lostE20 || reversalCandle || (lowerHigh && rsiNow! < 50) || twoBarReversal;
    if (!confirmed) return null;
    const closedBelowPrevLow = close15 < prev.low;
    const heldBelowE20ByClose = close15 <= e20_15! * 0.999;
    if (modeKey !== 'AGGRESSIVE' && !(closedBelowPrevLow && heldBelowE20ByClose)) return null;
    
    // Reward perfect reversals heavily
    score += (reversalCandle || twoBarReversal) ? 4 : 2;
    reasons.push('Bearish reversal confirmed');

    // ─── ORDER FLOW CONFLUENCE ─────────────────────
    const flowCheck = validateOrderFlow(orderFlow, 'SHORT');
    if (!flowCheck.ok && modeKey !== 'AGGRESSIVE') return null;
    
    score += flowCheck.score;
    if (flowCheck.reasons.length > 0) {
      reasons.push(flowCheck.reasons[0]);
    }

    // ─── REGIME SCORE BONUS ────────────────────────
    // For shorts, regime bonus is inverted (downtrend gives bonus)
    const shortRegimeBonus = regime === 'TRENDING_DOWN' ? Math.abs(regimeScoreBonus || 0) : -(regimeScoreBonus || 0);
    score += shortRegimeBonus;
    if (shortRegimeBonus > 0) {
      reasons.push('Market regime supports shorts');
    }

    if (score < cfg.scoreMin) return null;

    // ─── ENTRY/EXIT CALCULATIONS (SHORT) ──────────
    const triggerBuffer = (modeKey === 'CONSERVATIVE') ? 0.0025 : (modeKey === 'BALANCED' ? 0.0020 : 0.0015);
    const triggerPrice = low15 * (1 - triggerBuffer);
    const chasePct = ((close15 - triggerPrice) / close15) * 100;
    if (modeKey !== 'AGGRESSIVE' && (chasePct > 0.55 || (close15 - triggerPrice) > atr! * 0.40)) return null;

    const riskPerTrade = balance * activeMode.riskPct;
    const stopBase = Math.max(high15, e50_15!);
    const atrStop = triggerPrice + (atr! * 1.6);
    const structureStop = stopBase * (1 + 0.0012);
    const stopLoss = Math.max(structureStop, atrStop);
    const stopDistance = Math.max(stopLoss - triggerPrice, triggerPrice * 0.0035);
    const stopPctVal = (stopDistance / triggerPrice) * 100;
    if (modeKey !== 'AGGRESSIVE' && (stopPctVal > 2.2 || stopPctVal < 0.4)) return null;
    const takeProfit = triggerPrice - 1.25 * stopDistance;
    const takeProfit2 = triggerPrice - 2.5 * stopDistance;

    const qty = riskPerTrade / stopDistance;
    const sizeUSDT = qty * triggerPrice;

    return {
      kind: 'SNIPER', side: 'SHORT', score, reasons,
      entryPrice: triggerPrice, stopLoss, takeProfit, takeProfit2,
      qty, sizeUSDT, atr15: atr!, volRatio
    };
  }
}

