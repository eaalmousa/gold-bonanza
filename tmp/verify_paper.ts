(global as any).localStorage = { getItem: () => null, setItem: () => {} };
import { useTradingStore } from '../src/store/tradingStore';

function assert(cond: boolean, label: string) {
  if (cond) console.log(`  ✅ PASS: ${label}`);
  else       console.error(`  ❌ FAIL: ${label}`);
}
const store = useTradingStore;

// ─── Setup: start fresh paper session ────────────────────────────────────────
store.getState().resetPaperSession(10000);
assert(store.getState().paperMode === true,               'Paper mode activated by resetPaperSession');
assert(store.getState().paperSession.currentBalance === 10000, 'Balance starts at $10,000');

// ─── Trade 1: LONG BTC — TP2 hit (full winner) ────────────────────────────────
console.log('\n=== TRADE 1: LONG BTC — TP2 (Full Win) ===');
store.getState().setPipelineSignals([{
  id: 'BTC-LONG-1', symbol: 'BTCUSDT', status: 'ACCEPTED',
  signal: { kind: 'SNIPER', side: 'LONG', score: 92, qty: 0.5, sizeUSDT: 30000,
            entryPrice: 60000, stopLoss: 57000, takeProfit: 65000, takeProfit2: 70000,
            entryType: 'CONTINUATION', entryTiming: 'OPTIMAL', leverage: 10 } as any,
  price: 60000, change24h: 1.2, timestamp: Date.now()
}]);
store.getState().queueSignal('BTC-LONG-1');
const btcQueued = store.getState().pipelineSignals.find(s => s.id === 'BTC-LONG-1')!;
store.getState().deploySignal(btcQueued.signal, 'BTCUSDT');

const t1 = store.getState().activeTrades.find(t => t.symbol === 'BTCUSDT')!;
assert(t1.isPaperTrade === true,     'Trade stamped as isPaperTrade');
assert(t1.status === 'ACTIVE',       'Trade opens as ACTIVE');

// Simulate price ticks:
store.getState().updateTradeLivePrice('BTCUSDT', 63000); // between entry and TP1
assert(store.getState().activeTrades.find(t => t.symbol === 'BTCUSDT')?.status === 'ACTIVE', 'Still ACTIVE below TP1');

store.getState().updateTradeLivePrice('BTCUSDT', 65500); // crosses TP1
assert(store.getState().activeTrades.find(t => t.symbol === 'BTCUSDT')?.status === 'TP1_HIT', 'AUTO: TP1 crossed → TP1_HIT');

// Additional tick — TP2
store.getState().updateTradeLivePrice('BTCUSDT', 70200); // crosses TP2 — triggers auto-close
// Give the setTimeout(0) a chance to run
await new Promise(r => setTimeout(r, 10));

assert(store.getState().activeTrades.find(t => t.symbol === 'BTCUSDT') === undefined, 'Paper trade removed from activeTrades after TP2');
assert(store.getState().paperSession.closedTrades.length === 1, 'ClosedTrades has 1 entry');
const c1 = store.getState().paperSession.closedTrades[0];
assert(c1.outcome === 'WIN',         'Outcome = WIN');
assert(c1.realizedPnl! > 0,         'Positive realizedPnl');
console.log(`  📊 BTC closed: PnL = +${c1.realizedPnl} USDT | Balance: $${store.getState().paperSession.currentBalance}`);

// ─── Trade 2: SHORT SOL — SL hit (loss) ───────────────────────────────────────
console.log('\n=== TRADE 2: SHORT SOL — SL Hit (Loss) ===');
store.getState().setPipelineSignals([{
  id: 'SOL-SHORT-1', symbol: 'SOLUSDT', status: 'ACCEPTED',
  signal: { kind: 'SNIPER', side: 'SHORT', score: 80, qty: 20, sizeUSDT: 4000,
            entryPrice: 200, stopLoss: 215, takeProfit: 175, takeProfit2: 150,
            entryType: 'BREAKDOWN', entryTiming: 'OPTIMAL', leverage: 10 } as any,
  price: 200, change24h: -2, timestamp: Date.now()
}]);
store.getState().queueSignal('SOL-SHORT-1');
const solQueued = store.getState().pipelineSignals.find(s => s.id === 'SOL-SHORT-1')!;
store.getState().deploySignal(solQueued.signal, 'SOLUSDT');
assert(store.getState().activeTrades.find(t => t.symbol === 'SOLUSDT')?.isPaperTrade, 'SOL paper trade opened');

store.getState().updateTradeLivePrice('SOLUSDT', 216); // crosses SL (above 215 for SHORT)
await new Promise(r => setTimeout(r, 10));

assert(store.getState().activeTrades.find(t => t.symbol === 'SOLUSDT') === undefined, 'SOL removed after SL');
assert(store.getState().paperSession.closedTrades.length === 2, 'ClosedTrades has 2 entries');
const c2 = store.getState().paperSession.closedTrades[1];
assert(c2.outcome === 'LOSS',        'Outcome = LOSS');
assert(c2.realizedPnl! < 0,         'Negative realizedPnl on SL hit');
console.log(`  📊 SOL closed: PnL = ${c2.realizedPnl} USDT | Balance: $${store.getState().paperSession.currentBalance}`);

// ─── Session summary ──────────────────────────────────────────────────────────
console.log('\n=== SESSION SUMMARY ===');
const sess = store.getState().paperSession;
assert(sess.winCount === 1,          `winCount = 1 (got ${sess.winCount})`);
assert(sess.lossCount === 1,         `lossCount = 1 (got ${sess.lossCount})`);
console.log(`  📊 Start Balance:    $${sess.startBalance}`);
console.log(`  📊 Current Balance:  $${sess.currentBalance}`);
console.log(`  📊 Session PnL:      ${sess.totalPnl >= 0 ? '+' : ''}$${sess.totalPnl}`);
console.log(`  📊 Win Rate:         ${sess.winCount}W / ${sess.lossCount}L`);
console.log(`  📊 Avg R Multiple:   ${sess.avgRMultiple}R`);

// ─── Rescan safety ────────────────────────────────────────────────────────────
console.log('\n=== RESCAN SAFETY ===');
// Closed paper trades have been removed from activeTrades
// A fresh scan for those symbols should NOT be blocked (trade is done)
const preScan = store.getState().activeTrades.length;
assert(preScan === 0, 'No open paper trades remain after both closures');
assert(store.getState().paperSession.closedTrades.length === 2, 'Session history preserved');

console.log('\n=== PAPER TRADING TESTS COMPLETE ===');
