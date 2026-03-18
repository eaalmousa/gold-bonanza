import { runBonanzaCore } from '../src/engines/scanner';
import { MODES } from '../src/types/trading';

async function testAdapter() {
  console.log('--- Testing Scanner Adapter ---');
  const activeMode = MODES.AGGRESSIVE;
  const balance = 10000;
  
  const result = await runBonanzaCore(
    ['AVAXUSDT', 'SOLUSDT', 'ETHUSDT'],
    activeMode,
    balance
  );

  console.log('\n--- PIPELINE SIGNALS (Tradeable) ---');
  console.log(JSON.stringify(result.pipelineSignals.map(s => ({
    symbol: s.symbol,
    status: s.status,
    id: s.id,
    score: s.signal.score,
    entryTiming: s.signal.entryTiming,
    entryType: s.signal.entryType
  })), null, 2));

  console.log('\n--- PIPELINE TRACES (Observability) ---');
  console.log(JSON.stringify(result.pipelineTraces.slice(0, 5).map(t => ({
    symbol: t.symbol,
    engine: t.engine,
    status: t.status,
    score: t.score,
    lastRejectReason: t.lastRejectReason,
    usedBreakingDownBypass: t.usedBreakingDownBypass,
    usedLateException: t.usedLateException
  })), null, 2));

  console.log(`\nTotals: ${result.pipelineSignals.length} signals | ${result.pipelineTraces.length} traces`);
}

testAdapter().catch(console.error);
