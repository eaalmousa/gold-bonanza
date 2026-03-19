import { evaluateFrontendSignals, TRADER_CONFIG } from '../server/lib/autoTrader';
import * as binance from '../server/lib/binance';

// Simulation Proof of Synchronous Telemetry & Starvation Fix
async function proveStarvationFix() {
  console.log("--- PROOF: STARVATION FIX START ---");
  
  // 1. Force Auto-Trading ON and Mode to BINANCE_TEST
  TRADER_CONFIG.isAutoTradingEnabled = true;
  TRADER_CONFIG.executionMode = 'BINANCE_TEST';
  TRADER_CONFIG.MIN_SCORE = 11;

  // 2. Mock a failing getPositions (401 Identity Error)
  const originalGetPositions = binance.getPositions;
  //@ts-ignore
  binance.getPositions = async (url: string) => {
    throw new Error("Binance API 401: Invalid API Key on Testnet");
  };

  // 3. Mock incoming signals from Frontend Sensor
  const mockSignals = [
    {
      id: "SOL-SNIPER-99999",
      symbol: "SOLUSDT",
      status: "ACCEPTED",
      signal: {
        score: 14.5,
        side: "LONG",
        entryPrice: 100,
        stopLoss: 95
      }
    }
  ];

  console.log("Action: Syncing 1 ACCEPTED signal...");
  const result = await evaluateFrontendSignals(mockSignals);
  
  // 4. Verify that the signal was NOT lost (starved)
  const proofId = "SOL-SNIPER-99999";
  const proof = result[proofId];
  if (proof) {
    console.log(`PASS: Signal ID '${proofId}' found in Backend Cache.`);
    console.log(`Backend Decision: ${proof.backendDecision}`);
    console.log(`Blocker Reason: ${proof.blockerReason}`);
  } else {
    console.log("FAIL: Signal was starved (missing in cache).");
    console.log("Available IDs:", Object.keys(result));
  }

  //@ts-ignore
  binance.getPositions = originalGetPositions;
  console.log("--- PROOF: STARVATION FIX END ---");
}

proveStarvationFix();
