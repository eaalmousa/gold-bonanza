require('dotenv').config();
import * as autoTrader from '../lib/autoTrader';

async function proof() {
    console.log("--- STARTING PROOF SCAN ---");
    // Ensure symbols are loaded
    // @ts-ignore
    await autoTrader.runTraderLoop(); 
    
    console.log("\n--- BACKEND SIGNAL CACHE AFTER SCAN ---");
    const count = Object.keys(autoTrader.backendSignalCache).length;
    console.log(`Signals in cache: ${count}`);
    
    if (count > 0) {
        Object.values(autoTrader.backendSignalCache).forEach((s: any) => {
            console.log(`[${s.symbol}] Status: ${s.backendDecision} | Reason: ${s.blockerReason || 'N/A'}`);
        });
    } else {
        console.log("No signals processed in this iteration (or none met MIN_SCORE).");
    }
}

proof().catch(console.error);
