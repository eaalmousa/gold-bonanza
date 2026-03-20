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
export const globalDebugLogs: string[][] = [];
function makeDebugLog(symbol?: string): string[] {
  const log: string[] = [];
  if (symbol) log.push(`[SniperV3] ${symbol}`);
  globalDebugLogs.push(log);
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

  if (!tf1h || tf1h.length < 210 || !tf15m || tf15m.length < 90) {
    debugLog.push('REJECT: Insufficient klines data');
    return null;
  }

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

  if ([e20_1h, e50_1h, e200_1h].some(v => v == null)) {
    debugLog.push('REJECT: Missing 1h EMA values');
    return null;
  }

  // ─── GATE 2: DIRECTION ────────────────────────────────
  const isUptrend   = close1h > e200_1h! && e20_1h! > e50_1h! && e50_1h! > e200_1h!;
  const isDowntrend = close1h < e200_1h! && e20_1h! < e50_1h! && e50_1h! < e200_1h!;
  const e20Slope1h  = e20_1h! - (ema20_1h[idx1h - 3] ?? e20_1h!);
  const e50Slope1h  = e50_1h! - (ema50_1h[idx1h - 3] ?? e50_1h!);

  // BREAKING_DOWN: price is collapsing even if EMA50 > EMA200 (early trend fracture)
  // Catches flash crashes and sharp reversals where EMAs haven't crossed yet
  const isBreakingDown = close1h < e20_1h! && close1h < e50_1h! && e20Slope1h < 0 && e50Slope1h < 0;
  // RECOVERING: price is reclaiming EMA20 from below even if EMAs haven't aligned up yet
  const isRecovering = close1h > e20_1h! && close1h > e50_1h! && e20Slope1h > 0;

  let side: 'LONG' | 'SHORT';

  if (modeKey === 'AGGRESSIVE') {
    side = close1h > e50_1h! ? 'LONG' : 'SHORT';
  } else if (isBreakingDown) {
    // Structure fracture: use SHORT even mid-bull-cycle
    side = 'SHORT';
    debugLog.push('Direction: BREAKING_DOWN — price below both EMAs with negative slope');
  } else if (isUptrend && e20Slope1h > 0 && e50Slope1h >= 0) {
    side = 'LONG';
    if (regime === 'TRENDING_DOWN') { debugLog.push('REJECT: Counter-trend regime (LONG in DOWN)'); return null; }
  } else if (isDowntrend && e20Slope1h < 0 && e50Slope1h <= 0) {
    side = 'SHORT';
    if (regime === 'TRENDING_UP') { debugLog.push('REJECT: Counter-trend regime (SHORT in UP)'); return null; }
  } else if (isRecovering) {
    // Recovering from deep pullback — allow LONGs
    side = 'LONG';
    debugLog.push('Direction: RECOVERING — reclaiming EMAs');
  } else {
    debugLog.push('REJECT: No clean 1H trend structure');
    return null;
  }

  // ─── GATE 3: BTC MACRO TREND ──────────────────────────
  // Exception: BREAKING_DOWN signals bypass the SHORT block — altcoin crashes
  // can happen independently of BTC trend (news, whale dump, etc.)
  if (modeKey !== 'AGGRESSIVE' && btc4hTrend && !isBreakingDown) {
    if (side === 'LONG' && btc4hTrend === 'DOWN') {
      debugLog.push('REJECT: BTC 4H downtrend — no longs');
      return null;
    }
    if (side === 'SHORT' && btc4hTrend === 'UP') {
      debugLog.push('REJECT: BTC 4H uptrend — no shorts (use BREAKING_DOWN to bypass)');
      return null;
    }
  } else if (isBreakingDown && btc4hTrend === 'UP') {
    debugLog.push('NOTE: BREAKING_DOWN — BTC uptrend gate bypassed for altcoin crash short');
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
  if (lastIdx <= 60) {
    debugLog.push('REJECT: Insufficient 15m index');
    return null;
  }

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

  if ([e20_15, e50_15, rsiNow, rsiPrev, atr, volAvg].some(v => v == null)) {
    debugLog.push('REJECT: Missing 15m indicator values');
    return null;
  }

  const cfg    = activeMode.pullback;
  const slack  = cfg.valueZoneSlack;
  const range  = Math.max(1e-9, high15 - low15);
  const body   = Math.abs(close15 - open15);

  const candleAtrRatio = range / atr!;

  // ─── EXPANSION CAP — ASYMMETRIC by side ───────────────────────
  // LONG: cap at 1.15x ATR. Buying a pumped/expanded candle = chasing. This gate stays strict.
  // SHORT: allow up to 2.0x ATR. A violent crash candle IS the signal — killing it here
  //   was the #1 reason crash shorts were never triggered.
  if (side === 'LONG') {
    if (candleAtrRatio > 1.15) {
      debugLog.push(`REJECT: Huge expansion candle ${candleAtrRatio.toFixed(2)}x ATR > 1.15x (LONG cap)`);
      return null;
    }
    debugLog.push(`PASS: Candle size ${candleAtrRatio.toFixed(2)}x ATR (LONG limit 1.15x)`);

    // ─── MANDATORY RETEST CHECK — LONG ONLY ─────────────────────
    // Makes sense for LONGs: prev must hold above EMA20 confirming buyer acceptance.
    // Does NOT apply to SHORTs: prev closing above EMA20 is expected BEFORE a breakdown candle.
    if (candleAtrRatio > 0.9) {
      const prevClose15 = prev.close;
      const prevE20_15  = ema20_15[lastIdx - 1];
      const prevAcceptance = prevE20_15 != null && prevClose15 >= prevE20_15 * 0.999;
      if (!prevAcceptance) {
        debugLog.push(`REJECT: Expanded candle (${candleAtrRatio.toFixed(2)}x ATR) without prior acceptance candle`);
        return null;
      }
      debugLog.push(`PASS: Expanded candle has prior acceptance (prev closed above EMA20)`);
    }
  } else {
    // SHORT: allow crash candles, but cap at 1.65x ATR (premium selectivity v8.0)
    if (candleAtrRatio > 1.65) {
      debugLog.push(`REJECT: SHORT Expansion candle ${candleAtrRatio.toFixed(2)}x ATR > 1.65x (Premium cap)`);
      return null;
    }
  }

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

    if (!inZone) {
      debugLog.push(`REJECT: Price not in value zone [${zoneBottom.toFixed(4)} - ${zoneTop.toFixed(4)}]`);
      return null;
    }

    // ─── GATE 4b: LATE-ENTRY BLOCKER (tightened round 2) ─────────────
    // Normal modes: close must not be >0.65x ATR above EMA20 (was 1.0x)
    // Aggressive mode: hard cap at 0.75x ATR (was 1.5x)
    const extensionAboveZone = (close15 - e20_15!) / atr!;
    if (extensionAboveZone > 0.65 && modeKey !== 'AGGRESSIVE') {
      debugLog.push(`REJECT: Late entry — close is ${extensionAboveZone.toFixed(2)}x ATR above EMA20 (limit 0.65x)`);
      return null;
    }
    if (extensionAboveZone > 0.75) { // Hard cap even in aggressive mode
      debugLog.push(`REJECT: Extreme late entry — ${extensionAboveZone.toFixed(2)}x ATR above zone (cap 0.75x)`);
      return null;
    }

    // Calculate zone distance for quality report (tightened timing boundaries)
    const zoneIdeal         = (e20_15! + e50_15!) / 2; // midpoint of EMA zone
    const zoneDistancePct   = ((close15 - zoneIdeal) / zoneIdeal) * 100;
    // Timing: OPTIMAL <0.20, EARLY <0.45, LATE ≥0.45 (was 0.25/0.70)
    const entryTiming: 'EARLY' | 'OPTIMAL' | 'LATE' =
      extensionAboveZone < 0.20 ? 'OPTIMAL' :
      extensionAboveZone < 0.45 ? 'EARLY' : 'LATE';
    debugLog.push(`Zone distance: ${zoneDistancePct.toFixed(2)}%, timing: ${entryTiming}, extension: ${extensionAboveZone.toFixed(2)}x ATR`);

    score += 2;
    reasons.push(`Pullback into EMA zone (${entryTiming})`);

    // GATE: 1H structure guard
    const guard = modeKey === 'CONSERVATIVE' ? 0.0025 : modeKey === 'BALANCED' ? 0.004 : 0.006;
    const distFrom1hE20 = (close15 - e20_1h!) / e20_1h!;
    const distFrom1hE50 = (close15 - e50_1h!) / e50_1h!;
    if (modeKey !== 'AGGRESSIVE' && (distFrom1hE20 < -guard || distFrom1hE50 < -guard * 1.4)) {
      debugLog.push('REJECT: Price too far below 1H EMA structure (-guard limit)');
      return null;
    }
    // Hard floor for LONGs even in aggressive mode. Buying 1.25% below the 1H EMA20 into a downtrend is suicide.
    if (distFrom1hE20 < -0.0125 || distFrom1hE50 < -0.015) {
      debugLog.push('REJECT: Price massively submerged beneath 1H macro trend (-1.5% limit)');
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

    // ─── CANDLE ANATOMY (Knife-catching protection) ───────────────
    // Must close strong to confirm buyers stepped in.
    const bodyPct    = (body / range) * 100;
    const closePos   = (close15 - low15) / range;
    const isBullCandle = close15 > open15;
    const minBody    = modeKey === 'AGGRESSIVE' ? 35 : 55;
    const minClosePos = modeKey === 'AGGRESSIVE' ? 0.65 : 0.70; // 0.50 was too loose, caused 47% wrong direction
    if (!(isBullCandle && bodyPct >= minBody && closePos >= minClosePos)) {
      debugLog.push(`REJECT: Weak bullish confirmation — body:${bodyPct.toFixed(0)}% pos:${closePos.toFixed(2)}`);
      return null;
    }
    score += 2;
    reasons.push('Bullish confirmation candle');

    // ─── DEEP PULLBACK PROTECTION ────────────────────────────────
    // If the lowest point of the pullback went too far below EMA50, structure is broken.
    if ((e50_15! - low15) / atr! > 1.0) {
      debugLog.push(`REJECT: Deep pullback — wick went > 1.0x ATR below EMA50`);
      return null;
    }

    // ─── LOCAL CEILING / RESISTANCE PROXIMITY CHECK (LONG ENTRY REPAIR) ───
    // Mirror of the SHORT-side floor check. Do NOT buy immediately under a recent swing high / resistance cap.
    // 1. Find the highest point in the recent consolidation window
    const recentHighs  = highs15.slice(Math.max(0, lastIdx - 15), lastIdx);
    const localCeiling = Math.max(...recentHighs);

    // 2. Metrics
    const isBreakingCeiling   = close15 >= localCeiling - (atr! * 0.15);
    const isHoveringBelowCeil = close15 < localCeiling - (atr! * 0.15) && close15 > localCeiling - (atr! * 0.6);
    const distanceToCeilPct   = ((localCeiling - close15) / close15) * 100;
    const ceilDistStr         = `[Ceiling Dist: ${distanceToCeilPct.toFixed(2)}%]`;

    // 3. Chop-under-ceiling detection
    if (isHoveringBelowCeil) {
      debugLog.push(`REJECT: Compressing immediately below local resistance ceiling ${ceilDistStr}`);
      return null;
    }

    // 4. Breakout acceptance: if buying AT the ceiling, require a clean close above it
    if (isBreakingCeiling) {
      const cleanCloseAbove = close15 > localCeiling;
      const followThrough   = close15 > prev.close && isBullCandle;
      if (!cleanCloseAbove || !followThrough) {
        debugLog.push(`REJECT: Poking local resistance—no clean breakout acceptance ${ceilDistStr}`);
        return null;
      }
      score += 2;
      reasons.push('Clean ceiling breakout accepted');
    } else {
      reasons.push(`Clear headroom above (Dist: ${distanceToCeilPct.toFixed(2)}%)`);
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
    // REVERSAL: MUST reclaim EMA20. Catching falling knives below EMA20 is banned in all modes.
    if (entryType === 'REVERSAL') {
      if (close15 < e20_15!) {
        debugLog.push('REJECT: REVERSAL setup failed to reclaim EMA20');
        return null;
      }
      
      const prevIsBear = prev.close < prev.open;
      const isEngulfing = isBullCandle && prevIsBear && close15 > prev.open && open15 <= prev.close;
      const closedAbovePrevHigh = close15 > prev.high;

      if (isEngulfing) {
        score += 2;
        reasons.push('Bullish Engulfing Reversal');
      } else {
        if (!closedAbovePrevHigh) {
          debugLog.push('REJECT: Poor reversal structure (not engulfing and failed to close above prev high)');
          return null;
        }

        if (modeKey !== 'AGGRESSIVE' && score < cfg.scoreMin + 2) {
          debugLog.push('REJECT: REVERSAL setup requires higher base score since not engulfing');
          return null;
        }
      }
    } else {
      // CONTINUATION: normal gate
      const prevE20    = ema20_15[lastIdx - 1];
      const reclaimHold = (prevE20 != null) && (prev.close > prevE20) && (close15 > e20_15!) &&
        (prev.low <= prevE20 * (1 + slack) || low15 <= e20_15! * (1 + slack));
      const lowerWick     = Math.min(open15, close15) - low15;
      const lowerWickRatio = lowerWick / Math.max(1e-9, body);
      const nearE50       = low15 <= e50_15! * (1 + slack * 1.2);
      const higherLow     = (low15 > prev.low) && (low15 >= e50_15! * (1 - slack)) && (close15 > e20_15!);
      const prevCandleBull = prev.close > prev.open;
      const twoBarReversal = prevCandleBull && isBullCandle && (prev.low < e20_15!) && (close15 > e20_15!);
      // REMOVED `modeKey === 'AGGRESSIVE'` bypass. Longs MUST show real structural confirmation.
      const confirmed = reclaimHold || (higherLow && rsiNow! > 50) || twoBarReversal
        || (isBullCandle && nearE50 && (lowerWickRatio >= 1.35) && (closePos >= 0.62)); // reversalCandle inlined
      
      const closedAbovePrevHigh  = close15 > prev.high;
      const heldAboveE20ByClose  = close15 >= e20_15! * 1.001;

      if (!heldAboveE20ByClose) {
        debugLog.push('REJECT: Failed to hold EMA20 by close (strict requirement for longs)');
        return null;
      }

      if (modeKey === 'AGGRESSIVE') {
        if (!confirmed && !closedAbovePrevHigh) {
          debugLog.push('REJECT: Unconfirmed aggressive long continuation must close above prev high');
          return null;
        }
      } else {
        if (!confirmed) {
          debugLog.push('REJECT: CONTINUATION setup not confirmed (need EMA retest or higher-low)');
          return null;
        }
        if (!closedAbovePrevHigh) {
          debugLog.push('REJECT: Normal continuation must close above prev high');
          return null;
        }
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
    // Tightened chase check: 0.45% → 0.30%
    if (modeKey !== 'AGGRESSIVE' && (chasePct > 0.30 || (triggerPrice - close15) > atr! * 0.25)) {
      debugLog.push(`REJECT: Chase check — trigger ${chasePct.toFixed(2)}% above close (limit 0.30%)`);
      return null;
    }
    // Even in aggressive mode, block extreme chasing
    if (chasePct > 0.55 || (triggerPrice - close15) > atr! * 0.45) {
      debugLog.push(`REJECT: Extreme chase — trigger ${chasePct.toFixed(2)}% above close`);
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
    // Apply stop bounds to ALL modes — even AGGRESSIVE should not have absurd stops
    if (stopPctVal > 3.0 || stopPctVal < 0.35) {
      debugLog.push(`REJECT: Stop distance ${stopPctVal.toFixed(2)}% out of bounds [0.35%-3.0%]`);
      return null;
    }

    const takeProfit  = triggerPrice + 1.5 * stopDistance;   // minimum 1.5R TP1
    const takeProfit2 = triggerPrice + 2.5 * stopDistance;
    const qty         = riskPerTrade / stopDistance;
    const sizeUSDT    = qty * triggerPrice;

    // ─── MINIMUM NET RR GATE ────────────────────────────────────────────
    // After fees (0.05% maker each side) the net RR must be >= 1.3.
    // This blocks setups where the stop is too wide to produce meaningful reward.
    const feePerSide     = triggerPrice * 0.0005;  // ~0.05% taker fee per side
    const totalFees      = feePerSide * 2;          // entry + exit
    const netReward      = (takeProfit - triggerPrice) - totalFees;
    const netRisk        = stopDistance + totalFees;
    const netRR          = netReward / netRisk;
    if (netRR < 1.3) {
      debugLog.push(`REJECT: Net RR ${netRR.toFixed(2)} < 1.3 minimum (after fees)`);
      return null;
    }

    // ─── ZONE DISTANCE for quality report ────────────────────────
    const zoneDistPct     = ((close15 - zoneIdeal) / zoneIdeal) * 100;
    const extAbove        = (close15 - e20_15!) / atr!;
    // Match tightened boundaries: OPTIMAL <0.20, LATE ≥0.45
    const finalTiming: 'EARLY' | 'OPTIMAL' | 'LATE' =
      extAbove < 0.20 ? 'OPTIMAL' : extAbove < 0.45 ? 'EARLY' : 'LATE';

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

    // GATE: Value zone check (inverted — price rallies UP into zone for normal shorts)
    const zoneTop    = e50_15! * (1 + slack);
    const zoneBottom = e20_15! * (1 - slack);
    const inZone     = high15 >= zoneBottom && low15 <= zoneTop;

    // BREAKING_DOWN EXCEPTION for value zone:
    // A genuine breakdown doesn't rally back into the EMA zone — it falls THROUGH it.
    // If BREAKING_DOWN is active we allow a bypass, but ONLY when all of:
    //   1. close is below BOTH e20 and e50 (price is structurally underwater)
    //   2. candle is bearish (isBearCandle confirmed before this point via anatomy gate)
    //   3. RSI is already below 50 (momentum is clearly bearish, not a dip)
    // If any of these fail, the bypass is denied and the normal zone gate kills it.
    const isBearCandleEarly = candle.close < candle.open; // pre-check before anatomy gate runs
    const breakdownZoneBypass = isBreakingDown
      && close15 < e20_15!
      && close15 < e50_15!
      && isBearCandleEarly
      && rsiNow! < 50;

    if (!inZone && !breakdownZoneBypass) {
      debugLog.push(!inZone && isBreakingDown
        ? `REJECT: BREAKING_DOWN exception denied — did not meet multi-factor crash criteria (RSI:${rsiNow!.toFixed(1)} bearCandle:${isBearCandleEarly} belowBothEMAs:${close15 < e20_15! && close15 < e50_15!})`
        : 'REJECT: Price not in short value zone'
      );
      return null;
    }

    if (breakdownZoneBypass && !inZone) {
      debugLog.push(`PROVISIONAL PASS [BREAKING_DOWN crash path]: EMA zone bypassed — price below both EMAs, RSI:${rsiNow!.toFixed(1)}, bearish candle. Note: downstream gates (anatomy, volume, floor, score) still apply and can reject.`);
    } else {
      debugLog.push(`PASS [normal short zone]: price in EMA retest zone`);
    }

    // ─── LATE-ENTRY BLOCKER (SHORT) ─────────────────────────────
    const extensionBelowZone = (e20_15! - close15) / atr!;
    // Normal cap: 1.0x ATR — prevents shorting far below EMA zone (stale entries)
    // Crash-bypass cap: raised to 1.8x ATR — only for shorts that used the BREAKING_DOWN
    //   zone bypass. An in-zone BREAKING_DOWN signal keeps the normal 1.0x cap.
    //   1.8x bound still catches anything, since 2.0x ATR candles are screened upstream.
    const lateCap = breakdownZoneBypass ? 1.8 : 1.0;
    if (extensionBelowZone > lateCap) {
      debugLog.push(`REJECT: Short late entry — ${extensionBelowZone.toFixed(2)}x ATR below EMA20 exceeds ${lateCap}x cap${breakdownZoneBypass ? ' (crash-bypass cap)' : ''}`);
      return null;
    }
    if (breakdownZoneBypass && extensionBelowZone > 1.0) {
      debugLog.push(`PASS [crash-bypass late-entry exception]: ${extensionBelowZone.toFixed(2)}x ATR below EMA20 (normal cap 1.0x, crash-bypass cap 1.8x)`);
    }

    const zoneIdealShort  = (e20_15! + e50_15!) / 2;
    const zoneDistPct     = ((zoneIdealShort - close15) / zoneIdealShort) * 100;
    const finalTimingShort: 'EARLY' | 'OPTIMAL' | 'LATE' =
      extensionBelowZone < 0.25 ? 'OPTIMAL' : extensionBelowZone < 0.65 ? 'EARLY' : 'LATE';

    // GATE: 1H structure guard (inverted)
    const guard = modeKey === 'CONSERVATIVE' ? 0.0025 : modeKey === 'BALANCED' ? 0.004 : 0.006;
    const distFrom1hE20 = (e20_1h! - close15) / e20_1h!;
    const distFrom1hE50 = (e50_1h! - close15) / e50_1h!;
    if (modeKey !== 'AGGRESSIVE' && (distFrom1hE20 < -guard || distFrom1hE50 < -guard * 1.4)) {
      debugLog.push(`REJECT: 1H structure guard failed (too far extended from 1H EMAs)`);
      return null;
    }

    // GATE: RSI for SHORT
    // Use direct RSI range (not naive 100-x inversion) to avoid rejecting panic-sell conditions.
    // Conservative SHORT: RSI 15-58 (was 48-72 via inversion — too high for crash shorts)
    // Balanced SHORT: RSI 15-65
    // Aggressive SHORT: RSI 10-75
    const rsiMaxShort = 100 - cfg.rsiMin; // top end stays inverted (e.g. 72, 78, 85)
    const rsiMinShort = Math.min(15, cfg.rsiMin); // bottom: always allow down to 15 for panic momentum
    if (!(rsiNow! >= rsiMinShort && rsiNow! <= rsiMaxShort)) {
      debugLog.push(`REJECT: SHORT RSI ${rsiNow!.toFixed(1)} out of range [${rsiMinShort}-${rsiMaxShort}]`);
      return null;
    }
    const rsiDrop = rsiPrev! - rsiNow!;
    const rsiTurningDown = modeKey !== 'AGGRESSIVE'
      ? (rsiNow! < rsiPrev! && rsiDrop >= 1.2)
      : (rsiNow! < rsiPrev!);
    if (!rsiTurningDown) {
      debugLog.push(`REJECT: SHORT RSI velocity too low (${rsiPrev!.toFixed(1)} → ${rsiNow!.toFixed(1)}, drop ${rsiDrop.toFixed(2)} < 1.2)`);
      return null;
    }
    score += 4; reasons.push(`Decisive RSI momentum failure (${rsiNow!.toFixed(1)})`);

    // Volume
    const dollarVolAvg = dollarVolSMA20_15[lastIdx];
    if (cfg.minDollarVol15m && dollarVolAvg != null && dollarVolAvg < cfg.minDollarVol15m) {
      debugLog.push('REJECT: Dollar volume below minimum');
      return null;
    }
    const volSpike = volLongAvg ? (vol / volLongAvg!) : 0;
    if (cfg.volSpikeMult && volSpike < cfg.volSpikeMult) {
      debugLog.push('REJECT: Volume spike below minimum');
      return null;
    }
    const volRatio = vol / volAvg!;
    if (volRatio < cfg.volMult) {
      debugLog.push(`REJECT: Volume ratio below minimum (${volRatio.toFixed(2)}x < ${cfg.volMult}x)`);
      return null;
    }
    let volScore = 2;
    if (volRatio > 2.0) volScore += 2;
    if (volRatio > 3.5) volScore += 2;
    score += volScore; reasons.push(`Bear volume (${volRatio.toFixed(2)}x)`);

    // Candle anatomy — bearish (Premium Selective v8.0)
    const bodyPct    = (body / range) * 100;
    const closePos   = (high15 - close15) / range; // distance from high
    const lowerWick  = Math.min(open15, close15) - low15;
    const isBearCandle = close15 < open15;
    const minBody    = modeKey === 'AGGRESSIVE' ? 30 : 62;    // was 55
    const minClosePos = modeKey === 'AGGRESSIVE' ? 0.50 : 0.75; // was 0.70
    
    if (!(isBearCandle && bodyPct >= minBody && closePos >= minClosePos)) {
      debugLog.push(`REJECT: Mediocre bearish confirmation — body:${bodyPct.toFixed(0)}% pos:${closePos.toFixed(2)} (Req: ${minBody}% / ${minClosePos})`);
      return null;
    }

    // Buying Wick Penalty (Stabilization Detection)
    if (lowerWick > body * 0.45) {
      debugLog.push(`REJECT: Excessive lower buying wick (${(lowerWick/body).toFixed(2)}x body) indicates stabilizing bottom`);
      return null;
    }
    score += 5; reasons.push('Premium bearish confirmation candle');

    // Acceleration (downward)
    if (prev2) {
      const accel    = (prev.close - close15) - (prev2.close - prev.close);
      const accelPct = accel / close15;
      if (modeKey !== 'AGGRESSIVE' && cfg.accelPctMin && accelPct < cfg.accelPctMin) {
        debugLog.push(`REJECT: Downward acceleration below minimum (${accelPct.toFixed(4)})`);
        return null;
      }
      if (accelPct > 0.0015) { score += 2; reasons.push(`Strong downward accel`); }
      else if (accelPct > 0) score += 1;
    }

    const atrPct = (atr! / close15) * 100;
    if (!(atrPct > cfg.atrPctMin && atrPct < cfg.atrPctMax)) {
      debugLog.push(`REJECT: ATR% out of range (${atrPct.toFixed(2)}%)`);
      return null;
    }

    // Setup type reversal gate (ATR-weighted for Premium)
    const prevE20     = ema20_15[lastIdx - 1];
    const lostE20     = (prevE20 != null) && (prev.close < prevE20) && (close15 < e20_15!);
    const upperWick   = high15 - Math.max(open15, close15);
    const upperWickRatio = upperWick / Math.max(1e-9, body);
    const nearE50     = high15 >= e50_15! * (1 - slack * 1.2);
    const reversalCandle = isBearCandle && nearE50 && (upperWickRatio >= 1.65); // was 1.35
    const clearLowerHigh = (high15 < prev.high - (atr! * 0.2)); // ATR-weighted gap
    const prevCandleBear = prev.close < prev.open;
    const twoBarReversal = prevCandleBear && isBearCandle && (prev.high > e20_15!) && (close15 < e20_15!);

    // Anti-Stabilization Check (Cluster Detection)
    const last4Highs = highs15.slice(Math.max(0, lastIdx - 3), lastIdx + 1);
    const last4Lows = lows15.slice(Math.max(0, lastIdx - 3), lastIdx + 1);
    const clusterRange = Math.max(...last4Highs) - Math.min(...last4Lows);
    if (clusterRange < atr! * 0.4) {
      debugLog.push(`REJECT: Setup stabilized into tight cluster (range ${clusterRange.toFixed(6)} < 0.4x ATR)`);
      return null;
    }

    const wasAboveE50Recently = highs15.slice(lastIdx - 5, lastIdx).some(h => h > e50_15!);
    const shortEntryType: 'REVERSAL' | 'CONTINUATION' = wasAboveE50Recently && close15 < e20_15! ? 'REVERSAL' : 'CONTINUATION';

    if (shortEntryType === 'REVERSAL') {
      const hasStrongReversal = reversalCandle || twoBarReversal || doublePattern === 'DOUBLE_TOP';
      if (!hasStrongReversal && modeKey !== 'AGGRESSIVE') {
        debugLog.push('REJECT: Short reversal not confirmed (needs strong tail or 2-bar pattern)');
        return null;
      }
      score += reversalCandle || twoBarReversal ? 4 : 2;
      reasons.push('Bearish reversal confirmed');
    } else {
      const confirmed = modeKey === 'AGGRESSIVE' || lostE20 || (clearLowerHigh && rsiNow! < 50) || twoBarReversal;
      if (!confirmed) {
        debugLog.push('REJECT: Continuation not confirmed (lost EMA20 or ATR-weighted lower-high with RSI<50 req)');
        return null;
      }
      const closedBelowPrevLow  = close15 < prev.low;
      const heldBelowE20ByClose = close15 <= e20_15! * 0.999;
      if (modeKey !== 'AGGRESSIVE' && !(closedBelowPrevLow && heldBelowE20ByClose)) {
        debugLog.push('REJECT: Short continuation failed 15m structure hold');
        return null;
      }
      score += 2; reasons.push('Short continuation hold');
    }

    // ─── LOCAL FLOOR / SUPPORT PROXIMITY CHECK (SHORT ENTRY REPAIR) ───
    // 1. Find the lowest point in the recent consolidation or local down-leg window
    const recentLows = lows15.slice(Math.max(0, lastIdx - 15), lastIdx);
    const localFloor = Math.min(...recentLows);
    
    // 2. Metrics calculation
    const isBreakingFloor = close15 <= localFloor + (atr! * 0.15); 
    const isHoveringAboveFloor = close15 > localFloor + (atr! * 0.15) && close15 < localFloor + (atr! * 0.6);
    const distanceToFloorPct = ((close15 - localFloor) / localFloor) * 100;
    const floorDistStr = `[Floor Dist: ${distanceToFloorPct.toFixed(2)}%]`;

    // 3. Breakdown Acceptance Logic & Chop Detection
    if (isHoveringAboveFloor) {
       // We are compressing / hovering right above local support.
       debugLog.push(`REJECT: Compressing immediately above local support floor ${floorDistStr}`);
       return null;
    }

    if (isBreakingFloor) {
      // If we are at/breaking the floor, we require "acceptance" to avoid false breakdowns.
      // Acceptance = clean close below the local floor with follow-through
      const cleanCloseBelow = close15 < localFloor;
      const followThrough = close15 < prev.close && isBearCandle;
      
      if (!cleanCloseBelow || !followThrough) {
        debugLog.push(`REJECT: Poking local support but lacks true breakdown acceptance ${floorDistStr}`);
        return null;
      }
      
      score += 2; 
      reasons.push(`Clean floor breakdown accepted`);
    } else {
      reasons.push(`Clear airspace below (Dist: ${distanceToFloorPct.toFixed(2)}%)`);
    }

    // Order flow
    const flowCheck = validateOrderFlow(orderFlow, 'SHORT');
    const missingFlowPenalty = flowCheck.missingFlow ? 3 : 0;
    if (!flowCheck.ok && modeKey !== 'AGGRESSIVE') {
      debugLog.push('REJECT: Order flow strictly invalid for SHORT');
      return null;
    }
    score += flowCheck.score;
    if (flowCheck.reasons.length > 0) reasons.push(flowCheck.reasons[0]);

    // Regime bonus (inverted for shorts: downtrend is favorable)
    const shortRegimeBonus = regime === 'TRENDING_DOWN' ? Math.abs(regimeScoreBonus || 0) : -(regimeScoreBonus || 0);
    score += shortRegimeBonus;
    if (shortRegimeBonus > 0) reasons.push('Regime supports shorts');

    const effectiveScoreMin = cfg.scoreMin + missingFlowPenalty;
    if (score < effectiveScoreMin) {
      debugLog.push(`REJECT: Score below minimum threshold (${score} < ${effectiveScoreMin})`);
      return null;
    }

    // Entry/exit (SHORT)
    const triggerBuffer  = modeKey === 'CONSERVATIVE' ? 0.0015 : modeKey === 'BALANCED' ? 0.0012 : 0.0010;
    const triggerPrice   = low15 * (1 - triggerBuffer);
    const chasePct       = ((close15 - triggerPrice) / close15) * 100;
    if (modeKey !== 'AGGRESSIVE' && (chasePct > 0.45 || (close15 - triggerPrice) > atr! * 0.35)) {
      debugLog.push(`REJECT: Entry chase too far (${chasePct.toFixed(2)}%)`);
      return null;
    }

    const riskPerTrade   = balance * activeMode.riskPct;
    const structureStop  = Math.max(high15, e50_15!) * (1 + 0.0012);
    const atrStop        = triggerPrice + (atr! * 1.6);
    const minAtrStop     = triggerPrice + (atr! * 1.2);
    const rawStop        = Math.max(structureStop, atrStop);
    const stopLoss       = Math.max(rawStop, minAtrStop);
    const stopDistance   = Math.max(stopLoss - triggerPrice, triggerPrice * 0.0035);
    const stopPctVal     = (stopDistance / triggerPrice) * 100;
    if (modeKey !== 'AGGRESSIVE' && (stopPctVal > 2.5 || stopPctVal < 0.4)) {
      debugLog.push(`REJECT: Stop% out of bounds for short setup (${stopPctVal.toFixed(2)}%)`);
      return null;
    }

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
