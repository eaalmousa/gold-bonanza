// Node environment polyfills — must come before ALL imports
(global as any).localStorage = {
  getItem:    (_k: string) => null,
  setItem:    (_k: string, _v: string) => {},
  removeItem: (_k: string) => {}
};
(global as any).window = global;

import { useTradingStore } from '../src/store/tradingStore';
import { executeOrder, toExecutionPayload } from '../src/services/executionAdapter';

function assert(cond: boolean, label: string) {
  if (cond) console.log(`  ✅ PASS: ${label}`);
  else       console.error(`  ❌ FAIL: ${label}`);
}
const store = useTradingStore;

// ─── Helpers ─────────────────────────────────────────────────────────────────
const goodPayload = () => ({
  symbol: 'BTCUSDT', side: 'SHORT' as const,
  entryPrice: 60000, stopLoss: 63000, takeProfit: 54000, takeProfit2: 48000,
  qty: 0.5, sizeUSDT: 30000, leverage: 10,
  score: 88, entryType: 'BREAKDOWN', entryTiming: 'OPTIMAL',
  reasons: ['EMA flip'], kind: 'SNIPER'
});

// ═══════════════════════════════════════════════════════════════════════════════
// A. Execution Mode Model
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n=== A. EXECUTION MODE MODEL ===');
store.setState({ executionMode: 'PAPER', executionResults: [] });
assert(store.getState().executionMode === 'PAPER',          'Default mode is PAPER');

store.getState().setExecutionMode('BINANCE_TEST');
assert(store.getState().executionMode === 'BINANCE_TEST',   'setExecutionMode: BINANCE_TEST');

store.getState().setExecutionMode('BINANCE_LIVE');
assert(store.getState().executionMode === 'BINANCE_LIVE',   'setExecutionMode: BINANCE_LIVE');

store.getState().setExecutionMode('PAPER');
assert(store.getState().executionMode === 'PAPER',          'setExecutionMode: back to PAPER');
// PAPER mode also activates paperMode
assert(store.getState().paperMode === true,                 'PAPER mode syncs paperMode=true');

// ═══════════════════════════════════════════════════════════════════════════════
// B. Adapter Payload Validation Guards
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n=== B. ADAPTER PAYLOAD VALIDATION GUARDS ===');

// Missing symbol
let r = await executeOrder('PAPER', { ...goodPayload(), symbol: '' });
assert(r.status === 'FAILED' && r.error === 'Missing symbol',            'Missing symbol blocked');

// LevelPrice conflict: LONG with stopLoss above entryPrice
r = await executeOrder('PAPER', { ...goodPayload(), side: 'LONG', stopLoss: 65000 });
assert(r.status === 'FAILED' && r.error!.includes('stopLoss must be below'), 'LONG: SL above entry blocked');

// SHORT with stopLoss below entryPrice
r = await executeOrder('PAPER', { ...goodPayload(), stopLoss: 55000 });
assert(r.status === 'FAILED' && r.error!.includes('stopLoss must be above'), 'SHORT: SL below entry blocked');

// Invalid qty
r = await executeOrder('PAPER', { ...goodPayload(), qty: 0 });
assert(r.status === 'FAILED' && r.error === 'Invalid qty',               'Zero qty blocked');

// All guards pass → PAPER result
r = await executeOrder('PAPER', goodPayload());
assert(r.status === 'PAPER',                                             'Valid PAPER payload executes');
assert(r.mode === 'PAPER',                                               'Result mode is PAPER');
assert(r.payload.symbol === 'BTCUSDT',                                   'Payload preserved in result');
assert(r.payload.score === 88,                                           'score preserved through adapter');
assert(r.payload.entryType === 'BREAKDOWN',                              'entryType preserved through adapter');

// ═══════════════════════════════════════════════════════════════════════════════
// C. Store-level Guards (QUEUED check + duplicate symbol)
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n=== C. STORE-LEVEL DEPLOY GUARDS ===');
store.setState({ pipelineSignals: [], activeTrades: [], executionResults: [] });
store.getState().setExecutionMode('PAPER');

