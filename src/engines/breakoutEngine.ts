// ============================================
// Breakout Engine v3 — Super Sniper
// Added: expansion-candle blocker, late-entry
// check, quality report, correlation to v3 audit.
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
  btc4hTrend?: 'UP' | 'DOWN' | 'RANGING',
  btcRegimeLabel?: string,
  symbol?: string
): Signal | null {
  if (!tf15m || tf15m.length < 90) return null;

  const MAX_RETEST_WAIT = 4;
  
  // First, check if the current closed candle is a brand new breakout
  const currentBreakout = evaluateCoreBreakout(tf1h, tf15m, activeMode, balance, regime, regimeScoreBonus, orderFlow, btc4hTrend, btcRegimeLabel, symbol);
  if (currentBreakout) {
    currentBreakout.entryType = 'PENDING_BREAKOUT' as any;
    return currentBreakout;
  }

  // If not a brand new breakout, look backwards in time to see if there is a pending breakout waiting for a retest
  for (let lookback = 1; lookback <= MAX_RETEST_WAIT; lookback++) {
    const testIdx = tf15m.length - 1 - lookback; 
    if (testIdx < 60) break;
    
    // Evaluate the slice of candles that existed `lookback` candles ago
    const pastSliceLength = tf15m.length - lookback;
    const pastSliceArr = tf15m.slice(0, pastSliceLength);
    const pastBreakout = evaluateCoreBreakout(tf1h, pastSliceArr, activeMode, balance, regime, regimeScoreBonus, orderFlow, btc4hTrend, btcRegimeLabel, symbol);

    if (pastBreakout) {
      const bLevel = (pastBreakout as any).breakLevel;
      if (!bLevel) {
        pastBreakout.entryType = 'RETEST_CONFIRMED' as any;
        return pastBreakout; 
      }
      
      const side = pastBreakout.side;
      let minL = Infinity;
      let maxH = -Infinity;
      let closedAgainst = false;

      // Check all candles that have formed SINCE the breakout candle up to the current closed candle
      for (let j = pastSliceLength - 1; j < tf15m.length - 1; j++) {
        const c = tf15m[j];
        if (c.low < minL) minL = c.low;
        if (c.high > maxH) maxH = c.high;
        
        if (side === 'LONG' && c.close < bLevel) closedAgainst = true;
        if (side === 'SHORT' && c.close > bLevel) closedAgainst = true;
      }

      const currentClosed = tf15m[tf15m.length - 2];
      const atr = pastBreakout.atr15;

      // INVALIDATION 1: Price closed cleanly back through the break level OR broke structure entirely
      if (closedAgainst) {
        pastBreakout.entryType = 'INVALIDATED' as any;
        pastBreakout.debugLog?.push('REJECT: Retest invalidated — closed back into compression');
        return pastBreakout;
      }
      
      // Structural failure block specifically for longs in tough macro
      if (side === 'LONG' && minL < bLevel - (atr * 0.7)) {
        pastBreakout.entryType = 'INVALIDATED' as any;
        pastBreakout.debugLog?.push('REJECT: Breakout structure destroyed (wicked too deep)');
        return pastBreakout;
      }

      let hasRetested = false;
      if (side === 'LONG') {
        if (minL <= bLevel * 1.002 || minL <= bLevel + (atr * 0.25)) hasRetested = true;
      } else {
        if (maxH >= bLevel * 0.998 || maxH >= bLevel - (atr * 0.25)) hasRetested = true;
      }

      if (hasRetested) {
        // Evaluate the confirmation of the rejection on the current candle
        const cOpen = currentClosed.open;
        const cClose = currentClosed.close;
        const cHigh = currentClosed.high;
        const cLow = currentClosed.low;
        const cBody = Math.abs(cClose - cOpen);
        const cRange = Math.max(1e-9, cHigh - cLow);

        const isBullish = cClose > cOpen;
        const isBearish = cClose < cOpen;
        const closedAboveBreak = cClose > bLevel;
        const closedBelowBreak = cClose < bLevel;
        
        let validLongRetest = false;
        if (side === 'LONG' && isBullish && closedAboveBreak) {
          const upperWick = cHigh - cClose;
          const upperWickRatio = upperWick / Math.max(1e-9, cBody);
          const retestAtrRatio = cRange / atr;
          // Longs fight gravity. If upper wick > 1.25x the body, the buyers were swamped.
          if (upperWickRatio >= 1.25) {
            pastBreakout.debugLog?.push('Retest ignored: Heavy upper wick rejection against LONG breakout');
          } else if (retestAtrRatio > 1.1) {
            pastBreakout.debugLog?.push(`Retest ignored: Bounce was exhausted expansion candle (${retestAtrRatio.toFixed(2)}x ATR)`);
          } else {
            validLongRetest = true;
          }
        }

        let validShortRetest = (side === 'SHORT' && isBearish && closedBelowBreak);

        if (validLongRetest) {
          pastBreakout.entryType = 'RETEST_CONFIRMED' as any;
          pastBreakout.debugLog?.push('ACCEPT: Retest confirmed for LONG breakout');
          pastBreakout.entryPrice = currentClosed.close * 1.0010;
          return pastBreakout;
        } else if (validShortRetest) {
          pastBreakout.entryType = 'RETEST_CONFIRMED' as any;
          pastBreakout.debugLog?.push('ACCEPT: Retest confirmed for SHORT breakout');
          pastBreakout.entryPrice = currentClosed.close * (1 - 0.0010);
          return pastBreakout;
        } else {
          // It touched the retest zone but hasn't closed decisively away from it yet. 
          if (lookback === MAX_RETEST_WAIT) {
            pastBreakout.entryType = 'EXPIRED_NO_RETEST' as any;
            return pastBreakout;
          }
          pastBreakout.entryType = 'PENDING_BREAKOUT' as any;
          return pastBreakout;
        }
      }

      // INVALIDATION 2: Price ran away without a retest, setup is exhausted
      if (side === 'LONG' && maxH > bLevel + atr * 2) {
        pastBreakout.entryType = 'INVALIDATED' as any;
        pastBreakout.debugLog?.push('REJECT: Breakout ran away without a retest');
        return pastBreakout;
      } else if (side === 'SHORT' && minL < bLevel - atr * 2) {
        pastBreakout.entryType = 'INVALIDATED' as any;
        pastBreakout.debugLog?.push('REJECT: Breakdown ran away without a retest');
        return pastBreakout;
      }

      // If we wait too long, it expires
      if (lookback === MAX_RETEST_WAIT) {
        pastBreakout.entryType = 'EXPIRED_NO_RETEST' as any;
        return pastBreakout;
      }
      
      pastBreakout.entryType = 'PENDING_BREAKOUT' as any;
      return pastBreakout;
    }
  }

  return null;
}

