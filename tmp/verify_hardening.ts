(global as any).localStorage = { getItem: () => null, setItem: () => {} };
import { useTradingStore } from '../src/store/tradingStore';

function makeSignal(id: string, symbol: string, status: string, side = 'SHORT'): any {
  return {
    id,
    symbol,
    status,
    signal: {
      kind: 'SNIPER', side, score: 80, qty: 2, sizeUSDT: 1000,
      entryPrice: 100, stopLoss: 110, takeProfit: 80, takeProfit2: 60,
      entryType: 'BREAKDOWN', entryTiming: 'OPTIMAL',
      reasons: ['Structure break', 'Volume spike'],
      leverage: 10
    },
    price: 99, change24h: -2, timestamp: Date.now()
  };
}

function assert(condition: boolean, label: string) {
  if (condition) console.log(`  ✅ PASS: ${label}`);
  else           console.error(`  ❌ FAIL: ${label}`);
}

const store = useTradingStore;

// ─── Reset helper ────────────────────────────────────────────────────────────
function reset() {
  store.setState({ pipelineSignals: [], activeTrades: [] });
}

// ─── Test 1: Store guard - queue blocks non-ACCEPTED statuses ────────────────
console.log('\n=== TEST 1: Queue Guards ===');
reset();
store.getState().setPipelineSignals([
  makeSignal('A', 'AVAXUSDT', 'PENDING'),
  makeSignal('B', 'SOLUSDT',  'INVALIDATED'),
  makeSignal('C', 'ETHUSDT',  'EXPIRED'),
  makeSignal('D', 'BTCUSDT',  'ACCEPTED'),
]);
store.getState().queueSignal('A');
store.getState().queueSignal('B');
store.getState().queueSignal('C');
store.getState().queueSignal('D');

const after1 = store.getState().pipelineSignals;
assert(after1.find(s => s.id === 'A')?.status === 'PENDING',    'PENDING cannot be queued');
assert(after1.find(s => s.id === 'B')?.status === 'INVALIDATED','INVALIDATED cannot be queued');
assert(after1.find(s => s.id === 'C')?.status === 'EXPIRED',    'EXPIRED cannot be queued');
assert(after1.find(s => s.id === 'D')?.status === 'QUEUED',     'ACCEPTED correctly transitions to QUEUED');

// ─── Test 2: Store guard - deploy blocks non-QUEUED statuses ─────────────────
console.log('\n=== TEST 2: Deploy Guards ===');
reset();
store.getState().setPipelineSignals([
  makeSignal('E', 'LINKUSDT', 'PENDING'),
  makeSignal('F', 'DOTUSDT',  'ACCEPTED'),
]);
// Try to deploy a PENDING directly (should be blocked)
store.getState().deploySignal(makeSignal('E', 'LINKUSDT', 'PENDING').signal, 'LINKUSDT');
const after2_link = store.getState().pipelineSignals.find(s => s.id === 'E');
assert(after2_link?.status === 'PENDING', 'Deploy of PENDING signal is blocked');
assert(store.getState().activeTrades.length === 0, 'No active trade created from PENDING deploy attempt');

// Queue then deploy (correct flow)
store.getState().queueSignal('F');
store.getState().deploySignal(store.getState().pipelineSignals.find(s => s.id === 'F')!.signal, 'DOTUSDT');
const after2_dot = store.getState().pipelineSignals.find(s => s.id === 'F');
assert(after2_dot?.status === 'DEPLOYED', 'QUEUED → DEPLOYED transition works');
assert(store.getState().activeTrades.length === 1, 'Active trade created from correct QUEUED deploy');

// ─── Test 3: Duplicate handling policy ───────────────────────────────────────
console.log('\n=== TEST 3: Duplicate / Rescan Policy ===');
reset();
// First scan: inject ACCEPTED
store.getState().setPipelineSignals([makeSignal('G', 'MATICUSDT', 'ACCEPTED')]);
assert(store.getState().pipelineSignals.find(s => s.id === 'G')?.status === 'ACCEPTED', 'Initial scan populates ACCEPTED');

// Second scan: same symbol but PENDING now — replaces the ACCEPTED (since it's not protected)
store.getState().setPipelineSignals([{ ...makeSignal('G2', 'MATICUSDT', 'PENDING') }]);
const after3 = store.getState().pipelineSignals;
assert(!after3.find(s => s.id === 'G'), 'Old ACCEPTED replaced by rescan for same symbol');
assert(after3.find(s => s.id === 'G2')?.status === 'PENDING', 'New PENDING replaces old scan for same symbol');

// QUEUED signal must survive a rescan
store.getState().setPipelineSignals([makeSignal('H', 'ADAUSDT', 'ACCEPTED')]);
store.getState().queueSignal('H');
store.getState().setPipelineSignals([makeSignal('H2', 'ADAUSDT', 'ACCEPTED')]); // same symbol, new scan
const after3b = store.getState().pipelineSignals;
assert(after3b.find(s => s.id === 'H')?.status === 'QUEUED', 'QUEUED signal survives rescan — not overwritten');
assert(!after3b.find(s => s.id === 'H2'), 'Duplicate from rescan is filtered out for already-queued symbol');

// DEPLOYED signal survives rescan
store.getState().queueSignal('H');
store.getState().deploySignal(after3b.find(s => s.id === 'H')!.signal, 'ADAUSDT');
store.getState().setPipelineSignals([makeSignal('H3', 'ADAUSDT', 'ACCEPTED')]); // fresh scan
const after3c = store.getState().pipelineSignals;
assert(after3c.find(s => s.id === 'H')?.status === 'DEPLOYED', 'DEPLOYED signal survives rescan for same symbol');

// ─── Test 4: Full payload verification ───────────────────────────────────────
console.log('\n=== TEST 4: Full Payload Through Entire Path ===');
reset();
store.getState().setPipelineSignals([makeSignal('Z', 'BNBUSDT', 'ACCEPTED')]);
store.getState().queueSignal('Z');
const queued = store.getState().pipelineSignals.find(s => s.id === 'Z')!;
store.getState().deploySignal(queued.signal, queued.symbol);
const trade = store.getState().activeTrades[0];

assert(trade?.symbol === 'BNBUSDT',         'symbol preserved');
assert(trade?.side === 'SHORT',              'side preserved');
assert(trade?.entryPrice === 100,            'entryPrice preserved');
assert(trade?.sl === 110,                    'stopLoss preserved');
assert(trade?.t1 === 80,                     'takeProfit preserved');
assert(trade?.t2 === 60,                     'takeProfit2 preserved');
assert(trade?.qty === 2,                     'qty preserved');
assert(trade?.sizeUSDT === 1000,             'sizeUSDT preserved');
assert(trade?.score === 80,                  'score preserved');
assert(trade?.entryType === 'BREAKDOWN',     'entryType preserved');
assert(trade?.entryTiming === 'OPTIMAL',     'entryTiming preserved');
assert(trade?.reasons?.length === 2,         'reasons preserved');

console.log('\n=== ALL TESTS COMPLETE ===');
