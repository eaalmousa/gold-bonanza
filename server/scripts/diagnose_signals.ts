import { config } from 'dotenv';
config();
import * as autoTrader from '../lib/autoTrader';

async function diagnose() {
    console.log("--- BACKEND SIGNAL TRUTH DIAGNOSTICS ---");
    console.log(`AutoTrade Active: ${autoTrader.TRADER_CONFIG.isAutoTradingEnabled}`);
    console.log(`Max Concurrent: ${autoTrader.TRADER_CONFIG.MAX_CONCURRENT_TRADES}`);
    console.log(`Circuit Breaker: ${autoTrader.TRADER_CONFIG.CIRCUIT_BREAKER_ENABLED}`);
    console.log("\n--- BACKEND SIGNAL CACHE ---");
    console.log(JSON.stringify(autoTrader.backendSignalCache, null, 2));
    console.log("\n--- TRADER LOGS (LATEST 10) ---");
    autoTrader.tradeLogs.slice(0, 10).forEach(l => console.log(l));
    console.log("-----------------------------------------");
}

diagnose().catch(console.error);
