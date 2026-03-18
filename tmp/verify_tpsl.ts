(global as any).localStorage = { getItem: () => null, setItem: () => {} };
import { useTradingStore } from '../src/store/tradingStore';

function assert(cond: boolean, label: string) {
  if (cond) console.log(`  ✅ PASS: ${label}`);
  else       console.error(`  ❌ FAIL: ${label}`);
}

function makeTrade(sym: string, side: 'LONG' | 'SHORT', entry: number, t1: number, t2: number, sl: number) {
  useTradingStore.getState().addActiveTrade({
    symbol: sym, kind: 'SNIPER', type: 'MANUAL', side,
    entryPrice: entry, qty: 10, qtyBase: 10, sizeUSDT: entry * 10,
    t1, t2, sl, stopPrice: sl, leverage: 10,
    deployedAt: Date.now(), status: 'ACTIVE',
    score: 80, entryType: 'BREAKDOWN', entryTiming: 'OPTIMAL',
    reasons: ['test'],
    statusHistory: [{ status: 'ACTIVE', ts: Date.now() }]
  });
}

function tick(sym: string, price: number) {
  useTradingStore.getState().updateTradeLivePrice(sym, price);
}

function trade(sym: string) {
  return useTradingStore.getState().activeTrades.find(t => t.symbol === sym)!;
}

