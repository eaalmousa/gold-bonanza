"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateSniperSignal = evaluateSniperSignal;
var indicators_1 = require("./indicators");
var regimeFilter_1 = require("./regimeFilter");
// ─── DEBUG LOGGER ─────────────────────────────────────────────────
function makeDebugLog(symbol) {
    var log = [];
    if (symbol)
        log.push("[SniperV3] ".concat(symbol));
    return log;
}
function evaluateSniperSignal(tf1h, tf15m, activeMode, balance, regime, regimeScoreBonus, orderFlow, btc4hTrend, btcRegimeLabel, symbol) {
    var _a, _b, _c;
    var modeKey = activeMode.key;
    var debugLog = makeDebugLog(symbol);
    if (!tf1h || tf1h.length < 210 || !tf15m || tf15m.length < 90)
        return null;
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
    var closes1h = tf1h.map(function (c) { return c.close; });
    var ema20_1h = (0, indicators_1.calcEMA)(closes1h, 20);
    var ema50_1h = (0, indicators_1.calcEMA)(closes1h, 50);
    var ema200_1h = (0, indicators_1.calcEMA)(closes1h, 200);
    var idx1h = closes1h.length - 1;
    var close1h = closes1h[idx1h];
    var e20_1h = ema20_1h[idx1h];
    var e50_1h = ema50_1h[idx1h];
    var e200_1h = ema200_1h[idx1h];
    if ([e20_1h, e50_1h, e200_1h].some(function (v) { return v == null; }))
        return null;
    // ─── GATE 2: DIRECTION ────────────────────────────────
    var isUptrend = close1h > e200_1h && e20_1h > e50_1h && e50_1h > e200_1h;
    var isDowntrend = close1h < e200_1h && e20_1h < e50_1h && e50_1h < e200_1h;
    var e20Slope1h = e20_1h - ((_a = ema20_1h[idx1h - 3]) !== null && _a !== void 0 ? _a : e20_1h);
    var e50Slope1h = e50_1h - ((_b = ema50_1h[idx1h - 3]) !== null && _b !== void 0 ? _b : e50_1h);
    var side;
    if (modeKey === 'AGGRESSIVE') {
        side = close1h > e50_1h ? 'LONG' : 'SHORT';
    }
    else if (isUptrend && e20Slope1h > 0 && e50Slope1h >= 0) {
        side = 'LONG';
        if (regime === 'TRENDING_DOWN')
            return null;
    }
    else if (isDowntrend && e20Slope1h < 0 && e50Slope1h <= 0) {
        side = 'SHORT';
        if (regime === 'TRENDING_UP')
            return null;
    }
    else {
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
    var closes15 = tf15m.map(function (c) { return c.close; });
    var highs15 = tf15m.map(function (c) { return c.high; });
    var lows15 = tf15m.map(function (c) { return c.low; });
    var vols15 = tf15m.map(function (c) { return c.volume; });
    var ema20_15 = (0, indicators_1.calcEMA)(closes15, 20);
    var ema50_15 = (0, indicators_1.calcEMA)(closes15, 50);
    var rsi14_15 = (0, indicators_1.calcRSI)(closes15, 14);
    var atr14_15 = (0, indicators_1.calcATR)(highs15, lows15, closes15, 14);
    var volSMA20_15 = (0, indicators_1.calcSMA)(vols15, 20);
    var volSMA50_15 = (0, indicators_1.calcSMA)(vols15, 50);
    var dollarVols15 = vols15.map(function (v, i) { return v * closes15[i]; });
    var dollarVolSMA20_15 = (0, indicators_1.calcSMA)(dollarVols15, 20);
    var macdResult = (0, indicators_1.calcMACD)(closes15);
    var bbResult = (0, indicators_1.calcBollingerBands)(closes15, 20, 2.0);
    var doublePattern = (0, indicators_1.detectDoublePattern)(highs15, lows15, closes15);
    var lastIdx = closes15.length - 2;
    if (lastIdx <= 60)
        return null;
    var candle = tf15m[lastIdx];
    var prev = tf15m[lastIdx - 1];
    var prev2 = tf15m[lastIdx - 2];
    var close15 = candle.close;
    var open15 = candle.open;
    var high15 = candle.high;
    var low15 = candle.low;
    var e20_15 = ema20_15[lastIdx];
    var e50_15 = ema50_15[lastIdx];
    var rsiNow = rsi14_15[lastIdx];
    var rsiPrev = rsi14_15[lastIdx - 1];
    var atr = atr14_15[lastIdx];
    var vol = vols15[lastIdx];
    var volAvg = volSMA20_15[lastIdx];
    var volLongAvg = (_c = volSMA50_15[lastIdx]) !== null && _c !== void 0 ? _c : volAvg;
    if ([e20_15, e50_15, rsiNow, rsiPrev, atr, volAvg].some(function (v) { return v == null; }))
        return null;
    var cfg = activeMode.pullback;
    var slack = cfg.valueZoneSlack;
    var range = Math.max(1e-9, high15 - low15);
    var body = Math.abs(close15 - open15);
    var candleAtrRatio = range / atr;
    // ─── EXPANSION CAP (tightened for entry quality)
    // Reversals/pullbacks on huge candles have exhausted short-term momentum.
    // We cap sniper signals at 1.15x ATR.
    if (candleAtrRatio > 1.15) {
        debugLog.push("REJECT: Huge expansion candle ".concat(candleAtrRatio.toFixed(2), "x ATR > 1.15x"));
        return null;
    }
    debugLog.push("PASS: Candle size ".concat(candleAtrRatio.toFixed(2), "x ATR (limit 1.15x)"));
    // ─── MANDATORY RETEST CHECK FOR MODERATE EXPANSION ───────────────
    // If candle range > 0.9x ATR (moderate expansion), require the
    // previous candle to show acceptance: it must have closed ABOVE EMA20
    // confirming price held the zone rather than just spiking through it.
    if (candleAtrRatio > 0.9) {
        var prevClose15 = prev.close;
        var prevE20_15 = ema20_15[lastIdx - 1];
        var prevAcceptance = prevE20_15 != null && prevClose15 >= prevE20_15 * 0.999;
        if (!prevAcceptance) {
            debugLog.push("REJECT: Expanded candle (".concat(candleAtrRatio.toFixed(2), "x ATR) without prior acceptance candle"));
            return null;
        }
        debugLog.push("PASS: Expanded candle has prior acceptance (prev closed above EMA20)");
    }
    // ─── SETUP TYPE CLASSIFIER ─────────────────────────────
    // REVERSAL: price was BELOW EMA50 recently and is now reclaiming EMA20
    // CONTINUATION: price stayed above EMA20 the whole time, just pulled back to it
    var entryType = 'CONTINUATION';
    var wasbelowE50Recently = lows15.slice(lastIdx - 5, lastIdx).some(function (l) { return l < e50_15; });
    if (side === 'LONG') {
        if (wasbelowE50Recently && close15 > e20_15) {
            entryType = 'REVERSAL';
        }
    }
    else {
        var wasAboveE50Recently = highs15.slice(lastIdx - 5, lastIdx).some(function (h) { return h > e50_15; });
        if (wasAboveE50Recently && close15 < e20_15) {
            entryType = 'REVERSAL';
        }
    }
    debugLog.push("Setup classified as: ".concat(entryType));
    var reasons = [];
    var score = 0;
    if (side === 'LONG') {
        // ═══════════════════════════════════════════════
        //  LONG SNIPER
        // ═══════════════════════════════════════════════
        // GATE: Value zone check
        var zoneTop = e20_15 * (1 + slack);
        var zoneBottom = e50_15 * (1 - slack);
        var inZone = low15 <= zoneTop && high15 >= zoneBottom;
        if (modeKey !== 'AGGRESSIVE' && !inZone) {
            debugLog.push("REJECT: Price not in value zone [".concat(zoneBottom.toFixed(4), " - ").concat(zoneTop.toFixed(4), "]"));
            return null;
        }
        // ─── GATE 4b: LATE-ENTRY BLOCKER (tightened round 2) ─────────────
        // Normal modes: close must not be >0.65x ATR above EMA20 (was 1.0x)
        // Aggressive mode: hard cap at 0.75x ATR (was 1.5x)
        var extensionAboveZone = (close15 - e20_15) / atr;
        if (extensionAboveZone > 0.65 && modeKey !== 'AGGRESSIVE') {
            debugLog.push("REJECT: Late entry \u2014 close is ".concat(extensionAboveZone.toFixed(2), "x ATR above EMA20 (limit 0.65x)"));
            return null;
        }
        if (extensionAboveZone > 0.75) { // Hard cap even in aggressive mode
            debugLog.push("REJECT: Extreme late entry \u2014 ".concat(extensionAboveZone.toFixed(2), "x ATR above zone (cap 0.75x)"));
            return null;
        }
        // Calculate zone distance for quality report (tightened timing boundaries)
        var zoneIdeal = (e20_15 + e50_15) / 2; // midpoint of EMA zone
        var zoneDistancePct = ((close15 - zoneIdeal) / zoneIdeal) * 100;
        // Timing: OPTIMAL <0.20, EARLY <0.45, LATE ≥0.45 (was 0.25/0.70)
        var entryTiming = extensionAboveZone < 0.20 ? 'OPTIMAL' :
            extensionAboveZone < 0.45 ? 'EARLY' : 'LATE';
        debugLog.push("Zone distance: ".concat(zoneDistancePct.toFixed(2), "%, timing: ").concat(entryTiming, ", extension: ").concat(extensionAboveZone.toFixed(2), "x ATR"));
        score += 2;
        reasons.push("Pullback into EMA zone (".concat(entryTiming, ")"));
        // GATE: 1H structure guard
        var guard = modeKey === 'CONSERVATIVE' ? 0.0025 : modeKey === 'BALANCED' ? 0.004 : 0.006;
        var distFrom1hE20 = (close15 - e20_1h) / e20_1h;
        var distFrom1hE50 = (close15 - e50_1h) / e50_1h;
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
        if (!(rsiNow >= cfg.rsiMin && rsiNow <= cfg.rsiMax)) {
            debugLog.push("REJECT: RSI ".concat(rsiNow.toFixed(1), " out of range [").concat(cfg.rsiMin, "-").concat(cfg.rsiMax, "]"));
            return null;
        }
        var rsiTurning = modeKey !== 'AGGRESSIVE'
            ? (rsiNow > rsiPrev && (rsiNow - rsiPrev) >= 0.7)
            : (rsiNow > rsiPrev);
        if (!rsiTurning) {
            debugLog.push("REJECT: RSI not turning up (".concat(rsiPrev.toFixed(1), " \u2192 ").concat(rsiNow.toFixed(1), ")"));
            return null;
        }
        score += 2;
        reasons.push("RSI turning up (".concat(rsiNow.toFixed(1), ")"));
        // GATE: Dollar volume floor
        var dollarVolAvg = dollarVolSMA20_15[lastIdx];
        if (cfg.minDollarVol15m && dollarVolAvg != null && dollarVolAvg < cfg.minDollarVol15m) {
            debugLog.push("REJECT: Dollar volume ".concat((dollarVolAvg / 1e6).toFixed(2), "M too low (min ").concat((cfg.minDollarVol15m / 1e6).toFixed(2), "M)"));
            return null;
        }
        // Volume spike (Gate + Score)
        var volSpike = volLongAvg ? (vol / volLongAvg) : 0;
        if (cfg.volSpikeMult && volSpike < cfg.volSpikeMult) {
            debugLog.push("REJECT: Volume spike ".concat(volSpike.toFixed(2), "x < required ").concat(cfg.volSpikeMult, "x"));
            return null;
        }
        var volRatio = vol / volAvg;
        if (volRatio < cfg.volMult) {
            debugLog.push("REJECT: Volume ratio ".concat(volRatio.toFixed(2), "x < required ").concat(cfg.volMult, "x"));
            return null;
        }
        var volScore = 2;
        if (volRatio > 2.0)
            volScore += 2;
        if (volRatio > 3.5)
            volScore += 2;
        score += volScore;
        reasons.push("Bull volume (".concat(volRatio.toFixed(2), "x)"));
        // ─── CANDLE ANATOMY (Knife-catching protection) ───────────────
        // Must close strong to confirm buyers stepped in.
        var bodyPct = (body / range) * 100;
        var closePos = (close15 - low15) / range;
        var isBullCandle = close15 > open15;
        var minBody = modeKey === 'AGGRESSIVE' ? 35 : 55;
        var minClosePos = modeKey === 'AGGRESSIVE' ? 0.65 : 0.70; // 0.50 was too loose, caused 47% wrong direction
        if (!(isBullCandle && bodyPct >= minBody && closePos >= minClosePos)) {
            debugLog.push("REJECT: Weak bullish confirmation \u2014 body:".concat(bodyPct.toFixed(0), "% pos:").concat(closePos.toFixed(2)));
            return null;
        }
        score += 2;
        reasons.push('Bullish confirmation candle');
        // ─── DEEP PULLBACK PROTECTION ────────────────────────────────
        // If the lowest point of the pullback went too far below EMA50, structure is broken.
        if ((e50_15 - low15) / atr > 1.0) {
            debugLog.push("REJECT: Deep pullback \u2014 wick went > 1.0x ATR below EMA50");
            return null;
        }
        // ─── LOCAL CEILING / RESISTANCE PROXIMITY CHECK (LONG ENTRY REPAIR) ───
        // Mirror of the SHORT-side floor check. Do NOT buy immediately under a recent swing high / resistance cap.
        // 1. Find the highest point in the recent consolidation window
        var recentHighs = highs15.slice(Math.max(0, lastIdx - 15), lastIdx);
        var localCeiling = Math.max.apply(Math, recentHighs);
        // 2. Metrics
        var isBreakingCeiling = close15 >= localCeiling - (atr * 0.15);
        var isHoveringBelowCeil = close15 < localCeiling - (atr * 0.15) && close15 > localCeiling - (atr * 0.6);
        var distanceToCeilPct = ((localCeiling - close15) / close15) * 100;
        var ceilDistStr = "[Ceiling Dist: ".concat(distanceToCeilPct.toFixed(2), "%]");
        // 3. Chop-under-ceiling detection
        if (isHoveringBelowCeil) {
            debugLog.push("REJECT: Compressing immediately below local resistance ceiling ".concat(ceilDistStr));
            return null;
        }
        // 4. Breakout acceptance: if buying AT the ceiling, require a clean close above it
        if (isBreakingCeiling) {
            var cleanCloseAbove = close15 > localCeiling;
            var followThrough = close15 > prev.close && isBullCandle;
            if (!cleanCloseAbove || !followThrough) {
                debugLog.push("REJECT: Poking local resistance\u2014no clean breakout acceptance ".concat(ceilDistStr));
                return null;
            }
            score += 2;
            reasons.push('Clean ceiling breakout accepted');
        }
        else {
            reasons.push("Clear headroom above (Dist: ".concat(distanceToCeilPct.toFixed(2), "%)"));
        }
        // Acceleration
        if (prev2) {
            var accel = (close15 - prev.close) - (prev.close - prev2.close);
            var accelPct = accel / close15;
            if (modeKey !== 'AGGRESSIVE' && cfg.accelPctMin && accelPct < cfg.accelPctMin) {
                debugLog.push("REJECT: Insufficient acceleration ".concat((accelPct * 100).toFixed(3), "%"));
                return null;
            }
            if (accelPct > 0.0015) {
                score += 2;
                reasons.push("Strong acceleration (+".concat((accelPct * 100).toFixed(3), "%)"));
            }
            else if (accelPct > 0)
                score += 1;
        }
        // ATR range check
        var atrPct = (atr / close15) * 100;
        if (!(atrPct > cfg.atrPctMin && atrPct < cfg.atrPctMax)) {
            debugLog.push("REJECT: ATR% ".concat(atrPct.toFixed(2), " out of range [").concat(cfg.atrPctMin, "-").concat(cfg.atrPctMax, "]"));
            return null;
        }
        // ─── REVERSAL vs CONTINUATION specific requirements ─────────────
        // REVERSAL: MUST reclaim EMA20. Catching falling knives below EMA20 is banned in all modes.
        if (entryType === 'REVERSAL') {
            if (close15 < e20_15) {
                debugLog.push('REJECT: REVERSAL setup failed to reclaim EMA20');
                return null;
            }
            var prevIsBear = prev.close < prev.open;
            var isEngulfing = isBullCandle && prevIsBear && close15 > prev.open && open15 <= prev.close;
            var closedAbovePrevHigh = close15 > prev.high;
            if (isEngulfing) {
                score += 2;
                reasons.push('Bullish Engulfing Reversal');
            }
            else {
                if (!closedAbovePrevHigh) {
                    debugLog.push('REJECT: Poor reversal structure (not engulfing and failed to close above prev high)');
                    return null;
                }
                if (modeKey !== 'AGGRESSIVE' && score < cfg.scoreMin + 2) {
                    debugLog.push('REJECT: REVERSAL setup requires higher base score since not engulfing');
                    return null;
                }
            }
        }
        else {
            // CONTINUATION: normal gate
            var prevE20 = ema20_15[lastIdx - 1];
            var reclaimHold = (prevE20 != null) && (prev.close > prevE20) && (close15 > e20_15) &&
                (prev.low <= prevE20 * (1 + slack) || low15 <= e20_15 * (1 + slack));
            var lowerWick = Math.min(open15, close15) - low15;
            var lowerWickRatio = lowerWick / Math.max(1e-9, body);
            var nearE50 = low15 <= e50_15 * (1 + slack * 1.2);
            var reversalCandle = isBullCandle && nearE50 && (lowerWickRatio >= 1.35) && (closePos >= 0.62);
            var higherLow = (low15 > prev.low) && (low15 >= e50_15 * (1 - slack)) && (close15 > e20_15);
            var prevCandleBull = prev.close > prev.open;
            var twoBarReversal = prevCandleBull && isBullCandle && (prev.low < e20_15) && (close15 > e20_15);
            // REMOVED `modeKey === 'AGGRESSIVE'` bypass. Longs MUST show real structural confirmation.
            var confirmed = reclaimHold || (higherLow && rsiNow > 50) || twoBarReversal;
            var closedAbovePrevHigh = close15 > prev.high;
            var heldAboveE20ByClose = close15 >= e20_15 * 1.001;
            if (!heldAboveE20ByClose) {
                debugLog.push('REJECT: Failed to hold EMA20 by close (strict requirement for longs)');
                return null;
            }
            if (modeKey === 'AGGRESSIVE') {
                if (!confirmed && !closedAbovePrevHigh) {
                    debugLog.push('REJECT: Unconfirmed aggressive long continuation must close above prev high');
                    return null;
                }
            }
            else {
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
        var flowCheck = (0, regimeFilter_1.validateOrderFlow)(orderFlow, 'LONG');
        var missingFlowPenalty = flowCheck.missingFlow ? 3 : 0; // Compensate for missing data
        if (!flowCheck.ok && modeKey !== 'AGGRESSIVE') {
            debugLog.push('REJECT: Order flow is bearish');
            return null;
        }
        score += flowCheck.score;
        if (flowCheck.reasons.length > 0)
            reasons.push(flowCheck.reasons[0]);
        if (flowCheck.missingFlow)
            debugLog.push('NOTE: Order flow unavailable — score threshold raised by 3');
        // ─── MACD CONFLUENCE BONUS ───────────────────────────────────
        var macdHist = macdResult.histogram[lastIdx];
        var macdHistPrev = macdResult.histogram[lastIdx - 1];
        if (macdHist != null && macdHistPrev != null) {
            if (macdHist > 0 && macdHist > macdHistPrev) {
                score += 2;
                reasons.push('MACD histogram bullish');
            }
            else if (macdHist > macdHistPrev && macdHistPrev < 0) {
                score += 1;
                reasons.push('MACD divergence building');
            }
        }
        // ─── BOLLINGER BANDS CONFLUENCE BONUS ───────────────────────
        var pctB = bbResult.percentB[lastIdx];
        if (pctB != null) {
            if (pctB <= 0.15) {
                score += 2;
                reasons.push("BB lower band (%B=".concat((pctB * 100).toFixed(0), "%) \u2014 oversold"));
            }
            else if (pctB <= 0.30) {
                score += 1;
                reasons.push("Near BB lower (%B=".concat((pctB * 100).toFixed(0), "%)"));
            }
        }
        var bw = bbResult.bandwidth[lastIdx];
        var bwPrev5 = bbResult.bandwidth[lastIdx - 5];
        if (bw != null && bwPrev5 != null && bw < bwPrev5 * 0.75) {
            score += 1;
            reasons.push('BB squeeze — compression');
        }
        // ─── PATTERN BONUS ───────────────────────────────────────────
        if (doublePattern === 'DOUBLE_BOTTOM') {
            score += 3;
            reasons.push('Double Bottom (W) confirmed');
        }
        // ─── REGIME BONUS ────────────────────────────────────────────
        score += (regimeScoreBonus || 0);
        if (regimeScoreBonus && regimeScoreBonus > 0)
            reasons.push('Market regime supportive');
        // ─── FINAL SCORE CHECK ───────────────────────────────────────
        var effectiveScoreMin = cfg.scoreMin + missingFlowPenalty;
        debugLog.push("Score: ".concat(score, " / required: ").concat(effectiveScoreMin, " (raw min ").concat(cfg.scoreMin, " + flow penalty ").concat(missingFlowPenalty, ")"));
        if (score < effectiveScoreMin) {
            debugLog.push("REJECT: Score ".concat(score, " below threshold ").concat(effectiveScoreMin));
            return null;
        }
        // ─── ENTRY/EXIT CALCULATIONS ─────────────────────────────────
        var triggerBuffer = modeKey === 'CONSERVATIVE' ? 0.0015 : modeKey === 'BALANCED' ? 0.0012 : 0.0010;
        var triggerPrice = high15 * (1 + triggerBuffer);
        var chasePct = ((triggerPrice - close15) / close15) * 100;
        // Tightened chase check: 0.45% → 0.30%
        if (modeKey !== 'AGGRESSIVE' && (chasePct > 0.30 || (triggerPrice - close15) > atr * 0.25)) {
            debugLog.push("REJECT: Chase check \u2014 trigger ".concat(chasePct.toFixed(2), "% above close (limit 0.30%)"));
            return null;
        }
        // Even in aggressive mode, block extreme chasing
        if (chasePct > 0.55 || (triggerPrice - close15) > atr * 0.45) {
            debugLog.push("REJECT: Extreme chase \u2014 trigger ".concat(chasePct.toFixed(2), "% above close"));
            return null;
        }
        var riskPerTrade = balance * activeMode.riskPct;
        // ATR-primary stop loss (Finding 9) — must be at least 1.2x ATR below entry
        var structureStop = Math.min(low15, e50_15) * (1 - 0.0012);
        var atrStop = triggerPrice - (atr * 1.6);
        var minAtrStop = triggerPrice - (atr * 1.2); // hard floor: never tighter than 1.2x ATR
        var rawStop = Math.min(structureStop, atrStop);
        var stopLoss = Math.min(rawStop, minAtrStop); // ensure we are at or below the 1.2x floor
        var stopDistance = Math.max(triggerPrice - stopLoss, triggerPrice * 0.0035);
        var stopPctVal = (stopDistance / triggerPrice) * 100;
        if (modeKey !== 'AGGRESSIVE' && (stopPctVal > 2.5 || stopPctVal < 0.4)) {
            debugLog.push("REJECT: Stop distance ".concat(stopPctVal.toFixed(2), "% out of bounds [0.4%-2.5%]"));
            return null;
        }
        var takeProfit = triggerPrice + 1.25 * stopDistance;
        var takeProfit2 = triggerPrice + 2.5 * stopDistance;
        var qty = riskPerTrade / stopDistance;
        var sizeUSDT = qty * triggerPrice;
        // ─── ZONE DISTANCE for quality report ────────────────────────
        var zoneDistPct = ((close15 - zoneIdeal) / zoneIdeal) * 100;
        var extAbove = (close15 - e20_15) / atr;
        // Match tightened boundaries: OPTIMAL <0.20, LATE ≥0.45
        var finalTiming = extAbove < 0.20 ? 'OPTIMAL' : extAbove < 0.45 ? 'EARLY' : 'LATE';
        debugLog.push("ACCEPT: ".concat(entryType, " ").concat(side, " score=").concat(score, " trigger=").concat(triggerPrice.toFixed(4), " SL=").concat(stopLoss.toFixed(4)));
        return {
            kind: 'SNIPER', side: 'LONG',
            score: score,
            reasons: reasons,
            entryPrice: triggerPrice,
            stopLoss: stopLoss,
            takeProfit: takeProfit,
            takeProfit2: takeProfit2,
            qty: qty,
            sizeUSDT: sizeUSDT,
            atr15: atr,
            volRatio: volRatio,
            entryType: entryType,
            zoneDistancePct: parseFloat(zoneDistPct.toFixed(3)),
            btcRegimeAtEntry: btcRegimeLabel !== null && btcRegimeLabel !== void 0 ? btcRegimeLabel : 'UNKNOWN',
            entryTiming: finalTiming,
            debugLog: debugLog
        };
    }
    else {
        // ═══════════════════════════════════════════════
        //  SHORT SNIPER
        // ═══════════════════════════════════════════════
        // GATE: Value zone check (inverted — price rallies UP into zone)
        var zoneTop = e50_15 * (1 + slack);
        var zoneBottom = e20_15 * (1 - slack);
        var inZone = high15 >= zoneBottom && low15 <= zoneTop;
        if (modeKey !== 'AGGRESSIVE' && !inZone) {
            debugLog.push('REJECT: Price not in short value zone');
            return null;
        }
        // ─── LATE-ENTRY BLOCKER (SHORT) ─────────────────────────────
        var extensionBelowZone = (e20_15 - close15) / atr;
        if (extensionBelowZone > 1.0 && modeKey !== 'AGGRESSIVE') {
            debugLog.push("REJECT: Short late entry \u2014 close is ".concat(extensionBelowZone.toFixed(2), "x ATR below EMA20"));
            return null;
        }
        // Tightened hard cap to 1.0x (was 1.5x) — symmetric with LONG hard cap of 0.75x
        if (extensionBelowZone > 1.0)
            return null;
        var zoneIdealShort = (e20_15 + e50_15) / 2;
        var zoneDistPct = ((zoneIdealShort - close15) / zoneIdealShort) * 100;
        var finalTimingShort = extensionBelowZone < 0.25 ? 'OPTIMAL' : extensionBelowZone < 0.65 ? 'EARLY' : 'LATE';
        // GATE: 1H structure guard (inverted)
        var guard = modeKey === 'CONSERVATIVE' ? 0.0025 : modeKey === 'BALANCED' ? 0.004 : 0.006;
        var distFrom1hE20 = (e20_1h - close15) / e20_1h;
        var distFrom1hE50 = (e50_1h - close15) / e50_1h;
        if (modeKey !== 'AGGRESSIVE' && (distFrom1hE20 < -guard || distFrom1hE50 < -guard * 1.4))
            return null;
        // GATE: RSI
        var rsiMinShort = 100 - cfg.rsiMax;
        var rsiMaxShort = 100 - cfg.rsiMin;
        if (!(rsiNow >= rsiMinShort && rsiNow <= rsiMaxShort))
            return null;
        var rsiTurningDown = modeKey !== 'AGGRESSIVE'
            ? (rsiNow < rsiPrev && (rsiPrev - rsiNow) >= 0.7)
            : (rsiNow < rsiPrev);
        if (!rsiTurningDown)
            return null;
        score += 2;
        reasons.push("RSI turning down (".concat(rsiNow.toFixed(1), ")"));
        // Volume
        var dollarVolAvg = dollarVolSMA20_15[lastIdx];
        if (cfg.minDollarVol15m && dollarVolAvg != null && dollarVolAvg < cfg.minDollarVol15m)
            return null;
        var volSpike = volLongAvg ? (vol / volLongAvg) : 0;
        if (cfg.volSpikeMult && volSpike < cfg.volSpikeMult)
            return null;
        var volRatio = vol / volAvg;
        if (volRatio < cfg.volMult)
            return null;
        var volScore = 2;
        if (volRatio > 2.0)
            volScore += 2;
        if (volRatio > 3.5)
            volScore += 2;
        score += volScore;
        reasons.push("Bear volume (".concat(volRatio.toFixed(2), "x)"));
        // Candle anatomy — bearish
        // Tightened for Aggressive mode to match LONG quality (was 10%/0.20 — too loose)
        var bodyPct = (body / range) * 100;
        var closePos = (high15 - close15) / range; // distance from high
        var isBearCandle = close15 < open15;
        var minBody = modeKey === 'AGGRESSIVE' ? 25 : 55; // was 10 in Aggressive — now 25
        var minClosePos = modeKey === 'AGGRESSIVE' ? 0.45 : 0.70; // was 0.20 in Aggressive — now 0.45
        if (!(isBearCandle && bodyPct >= minBody && closePos >= minClosePos)) {
            debugLog.push("REJECT: Weak bearish confirmation \u2014 body:".concat(bodyPct.toFixed(0), "% pos:").concat(closePos.toFixed(2)));
            return null;
        }
        // Acceleration (downward)
        if (prev2) {
            var accel = (prev.close - close15) - (prev2.close - prev.close);
            var accelPct = accel / close15;
            if (modeKey !== 'AGGRESSIVE' && cfg.accelPctMin && accelPct < cfg.accelPctMin)
                return null;
            if (accelPct > 0.0015) {
                score += 2;
                reasons.push("Strong downward accel");
            }
            else if (accelPct > 0)
                score += 1;
        }
        var atrPct = (atr / close15) * 100;
        if (!(atrPct > cfg.atrPctMin && atrPct < cfg.atrPctMax))
            return null;
        // Setup type reversal gate
        var prevE20 = ema20_15[lastIdx - 1];
        var lostE20 = (prevE20 != null) && (prev.close < prevE20) && (close15 < e20_15);
        var upperWick = high15 - Math.max(open15, close15);
        var upperWickRatio = upperWick / Math.max(1e-9, body);
        var nearE50 = high15 >= e50_15 * (1 - slack * 1.2);
        var reversalCandle = isBearCandle && nearE50 && (upperWickRatio >= 1.35);
        var lowerHigh = (high15 < prev.high) && (high15 <= e50_15 * (1 + slack)) && (close15 < e20_15);
        var prevCandleBear = prev.close < prev.open;
        var twoBarReversal = prevCandleBear && isBearCandle && (prev.high > e20_15) && (close15 < e20_15);
        var wasAboveE50Recently = highs15.slice(lastIdx - 5, lastIdx).some(function (h) { return h > e50_15; });
        var shortEntryType = wasAboveE50Recently && close15 < e20_15 ? 'REVERSAL' : 'CONTINUATION';
        if (shortEntryType === 'REVERSAL') {
            var hasStrongReversal = reversalCandle || twoBarReversal || doublePattern === 'DOUBLE_TOP';
            if (!hasStrongReversal && modeKey !== 'AGGRESSIVE')
                return null;
            score += reversalCandle || twoBarReversal ? 4 : 2;
            reasons.push('Bearish reversal confirmed');
        }
        else {
            var confirmed = modeKey === 'AGGRESSIVE' || lostE20 || (lowerHigh && rsiNow < 50) || twoBarReversal;
            if (!confirmed)
                return null;
            var closedBelowPrevLow = close15 < prev.low;
            var heldBelowE20ByClose = close15 <= e20_15 * 0.999;
            if (modeKey !== 'AGGRESSIVE' && !(closedBelowPrevLow && heldBelowE20ByClose))
                return null;
            score += 2;
            reasons.push('Short continuation hold');
        }
        // ─── LOCAL FLOOR / SUPPORT PROXIMITY CHECK (SHORT ENTRY REPAIR) ───
        // 1. Find the lowest point in the recent consolidation or local down-leg window
        var recentLows = lows15.slice(Math.max(0, lastIdx - 15), lastIdx);
        var localFloor = Math.min.apply(Math, recentLows);
        // 2. Metrics calculation
        var isBreakingFloor = close15 <= localFloor + (atr * 0.15);
        var isHoveringAboveFloor = close15 > localFloor + (atr * 0.15) && close15 < localFloor + (atr * 0.6);
        var distanceToFloorPct = ((close15 - localFloor) / localFloor) * 100;
        var floorDistStr = "[Floor Dist: ".concat(distanceToFloorPct.toFixed(2), "%]");
        // 3. Breakdown Acceptance Logic & Chop Detection
        if (isHoveringAboveFloor) {
            // We are compressing / hovering right above local support.
            debugLog.push("REJECT: Compressing immediately above local support floor ".concat(floorDistStr));
            return null;
        }
        if (isBreakingFloor) {
            // If we are at/breaking the floor, we require "acceptance" to avoid false breakdowns.
            // Acceptance = clean close below the local floor with follow-through
            var cleanCloseBelow = close15 < localFloor;
            var followThrough = close15 < prev.close && isBearCandle;
            if (!cleanCloseBelow || !followThrough) {
                debugLog.push("REJECT: Poking local support but lacks true breakdown acceptance ".concat(floorDistStr));
                return null;
            }
            score += 2;
            reasons.push("Clean floor breakdown accepted");
        }
        else {
            reasons.push("Clear airspace below (Dist: ".concat(distanceToFloorPct.toFixed(2), "%)"));
        }
        // Order flow
        var flowCheck = (0, regimeFilter_1.validateOrderFlow)(orderFlow, 'SHORT');
        var missingFlowPenalty = flowCheck.missingFlow ? 3 : 0;
        if (!flowCheck.ok && modeKey !== 'AGGRESSIVE')
            return null;
        score += flowCheck.score;
        if (flowCheck.reasons.length > 0)
            reasons.push(flowCheck.reasons[0]);
        // Regime bonus (inverted for shorts: downtrend is favorable)
        var shortRegimeBonus = regime === 'TRENDING_DOWN' ? Math.abs(regimeScoreBonus || 0) : -(regimeScoreBonus || 0);
        score += shortRegimeBonus;
        if (shortRegimeBonus > 0)
            reasons.push('Regime supports shorts');
        var effectiveScoreMin = cfg.scoreMin + missingFlowPenalty;
        if (score < effectiveScoreMin)
            return null;
        // Entry/exit (SHORT)
        var triggerBuffer = modeKey === 'CONSERVATIVE' ? 0.0015 : modeKey === 'BALANCED' ? 0.0012 : 0.0010;
        var triggerPrice = low15 * (1 - triggerBuffer);
        var chasePct = ((close15 - triggerPrice) / close15) * 100;
        if (modeKey !== 'AGGRESSIVE' && (chasePct > 0.45 || (close15 - triggerPrice) > atr * 0.35))
            return null;
        var riskPerTrade = balance * activeMode.riskPct;
        var structureStop = Math.max(high15, e50_15) * (1 + 0.0012);
        var atrStop = triggerPrice + (atr * 1.6);
        var minAtrStop = triggerPrice + (atr * 1.2);
        var rawStop = Math.max(structureStop, atrStop);
        var stopLoss = Math.max(rawStop, minAtrStop);
        var stopDistance = Math.max(stopLoss - triggerPrice, triggerPrice * 0.0035);
        var stopPctVal = (stopDistance / triggerPrice) * 100;
        if (modeKey !== 'AGGRESSIVE' && (stopPctVal > 2.5 || stopPctVal < 0.4))
            return null;
        var takeProfit = triggerPrice - 1.25 * stopDistance;
        var takeProfit2 = triggerPrice - 2.5 * stopDistance;
        var qty = riskPerTrade / stopDistance;
        var sizeUSDT = qty * triggerPrice;
        debugLog.push("ACCEPT: ".concat(shortEntryType, " SHORT score=").concat(score));
        return {
            kind: 'SNIPER', side: 'SHORT',
            score: score,
            reasons: reasons,
            entryPrice: triggerPrice,
            stopLoss: stopLoss,
            takeProfit: takeProfit,
            takeProfit2: takeProfit2,
            qty: qty,
            sizeUSDT: sizeUSDT,
            atr15: atr,
            volRatio: volRatio,
            entryType: shortEntryType,
            zoneDistancePct: parseFloat(zoneDistPct.toFixed(3)),
            btcRegimeAtEntry: btcRegimeLabel !== null && btcRegimeLabel !== void 0 ? btcRegimeLabel : 'UNKNOWN',
            entryTiming: finalTimingShort,
            debugLog: debugLog
        };
    }
}
