// ============================================
// Market Regime Filter — P3
// Classifies the broader market context using
// BTC/ETH as the reference anchor.
// ============================================

import type { Kline, MarketRegime, OrderFlowSnapshot } from '../types/trading';
import { calcEMA, calcATR } from './indicators';

/**
 * Classify the current market regime based on BTC 1H data and optionally 4H macro context.
 * Returns the regime + a score-modifier for signals.
 */
export function detectMarketRegime(btc1h: Kline[], btc4h?: Kline[]): {
  regime: MarketRegime;
  btc4hTrend: 'UP' | 'DOWN' | 'RANGING';
  scoreBonus: number;  // Applied to signal scores: positive = favorable, negative = hostile
  reason: string;
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
  const highs = btc1h.map(c => c.high);
  const lows = btc1h.map(c => c.low);
  
  const ema20 = calcEMA(closes, 20);
  const ema50 = calcEMA(closes, 50);
  const ema200 = calcEMA(closes, 200);
  const atr14 = calcATR(highs, lows, closes, 14);

  const idx = closes.length - 1;
  const close = closes[idx];
  const e20 = ema20[idx];
  const e50 = ema50[idx];
  const e200 = ema200[idx];
  const atr = atr14[idx];

  if ([e20, e50, e200, atr].some(v => v == null)) {
    return { regime: 'RANGING', btc4hTrend, scoreBonus: 0, reason: 'EMA not ready' };
  }

  // ─── CRASH DETECTION ──────────────────────────────
  // Check for sharp BTC drop in last 4 candles (4H equivalent at 1H granularity)
  const recentClose4 = closes[idx - 4] || close;
  const drop4h = ((close - recentClose4) / recentClose4) * 100;
  
  // Also check 12h (12 candles) for extended selloff  
  const recentClose12 = closes[idx - 12] || close;
  const drop12h = ((close - recentClose12) / recentClose12) * 100;

  if (drop4h < -3.0 || drop12h < -5.0) {
    return { regime: 'CRASH', btc4hTrend, scoreBonus: -10, reason: `BTC crash: ${drop4h.toFixed(1)}% (4h) / ${drop12h.toFixed(1)}% (12h)` };
  }

  // ─── TRENDING UP ──────────────────────────────────
  const emaAlignedUp = e20! > e50! && e50! > e200!;
  const aboveEma200 = close > e200!;
  const e20SlopeUp = e20! > ema20[idx - 5]!;
  const e50SlopeUp = e50! > ema50[idx - 5]!;

  if (emaAlignedUp && aboveEma200 && e20SlopeUp && e50SlopeUp) {
    // Strong uptrend — check momentum
    const recentGain = ((close - recentClose12) / recentClose12) * 100;
    const isStrong = recentGain > 1.5;
    return { 
      regime: 'TRENDING_UP', 
      btc4hTrend,
      scoreBonus: isStrong ? 3 : 1, 
      reason: `BTC uptrend: EMA aligned, +${recentGain.toFixed(1)}% (12h)` 
    };
  }

  // ─── TRENDING DOWN ────────────────────────────────
  const emaAlignedDown = e20! < e50! && e50! < e200!;
  const belowEma200 = close < e200!;
  const e20SlopeDown = e20! < ema20[idx - 5]!;

  if (emaAlignedDown && belowEma200 && e20SlopeDown) {
    return { 
      regime: 'TRENDING_DOWN', 
      btc4hTrend,
      scoreBonus: -3, 
      reason: `BTC downtrend: EMA aligned bearish` 
    };
  }

  // ─── RANGING ──────────────────────────────────────
  // Price oscillating around EMAs, no clear direction
  const distFromE200 = Math.abs(close - e200!) / e200! * 100;
  if (distFromE200 < 2.0) {
    return { 
      regime: 'RANGING', 
      btc4hTrend,
      scoreBonus: -1, 
      reason: `BTC ranging: ${distFromE200.toFixed(1)}% from EMA200` 
    };
  }

  return { 
    regime: aboveEma200 ? 'TRENDING_UP' : 'TRENDING_DOWN', 
    btc4hTrend,
    scoreBonus: 0, 
    reason: `BTC ambiguous: above EMA200=${aboveEma200}` 
  };
}

/**
 * Validate order flow confluence for a signal direction.
 * Returns true if order flow supports the intended trade direction.
 */
export function validateOrderFlow(
  snapshot: OrderFlowSnapshot | undefined,
  side: 'LONG' | 'SHORT'
): {
  ok: boolean;
  score: number;
  reasons: string[];
} {
  if (!snapshot) {
    return { ok: true, score: 0, reasons: ['Order flow data unavailable — bypassed'] };
  }

  const reasons: string[] = [];
  let score = 0;
  let blockers = 0;

  if (side === 'LONG') {
    // ─── CVD must be positive or neutral ────────────
    if (snapshot.cvd > 0) {
      score += 2;
      reasons.push(`CVD positive (+${(snapshot.cvd / 1e6).toFixed(1)}M) — buy pressure`);
    } else if (snapshot.cvd < -500000) {
      blockers++;
      reasons.push(`CVD deeply negative (${(snapshot.cvd / 1e6).toFixed(1)}M) — sell pressure`);
    }

    // ─── Bid/Ask imbalance favoring buys ────────────
    if (snapshot.imbalanceRatio > 1.3) {
      score += 2;
      reasons.push(`Order book imbalance ${snapshot.imbalanceRatio.toFixed(2)}× — bids strong`);
    } else if (snapshot.imbalanceRatio < 0.7) {
      blockers++;
      reasons.push(`Order book imbalance ${snapshot.imbalanceRatio.toFixed(2)}× — asks dominate`);
    }

    // ─── No large institutional sell walls ──────────
    if (snapshot.largeBlocksAsk > snapshot.largeBlocksBid * 2) {
      blockers++;
      reasons.push(`Heavy institutional sell walls (${snapshot.largeBlocksAsk} vs ${snapshot.largeBlocksBid} bid blocks)`);
    } else if (snapshot.largeBlocksBid > snapshot.largeBlocksAsk * 1.5) {
      score += 1;
      reasons.push('Institutional bid support present');
    }

    // ─── Last trade aggressor ───────────────────────
    if (snapshot.lastTradeAggressor === 'BUY') {
      score += 1;
      reasons.push('Last aggressive trade was a BUY');
    }
  } else {
    // SHORT flow validation (mirror logic)
    if (snapshot.cvd < 0) {
      score += 2;
      reasons.push(`CVD negative (${(snapshot.cvd / 1e6).toFixed(1)}M) — sell pressure`);
    } else if (snapshot.cvd > 500000) {
      blockers++;
      reasons.push(`CVD deeply positive — buy pressure`);
    }

    if (snapshot.imbalanceRatio < 0.7) {
      score += 2;
      reasons.push(`Order book imbalance ${snapshot.imbalanceRatio.toFixed(2)}× — asks dominate`);
    } else if (snapshot.imbalanceRatio > 1.3) {
      blockers++;
      reasons.push(`Order book imbalance — bids too strong for short`);
    }

    if (snapshot.largeBlocksBid > snapshot.largeBlocksAsk * 2) {
      blockers++;
      reasons.push('Heavy institutional bid support — dangerous to short');
    }

    if (snapshot.lastTradeAggressor === 'SELL') {
      score += 1;
    }
  }

  return {
    ok: blockers < 2,  // Allow signal if at most 1 blocker (not all blockers together)
    score,
    reasons
  };
}
