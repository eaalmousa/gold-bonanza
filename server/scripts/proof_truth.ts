require('dotenv').config();
import * as autoTrader from '../lib/autoTrader';

async function proof() {
    // Override MIN_SCORE temporarily so the backend sees everything
    autoTrader.updateTraderConfig({ minScore: 5 });
    
    // Explicitly run one loop iteration
    // @ts-ignore
    await autoTrader.runTraderLoop(); 
    
    console.log("\n--- EVERYTHING FOUND BY BACKEND SCANNER (Score >= 5) ---");
    // We need to look at what runBonanzaCore returned in that last run. 
    // Since autoTrader.ts doesn't export the raw results, we check the cache.
    
    console.log(JSON.stringify(autoTrader.backendSignalCache, null, 2));
    
    console.log("\n--- TRADER LOGS (LAST 20) ---");
    autoTrader.tradeLogs.slice(0, 20).forEach((l: string) => console.log(l));
}

proof().catch(console.error);