// Guard 1: signal not QUEUED
store.getState().setPipelineSignals([{
  id: 'BTC-1', symbol: 'BTCUSDT', status: 'ACCEPTED',
  signal: goodPayload() as any,
  price: 60000, change24h: -1, timestamp: Date.now()
}]);
store.getState().deploySignal(goodPayload(), 'BTCUSDT');    // ACCEPTED, not QUEUED
await new Promise(r => setTimeout(r, 5));
assert(store.getState().activeTrades.length === 0,           'Deploy blocked: signal not QUEUED');

// Guard 2: correct flow → must queue first
store.getState().queueSignal('BTC-1');
store.getState().deploySignal(store.getState().pipelineSignals[0].signal, 'BTCUSDT');
await new Promise(r => setTimeout(r, 5));
assert(store.getState().activeTrades.length === 1,           'Queued signal deploys correctly');
assert(store.getState().executionResults.length === 1,       'ExecutionResult recorded');
assert(store.getState().executionResults[0].status === 'PAPER', 'Result status is PAPER');
assert(store.getState().activeTrades[0].isPaperTrade === true,  'isPaperTrade stamped on trade');

// Guard 3: duplicate symbol
store.getState().setPipelineSignals([{
  id: 'BTC-2', symbol: 'BTCUSDT', status: 'ACCEPTED',
  signal: goodPayload() as any,
  price: 60000, change24h: -1, timestamp: Date.now()
}]);
store.getState().queueSignal('BTC-2');
store.getState().deploySignal(goodPayload(), 'BTCUSDT');    // already active
await new Promise(r => setTimeout(r, 5));
assert(store.getState().activeTrades.length === 1,           'Duplicate symbol deploy blocked');

// ═══════════════════════════════════════════════════════════════════════════════
// D. Exchange Path Isolation
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n=== D. EXCHANGE PATH ISOLATION ===');
// BINANCE_TEST without credentials → FAILED (no token in localStorage mock)
r = await executeOrder('BINANCE_TEST', goodPayload());
assert(r.status === 'FAILED',                                'BINANCE_TEST without creds → FAILED');
assert(r.error === 'No API credentials present',             'Correct error message');
assert(r.mode === 'BINANCE_TEST',                            'Mode preserved in failed result');

// BINANCE_LIVE without credentials → FAILED
r = await executeOrder('BINANCE_LIVE', goodPayload());
assert(r.status === 'FAILED',                                'BINANCE_LIVE without creds → FAILED');
assert(r.error === 'No API credentials present',             'Correct error for LIVE');

// Neither call should affect pipelineSignals or activeTrades
assert(store.getState().activeTrades.length === 1,           'activeTrades unchanged by direct adapter calls');

// ═══════════════════════════════════════════════════════════════════════════════
// E. toExecutionPayload normalisation
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n=== E. toExecutionPayload NORMALISATION ===');
const rawSig = {
  kind: 'SNIPER', side: 'LONG',
  entryPrice: 100, stopLoss: 90, takeProfit: 120, takeProfit2: 140,
  qty: 5, sizeUSDT: 500, leverage: 10,
  score: 81, entryType: 'BREAKOUT', entryTiming: 'LATE',
  reasons: ['Above EMA20', 'Volume spike']
};
const ep = toExecutionPayload(rawSig, 'SOLUSDT');
assert(ep.symbol === 'SOLUSDT',          'symbol normalised to uppercase');
assert(ep.side === 'LONG',               'side preserved');
assert(ep.stopLoss === 90,               'stopLoss mapped correctly');
assert(ep.takeProfit === 120,            'takeProfit mapped');
assert(ep.takeProfit2 === 140,           'takeProfit2 mapped');
assert(ep.score === 81,                  'score preserved');
assert(ep.reasons?.length === 2,         'reasons preserved');

console.log('\n=== ALL ADAPTER TESTS COMPLETE ===');
