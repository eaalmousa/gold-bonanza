// ============================================================
// Execution Adapter — LIVE ONLY
//
// Single-entry routing layer between deploySignal and Binance live futures.
// No paper, demo, or test paths exist.
//
// CONTRACT:
//  - Receives a canonical ExecutionPayload
//  - Runs all safety guards before any exchange call
//  - Returns ExecutionResult (always — never throws to caller)
//  - Logs full payload BEFORE submission for audit trail
// ============================================================

import type { ExecutionMode, ExecutionPayload, ExecutionResult } from '../types/trading';
import { apiRequest } from './api';

// ─── Guards ──────────────────────────────────────────────────────────────────

function validatePayload(p: ExecutionPayload): string | null {
  if (!p.symbol)             return 'Missing symbol';
  if (!p.side)               return 'Missing side';
  if (!p.entryPrice || p.entryPrice <= 0) return 'Blocked: invalid entry price';
  if (!p.stopLoss   || p.stopLoss   <= 0) return 'Blocked: invalid stop loss';
  if (!p.takeProfit || p.takeProfit <= 0) return 'Blocked: invalid take profit';
  if (!p.qty        || p.qty        <= 0) return 'Blocked: computed quantity is zero — check balance and risk config';
  if (!p.sizeUSDT   || p.sizeUSDT   <= 0) return 'Blocked: risk capital is zero — check balance and risk config';

  // Strict direction geometry
  if (p.side === 'LONG'  && p.stopLoss  >= p.entryPrice) return 'LONG: stopLoss must be below entryPrice';
  if (p.side === 'SHORT' && p.stopLoss  <= p.entryPrice) return 'SHORT: stopLoss must be above entryPrice';
  if (p.side === 'LONG'  && p.takeProfit <= p.entryPrice) return 'LONG: takeProfit must be above entryPrice';
  if (p.side === 'SHORT' && p.takeProfit >= p.entryPrice) return 'SHORT: takeProfit must be below entryPrice';

  return null;
}

function hasCredentials(): boolean {
  const token = localStorage.getItem('gb_token');
  return Boolean(token && token.length > 10);
}

// ─── Live Execution ────────────────────────────────────────────────────────────

async function executeLive(payload: ExecutionPayload): Promise<ExecutionResult> {
  const base: ExecutionResult = {
    signalId: payload.signalId,
    symbol:   payload.symbol,
    mode:     'LIVE',
    status:   'SUBMITTING',
    ts:       Date.now(),
    payload
  };

  if (!hasCredentials()) {
    console.error('[Execution:LIVE] BLOCKED — no API credentials');
    return { ...base, status: 'FAILED', error: 'No API credentials present' };
  }

  // ── Full audit log BEFORE any submission ─────────────────────────────────
  console.group('[Execution:LIVE] Submission payload ▼');
  console.table({
    symbol:      payload.symbol,
    side:        payload.side,
    entryPrice:  payload.entryPrice,
    stopLoss:    payload.stopLoss,
    takeProfit:  payload.takeProfit,
    takeProfit2: payload.takeProfit2 ?? 'N/A',
    qty:         payload.qty,
    sizeUSDT:    payload.sizeUSDT,
    leverage:    payload.leverage,
    score:       payload.score   ?? 'N/A',
    entryType:   payload.entryType  ?? 'N/A',
    entryTiming: payload.entryTiming ?? 'N/A',
    mode:        'LIVE',
  });
  console.groupEnd();

  try {
    const body = {
      symbol:      payload.symbol,
      side:        payload.side,
      entryPrice:  payload.entryPrice,
      stopLoss:    payload.stopLoss,
      takeProfit:  payload.takeProfit,
      takeProfit2: payload.takeProfit2,
      qty:         payload.qty,
      sizeUSDT:    payload.sizeUSDT,
      leverage:    payload.leverage,
      mode:        'LIVE',   // hardwired — server uses this to route to fapi.binance.com
      score:       payload.score,
      entryType:   payload.entryType,
      entryTiming: payload.entryTiming,
      reasons:     payload.reasons,
    };

    const response = await apiRequest('/trade/open', {
      method: 'POST',
      body: JSON.stringify(body)
    });

    const orderId = response?.orderId ?? response?.clientOrderId ?? response?.id;
    console.log(`[Execution:LIVE] ✅ Order submitted. orderId=${orderId}`);

    return {
      ...base,
      status:           'SUBMITTED',
      exchangeOrderId:  orderId,
      exchangeResponse: response
    };
  } catch (err: any) {
    const msg = err?.message ?? 'Unknown exchange error';
    console.error(`[Execution:LIVE] ❌ Submission failed: ${msg}`);
    return { ...base, status: 'FAILED', error: msg };
  }
}

// ─── Main Adapter Entry Point ─────────────────────────────────────────────────

export async function executeOrder(
  _mode: ExecutionMode,  // always LIVE — kept for compatibility, ignored
  payload: ExecutionPayload
): Promise<ExecutionResult> {
  const validationError = validatePayload(payload);
  if (validationError) {
    console.error('[Execution] BLOCKED by payload validation:', validationError, payload);
    return {
      signalId: payload.signalId,
      symbol:   payload.symbol,
      mode:     'LIVE',
      status:   'FAILED',
      ts:       Date.now(),
      error:    validationError,
      payload
    };
  }

  return await executeLive(payload);
}

/** Normalise any signal-shaped object into a canonical ExecutionPayload. */
export function toExecutionPayload(sig: any, symbol: string): ExecutionPayload {
  return {
    signalId:    sig.id || `sig_${Date.now()}`,
    symbol:      (symbol || sig.symbol || '').toUpperCase(),
    side:        sig.side as 'LONG' | 'SHORT',
    entryPrice:  sig.entryPrice,
    stopLoss:    sig.stopLoss ?? sig.sl,
    takeProfit:  sig.takeProfit ?? sig.t1,
    takeProfit2: sig.takeProfit2 ?? sig.t2,
    qty:         sig.qty,
    sizeUSDT:    sig.sizeUSDT,
    leverage:    sig.leverage ?? 10,
    score:       sig.score,
    entryType:   sig.entryType,
    entryTiming: sig.entryTiming,
    reasons:     sig.reasons,
    kind:        sig.kind,
  };
}
