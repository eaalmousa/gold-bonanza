// ============================================
// Market Regime Filter — v3
// - Stricter crash detection (1.8% / 3h instead of 3% / 4h)
// - New CHOP regime blocks entries in compressed sideways conditions
// - BTC correlation limiter for position concentration
// ============================================

import type { Kline, MarketRegime, OrderFlowSnapshot } from '../types/trading';
import { calcEMA, calcATR, calcRSI } from './indicators';

/**
 * Classify the current market regime based on BTC 1H + 4H data.
 * Returns regime + score-modifier for signals.
 */
export function detectMarketRegime(btc1h: Kline[], btc4h?: Kline[]): {
  regime: MarketRegime;
  btc4hTrend: 'UP' | 'DOWN' | 'RANGING';
  scoreBonus: number;
  reason: string;
  btcRsi?: number;
} {
  let btc4hTrend: 'UP' | 'DOWN' | 'RANGING' = 'RANGING';

  // ─── 4H MACRO TREND ANALYSIS ────────────────────
  if (btc4h && btc4h.length >= 50) {
    const closes4h = btc4h.map(c => c.close);
    const ema20_4h = calcEMA(closes4h, 20);
    const ema50_4h = calcEMA(closes4h, 50);
    const idx4h = closes4h.length - 1;
    const c4 = closes4h[idx4h];
    const e20_4 = ema20_4h[idx4h];
    const e50_4 = ema50_4h[idx4h];

    if (e20_4 != null && e50_4 != null) {
      if (c4 > e20_4 && e20_4 > e50_4) {
        btc4hTrend = 'UP';
      } else if (c4 < e20_4 && e20_4 < e50_4) {
        btc4hTrend = 'DOWN';
      }
    }
  }

  if (!btc1h || btc1h.length < 210) {
    return { regime: 'RANGING', btc4hTrend, scoreBonus: 0, reason: 'Insufficient BTC data' };
  }

  const closes = btc1h.map(c => c.close);
  const highs  = btc1h.map(c => c.high);
  const lows   = btc1h.map(c => c.low);

  const ema20  = calcEMA(closes, 20);
  const ema50  = calcEMA(closes, 50);
  const ema200 = calcEMA(closes, 200);
  const atr14  = calcATR(highs, lows, closes, 14);
  const rsi14  = calcRSI(closes, 14);

  const idx   = closes.length - 1;
  const close = closes[idx];
  const e20   = ema20[idx];
  const e50   = ema50[idx];
  const e200  = ema200[idx];
  const atr   = atr14[idx];
  const btcRsi = rsi14[idx] ?? undefined;

  if ([e20, e50, e200, atr].some(v => v == null)) {
    return { regime: 'RANGING', btc4hTrend, scoreBonus: 0, reason: 'EMA not ready' };
  }

  // ─── CRASH DETECTION (Tightened for earlier detection) ─────────────────
  // A rapid -1.5% in 3h or -3.5% in 10h is enough to suspend longs and enter CRASH mode.
  const close3h  = closes[idx - 3] ?? close;
  const drop3h   = ((close - close3h) / close3h) * 100;
  const close10h = closes[idx - 10] ?? close;
  const drop10h  = ((close - close10h) / close10h) * 100;

  if (drop3h < -1.5 || drop10h < -3.5) {
    return {
      regime: 'CRASH',
      btc4hTrend, btcRsi,
      scoreBonus: -10,
      reason: `BTC crash detected: ${drop3h.toFixed(2)}% (3h) / ${drop10h.toFixed(2)}% (10h)`
    };
  }

  // ─── CHOP DETECTION (Calibrated) ──────────────────────────────────────────
  // CHOP = genuinely dead market. Requires BOTH conditions:
  //   1. EMA separation < 0.3% (EMAs nearly touching — no directional momentum)
  //   2. 8h range < 0.6x expected ATR range (price compressed well below normal)
  // Previous thresholds (0.8% / 1.0) were too aggressive and triggered in ~70%
  // of normal crypto conditions, effectively disabling the scanner permanently.
  const emaDelta = Math.abs(e20! - e50!) / e50!;
  const range8h  = Math.max(...highs.slice(idx - 8)) - Math.min(...lows.slice(idx - 8));
  const atrRatio = range8h / (atr! * 8);

  // Both conditions must be true to declare CHOP (AND instead of OR)
  if (emaDelta < 0.003 && atrRatio < 0.6) {
    return {
      regime: 'CHOP',
      btc4hTrend, btcRsi,
      scoreBonus: -5,
      reason: `BTC CHOP: EMA20/50 spread=${(emaDelta * 100).toFixed(2)}%, 8h range ratio=${atrRatio.toFixed(2)}`
    };
  }

  // ─── TRENDING UP (Requires Real Displacement) ───────────────────
  const emaAlignedUp = e20! > e50! && e50! > e200!;
  const aboveEma200  = close > e200!;
  // Must rise at least 0.15% over 5 hours, no flat drifting allowed
  const e20SlopeUp   = ((e20! - (ema20[idx - 5] ?? e20!)) / e20!) * 100 > 0.15;
  const e50SlopeUp   = ((e50! - (ema50[idx - 5] ?? e50!)) / e50!) * 100 > 0.10;

  if (emaAlignedUp && aboveEma200 && e20SlopeUp && e50SlopeUp) {
    const recentGain = ((close - close10h) / close10h) * 100;
    const isStrong   = recentGain > 2.0; // tighter definition of strong
    return {
      regime: 'TRENDING_UP',
      btc4hTrend, btcRsi,
      scoreBonus: isStrong ? 3 : 1,
      reason: `BTC active uptrend: EMA aligned, steep slope, +${recentGain.toFixed(1)}% (10h)`
    };
  }

  // ─── TRENDING DOWN ────────────────────────────────
  const emaAlignedDown = e20! < e50! && e50! < e200!;
  const belowEma200    = close < e200!;
  // Slope must be actively going down, not drifting
  const e20SlopeDown   = ((e20! - (ema20[idx - 5] ?? e20!)) / e20!) * 100 < -0.15;

  if (emaAlignedDown && belowEma200 && e20SlopeDown) {
    return {
      regime: 'TRENDING_DOWN',
      btc4hTrend, btcRsi,
      scoreBonus: -3,
      reason: `BTC active downtrend: EMA aligned bearish, steep slope`
    };
  }

  // ─── RANGING ──────────────────────────────────────
  const distFromE200 = Math.abs(close - e200!) / e200! * 100;
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
export function getCorrelationPositionLimit(
  regime: MarketRegime,
  btc4hTrend: 'UP' | 'DOWN' | 'RANGING',
  currentOpenCount: number
): {
  allowNew: boolean;
  maxNewPositions: number;
  reason: string;
} {
  if (regime === 'CRASH') {
    return { allowNew: false, maxNewPositions: 0, reason: 'BTC CRASH — all entries blocked' };
  }
  if (regime === 'CHOP') {
    // CHOP = limited entries. Range environments produce more false entries,
    // but zero entries permanently disables the scanner which is worse.
    return {
      allowNew: true,
      maxNewPositions: 2,
      reason: 'BTC CHOP — limited to 2 new entries in ranging/compressed market'
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
export function validateOrderFlow(
  snapshot: OrderFlowSnapshot | undefined,
  side: 'LONG' | 'SHORT'
): {
  ok: boolean;
  score: number;
  reasons: string[];
  missingFlow: boolean;
} {
  // If no snapshot, don't pass outright — flag it so caller can raise score threshold
  if (!snapshot) {
    return { ok: true, score: 0, reasons: [], missingFlow: true };
  }

  const reasons: string[] = [];
  let score    = 0;
  let blockers = 0;

  if (side === 'LONG') {
    if (snapshot.cvd > 0) {
      score += 2;
      reasons.push(`CVD positive (+${(snapshot.cvd / 1e6).toFixed(1)}M) — buy pressure`);
    } else if (snapshot.cvd < -500000) {
      blockers++;
      reasons.push(`CVD deeply negative (${(snapshot.cvd / 1e6).toFixed(1)}M) — sell pressure`);
    }

    if (snapshot.imbalanceRatio > 1.3) {
      score += 2;
      reasons.push(`Order book imbalance ${snapshot.imbalanceRatio.toFixed(2)}× — bids strong`);
    } else if (snapshot.imbalanceRatio < 0.7) {
      blockers++;
      reasons.push(`Order book imbalance ${snapshot.imbalanceRatio.toFixed(2)}× — asks dominate`);
    }

    if (snapshot.largeBlocksAsk > snapshot.largeBlocksBid * 2) {
      blockers++;
      reasons.push(`Heavy institutional sell walls`);
    } else if (snapshot.largeBlocksBid > snapshot.largeBlocksAsk * 1.5) {
      score += 1;
      reasons.push('Institutional bid support present');
    }

    if (snapshot.lastTradeAggressor === 'BUY') {
      score += 1;
      reasons.push('Last aggressive trade was a BUY');
    }
  } else {
    if (snapshot.cvd < 0) {
      score += 2;
      reasons.push(`CVD negative (${(snapshot.cvd / 1e6).toFixed(1)}M) — sell pressure`);
    } else if (snapshot.cvd > 500000) {
      blockers++;
    }

    if (snapshot.imbalanceRatio < 0.7) {
      score += 2;
      reasons.push(`Order book imbalance ${snapshot.imbalanceRatio.toFixed(2)}× — asks dominate`);
    } else if (snapshot.imbalanceRatio > 1.3) {
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
