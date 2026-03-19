"use strict";
// ============================================
// Market Regime Filter — v3
// - Stricter crash detection (1.8% / 3h instead of 3% / 4h)
// - New CHOP regime blocks entries in compressed sideways conditions
// - BTC correlation limiter for position concentration
// ============================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectMarketRegime = detectMarketRegime;
exports.getCorrelationPositionLimit = getCorrelationPositionLimit;
exports.validateOrderFlow = validateOrderFlow;
const indicators_1 = require("./indicators");
/**
 * Classify the current market regime based on BTC 1H + 4H data.
 * Returns regime + score-modifier for signals.
 */
function detectMarketRegime(btc1h, btc4h) {
    let btc4hTrend = 'RANGING';
    // ─── 4H MACRO TREND ANALYSIS ────────────────────
    if (btc4h && btc4h.length >= 50) {
        const closes4h = btc4h.map(c => c.close);
        const ema20_4h = (0, indicators_1.calcEMA)(closes4h, 20);
        const ema50_4h = (0, indicators_1.calcEMA)(closes4h, 50);
        const idx4h = closes4h.length - 1;
        const c4 = closes4h[idx4h];
        const e20_4 = ema20_4h[idx4h];
        const e50_4 = ema50_4h[idx4h];
        if (e20_4 != null && e50_4 != null) {
            if (c4 > e20_4 && e20_4 > e50_4) {
                btc4hTrend = 'UP';
            }
            else if (c4 < e20_4 && e20_4 < e50_4) {
                btc4hTrend = 'DOWN';
            }
        }
    }
    if (!btc1h || btc1h.length < 210) {
        return { regime: 'RANGING', btc4hTrend, scoreBonus: 0, reason: 'Insufficient BTC data' };
    }
    const closes = btc1h.map(c => c.close);
    const highs = btc1h.map(c => c.high);
    const lows = btc1h.map(c => c.low);
    const ema20 = (0, indicators_1.calcEMA)(closes, 20);
    const ema50 = (0, indicators_1.calcEMA)(closes, 50);
    const ema200 = (0, indicators_1.calcEMA)(closes, 200);
    const atr14 = (0, indicators_1.calcATR)(highs, lows, closes, 14);
    const rsi14 = (0, indicators_1.calcRSI)(closes, 14);
    const idx = closes.length - 1;
    const close = closes[idx];
    const e20 = ema20[idx];
    const e50 = ema50[idx];
    const e200 = ema200[idx];
    const atr = atr14[idx];
    const btcRsi = rsi14[idx] ?? undefined;
    if ([e20, e50, e200, atr].some(v => v == null)) {
        return { regime: 'RANGING', btc4hTrend, scoreBonus: 0, reason: 'EMA not ready' };
    }
    // ─── CRASH DETECTION (Tightened: -1.8% over 3h) ──────────────
    // Previous threshold was -3% over 4h — too late. By the time BTC is 
    // down 3% in 4h, alts are already down 5-8%. We detect earlier.
    const close3h = closes[idx - 3] ?? close;
    const drop3h = ((close - close3h) / close3h) * 100;
    const close10h = closes[idx - 10] ?? close;
    const drop10h = ((close - close10h) / close10h) * 100;
    if (drop3h < -1.8 || drop10h < -4.5) {
        return {
            regime: 'CRASH',
            btc4hTrend, btcRsi,
            scoreBonus: -10,
            reason: `BTC crash detected: ${drop3h.toFixed(2)}% (3h) / ${drop10h.toFixed(2)}% (10h)`
        };
    }
    // ─── CHOP DETECTION (NEW) ──────────────────────────────────────
    // Conditions: EMAs 20/50 are compressed (within 0.3% of each other)
    // AND recent 8h range is small (<1.2% ATR-ratio). No clear direction.
    const emaDelta = Math.abs(e20 - e50) / e50;
    const range8h = Math.max(...highs.slice(idx - 8)) - Math.min(...lows.slice(idx - 8));
    const atrRatio = range8h / (atr * 8);
    if (emaDelta < 0.003 && atrRatio < 0.65) {
        return {
            regime: 'CHOP',
            btc4hTrend, btcRsi,
            scoreBonus: -5,
            reason: `BTC CHOP: EMA20/50 compressed ${(emaDelta * 100).toFixed(2)}%, range ratio ${atrRatio.toFixed(2)}`
        };
    }
    // ─── TRENDING UP ──────────────────────────────────
    const emaAlignedUp = e20 > e50 && e50 > e200;
    const aboveEma200 = close > e200;
    const e20SlopeUp = e20 > (ema20[idx - 5] ?? e20);
    const e50SlopeUp = e50 > (ema50[idx - 5] ?? e50);
    if (emaAlignedUp && aboveEma200 && e20SlopeUp && e50SlopeUp) {
        const recentGain = ((close - close10h) / close10h) * 100;
        const isStrong = recentGain > 1.5;
        return {
            regime: 'TRENDING_UP',
            btc4hTrend, btcRsi,
            scoreBonus: isStrong ? 3 : 1,
            reason: `BTC uptrend: EMA aligned, +${recentGain.toFixed(1)}% (10h)`
        };
    }
    // ─── TRENDING DOWN ────────────────────────────────
    const emaAlignedDown = e20 < e50 && e50 < e200;
    const belowEma200 = close < e200;
    const e20SlopeDown = e20 < (ema20[idx - 5] ?? e20);
    if (emaAlignedDown && belowEma200 && e20SlopeDown) {
        return {
            regime: 'TRENDING_DOWN',
            btc4hTrend, btcRsi,
            scoreBonus: -3,
            reason: `BTC downtrend: EMA aligned bearish`
        };
    }
    // ─── RANGING ──────────────────────────────────────
    const distFromE200 = Math.abs(close - e200) / e200 * 100;
    if (distFromE200 < 2.0) {
        return {
            regime: 'RANGING',
            btc4hTrend, btcRsi,
            scoreBonus: -1,
            reason: `BTC ranging: ${distFromE200.toFixed(1)}% from EMA200`
        };
    }
    return {
        regime: aboveEma200 ? 'TRENDING_UP' : 'TRENDING_DOWN',
        btc4hTrend, btcRsi,
        scoreBonus: 0,
        reason: `BTC ambiguous: above EMA200=${aboveEma200}`
    };
}
/**
 * Market-Correlation Limiter (User Request 3)
 * Returns how many new positions are safe to open given current BTC regime.
 * During CHOP/CRASH: heavily restrict new entries.
 * During TRENDING_DOWN: block new LONG positions.
 */
