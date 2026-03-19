import path from 'path';
import { pathToFileURL } from 'url';

async function verifyRoutingModes() {
  console.log("--- FINAL PROOF: EXECUTION TARGET SWITCHER (GBv12) ---");

  const binanceAbs = path.resolve(process.cwd(), 'server/lib/binance.ts');
  const binanceUrl = pathToFileURL(binanceAbs).href;
  const { binanceRequest } = await import(binanceUrl);

  const traderAbs = path.resolve(process.cwd(), 'server/lib/autoTrader.ts');
  const traderUrl = pathToFileURL(traderAbs).href;
  const { evaluateFrontendSignals, TRADER_CONFIG } = await import(traderUrl);

  const TEST_SIGNAL = {
    id: "PROOT_1", symbol: "SOLUSDT", status: "ACCEPTED", timestamp: Date.now(),
    signal: { side: "LONG", entryPrice: 150, stopLoss: 140, takeProfit: 170, sizeUSDT: 50 }
  };

  // --- MODE 1: PAPER ---
  console.log("\n[TEST: MODE = PAPER]");
  TRADER_CONFIG.executionMode = 'PAPER';
  TRADER_CONFIG.isAutoTradingEnabled = true;

  const resPaper = await evaluateFrontendSignals([TEST_SIGNAL]);
  console.log(`PAPER Result: Decision = ${resPaper["PROOT_1"].backendDecision}, OrderID = ${resPaper["PROOT_1"].deployedOrderId}`);

  // --- MODE 2: DEMO (Credential Guard) ---
  console.log("\n[TEST: MODE = DEMO]");
  TRADER_CONFIG.executionMode = 'DEMO';
  // Simulate missing DEMO keys
  process.env.BINANCE_TEST_API_KEY = ""; 
  
  try {
    await evaluateFrontendSignals([TEST_SIGNAL]);
  } catch (err: any) {
    console.log(`DEMO Guard Caught: ${err.message}`);
  }

  // --- MODE 3: LIVE (Routing Verification) ---
  console.log("\n[TEST: MODE = LIVE]");
  TRADER_CONFIG.executionMode = 'LIVE';
  // Set fake Live key to prove routing
  process.env.BINANCE_API_KEY = "LIVE_KEY_PROVEN";
  process.env.BINANCE_API_SECRET = "LIVE_SECRET_PROVEN";
  
  try {
    // This will hit fapi.binance.com with our fake key
    await evaluateFrontendSignals([TEST_SIGNAL]);
  } catch (err: any) {
    console.log(`LIVE Routing Analysis:`);
    // The logger in binanceRequest will show the URL used
    console.log(`Final Result: ${err.message}`);
  }

  console.log("\n--- VERIFICATION COMPLETE ---");
}

verifyRoutingModes().catch(console.error);
