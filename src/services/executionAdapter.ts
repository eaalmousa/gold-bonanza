// ============================================================
// Execution Adapter v1
//
// Single-entry routing layer between deploySignal and any
// execution backend (PAPER | DEMO | LIVE).
//
// CONTRACT:
//  - Receives a canonical ExecutionPayload
//  - Runs all safety guards before any exchange call
//  - Returns ExecutionResult (always — never throws to caller)
//  - Real exchange paths log payload BEFORE submission
//  - Paper path is zero-side-effects on exchange state
// ============================================================

import type { ExecutionMode, ExecutionPayload, ExecutionResult } from '../types/trading';
import { apiRequest } from './api';

// ─── Guards ──────────────────────────────────────────────────────────────────

function validatePayload(p: ExecutionPayload): string | null {
  if (!p.symbol)             return 'Missing symbol';
  if (!p.side)               return 'Missing side';
  if (!p.entryPrice || p.entryPrice <= 0) return 'Invalid entryPrice';
  if (!p.stopLoss   || p.stopLoss   <= 0) return 'Invalid stopLoss';
  if (!p.takeProfit || p.takeProfit <= 0) return 'Invalid takeProfit';
  if (!p.qty        || p.qty        <= 0) return 'Invalid qty';
  if (!p.sizeUSDT   || p.sizeUSDT   <= 0) return 'Invalid sizeUSDT';

  // Direction sanity
  if (p.side === 'LONG'  && p.stopLoss >= p.entryPrice) return 'LONG: stopLoss must be below entryPrice';
  if (p.side === 'SHORT' && p.stopLoss <= p.entryPrice) return 'SHORT: stopLoss must be above entryPrice';
  if (p.side === 'LONG'  && p.takeProfit <= p.entryPrice) return 'LONG: takeProfit must be above entryPrice';
  if (p.side === 'SHORT' && p.takeProfit >= p.entryPrice) return 'SHORT: takeProfit must be below entryPrice';

  return null;
}

function hasCredentials(): boolean {
  // Credentials live server-side; we check that the JWT token exists
  // as a proxy (server will reject if keys are actually missing).
  const token = localStorage.getItem('gb_token');
  return Boolean(token && token.length > 10);
}

// ─── Paper Path ──────────────────────────────────────────────────────────────

function executePaper(payload: ExecutionPayload): ExecutionResult {
  console.log('[Execution:PAPER] Simulated fill — no exchange call', payload);
  return {
    signalId: payload.signalId,
    symbol:   payload.symbol,
    mode:     'PAPER',
    status:   'PAPER',
    ts:       Date.now(),
    payload
  };
}

// ─── Exchange Path (TEST + LIVE share same route, mode is server-gated) ──────

async function executeExchange(
  mode: 'DEMO' | 'LIVE',
  payload: ExecutionPayload
): Promise<ExecutionResult> {
  const base: ExecutionResult = {
    signalId: payload.signalId,
    symbol:   payload.symbol,
    mode,
    status:   'SUBMITTING',
    ts:       Date.now(),
    payload
  };

  // ── Hard guard: credentials ──────────────────────────────────────────────
  if (!hasCredentials()) {
    const msg = `[Execution:${mode}] BLOCKED — no API credentials`;
    console.error(msg);
    return { ...base, status: 'FAILED', error: 'No API credentials present' };
  }

  // ── Audit log BEFORE any submission ─────────────────────────────────────
  console.group(`[Execution:${mode}] Submission payload ▼`);
  console.table({
    symbol:     payload.symbol,
    side:       payload.side,
    entryPrice: payload.entryPrice,
    stopLoss:   payload.stopLoss,
    takeProfit: payload.takeProfit,
    takeProfit2:payload.takeProfit2 ?? 'N/A',
    qty:        payload.qty,
    sizeUSDT:   payload.sizeUSDT,
    leverage:   payload.leverage,
    score:      payload.score   ?? 'N/A',
    entryType:  payload.entryType ?? 'N/A',
    entryTiming:payload.entryTiming ?? 'N/A',
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
      mode,               // server uses this to decide testnet vs live BASE_URL
      // Provenance — stored server-side for audit log
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
    console.log(`[Execution:${mode}] ✅ Order submitted. orderId=${orderId}`);

    return {
      ...base,
      status:           'SUBMITTED',
      exchangeOrderId:  orderId,
      exchangeResponse: response
    };
  } catch (err: any) {
    const msg = err?.message ?? 'Unknown exchange error';
    console.error(`[Execution:${mode}] ❌ Submission failed: ${msg}`);
    return { ...base, status: 'FAILED', error: msg };
  }
}

// ─── Main Adapter Entry Point ─────────────────────────────────────────────────

export async function executeOrder(
  mode: ExecutionMode,
  payload: ExecutionPayload
): Promise<ExecutionResult> {
  // ── Payload guard (all modes) ────────────────────────────────────────────
  const validationError = validatePayload(payload);
  if (validationError) {
    console.error(`[Execution] BLOCKED by payload validation: ${validationError}`, payload);
    return {
      signalId: payload.signalId,
      symbol:   payload.symbol,
      mode,
      status:  'FAILED',
      ts:      Date.now(),
      error:   validationError,
      payload
    };
  }

  switch (mode) {
    case 'PAPER':  return executePaper(payload);
    case 'DEMO':   return await executeExchange('DEMO', payload);
    case 'LIVE':   return await executeExchange('LIVE', payload);
    default: {
      console.error(`[Execution] Unknown mode: ${mode}`);
      return { signalId: payload.signalId, symbol: payload.symbol, mode, status: 'FAILED', ts: Date.now(), error: `Unknown execution mode: ${mode}`, payload };
    }
  }
}

/** Normalise any signal-shaped object into a canonical ExecutionPayload. */
export function toExecutionPayload(sig: any, symbol: string): ExecutionPayload {
  return {
    signalId:    sig.id || `sig_${Date.now()}`, // Ensure a signalId is present
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
