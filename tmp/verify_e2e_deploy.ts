(global as any).localStorage = { getItem: () => null, setItem: () => {} };
import { useTradingStore } from '../src/store/tradingStore';

function testE2E() {
  const store = useTradingStore.getState();
  
  // 1. Inject mock pipeline signals
  store.setPipelineSignals([
    {
      id: 'BTC-SNIPER-123',
      symbol: 'BTCUSDT',
      status: 'ACCEPTED',
      signal: {
        kind: 'SNIPER', side: 'SHORT', score: 95.5, qty: 1, sizeUSDT: 5000, 
        entryPrice: 65000, stopLoss: 66000, takeProfit: 60000, takeProfit2: 55000,
        entryType: 'BREAKDOWN', entryTiming: 'OPTIMAL', reasons: ['RSI oversold', 'EMA cross'],
        leverage: 10
      } as any,
      price: 64900, change24h: -1.2, timestamp: Date.now()
    },
    {
      id: 'AVAX-BREAKOUT-456',
      symbol: 'AVAXUSDT',
      status: 'PENDING',
      signal: {
        kind: 'BREAKOUT', side: 'LONG', score: 85, qty: 10, sizeUSDT: 500,
        entryPrice: 50, stopLoss: 45, takeProfit: 70, takeProfit2: undefined,
        entryType: 'PENDING_RETEST', entryTiming: 'EARLY', reasons: ['Volume expansion'],
        leverage: 10
      } as any,
      price: 49, change24h: 5.5, timestamp: Date.now()
    }
  ]);

  console.log('--- Initial State ---');
  let currentSignals = useTradingStore.getState().pipelineSignals;
  currentSignals.forEach(s => console.log(`${s.symbol}: ${s.status}`));

  // 2. Queue the first one
  console.log('\n--- Toggling queueing for BTC ---');
  useTradingStore.getState().queueSignal('BTC-SNIPER-123');
  
  let queued = useTradingStore.getState().pipelineSignals.find(s => s.id === 'BTC-SNIPER-123');
  console.log(`BTC Pipeline Status: ${queued?.status}`);

  // 3. Deploy it
  console.log('\n--- Executing Deploy (from Command Hub Simulator) ---');
  // At this point we emulate the hub deploying the queued signal
  useTradingStore.getState().deploySignal(queued!.signal, queued!.symbol);

  console.log('\n--- Final State ---');
  const postDeployPipeline = useTradingStore.getState().pipelineSignals.find(s => s.id === 'BTC-SNIPER-123');
  console.log(`BTC Pipeline Status: ${postDeployPipeline?.status}`);
  
  const activeTrade = useTradingStore.getState().activeTrades[0];
  console.log('Fields successfully mapped through activeTrade:');
  console.log(JSON.stringify({
    symbol: activeTrade.symbol,
    status: activeTrade.status,
    score: activeTrade.score,
    entryType: activeTrade.entryType,
    entryTiming: activeTrade.entryTiming,
    reasons: activeTrade.reasons,
    sizeUSDT: activeTrade.sizeUSDT,
    side: activeTrade.side
  }, null, 2));
}

testE2E();
