(global as any).localStorage = { getItem: () => null, setItem: () => {} };
import { useTradingStore } from '../src/store/tradingStore';

function assert(cond: boolean, label: string) {
  if (cond) console.log(`  ✅ PASS: ${label}`);
  else       console.error(`  ❌ FAIL: ${label}`);
}

const store = useTradingStore;
store.setState({ activeTrades: [] });

// ─── Deploy a mock SHORT trade ────────────────────────────────────────────────
store.getState().addActiveTrade({
  symbol: 'SOLUSDT', kind: 'SNIPER', type: 'MANUAL',
  side: 'SHORT', entryPrice: 200, qty: 10, qtyBase: 10,
  sizeUSDT: 2000, t1: 160, t2: 130, sl: 218,
  stopPrice: 218, leverage: 10,
  deployedAt: Date.now(), status: 'ACTIVE',
  score: 78, entryType: 'BREAKDOWN', entryTiming: 'OPTIMAL',
  reasons: ['EMA flip', 'Volume surge'],
  statusHistory: [{ status: 'ACTIVE', ts: Date.now() }]
});

console.log('\n=== STAGE 1: Trade Created ===');
const t0 = store.getState().activeTrades[0];
assert(t0.status === 'ACTIVE',            'Status is ACTIVE on creation');
assert(t0.statusHistory?.length === 1,    'StatusHistory has initial ACTIVE entry');
assert(t0.score === 78,                   'score preserved from pipeline');
assert(t0.entryType === 'BREAKDOWN',      'entryType preserved');
assert(t0.entryTiming === 'OPTIMAL',      'entryTiming preserved');
assert(t0.reasons?.length === 2,          'reasons preserved');

// ─── Simulate live price feed tick ───────────────────────────────────────────
console.log('\n=== STAGE 2: Live Price Update (price moving toward TP1) ===');
store.getState().updateTradeLivePrice('SOLUSDT', 180);
const t1 = store.getState().activeTrades[0];
// SHORT: entry=200, livePrice=180, sl=218 → profitable
// unrealizedPnl = (200-180) * 10 = +200
assert(t1.livePrice === 180,              'livePrice set correctly');
assert(t1.unrealizedPnl! > 0,            'unrealizedPnl is positive (SHORT moving down)');
assert(t1.unrealizedPnl! === 200,        `unrealizedPnl = +200 (got ${t1.unrealizedPnl})`);
// R = priceDiff / riskPerUnit; dir=-1 for SHORT
// priceDiff = (180-200)*(-1) = 20; risk = |200-218| = 18; R = 20/18 ≈ 1.111
assert(t1.rMultiple !== undefined,        'rMultiple calculated');
assert(t1.rMultiple! > 1,                `rMultiple > 1R (got ${t1.rMultiple})`);
// distToTp1: pct(160) = (160-180)/180 * 100 * -1 = 20/180*100 ≈ 11.1%
assert(t1.distToTp1 !== undefined,        'distToTp1 calculated');
assert(t1.distToTp1! > 0,               `distToTp1 is positive (price hasn't reached TP1: ${t1.distToTp1}%)`);
assert(t1.distToSl !== undefined,         'distToSl calculated');
console.log(`  📊 unrealizedPnl=${t1.unrealizedPnl} rMultiple=${t1.rMultiple}R TP1 distance=${t1.distToTp1}%`);

// ─── TP1 hit ─────────────────────────────────────────────────────────────────
console.log('\n=== STAGE 3: TP1 Hit ===');
store.getState().updateTradeStatus('SOLUSDT', 'TP1_HIT', 160, 'First target reached');
const t2 = store.getState().activeTrades[0];
assert(t2.status === 'TP1_HIT',           'Status transitions to TP1_HIT');
assert(t2.statusHistory?.length === 2,    'StatusHistory has 2 entries');
assert(t2.realizedPnl !== undefined,      'realizedPnl computed on terminal status');
// realizedPnl = (160-200)*(-1)*10 = 400
assert(t2.realizedPnl === 400,           `realizedPnl = 400 (got ${t2.realizedPnl})`);
console.log(`  📊 realizedPnl=${t2.realizedPnl} USDT`);

// ─── TP2 hit ─────────────────────────────────────────────────────────────────
console.log('\n=== STAGE 4: TP2 Hit ===');
store.getState().updateTradeStatus('SOLUSDT', 'TP2_HIT', 130, 'Full target reached');
const t3 = store.getState().activeTrades[0];
assert(t3.status === 'TP2_HIT',           'Status transitions to TP2_HIT');
assert(t3.statusHistory?.length === 3,    'StatusHistory has 3 entries');
// realizedPnl = (130-200)*(-1)*10 = 700
assert(t3.realizedPnl === 700,           `realizedPnl = 700 (got ${t3.realizedPnl})`);
console.log(`  📊 Timeline: ${t3.statusHistory?.map(e => e.status).join(' → ')}`);

// ─── Rescan doesn't mutate deployed trade ────────────────────────────────────
console.log('\n=== STAGE 5: Rescan safety ===');
store.setState({
  pipelineSignals: [],
  activeTrades: [{ ...store.getState().activeTrades[0] }]  // keep deployed trade
});
store.getState().setPipelineSignals([{ 
  id: 'SOL-NEW', symbol: 'SOLUSDT', status: 'ACCEPTED', 
  signal: { kind: 'SNIPER', side: 'SHORT', score: 90 } as any,
  price: 128, change24h: -5, timestamp: Date.now()
}]);

const afterRescan = store.getState().activeTrades[0];
assert(afterRescan.status === 'TP2_HIT',  'Active trade status not corrupted by rescan');
assert(afterRescan.realizedPnl === 700,   'realizedPnl not corrupted by rescan');
const newSignal = store.getState().pipelineSignals.find(s => s.symbol === 'SOLUSDT');
assert(!newSignal,                         'New SOLUSDT scan result blocked (active trade owns slot)');
console.log(`  📊 pipelineSignals for SOLUSDT after rescan: ${newSignal ? '❌ LEAKED IN' : '✅ correctly filtered'}`);

console.log('\n=== ALL LIFECYCLE TESTS COMPLETE ===');
