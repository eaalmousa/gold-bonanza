// ============================================
// Exit Strategy Engine v2
// ATR-based trailing, no state mutation,
// time-based breakeven exit.
// ============================================

import type { ActiveTrade, ExitSignal } from '../types/trading';

/**
 * Compute exit advisory for a trade.
 * IMPORTANT: This is a PURE function — it does NOT mutate the trade object.
 * Returns both the ExitSignal and an updated dynamicSL value.
 */
export function computeExitSignal(
  tr: ActiveTrade,
  cur: number,
  atr15?: number // ATR-based trailing instead of fixed %
): ExitSignal & { newDynamicSL?: number } {
  const side = (tr.side || tr.type || 'LONG').toUpperCase();
  const dir = side === 'SHORT' ? -1 : 1;

  const entry = tr.entryPrice || 0;
  const price = cur || 0;
  if (!entry || !price) return { label: 'HOLD', detail: 'Waiting for price', trail: null };

  const profitPct = ((price - entry) / entry) * 100 * dir;

  // ─── ATR-BASED TRAILING STOP ────────────────────
  // Use 1.5× ATR as trailing distance (instead of fixed 0.35%)
  // Fallback to 0.8% if no ATR data available
  const trailDistance = atr15 ? atr15 * 1.5 : price * 0.008;
  const trailActivatePct = 0.80; // Activate at +0.80% profit

  let dynamicSL = (typeof tr.dynamicSL === 'number' && isFinite(tr.dynamicSL)) ? tr.dynamicSL : undefined;

  if (profitPct >= trailActivatePct) {
    const newTrail = dir > 0 ? price - trailDistance : price + trailDistance;
    if (dynamicSL === undefined) {
      dynamicSL = newTrail;
    } else {
      // Only ratchet stop in favorable direction
      dynamicSL = dir > 0 ? Math.max(dynamicSL, newTrail) : Math.min(dynamicSL, newTrail);
    }
  }

  // Merge with static stop if present
  if (typeof tr.stopPrice === 'number' && isFinite(tr.stopPrice) && tr.stopPrice > 0) {
    if (dynamicSL === undefined) {
      dynamicSL = tr.stopPrice;
    } else {
      dynamicSL = dir > 0 ? Math.max(dynamicSL, tr.stopPrice) : Math.min(dynamicSL, tr.stopPrice);
    }
  }

  // ─── CHECK STOP HIT ────────────────────────────
  if (dynamicSL !== undefined) {
    const hit = dir > 0 ? (price <= dynamicSL) : (price >= dynamicSL);
    if (hit) {
      return { label: 'EXIT', detail: 'Trailing stop hit', trail: dynamicSL, newDynamicSL: dynamicSL };
    }
  }

  // ─── HARD LOSS CUTOFF ──────────────────────────
  if (profitPct <= -1.50) {
    return { label: 'EXIT', detail: 'Loss cutoff (-1.50%)', trail: dynamicSL ?? null, newDynamicSL: dynamicSL };
  }

  // ─── TAKE PARTIAL AT 1.5x RISK DISTANCE ───────
  // Instead of arbitrary 2%, take partial at 1.5× the risk distance
  const riskDistance = Math.abs(entry - (tr.sl || tr.stopPrice || entry * 0.985));
  const partialTarget = entry + dir * riskDistance * 1.5;
  const reachedPartial = dir > 0 ? price >= partialTarget : price <= partialTarget;

  if (reachedPartial && profitPct >= 1.2) {
    return {
      label: 'TAKE PARTIAL',
      detail: `Lock profit at 1.5R (+${profitPct.toFixed(2)}%)`,
      trail: dynamicSL ?? null,
      newDynamicSL: dynamicSL
    };
  }

  // ─── TIGHTEN STOP IF APPROACHING TARGET ────────
  if (profitPct >= 1.5 && profitPct < 2.5) {
    return {
      label: 'TIGHTEN STOP',
      detail: `In profit zone (+${profitPct.toFixed(2)}%) — tighten stop`,
      trail: dynamicSL ?? null,
      newDynamicSL: dynamicSL
    };
  }

  // ─── TIME-BASED BREAKEVEN ──────────────────────
  // If trade hasn't moved +0.5% in 6 candles (90 minutes), suggest breakeven exit
  const ageMs = Date.now() - (tr.deployedAt || Date.now());
  const ageMinutes = ageMs / 60000;
  if (ageMinutes > 90 && profitPct < 0.5 && profitPct > -0.5) {
    return {
      label: 'TIGHTEN STOP',
      detail: `Stale trade (${Math.round(ageMinutes)}min, only +${profitPct.toFixed(2)}%) — move to breakeven`,
      trail: dynamicSL ?? null,
      newDynamicSL: dynamicSL
    };
  }

  return {
    label: 'HOLD',
    detail: profitPct >= trailActivatePct ? 'Trailing active' : 'Monitoring',
    trail: dynamicSL ?? null,
    newDynamicSL: dynamicSL
  };
}
