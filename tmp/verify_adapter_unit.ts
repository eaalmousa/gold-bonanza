// ─────────────────────────────────────────────────────────────────────────────
// Standalone adapter test — does NOT import api.ts or store.
// Tests the pure logic of executeOrder() and toExecutionPayload().
// ─────────────────────────────────────────────────────────────────────────────
(global as any).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
(global as any).window       = global;

// Inline the adapter logic so we avoid the Vite import.meta.env problem
// (same logic as src/services/executionAdapter.ts — kept in sync manually)
import type { ExecutionMode, ExecutionPayload, ExecutionResult } from '../src/types/trading';

function validatePayload(p: ExecutionPayload): string | null {
  if (!p.symbol)              return 'Missing symbol';
  if (!p.side)                return 'Missing side';
  if (!p.entryPrice || p.entryPrice <= 0) return 'Invalid entryPrice';
  if (!p.stopLoss   || p.stopLoss   <= 0) return 'Invalid stopLoss';
  if (!p.takeProfit || p.takeProfit <= 0) return 'Invalid takeProfit';
  if (!p.qty        || p.qty        <= 0) return 'Invalid qty';
  if (!p.sizeUSDT   || p.sizeUSDT   <= 0) return 'Invalid sizeUSDT';
  if (p.side === 'LONG'  && p.stopLoss >= p.entryPrice) return 'LONG: stopLoss must be below entryPrice';
  if (p.side === 'SHORT' && p.stopLoss <= p.entryPrice) return 'SHORT: stopLoss must be above entryPrice';
  if (p.side === 'LONG'  && p.takeProfit <= p.entryPrice) return 'LONG: takeProfit must be above entryPrice';
  if (p.side === 'SHORT' && p.takeProfit >= p.entryPrice) return 'SHORT: takeProfit must be below entryPrice';
  return null;
}

function hasCredentials(): boolean {
  const token = (global as any).localStorage.getItem('gb_token');
  return Boolean(token && token.length > 10);
}

function executePaper(payload: ExecutionPayload): ExecutionResult {
  return { symbol: payload.symbol, mode: 'PAPER', status: 'PAPER', ts: Date.now(), payload };
}

async function executeExchange(mode: 'BINANCE_TEST' | 'BINANCE_LIVE', payload: ExecutionPayload): Promise<ExecutionResult> {
  const base: ExecutionResult = { symbol: payload.symbol, mode, status: 'SUBMITTING', ts: Date.now(), payload };
  if (!hasCredentials()) {
    return { ...base, status: 'FAILED', error: 'No API credentials present' };
  }
  // Would call real API here
  return { ...base, status: 'SUBMITTED' };
}

async function executeOrder(mode: ExecutionMode, payload: ExecutionPayload): Promise<ExecutionResult> {
  const err = validatePayload(payload);
  if (err) return { symbol: payload.symbol, mode, status: 'FAILED', ts: Date.now(), error: err, payload };
  switch (mode) {
    case 'PAPER':        return executePaper(payload);
    case 'BINANCE_TEST': return await executeExchange('BINANCE_TEST', payload);
    case 'BINANCE_LIVE': return await executeExchange('BINANCE_LIVE', payload);
  }
}

function toExecutionPayload(sig: any, symbol: string): ExecutionPayload {
  return {
    symbol: (symbol || sig.symbol || '').toUpperCase(), side: sig.side,
    entryPrice: sig.entryPrice, stopLoss: sig.stopLoss ?? sig.sl,
    takeProfit: sig.takeProfit ?? sig.t1, takeProfit2: sig.takeProfit2 ?? sig.t2,
    qty: sig.qty, sizeUSDT: sig.sizeUSDT, leverage: sig.leverage ?? 10,
    score: sig.score, entryType: sig.entryType, entryTiming: sig.entryTiming,
    reasons: sig.reasons, kind: sig.kind,
  };
}

function assert(cond: boolean, label: string) {
  if (cond) console.log(`  ✅ PASS: ${label}`);
  else       console.error(`  ❌ FAIL: ${label}`);
}

const good: ExecutionPayload = {
  symbol: 'BTCUSDT', side: 'SHORT',
  entryPrice: 60000, stopLoss: 63000, takeProfit: 54000, takeProfit2: 48000,
  qty: 0.5, sizeUSDT: 30000, leverage: 10,
  score: 88, entryType: 'BREAKDOWN', entryTiming: 'OPTIMAL', reasons: ['EMA flip'], kind: 'SNIPER'
};