function evaluateCoreBreakout(
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
  const debugLog: string[] = [`[BreakoutV3] ${symbol ?? ''}`];

  if (!tf1h || tf1h.length < 210 || !tf15m || tf15m.length < 90) return null;

  // ─── GATE: REGIME ───────────────────────────────────
  if (regime === 'CRASH') {
    debugLog.push('REJECT: CRASH regime');
    return null;
  }
  if (regime === 'CHOP' && modeKey !== 'AGGRESSIVE') {
    debugLog.push('REJECT: CHOP — breakouts in chop are false breakouts');
    return null;
  }

  // ─── 1H TREND GATE ───────────────────────────────────
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

  const isUptrend1h   = close1h > e200_1h! && e20_1h! > e50_1h!;
  const isDowntrend1h = close1h < e200_1h! && e20_1h! < e50_1h!;

  let side: 'LONG' | 'SHORT';
  if (modeKey === 'AGGRESSIVE') {
    side = close1h > e50_1h! ? 'LONG' : 'SHORT';
  } else if (isUptrend1h) {
    side = 'LONG';
    if (regime === 'TRENDING_DOWN') return null;
  } else if (isDowntrend1h) {
    side = 'SHORT';
    if (regime === 'TRENDING_UP') return null;
  } else {
    if (regime !== 'RANGING') return null;
    side = close1h > e200_1h! ? 'LONG' : 'SHORT';
  }

  // ─── 4H MACRO GATE ────────────────────────────────────
  if (modeKey !== 'AGGRESSIVE' && btc4hTrend) {
    if (side === 'LONG'  && btc4hTrend === 'DOWN') return null;
    if (side === 'SHORT' && btc4hTrend === 'UP')   return null;
  }

  // ─── 15m DATA ─────────────────────────────────────────
  const closes15   = tf15m.map(c => c.close);
  const highs15    = tf15m.map(c => c.high);
  const lows15     = tf15m.map(c => c.low);
  const vols15     = tf15m.map(c => c.volume);
  const ema20_15   = calcEMA(closes15, 20);
  const rsi14_15   = calcRSI(closes15, 14);
  const atr14_15   = calcATR(highs15, lows15, closes15, 14);
  const volSMA20_15 = calcSMA(vols15, 20);
  const volSMA50_15 = calcSMA(vols15, 50);
  const dollarVols15 = vols15.map((v,i) => v * closes15[i]);
  const dollarVolSMA20_15 = calcSMA(dollarVols15, 20);

  const lastIdx = closes15.length - 2;
  if (lastIdx < 60) return null;

  const cfg   = activeMode.breakout;
  const candle = tf15m[lastIdx];
  const prev   = tf15m[lastIdx - 1];
  const prev2  = tf15m[lastIdx - 2];

  const close15 = candle.close;
  const open15  = candle.open;
  const high15  = candle.high;
  const low15   = candle.low;

  const rsiNow     = rsi14_15[lastIdx];
  const atr        = atr14_15[lastIdx];
  const volNow     = vols15[lastIdx];
  const volAvg     = volSMA20_15[lastIdx];
  const volLongAvg = volSMA50_15[lastIdx] ?? volAvg;
  const e20        = ema20_15[lastIdx];

  if ([rsiNow, atr, volAvg, e20].some(v => v == null)) return null;

  const range = Math.max(1e-9, high15 - low15);
  const body  = Math.abs(close15 - open15);

  // ─── EXPANSION-CANDLE BLOCKER (tightened again for entry quality)
  // Breakouts on candles > 1.1x ATR fail 70%+ of the time because the 15m move is exhausted.
  const candleAtrRatio = range / atr!;
  if (candleAtrRatio > 1.1) {
    debugLog.push(`REJECT: Expansion candle on breakout ${candleAtrRatio.toFixed(2)}x ATR > 1.1x`);
    return null;
  }

  const reasons: string[] = [];
  let score = 0;

  if (side === 'LONG') {
    // ─── RSI RANGE ──────────────────────────────────────
    if (!(rsiNow! >= cfg.rsiMin && rsiNow! <= cfg.rsiMax)) return null;
    score += 1;
    reasons.push(`RSI in breakout zone (${rsiNow!.toFixed(1)})`);

    // ─── COIL DETECTION ─────────────────────────────────
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
    reasons.push(`Compression (${coilRange.toFixed(2)}% range)`);

    // ─── BREAKOUT ABOVE COIL ────────────────────────────
    const breakLevel = hiCoil * (1 + cfg.breakPct);
    // MUST break out in all modes. Aggressive mode cannot front-run the breakout.
    if (close15 < breakLevel) return null;
    score += 3;
    reasons.push('Breakout above compression range');

    // ─── LATE-ENTRY CHECK for breakouts ─────────────────
    // If price is already more than 1.5x ATR above the break level, this is chasing
    const lateExtension = (close15 - breakLevel) / atr!;
    if (lateExtension > 1.5 && modeKey !== 'AGGRESSIVE') {
      debugLog.push(`REJECT: Breakout late entry ${lateExtension.toFixed(2)}x ATR past breakLevel`);
      return null;
    }
    const entryTiming: 'EARLY' | 'OPTIMAL' | 'LATE' =
      lateExtension < 0.5 ? 'OPTIMAL' : lateExtension < 1.0 ? 'EARLY' : 'LATE';

    // ─── FALSE BREAKOUT SHIELD ───────────────────────────
    const breakoutQuality = (close15 - breakLevel) / Math.max(1e-9, high15 - breakLevel);
    // Requires a strong structural close above the break line.
    const minBreakQuality = modeKey === 'AGGRESSIVE' ? 0.50 : 0.70;
    if (breakoutQuality < minBreakQuality) {
      debugLog.push(`REJECT: Weak breakout quality ${breakoutQuality.toFixed(2)} (requires ${minBreakQuality})`);
      return null; 
    }
    score += 1;
    reasons.push('Strong breakout close');

    // Previous candle must not already be broken -> prevents entering on 2nd/3rd candle
    if (prev.close > breakLevel) {
      debugLog.push(`REJECT: Late entry, previous candle already broke out`);
      return null;
    }

    // ─── VOLUME ─────────────────────────────────────────
    const volRatio = volNow / volAvg!;
    const volSpike = volLongAvg ? (volNow / volLongAvg!) : 0;
    if (volRatio < cfg.volMult || volSpike < cfg.volSpikeMult) return null;
    let volScore = 2;
    if (volRatio > 2.0) volScore += 2;
    if (volRatio > 3.0) volScore += 1;
    score += volScore;
    reasons.push(`Volume surge (${volRatio.toFixed(2)}x)`);

    // ─── DOLLAR VOL FLOOR ───────────────────────────────
    const dollarVolAvg = dollarVolSMA20_15[lastIdx];
    if (cfg.minDollarVol15m && dollarVolAvg != null && dollarVolAvg < cfg.minDollarVol15m) return null;

    // ─── CANDLE ANATOMY ─────────────────────────────────
    const bodyPct    = (body / range) * 100;
    const closePos   = (close15 - low15) / range;
    const isBullCandle = close15 > open15;
    const minBody    = modeKey === 'AGGRESSIVE' ? 45 : 65; 
    const minClosePos = modeKey === 'AGGRESSIVE' ? 0.65 : 0.78; 
    if (!(isBullCandle && bodyPct >= minBody && closePos >= minClosePos)) {
      debugLog.push(`REJECT: Weak anatomy — body:${bodyPct.toFixed(0)}% pos:${closePos.toFixed(2)}`);
      return null;
    }

    const upperWick = high15 - close15;
    // Selling Wick Penalty (Anti-Stall)
    if (upperWick > body * 0.40) {
      debugLog.push(`REJECT: Excessive upper selling wick (${(upperWick/body).toFixed(2)}x body) — breakout stalling`);
      return null;
    }
    score += 1;
    reasons.push('Strong breakout candle');

    // ─── ACCELERATION ───────────────────────────────────
    if (prev2) {
      const accel    = (close15 - prev.close) - (prev.close - prev2.close);
      const accelPct = accel / close15;
      if (modeKey !== 'AGGRESSIVE' && cfg.accelPctMin && accelPct < cfg.accelPctMin) return null;
      if (accelPct > 0.002) { score += 1; reasons.push(`Acceleration (+${(accelPct*100).toFixed(3)}%)`); }
    }

    // ─── ORDER FLOW ─────────────────────────────────────
    const flowCheck = validateOrderFlow(orderFlow, 'LONG');
    const missingFlowPenalty = flowCheck.missingFlow ? 3 : 0;
    if (!flowCheck.ok && modeKey !== 'AGGRESSIVE') return null;
    score += flowCheck.score;
    if (flowCheck.reasons.length > 0) reasons.push(flowCheck.reasons[0]);

    score += 1; // 1H trend gate bonus
    reasons.push('1H trend confirmed');

    score += (regimeScoreBonus || 0);
    if (regimeScoreBonus && regimeScoreBonus > 0) reasons.push('Regime supportive');

    const effectiveScoreMin = cfg.scoreMin + missingFlowPenalty;
    if (score < effectiveScoreMin) return null;

    // ─── ENTRY/RISK ──────────────────────────────────────
    const triggerPrice = close15 * 1.0010;
    const riskPerTrade = balance * activeMode.riskPct;
    const stopBase     = Math.max(loCoil, e20! * (1 - 0.002));
    const atrStop      = triggerPrice - (atr! * 1.8);
    const minAtrStop   = triggerPrice - (atr! * 1.2);
    const stopLoss     = Math.min(Math.max(stopBase, atrStop), minAtrStop);
    const stopDistance = Math.max(triggerPrice - stopLoss, triggerPrice * 0.004);
    const stopPctVal   = (stopDistance / triggerPrice) * 100;
    if (modeKey !== 'AGGRESSIVE' && (stopPctVal > 2.5 || stopPctVal < 0.4)) return null;
    const takeProfit  = triggerPrice + 1.25 * stopDistance;
    const takeProfit2 = triggerPrice + 2.5  * stopDistance;
    const qty         = riskPerTrade / stopDistance;
    const sizeUSDT    = qty * triggerPrice;

    const zoneDistancePct = ((close15 - breakLevel) / breakLevel) * 100;
    debugLog.push(`ACCEPT: LONG BREAKOUT score=${score} timing=${entryTiming}`);

    return {
      kind: 'SUPER_SNIPER', side: 'LONG', score, reasons,
      entryPrice: triggerPrice, stopLoss, takeProfit, takeProfit2,
      qty, sizeUSDT, atr15: atr!, volRatio,
      entryType: 'BREAKOUT',
      zoneDistancePct: parseFloat(zoneDistancePct.toFixed(3)),
      btcRegimeAtEntry: btcRegimeLabel ?? 'UNKNOWN',
      entryTiming,
      debugLog,
      // Internal tracking for retest engine
      breakLevel
    };

  } else {
    // ─── SHORT BREAKOUT ──────────────────────────────────
    const rsiMinShort = 100 - cfg.rsiMax;
    const rsiMaxShort = 100 - cfg.rsiMin;
    if (!(rsiNow! >= rsiMinShort && rsiNow! <= rsiMaxShort)) return null;
    score += 1;
    reasons.push(`RSI in short breakout zone (${rsiNow!.toFixed(1)})`);

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
    reasons.push(`Compression (${coilRange.toFixed(2)}%)`);

    const breakLevel = loCoil * (1 - cfg.breakPct);
    if (close15 > breakLevel) return null;
    score += 3;
    reasons.push('Breakdown below compression range');

    const lateExtension = (breakLevel - close15) / atr!;
    if (lateExtension > 1.25 && modeKey !== 'AGGRESSIVE') {
      debugLog.push(`REJECT: SHORT Breakdown late entry ${lateExtension.toFixed(2)}x ATR past breakLevel (Premium cap 1.25x)`);
      return null;
    }
    const entryTiming: 'EARLY' | 'OPTIMAL' | 'LATE' =
      lateExtension < 0.5 ? 'OPTIMAL' : lateExtension < 0.9 ? 'EARLY' : 'LATE';

    const breakoutQuality = (breakLevel - close15) / Math.max(1e-9, breakLevel - low15);
    const minBreakQuality = modeKey === 'AGGRESSIVE' ? 0.50 : 0.72; // was 0.70
    if (breakoutQuality < minBreakQuality) {
      debugLog.push(`REJECT: Weak breakdown quality ${breakoutQuality.toFixed(2)} (requires ${minBreakQuality})`);
      return null;
    }
    score += 1;
    reasons.push('Strong breakdown close');

    if (prev.close < breakLevel) {
       debugLog.push(`REJECT: Late entry, previous candle already broke down`);
       return null;
    }

    const volRatio = volNow / volAvg!;
    const volSpike = volLongAvg ? (volNow / volLongAvg!) : 0;
    if (volRatio < cfg.volMult || volSpike < cfg.volSpikeMult) return null;
    let volScore = 2;
    if (volRatio > 2.0) volScore += 2;
    if (volRatio > 3.0) volScore += 1;
    score += volScore;
    reasons.push(`Volume surge (${volRatio.toFixed(2)}x)`);

    const dollarVolAvg = dollarVolSMA20_15[lastIdx];
    if (cfg.minDollarVol15m && dollarVolAvg != null && dollarVolAvg < cfg.minDollarVol15m) return null;

    const bodyPct    = (body / range) * 100;
    const closePos   = (close15 - low15) / range;
    const lowerWick  = Math.min(open15, close15) - low15;
    const isBearCandle = close15 < open15;
    const minBody    = modeKey === 'AGGRESSIVE' ? 45 : 70; // was 65
    const maxClosePos = modeKey === 'AGGRESSIVE' ? 0.35 : 0.18; // was 0.22
    
    if (!(isBearCandle && bodyPct >= minBody && closePos <= maxClosePos)) {
      debugLog.push(`REJECT: Weak bearer anatomy — body:${bodyPct.toFixed(0)}% pos:${closePos.toFixed(2)} (Req: ${minBody}% / ${maxClosePos})`);
      return null;
    }

    // Buying Wick Penalty (Anti-Stall)
    if (lowerWick > body * 0.40) {
      debugLog.push(`REJECT: Excessive lower buying wick (${(lowerWick/body).toFixed(2)}x body) — breakdown stalling`);
      return null;
    }
    score += 1;
    reasons.push('Decisive premium breakdown candle');

    if (prev2) {
      const accel    = (prev.close - close15) - (prev2.close - prev.close);
      const accelPct = accel / close15;
      if (modeKey !== 'AGGRESSIVE' && cfg.accelPctMin && accelPct < cfg.accelPctMin) return null;
      if (accelPct > 0.002) { score += 1; reasons.push(`Downward accel`); }
    }

    const flowCheck = validateOrderFlow(orderFlow, 'SHORT');
    const missingFlowPenalty = flowCheck.missingFlow ? 3 : 0;
    if (!flowCheck.ok && modeKey !== 'AGGRESSIVE') return null;
    score += flowCheck.score;
    if (flowCheck.reasons.length > 0) reasons.push(flowCheck.reasons[0]);

    score += 1;
    reasons.push('1H trend confirmed (bearish)');

    const shortRegimeBonus = regime === 'TRENDING_DOWN' ? Math.abs(regimeScoreBonus || 0) : -(regimeScoreBonus || 0);
    score += shortRegimeBonus;

    const effectiveScoreMin = cfg.scoreMin + missingFlowPenalty;
    if (score < effectiveScoreMin) return null;

    const triggerPrice = close15 * (1 - 0.0010);
    const riskPerTrade = balance * activeMode.riskPct;
    const stopBase     = Math.min(hiCoil, e20! * (1 + 0.002));
    const atrStop      = triggerPrice + (atr! * 1.8);
    const minAtrStop   = triggerPrice + (atr! * 1.2);
    const stopLoss     = Math.max(Math.min(stopBase, atrStop), minAtrStop);
    const stopDistance = Math.max(stopLoss - triggerPrice, triggerPrice * 0.004);
    const stopPctVal   = (stopDistance / triggerPrice) * 100;
    if (modeKey !== 'AGGRESSIVE' && (stopPctVal > 2.5 || stopPctVal < 0.4)) return null;
    const takeProfit  = triggerPrice - 1.25 * stopDistance;
    const takeProfit2 = triggerPrice - 2.5  * stopDistance;
    const qty         = riskPerTrade / stopDistance;
    const sizeUSDT    = qty * triggerPrice;

    const zoneDistancePct = ((breakLevel - close15) / breakLevel) * 100;
    debugLog.push(`ACCEPT: SHORT BREAKOUT score=${score} timing=${entryTiming}`);

    return {
      kind: 'SUPER_SNIPER', side: 'SHORT', score, reasons,
      entryPrice: triggerPrice, stopLoss, takeProfit, takeProfit2,
      qty, sizeUSDT, atr15: atr!, volRatio,
      entryType: 'BREAKOUT',
      zoneDistancePct: parseFloat(zoneDistancePct.toFixed(3)),
      btcRegimeAtEntry: btcRegimeLabel ?? 'UNKNOWN',
      entryTiming,
      debugLog,
      // Internal tracking for retest engine
      breakLevel
    };
  }
}
