// ============================================
// Sniper Engine v3 — Precision Pullback Engine
// Key improvements over v2:
//  - Setup type classification: REVERSAL vs CONTINUATION
//  - Late-entry blocker: rejects entries >1.0x ATR from zone
//  - Expansion-candle blocker: rejects candles >1.5x ATR range
//  - ATR-primary stop loss (min 1.2x ATR below entry)
//  - Order flow compensation for missing data (+3 score requirement)
//  - Quality report on every signal
//  - Debug log for accept/reject reasoning
// ============================================

import type { Kline, Signal, ModeConfig, MarketRegime, OrderFlowSnapshot } from '../types/trading';
import { calcEMA, calcRSI, calcATR, calcSMA, calcMACD, calcBollingerBands, detectDoublePattern } from './indicators';
import { validateOrderFlow } from './regimeFilter';

// ─── DEBUG LOGGER ─────────────────────────────────────────────────
function makeDebugLog(symbol?: string): string[] {
  const log: string[] = [];
  if (symbol) log.push(`[SniperV3] ${symbol}`);
  return log;
}

export function evaluateSniperSignal(
  tf1h: Kline[],
  tf15m: Kline[],
  activeMode: ModeConfig,
  balance: number,
  regime?: MarketRegime,
  regimeScoreBonus?: number,
  orderFlow?: OrderFlowSnapshot,
  btc4hTrend?: 'UP' | 'DOWN' | 'RANGING',
  btcRegimeLabel?: string,
  symbol?: string
): Signal | null {
  const modeKey: string = activeMode.key;
  const debugLog = makeDebugLog(symbol);

  if (!tf1h || tf1h.length < 210 || !tf15m || tf15m.length < 90) return null;

  // ─── GATE 1: REGIME ───────────────────────────────────
  if (regime === 'CRASH') {
    debugLog.push('REJECT: CRASH regime — no new entries');
    return null;
  }
  if (regime === 'CHOP' && modeKey !== 'AGGRESSIVE') {
    debugLog.push('REJECT: CHOP regime — sideways market, skip pullback entries');
    return null;
  }

  // ─── 1H STRUCTURE ANALYSIS ────────────────────────────
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

  // ─── GATE 2: DIRECTION ────────────────────────────────
  const isUptrend   = close1h > e200_1h! && e20_1h! > e50_1h! && e50_1h! > e200_1h!;
  const isDowntrend = close1h < e200_1h! && e20_1h! < e50_1h! && e50_1h! < e200_1h!;
  const e20Slope1h  = e20_1h! - (ema20_1h[idx1h - 3] ?? e20_1h!);
  const e50Slope1h  = e50_1h! - (ema50_1h[idx1h - 3] ?? e50_1h!);

  let side: 'LONG' | 'SHORT';

  if (modeKey === 'AGGRESSIVE') {
    side = close1h > e50_1h! ? 'LONG' : 'SHORT';
  } else if (isUptrend && e20Slope1h > 0 && e50Slope1h >= 0) {
    side = 'LONG';
    if (regime === 'TRENDING_DOWN') return null;
  } else if (isDowntrend && e20Slope1h < 0 && e50Slope1h <= 0) {
    side = 'SHORT';
    if (regime === 'TRENDING_UP') return null;
  } else {
    debugLog.push('REJECT: No clean 1H trend structure');
    return null;
  }

  // ─── GATE 3: BTC MACRO TREND ──────────────────────────
  if (modeKey !== 'AGGRESSIVE' && btc4hTrend) {
    if (side === 'LONG' && btc4hTrend === 'DOWN') {
      debugLog.push('REJECT: BTC 4H downtrend — no longs');
      return null;
    }
    if (side === 'SHORT' && btc4hTrend === 'UP') {
      debugLog.push('REJECT: BTC 4H uptrend — no shorts');
      return null;
    }
    // CHOP on BTC in aggressive mode is allowed but blocks short bonus
  }

  // ─── 15m INDICATORS ───────────────────────────────────
  const closes15      = tf15m.map(c => c.close);
  const highs15       = tf15m.map(c => c.high);
  const lows15        = tf15m.map(c => c.low);
  const vols15        = tf15m.map(c => c.volume);
  const ema20_15      = calcEMA(closes15, 20);
  const ema50_15      = calcEMA(closes15, 50);
  const rsi14_15      = calcRSI(closes15, 14);
  const atr14_15      = calcATR(highs15, lows15, closes15, 14);
  const volSMA20_15   = calcSMA(vols15, 20);
  const volSMA50_15   = calcSMA(vols15, 50);
  const dollarVols15  = vols15.map((v, i) => v * closes15[i]);
  const dollarVolSMA20_15 = calcSMA(dollarVols15, 20);
  const macdResult    = calcMACD(closes15);
  const bbResult      = calcBollingerBands(closes15, 20, 2.0);
  const doublePattern = detectDoublePattern(highs15, lows15, closes15);

  const lastIdx = closes15.length - 2;
  if (lastIdx <= 60) return null;

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
  const volLongAvg = volSMA50_15[lastIdx] ?? volAvg;

  if ([e20_15, e50_15, rsiNow, rsiPrev, atr, volAvg].some(v => v == null)) return null;

  const cfg    = activeMode.pullback;
  const slack  = cfg.valueZoneSlack;
  const range  = Math.max(1e-9, high15 - low15);
  const body   = Math.abs(close15 - open15);

  // ─── GATE 4a: EXPANSION-CANDLE BLOCKER (User Request 2) ──────────
  // Reject if trigger candle is >1.5x ATR — the move is already spent
  const candleAtrRatio = range / atr!;
  if (candleAtrRatio > 1.5) {
    debugLog.push(`REJECT: Expansion candle — range=${(range/atr!).toFixed(2)}x ATR > 1.5x`);
    return null;
  }
  debugLog.push(`PASS: Candle size ${candleAtrRatio.toFixed(2)}x ATR (limit 1.5x)`);

  // ─── SETUP TYPE CLASSIFIER ─────────────────────────────
  // REVERSAL: price was BELOW EMA50 recently and is now reclaiming EMA20
  // CONTINUATION: price stayed above EMA20 the whole time, just pulled back to it
  let entryType: 'REVERSAL' | 'CONTINUATION' = 'CONTINUATION';
  const wasbelowE50Recently = lows15.slice(lastIdx - 5, lastIdx).some(l => l < e50_15!);

  if (side === 'LONG') {
    if (wasbelowE50Recently && close15 > e20_15!) {
      entryType = 'REVERSAL';
    }
  } else {
    const wasAboveE50Recently = highs15.slice(lastIdx - 5, lastIdx).some(h => h > e50_15!);
    if (wasAboveE50Recently && close15 < e20_15!) {
      entryType = 'REVERSAL';
    }
  }
  debugLog.push(`Setup classified as: ${entryType}`);

  const reasons: string[] = [];
  let score = 0;

  if (side === 'LONG') {
    // ═══════════════════════════════════════════════
    //  LONG SNIPER
    // ═══════════════════════════════════════════════

    // GATE: Value zone check
    const zoneTop    = e20_15! * (1 + slack);
    const zoneBottom = e50_15! * (1 - slack);
    const inZone = low15 <= zoneTop && high15 >= zoneBottom;

    if (modeKey !== 'AGGRESSIVE' && !inZone) {
      debugLog.push(`REJECT: Price not in value zone [${zoneBottom.toFixed(4)} - ${zoneTop.toFixed(4)}]`);
      return null;
    }

    // ─── GATE 4b: LATE-ENTRY BLOCKER (User Request 1 / Finding 1+5) ───
    // Close must not already be extended above EMA20 by more than 1.0x ATR
    const extensionAboveZone = (close15 - e20_15!) / atr!;
    if (extensionAboveZone > 1.0 && modeKey !== 'AGGRESSIVE') {
      debugLog.push(`REJECT: Late entry — close is ${extensionAboveZone.toFixed(2)}x ATR above EMA20 (limit 1.0x)`);
      return null;
    }
    if (extensionAboveZone > 1.5) { // Even in aggressive mode, 1.5x is too far
      debugLog.push(`REJECT: Extreme late entry — ${extensionAboveZone.toFixed(2)}x ATR above zone`);
      return null;
    }

    // Calculate zone distance for quality report
    const zoneIdeal         = (e20_15! + e50_15!) / 2; // midpoint of EMA zone
    const zoneDistancePct   = ((close15 - zoneIdeal) / zoneIdeal) * 100;
    // Timing assessment
    const entryTiming: 'EARLY' | 'OPTIMAL' | 'LATE' =
      extensionAboveZone < 0.3 ? 'OPTIMAL' :
      extensionAboveZone < 0.7 ? 'EARLY' : 'LATE';
    debugLog.push(`Zone distance: ${zoneDistancePct.toFixed(2)}%, timing: ${entryTiming}, extension: ${extensionAboveZone.toFixed(2)}x ATR`);

    score += 2;
    reasons.push(`Pullback into EMA zone (${entryTiming})`);

    // GATE: 1H structure guard
    const guard = modeKey === 'CONSERVATIVE' ? 0.0025 : modeKey === 'BALANCED' ? 0.004 : 0.006;
    const distFrom1hE20 = (close15 - e20_1h!) / e20_1h!;
    const distFrom1hE50 = (close15 - e50_1h!) / e50_1h!;
    if (modeKey !== 'AGGRESSIVE' && (distFrom1hE20 < -guard || distFrom1hE50 < -guard * 1.4)) {
      debugLog.push('REJECT: Price too far below 1H EMA structure');
      return null;
    }

    // GATE: RSI
    if (!(rsiNow! >= cfg.rsiMin && rsiNow! <= cfg.rsiMax)) {
      debugLog.push(`REJECT: RSI ${rsiNow!.toFixed(1)} out of range [${cfg.rsiMin}-${cfg.rsiMax}]`);
      return null;
    }
    const rsiTurning = modeKey !== 'AGGRESSIVE'
      ? (rsiNow! > rsiPrev! && (rsiNow! - rsiPrev!) >= 0.7)
      : (rsiNow! > rsiPrev!);
    if (!rsiTurning) {
      debugLog.push(`REJECT: RSI not turning up (${rsiPrev!.toFixed(1)} → ${rsiNow!.toFixed(1)})`);
      return null;
    }
    score += 2;
    reasons.push(`RSI turning up (${rsiNow!.toFixed(1)})`);

    // GATE: Dollar volume floor
    const dollarVolAvg = dollarVolSMA20_15[lastIdx];
    if (cfg.minDollarVol15m && dollarVolAvg != null && dollarVolAvg < cfg.minDollarVol15m) {
      debugLog.push(`REJECT: Dollar volume ${(dollarVolAvg/1e6).toFixed(2)}M too low (min ${(cfg.minDollarVol15m/1e6).toFixed(2)}M)`);
      return null;
    }

    // Volume spike (Gate + Score)
    const volSpike = volLongAvg ? (vol / volLongAvg!) : 0;
    if (cfg.volSpikeMult && volSpike < cfg.volSpikeMult) {
      debugLog.push(`REJECT: Volume spike ${volSpike.toFixed(2)}x < required ${cfg.volSpikeMult}x`);
      return null;
    }
    const volRatio = vol / volAvg!;
    if (volRatio < cfg.volMult) {
      debugLog.push(`REJECT: Volume ratio ${volRatio.toFixed(2)}x < required ${cfg.volMult}x`);
      return null;
    }
    let volScore = 2;
    if (volRatio > 2.0) volScore += 2;
    if (volRatio > 3.5) volScore += 2;
    score += volScore;
    reasons.push(`Bull volume (${volRatio.toFixed(2)}x)`);

    // Candle anatomy
    const bodyPct    = (body / range) * 100;
    const closePos   = (close15 - low15) / range;
    const isBullCandle = close15 > open15;
    const minBody    = modeKey === 'AGGRESSIVE' ? 10 : 55;
    const minClosePos = modeKey === 'AGGRESSIVE' ? 0.20 : 0.70;
    if (modeKey !== 'AGGRESSIVE' && !(isBullCandle && bodyPct >= minBody && closePos >= minClosePos)) {
      debugLog.push(`REJECT: Weak candle anatomy — body ${bodyPct.toFixed(0)}%, closePos ${closePos.toFixed(2)}`);
      return null;
    }

    // Acceleration
    if (prev2) {
      const accel    = (close15 - prev.close) - (prev.close - prev2.close);
      const accelPct = accel / close15;
      if (modeKey !== 'AGGRESSIVE' && cfg.accelPctMin && accelPct < cfg.accelPctMin) {
        debugLog.push(`REJECT: Insufficient acceleration ${(accelPct*100).toFixed(3)}%`);
        return null;
      }
      if (accelPct > 0.0015) { score += 2; reasons.push(`Strong acceleration (+${(accelPct*100).toFixed(3)}%)`); }
      else if (accelPct > 0) score += 1;
    }

    // ATR range check
    const atrPct = (atr! / close15) * 100;
    if (!(atrPct > cfg.atrPctMin && atrPct < cfg.atrPctMax)) {
      debugLog.push(`REJECT: ATR% ${atrPct.toFixed(2)} out of range [${cfg.atrPctMin}-${cfg.atrPctMax}]`);
      return null;
    }

    // ─── REVERSAL vs CONTINUATION specific requirements ─────────────
    // REVERSAL: needs stronger confirmation (double-bar or major reversal candle + must reclaim EMA20)
    // CONTINUATION: easier (just needs to hold EMA20)
    const prevE20    = ema20_15[lastIdx - 1];
    const reclaimHold = (prevE20 != null) && (prev.close > prevE20) && (close15 > e20_15!) &&
      (prev.low <= prevE20 * (1 + slack) || low15 <= e20_15! * (1 + slack));
    const lowerWick     = Math.min(open15, close15) - low15;
    const lowerWickRatio = lowerWick / Math.max(1e-9, body);
    const nearE50       = low15 <= e50_15! * (1 + slack * 1.2);
    const reversalCandle = isBullCandle && nearE50 && (lowerWickRatio >= 1.35) && (closePos >= 0.62);
    const higherLow     = (low15 > prev.low) && (low15 >= e50_15! * (1 - slack)) && (close15 > e20_15!);
    const prevCandleBull = prev.close > prev.open;
    const twoBarReversal = prevCandleBull && isBullCandle && (prev.low < e20_15!) && (close15 > e20_15!);

    if (entryType === 'REVERSAL') {
      // Stricter: must have double-bottom OR two-bar OR reversal candle
      const hasStrongReversal = reversalCandle || twoBarReversal || doublePattern === 'DOUBLE_BOTTOM';
      if (!hasStrongReversal && modeKey !== 'AGGRESSIVE') {
        debugLog.push('REJECT: REVERSAL setup needs stronger confirmation (pinbar, two-bar, or double-bottom)');
        return null;
      }
      score += reversalCandle || twoBarReversal ? 4 : 2;
      reasons.push('Reversal confirmed');
    } else {
      // CONTINUATION: normal gate
      const confirmed = modeKey === 'AGGRESSIVE' || reclaimHold || (higherLow && rsiNow! > 50) || twoBarReversal;
      if (!confirmed) {
        debugLog.push('REJECT: CONTINUATION setup not confirmed (need EMA retest or higher-low)');
        return null;
      }
      const closedAbovePrevHigh  = close15 > prev.high;
      const heldAboveE20ByClose  = close15 >= e20_15! * 1.001;
      if (modeKey !== 'AGGRESSIVE' && !(closedAbovePrevHigh && heldAboveE20ByClose)) {
        debugLog.push('REJECT: Did not close above prev high while holding EMA20');
        return null;
      }
      score += 2;
      reasons.push('Continuation hold confirmed');
    }

    // ─── ORDER FLOW ─────────────────────────────────────────────
    const flowCheck  = validateOrderFlow(orderFlow, 'LONG');
    const missingFlowPenalty = flowCheck.missingFlow ? 3 : 0; // Compensate for missing data
    if (!flowCheck.ok && modeKey !== 'AGGRESSIVE') {
      debugLog.push('REJECT: Order flow is bearish');
      return null;
    }
    score += flowCheck.score;
    if (flowCheck.reasons.length > 0) reasons.push(flowCheck.reasons[0]);
    if (flowCheck.missingFlow) debugLog.push('NOTE: Order flow unavailable — score threshold raised by 3');

    // ─── MACD CONFLUENCE BONUS ───────────────────────────────────
    const macdHist     = macdResult.histogram[lastIdx];
    const macdHistPrev = macdResult.histogram[lastIdx - 1];
    if (macdHist != null && macdHistPrev != null) {
      if (macdHist > 0 && macdHist > macdHistPrev) { score += 2; reasons.push('MACD histogram bullish'); }
      else if (macdHist > macdHistPrev && macdHistPrev! < 0) { score += 1; reasons.push('MACD divergence building'); }
    }

    // ─── BOLLINGER BANDS CONFLUENCE BONUS ───────────────────────
    const pctB = bbResult.percentB[lastIdx];
    if (pctB != null) {
      if (pctB <= 0.15) { score += 2; reasons.push(`BB lower band (%B=${(pctB*100).toFixed(0)}%) — oversold`); }
      else if (pctB <= 0.30) { score += 1; reasons.push(`Near BB lower (%B=${(pctB*100).toFixed(0)}%)`); }
    }
    const bw = bbResult.bandwidth[lastIdx];
    const bwPrev5 = bbResult.bandwidth[lastIdx - 5];
    if (bw != null && bwPrev5 != null && bw < bwPrev5 * 0.75) {
      score += 1; reasons.push('BB squeeze — compression');
    }

    // ─── PATTERN BONUS ───────────────────────────────────────────
    if (doublePattern === 'DOUBLE_BOTTOM') {
      score += 3; reasons.push('Double Bottom (W) confirmed');
    }

    // ─── REGIME BONUS ────────────────────────────────────────────
    score += (regimeScoreBonus || 0);
    if (regimeScoreBonus && regimeScoreBonus > 0) reasons.push('Market regime supportive');

    // ─── FINAL SCORE CHECK ───────────────────────────────────────
    const effectiveScoreMin = cfg.scoreMin + missingFlowPenalty;
    debugLog.push(`Score: ${score} / required: ${effectiveScoreMin} (raw min ${cfg.scoreMin} + flow penalty ${missingFlowPenalty})`);
    if (score < effectiveScoreMin) {
      debugLog.push(`REJECT: Score ${score} below threshold ${effectiveScoreMin}`);
      return null;
    }

    // ─── ENTRY/EXIT CALCULATIONS ─────────────────────────────────
    const triggerBuffer = modeKey === 'CONSERVATIVE' ? 0.0015 : modeKey === 'BALANCED' ? 0.0012 : 0.0010;
    const triggerPrice  = high15 * (1 + triggerBuffer);
    const chasePct      = ((triggerPrice - close15) / close15) * 100;
    if (modeKey !== 'AGGRESSIVE' && (chasePct > 0.45 || (triggerPrice - close15) > atr! * 0.35)) {
      debugLog.push(`REJECT: Chase check — trigger ${chasePct.toFixed(2)}% above close`);
      return null;
    }

    const riskPerTrade = balance * activeMode.riskPct;

    // ATR-primary stop loss (Finding 9) — must be at least 1.2x ATR below entry
    const structureStop   = Math.min(low15, e50_15!) * (1 - 0.0012);
    const atrStop         = triggerPrice - (atr! * 1.6);
    const minAtrStop      = triggerPrice - (atr! * 1.2); // hard floor: never tighter than 1.2x ATR
    const rawStop         = Math.min(structureStop, atrStop);
    const stopLoss        = Math.min(rawStop, minAtrStop); // ensure we are at or below the 1.2x floor
    const stopDistance    = Math.max(triggerPrice - stopLoss, triggerPrice * 0.0035);
    const stopPctVal      = (stopDistance / triggerPrice) * 100;
    if (modeKey !== 'AGGRESSIVE' && (stopPctVal > 2.5 || stopPctVal < 0.4)) {
      debugLog.push(`REJECT: Stop distance ${stopPctVal.toFixed(2)}% out of bounds [0.4%-2.5%]`);
      return null;
    }

    const takeProfit  = triggerPrice + 1.25 * stopDistance;
    const takeProfit2 = triggerPrice + 2.5  * stopDistance;
    const qty         = riskPerTrade / stopDistance;
    const sizeUSDT    = qty * triggerPrice;

    // ─── ZONE DISTANCE for quality report ────────────────────────
    const zoneIdeal       = (e20_15! + e50_15!) / 2;
    const zoneDistPct     = ((close15 - zoneIdeal) / zoneIdeal) * 100;
    const extAbove        = (close15 - e20_15!) / atr!;
    const finalTiming: 'EARLY' | 'OPTIMAL' | 'LATE' =
      extAbove < 0.25 ? 'OPTIMAL' : extAbove < 0.65 ? 'EARLY' : 'LATE';

    debugLog.push(`ACCEPT: ${entryType} ${side} score=${score} trigger=${triggerPrice.toFixed(4)} SL=${stopLoss.toFixed(4)}`);

    return {
      kind: 'SNIPER', side: 'LONG', score, reasons,
      entryPrice: triggerPrice, stopLoss, takeProfit, takeProfit2,
      qty, sizeUSDT, atr15: atr!, volRatio,
      entryType,
      zoneDistancePct: parseFloat(zoneDistPct.toFixed(3)),
      btcRegimeAtEntry: btcRegimeLabel ?? 'UNKNOWN',
      entryTiming: finalTiming,
      debugLog
    };

  } else {
    // ═══════════════════════════════════════════════
    //  SHORT SNIPER
    // ═══════════════════════════════════════════════

    // GATE: Value zone check (inverted — price rallies UP into zone)
    const zoneTop    = e50_15! * (1 + slack);
    const zoneBottom = e20_15! * (1 - slack);
    const inZone     = high15 >= zoneBottom && low15 <= zoneTop;

    if (modeKey !== 'AGGRESSIVE' && !inZone) {
      debugLog.push('REJECT: Price not in short value zone');
      return null;
    }

    // ─── LATE-ENTRY BLOCKER (SHORT) ─────────────────────────────
    const extensionBelowZone = (e20_15! - close15) / atr!;
    if (extensionBelowZone > 1.0 && modeKey !== 'AGGRESSIVE') {
      debugLog.push(`REJECT: Short late entry — close is ${extensionBelowZone.toFixed(2)}x ATR below EMA20`);
      return null;
    }
    if (extensionBelowZone > 1.5) return null;

    const zoneIdealShort  = (e20_15! + e50_15!) / 2;
    const zoneDistPct     = ((zoneIdealShort - close15) / zoneIdealShort) * 100;
    const finalTimingShort: 'EARLY' | 'OPTIMAL' | 'LATE' =
      extensionBelowZone < 0.25 ? 'OPTIMAL' : extensionBelowZone < 0.65 ? 'EARLY' : 'LATE';

    // GATE: 1H structure guard (inverted)
    const guard = modeKey === 'CONSERVATIVE' ? 0.0025 : modeKey === 'BALANCED' ? 0.004 : 0.006;
    const distFrom1hE20 = (e20_1h! - close15) / e20_1h!;
    const distFrom1hE50 = (e50_1h! - close15) / e50_1h!;
    if (modeKey !== 'AGGRESSIVE' && (distFrom1hE20 < -guard || distFrom1hE50 < -guard * 1.4)) return null;

    // GATE: RSI
    const rsiMinShort = 100 - cfg.rsiMax;
    const rsiMaxShort = 100 - cfg.rsiMin;
    if (!(rsiNow! >= rsiMinShort && rsiNow! <= rsiMaxShort)) return null;
    const rsiTurningDown = modeKey !== 'AGGRESSIVE'
      ? (rsiNow! < rsiPrev! && (rsiPrev! - rsiNow!) >= 0.7)
      : (rsiNow! < rsiPrev!);
    if (!rsiTurningDown) return null;
    score += 2; reasons.push(`RSI turning down (${rsiNow!.toFixed(1)})`);

    // Volume
    const dollarVolAvg = dollarVolSMA20_15[lastIdx];
    if (cfg.minDollarVol15m && dollarVolAvg != null && dollarVolAvg < cfg.minDollarVol15m) return null;
    const volSpike = volLongAvg ? (vol / volLongAvg!) : 0;
    if (cfg.volSpikeMult && volSpike < cfg.volSpikeMult) return null;
    const volRatio = vol / volAvg!;
    if (volRatio < cfg.volMult) return null;
    let volScore = 2;
    if (volRatio > 2.0) volScore += 2;
    if (volRatio > 3.5) volScore += 2;
    score += volScore; reasons.push(`Bear volume (${volRatio.toFixed(2)}x)`);

    // Candle anatomy — bearish
    const bodyPct  = (body / range) * 100;
    const closePos = (high15 - close15) / range; // distance from high
    const isBearCandle = close15 < open15;
    const minBody    = modeKey === 'AGGRESSIVE' ? 10 : 55;
    const minClosePos = modeKey === 'AGGRESSIVE' ? 0.20 : 0.70;
    if (modeKey !== 'AGGRESSIVE' && !(isBearCandle && bodyPct >= minBody && closePos >= minClosePos)) return null;

    // Acceleration (downward)
    if (prev2) {
      const accel    = (prev.close - close15) - (prev2.close - prev.close);
      const accelPct = accel / close15;
      if (modeKey !== 'AGGRESSIVE' && cfg.accelPctMin && accelPct < cfg.accelPctMin) return null;
      if (accelPct > 0.0015) { score += 2; reasons.push(`Strong downward accel`); }
      else if (accelPct > 0) score += 1;
    }

    const atrPct = (atr! / close15) * 100;
    if (!(atrPct > cfg.atrPctMin && atrPct < cfg.atrPctMax)) return null;

    // Setup type reversal gate
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
    const shortEntryType: 'REVERSAL' | 'CONTINUATION' = wasAboveE50Recently && close15 < e20_15! ? 'REVERSAL' : 'CONTINUATION';

    if (shortEntryType === 'REVERSAL') {
      const hasStrongReversal = reversalCandle || twoBarReversal || doublePattern === 'DOUBLE_TOP';
      if (!hasStrongReversal && modeKey !== 'AGGRESSIVE') return null;
      score += reversalCandle || twoBarReversal ? 4 : 2;
      reasons.push('Bearish reversal confirmed');
    } else {
      const confirmed = modeKey === 'AGGRESSIVE' || lostE20 || (lowerHigh && rsiNow! < 50) || twoBarReversal;
      if (!confirmed) return null;
      const closedBelowPrevLow  = close15 < prev.low;
      const heldBelowE20ByClose = close15 <= e20_15! * 0.999;
      if (modeKey !== 'AGGRESSIVE' && !(closedBelowPrevLow && heldBelowE20ByClose)) return null;
      score += 2; reasons.push('Short continuation hold');
    }

    // Order flow
    const flowCheck = validateOrderFlow(orderFlow, 'SHORT');
    const missingFlowPenalty = flowCheck.missingFlow ? 3 : 0;
    if (!flowCheck.ok && modeKey !== 'AGGRESSIVE') return null;
    score += flowCheck.score;
    if (flowCheck.reasons.length > 0) reasons.push(flowCheck.reasons[0]);

    // Regime bonus (inverted for shorts: downtrend is favorable)
    const shortRegimeBonus = regime === 'TRENDING_DOWN' ? Math.abs(regimeScoreBonus || 0) : -(regimeScoreBonus || 0);
    score += shortRegimeBonus;
    if (shortRegimeBonus > 0) reasons.push('Regime supports shorts');

    const effectiveScoreMin = cfg.scoreMin + missingFlowPenalty;
    if (score < effectiveScoreMin) return null;

    // Entry/exit (SHORT)
    const triggerBuffer  = modeKey === 'CONSERVATIVE' ? 0.0015 : modeKey === 'BALANCED' ? 0.0012 : 0.0010;
    const triggerPrice   = low15 * (1 - triggerBuffer);
    const chasePct       = ((close15 - triggerPrice) / close15) * 100;
    if (modeKey !== 'AGGRESSIVE' && (chasePct > 0.45 || (close15 - triggerPrice) > atr! * 0.35)) return null;

    const riskPerTrade   = balance * activeMode.riskPct;
    const structureStop  = Math.max(high15, e50_15!) * (1 + 0.0012);
    const atrStop        = triggerPrice + (atr! * 1.6);
    const minAtrStop     = triggerPrice + (atr! * 1.2);
    const rawStop        = Math.max(structureStop, atrStop);
    const stopLoss       = Math.max(rawStop, minAtrStop);
    const stopDistance   = Math.max(stopLoss - triggerPrice, triggerPrice * 0.0035);
    const stopPctVal     = (stopDistance / triggerPrice) * 100;
    if (modeKey !== 'AGGRESSIVE' && (stopPctVal > 2.5 || stopPctVal < 0.4)) return null;

    const takeProfit  = triggerPrice - 1.25 * stopDistance;
    const takeProfit2 = triggerPrice - 2.5  * stopDistance;
    const qty         = riskPerTrade / stopDistance;
    const sizeUSDT    = qty * triggerPrice;

    debugLog.push(`ACCEPT: ${shortEntryType} SHORT score=${score}`);

    return {
      kind: 'SNIPER', side: 'SHORT', score, reasons,
      entryPrice: triggerPrice, stopLoss, takeProfit, takeProfit2,
      qty, sizeUSDT, atr15: atr!, volRatio,
      entryType: shortEntryType,
      zoneDistancePct: parseFloat(zoneDistPct.toFixed(3)),
      btcRegimeAtEntry: btcRegimeLabel ?? 'UNKNOWN',
      entryTiming: finalTimingShort,
      debugLog
    };
  }
}