function getCorrelationPositionLimit(regime, btc4hTrend, currentOpenCount) {
    if (regime === 'CRASH') {
        return { allowNew: false, maxNewPositions: 0, reason: 'BTC CRASH — all new entries blocked' };
    }
    if (regime === 'CHOP') {
        return {
            allowNew: currentOpenCount < 2,
            maxNewPositions: 2,
            reason: 'BTC CHOP — max 2 concurrent positions allowed'
        };
    }
    if (regime === 'TRENDING_DOWN' && btc4hTrend === 'DOWN') {
        return {
            allowNew: currentOpenCount < 3,
            maxNewPositions: 3,
            reason: 'BTC downtrend — limit to 3 positions, LONGS heavily filtered'
        };
    }
    // Normal / up conditions
    return { allowNew: true, maxNewPositions: 99, reason: 'Normal conditions' };
}
/**
 * Validate order flow confluence for a signal direction.
 * If snapshot is unavailable, require higher score to compensate.
 */
function validateOrderFlow(snapshot, side) {
    // If no snapshot, don't pass outright — flag it so caller can raise score threshold
    if (!snapshot) {
        return { ok: true, score: 0, reasons: [], missingFlow: true };
    }
    const reasons = [];
    let score = 0;
    let blockers = 0;
    if (side === 'LONG') {
        if (snapshot.cvd > 0) {
            score += 2;
            reasons.push(`CVD positive (+${(snapshot.cvd / 1e6).toFixed(1)}M) — buy pressure`);
        }
        else if (snapshot.cvd < -500000) {
            blockers++;
            reasons.push(`CVD deeply negative (${(snapshot.cvd / 1e6).toFixed(1)}M) — sell pressure`);
        }
        if (snapshot.imbalanceRatio > 1.3) {
            score += 2;
            reasons.push(`Order book imbalance ${snapshot.imbalanceRatio.toFixed(2)}× — bids strong`);
        }
        else if (snapshot.imbalanceRatio < 0.7) {
            blockers++;
            reasons.push(`Order book imbalance ${snapshot.imbalanceRatio.toFixed(2)}× — asks dominate`);
        }
        if (snapshot.largeBlocksAsk > snapshot.largeBlocksBid * 2) {
            blockers++;
            reasons.push(`Heavy institutional sell walls`);
        }
        else if (snapshot.largeBlocksBid > snapshot.largeBlocksAsk * 1.5) {
            score += 1;
            reasons.push('Institutional bid support present');
        }
        if (snapshot.lastTradeAggressor === 'BUY') {
            score += 1;
            reasons.push('Last aggressive trade was a BUY');
        }
    }
    else {
        if (snapshot.cvd < 0) {
            score += 2;
            reasons.push(`CVD negative (${(snapshot.cvd / 1e6).toFixed(1)}M) — sell pressure`);
        }
        else if (snapshot.cvd > 500000) {
            blockers++;
        }
        if (snapshot.imbalanceRatio < 0.7) {
            score += 2;
            reasons.push(`Order book imbalance ${snapshot.imbalanceRatio.toFixed(2)}× — asks dominate`);
        }
        else if (snapshot.imbalanceRatio > 1.3) {
            blockers++;
        }
        if (snapshot.largeBlocksBid > snapshot.largeBlocksAsk * 2) {
            blockers++;
            reasons.push('Heavy institutional bid support — dangerous to short');
        }
        if (snapshot.lastTradeAggressor === 'SELL') {
            score += 1;
        }
    }
    return { ok: blockers < 2, score, reasons, missingFlow: false };
}
