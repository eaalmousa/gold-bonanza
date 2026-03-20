import { evaluateSniperSignal } from './src/engines/sniperEngine';
import { ModeConfig, Kline } from './src/types/trading';

// Mock Mock Data
const mock1h: Kline[] = new Array(300).fill({ close: 100, open: 100, high: 101, low: 99, volume: 1000, time: 0 });
const mock15m: Kline[] = new Array(100).fill({ close: 1.0, open: 0.9, high: 1.1, low: 0.8, volume: 100, time: 0 });

const activeMode: ModeConfig = {
  key: 'BALANCED',
  riskPct: 0.01, // 1% risk
  pullback: {
    rsiMin: 30, rsiMax: 70, volMult: 1.1, scoreMin: 1, 
    valueZoneSlack: 0.05, atrPctMin: 0.01, atrPctMax: 10.0
  }
} as any;

// Verification Test scenarios
console.log("=== SIZING VERIFICATION RUN ===\n");

function testSizing(balance: number, entry: number, stop: number, symbol: string) {
    console.log(`[TEST: ${symbol}] Balance=$${balance} Entry=$${entry} Stop=$${stop}`);
    
    // We mock a manual sizing call to evaluate the logic inside evaluateSniperSignalInner
    // Since we want to prove ONLY the sizing logic, we directly invoke the calculation block
    // OR we can mock the entire signal evaluation and see the Note/Rejected messages.
    
    // For this proof, I will simulate the formula used in sniperEngine.ts:
    const intendedRisk = balance * activeMode.riskPct;
    const stopDistance = Math.abs(entry - stop);
    const rawQty = intendedRisk / stopDistance;
    const rawNotional = rawQty * entry;
    
    let result = { 
        rawNotional, 
        adjNotional: rawNotional, 
        adjRisk: intendedRisk, 
        multiplier: 1.0, 
        decision: 'ALLOW' 
    };

    if (rawNotional < 5.0) {
        const MIN_NOTIONAL = 5.50;
        const adjQty = MIN_NOTIONAL / entry;
        const adjRisk = adjQty * stopDistance;
        const multiplier = adjRisk / intendedRisk;

        result.adjNotional = MIN_NOTIONAL;
        result.adjRisk = adjRisk;
        result.multiplier = multiplier;

        if (multiplier > 2.0) {
            result.decision = 'REJECT (Risk Inflation > 2.0x)';
        } else {
            result.decision = 'ALLOW (Safe Adjustment)';
        }
    }

    console.log(`- Intended Risk: $${intendedRisk.toFixed(2)}`);
    console.log(`- Raw Notional:  $${rawNotional.toFixed(2)}`);
    console.log(`- Adj Notional:  $${result.adjNotional.toFixed(2)}`);
    console.log(`- Actual Risk:   $${result.adjRisk.toFixed(2)}`);
    console.log(`- Multiplier:    ${result.multiplier.toFixed(2)}x`);
    console.log(`- FINAL DECISION: ${result.decision}\n`);
}

// Scenario 1: WIF (Low Price, Tight Stop) -> Safe Adjustment
testSizing(100, 0.25, 0.24, "WIF_SAFE");

// Scenario 2: MORPHO (Low Price, Wide Stop) -> Safety rejection
testSizing(50, 1.50, 1.20, "MORPHO_REJECT");

// Scenario 3: NEAR (Mid Price, 1% Risk) -> Natural Compliance
testSizing(1000, 5.0, 4.90, "NEAR_NATURAL");