// ─── B. Adapter Payload Validation Guards ─────────────────────────────────────
console.log('\n=== B. ADAPTER PAYLOAD VALIDATION ===');

let r = await executeOrder('PAPER', { ...good, symbol: '' });
assert(r.status === 'FAILED' && r.error === 'Missing symbol',                     'Missing symbol blocked');

r = await executeOrder('PAPER', { ...good, side: 'LONG', stopLoss: 65000 });
assert(r.status === 'FAILED' && r.error!.includes('stopLoss must be below'),      'LONG: SL above entry blocked');

r = await executeOrder('PAPER', { ...good, stopLoss: 55000 });
assert(r.status === 'FAILED' && r.error!.includes('stopLoss must be above'),      'SHORT: SL below entry blocked');

r = await executeOrder('PAPER', { ...good, side: 'LONG', stopLoss: 55000, takeProfit: 55000 });
assert(r.status === 'FAILED' && r.error!.includes('takeProfit must be above'),    'LONG: TP below entry blocked');

r = await executeOrder('PAPER', { ...good, takeProfit: 65000 });
assert(r.status === 'FAILED' && r.error!.includes('takeProfit must be below'),    'SHORT: TP above entry blocked');

r = await executeOrder('PAPER', { ...good, qty: 0 });
assert(r.status === 'FAILED' && r.error === 'Invalid qty',                        'Zero qty blocked');

r = await executeOrder('PAPER', { ...good, sizeUSDT: -1 });
assert(r.status === 'FAILED' && r.error === 'Invalid sizeUSDT',                   'Negative sizeUSDT blocked');

// Valid paper payload
r = await executeOrder('PAPER', good);
assert(r.status === 'PAPER',                                                      'Valid PAPER executes as PAPER');
assert(r.mode === 'PAPER',                                                         'Mode recorded correctly');
assert(r.payload.symbol === 'BTCUSDT',                                             'symbol preserved in result');
assert(r.payload.score === 88,                                                     'score preserved in result');
assert(r.payload.entryType === 'BREAKDOWN',                                        'entryType preserved');
assert(r.payload.reasons?.length === 1,                                            'reasons preserved');
console.log(`  📊 PAPER result: ${JSON.stringify({ status: r.status, mode: r.mode, symbol: r.payload.symbol })}`);

// ─── D. Exchange Path Isolation ───────────────────────────────────────────────
console.log('\n=== D. EXCHANGE PATH ISOLATION ===');

// No credentials → FAILED (localStorage returns null)
r = await executeOrder('BINANCE_TEST', good);
assert(r.status === 'FAILED',                                    'BINANCE_TEST without creds → FAILED');
assert(r.error === 'No API credentials present',                 'Correct credential error');
assert(r.mode === 'BINANCE_TEST',                                'Mode preserved in FAILED result');

r = await executeOrder('BINANCE_LIVE', good);
assert(r.status === 'FAILED',                                    'BINANCE_LIVE without creds → FAILED');
assert(r.mode === 'BINANCE_LIVE',                                'Mode preserved in LIVE FAILED result');

// ─── E. toExecutionPayload normalisation ──────────────────────────────────────
console.log('\n=== E. toExecutionPayload NORMALISATION ===');
const rawSig = {
  kind: 'SNIPER', side: 'LONG', entryPrice: 100, stopLoss: 90,
  takeProfit: 120, takeProfit2: 140, qty: 5, sizeUSDT: 500, leverage: 10,
  score: 81, entryType: 'BREAKOUT', entryTiming: 'LATE', reasons: ['A', 'B']
};
const ep = toExecutionPayload(rawSig, 'solusdt');  // lowercase → should uppercase
assert(ep.symbol === 'SOLUSDT',    'symbol uppercased');
assert(ep.side   === 'LONG',       'side preserved');
assert(ep.stopLoss   === 90,       'stopLoss mapped');
assert(ep.takeProfit === 120,      'takeProfit mapped');
assert(ep.takeProfit2 === 140,     'takeProfit2 mapped');
assert(ep.score === 81,            'score preserved');
assert(ep.reasons?.length === 2,   'reasons preserved');
assert(ep.kind === 'SNIPER',       'kind preserved');
assert(ep.leverage === 10,         'leverage preserved');

console.log('\n=== ADAPTER UNIT TESTS COMPLETE ===');