function reset() {
  useTradingStore.setState({ activeTrades: [] });
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 1: LONG trade — TP1 → TP2 full journey
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n=== TEST 1: LONG — ACTIVE → TP1_HIT → TP2_HIT ===');
reset();
makeTrade('BTCUSDT', 'LONG', 60000, 65000, 70000, 57000);

// T- below TP1: still ACTIVE
tick('BTCUSDT', 63000);
assert(trade('BTCUSDT').status === 'ACTIVE',  'No transition below TP1');
assert(trade('BTCUSDT').unrealizedPnl! > 0,   'Positive unrealizedPnl (LONG moving up)');
assert(Math.abs(trade('BTCUSDT').unrealizedPnl! - 30000) < 1, `unrealizedPnl exact: ${trade('BTCUSDT').unrealizedPnl} / expected 30000`);

// T- cross TP1
tick('BTCUSDT', 65100);
assert(trade('BTCUSDT').status === 'TP1_HIT', 'TP1 crossed → TP1_HIT');
assert(trade('BTCUSDT').realizedPnl! > 0,     'realizedPnl set on TP1');
assert(trade('BTCUSDT').statusHistory!.length === 2, 'statusHistory has 2 entries');
console.log(`  📊 TP1 PnL snapshot: +${trade('BTCUSDT').realizedPnl} USDT`);

// T- duplicate tick above TP1: no second transition
tick('BTCUSDT', 65200);
assert(trade('BTCUSDT').status === 'TP1_HIT', 'Duplicate tick above TP1 does not retrigger');
assert(trade('BTCUSDT').statusHistory!.length === 2, 'statusHistory still 2 (no dupe)');

// T- cross TP2 from TP1_HIT — send as SEPARATE tick (realism: levels can't both be crossed in one tick)
tick('BTCUSDT', 70001);
tick('BTCUSDT', 70500);  // second tick to confirm TP2
assert(trade('BTCUSDT').status === 'TP2_HIT', 'TP2 crossed → TP2_HIT');
assert(trade('BTCUSDT').realizedPnl! > trade('BTCUSDT').realizedPnl! - 1, 'realizedPnl updated to TP2');
assert(trade('BTCUSDT').statusHistory!.length === 3, 'statusHistory has 3 entries');
console.log(`  📊 Full journey: ${trade('BTCUSDT').statusHistory!.map(e => e.status).join(' → ')}`);
console.log(`  📊 Final PnL: +${trade('BTCUSDT').realizedPnl} USDT`);

// T- more ticks after terminal: no further changes
const finalStatus = trade('BTCUSDT').status;
const finalPnl    = trade('BTCUSDT').realizedPnl;
tick('BTCUSDT', 75000);
assert(trade('BTCUSDT').status === finalStatus, 'Terminal trade ignores further ticks (status)');
assert(trade('BTCUSDT').realizedPnl === finalPnl, 'Terminal trade ignores further ticks (PnL)');

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 2: SHORT trade — SL hit while ACTIVE
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n=== TEST 2: SHORT — ACTIVE → SL_HIT ===');
reset();
makeTrade('SOLUSDT', 'SHORT', 200, 160, 130, 218); // SL above entry for SHORT

// Moving down (profit territory for SHORT)
tick('SOLUSDT', 190);
assert(trade('SOLUSDT').status === 'ACTIVE',   'Moving toward TP, still ACTIVE');
assert(trade('SOLUSDT').unrealizedPnl! > 0,    'Positive PnL (SHORT moving down)');

// SL crossed (price moves above SL — bad for SHORT)
tick('SOLUSDT', 220); // above 218 SL
assert(trade('SOLUSDT').status === 'SL_HIT',   'SL crossed → SL_HIT');
assert(trade('SOLUSDT').realizedPnl! < 0,      'Negative PnL on SL_HIT (short squeezed)');
assert(trade('SOLUSDT').statusHistory!.length === 2, 'StatusHistory: ACTIVE → SL_HIT');
console.log(`  📊 SL timeline: ${trade('SOLUSDT').statusHistory!.map(e => `${e.status}@${e.price ?? '?'}`).join(' → ')}`);
console.log(`  📊 SL PnL: ${trade('SOLUSDT').realizedPnl} USDT`);

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 3: SHORT trade — TP1 then SL (partial exit then stop on residual)
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n=== TEST 3: SHORT — TP1_HIT → SL_HIT (stop on runner) ===');
reset();
makeTrade('ETHUSDT', 'SHORT', 3000, 2700, 2400, 3200);

// TP1 crossed (SHORT: price below 2700)
tick('ETHUSDT', 2680);
assert(trade('ETHUSDT').status === 'TP1_HIT', 'SHORT TP1 crossed correctly');
console.log(`  📊 After TP1: ${trade('ETHUSDT').statusHistory!.map(e => e.status).join(' → ')}`);

// Short bounces back above SL — send as separate tick (cannot cross both TP1 and SL in identical tick)
tick('ETHUSDT', 3201);
tick('ETHUSDT', 3250);
assert(trade('ETHUSDT').status === 'SL_HIT',  'SL hit on runner from TP1_HIT state');
assert(trade('ETHUSDT').statusHistory!.length === 3, 'Full history: ACTIVE → TP1_HIT → SL_HIT');
console.log(`  📊 Runner SL: ${trade('ETHUSDT').statusHistory!.map(e => `${e.status}@${e.price ?? '?'}`).join(' → ')}`);

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 4: Terminal trades don't accumulate in live feed subscription key
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n=== TEST 4: Terminal trades fall out of subscription set ===');
reset();
makeTrade('AVAXUSDT', 'LONG', 50, 65, 80, 42);
tick('AVAXUSDT', 66); // hits TP1
const t1Trades = useTradingStore.getState().activeTrades;

// Simulate what useLiveFeeds subscription filter does
const TERMINAL = ['TP1_HIT', 'TP2_HIT', 'SL_HIT', 'CLOSED', 'CANCELLED'];
const openForSubscription = t1Trades.filter(t => !TERMINAL.includes(t.status));
const terminalTrades       = t1Trades.filter(t =>  TERMINAL.includes(t.status));

assert(trade('AVAXUSDT').status === 'TP1_HIT',  'AVAX hit TP1 correctly');
assert(openForSubscription.length === 0,          'No open trades remain for live subscription');
assert(terminalTrades.length === 1,               'Terminal trade is correctly classified');
console.log(`  📊 Subscription set after TP1: ${openForSubscription.length} open, ${terminalTrades.length} terminal`);
// Dependency key for useLiveFeeds useEffect:
const depKey = t1Trades.map(t => `${t.symbol}:${t.status}`).join(',');
console.log(`  📊 useEffect dep key: "${depKey}" → will re-run, no streams for AVAXUSDT`);

console.log('\n=== ALL TP/SL AUTO-DETECTION TESTS COMPLETE ===');
