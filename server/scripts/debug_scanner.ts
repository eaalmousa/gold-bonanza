import { runBonanzaCore } from '../../src/engines/scanner';
import { MODES, DEFAULT_SYMBOLS } from '../../src/types/trading';

async function testScanner() {
  console.log('Starting scanner core test with ' + DEFAULT_SYMBOLS.length + ' symbols...');
  const symbols = DEFAULT_SYMBOLS;
  
  const result = await runBonanzaCore(
    symbols, 
    MODES.AGGRESSIVE, // match frontend
    300, 
    (pct) => console.log('Progress', pct),
    {}, // order flow
    (regime, reason) => console.log('Regime update:', regime, reason),
    0, // open count
    { openPositions: [], currentScanCycleStart: Date.now() } // portfolio
  );

  console.log(`Scanner complete: found ${result.sniperSignals.length} snipers, ${result.breakoutSignals.length} breakouts.`);
  console.log(result.sniperSignals.map(s => `${s.symbol} ${s.signal.side} ${s.signal.score}`).join('\n'));
}

testScanner();
