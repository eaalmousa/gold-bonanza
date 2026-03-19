import { config } from 'dotenv';
config();
process.env.BINANCE_API_KEY = 'mock';
process.env.BINANCE_API_SECRET = 'mock';

const autoTrader = require('../lib/autoTrader');
const binance = require('../lib/binance');

autoTrader.updateTraderConfig({ circuitBreakerEnabled: false, maxConcurrent: 8 });

// Mock dependencies
// @ts-ignore
binance.getPositions = async () => {
    return [
        {
            symbol: 'ETHUSDT',
            positionAmt: '1.5',
            entryPrice: '3000',
            leverage: '10',
            unRealizedProfit: '-2000' // High loss to trigger deep red (> -25%)
        }
    ];
};

// @ts-ignore
binance.getBalance = async () => 1000;

// @ts-ignore
binance.placeMarketOrder = async () => {
    console.log(`[MOCK BINANCE] DEPLOYED MARKET ORDER SUCCESSFULLY!`);
    return { orderId: 12345 };
};

// Override core scan to just return a single ACCEPTED signal 
// @ts-ignore
const scanner = require('../../src/engines/scanner');
scanner.runBonanzaCore = async () => {
    return {
        pipelineSignals: [
            {
                status: 'ACCEPTED',
                symbol: 'SOLUSDT',
                signal: {
                    score: 20,
                    side: 'LONG',
                    entryType: 'PULLBACK',
                    entryPrice: 150,
                    stopLoss: 140,
                    takeProfit: 160,
                    takeProfit2: 170
                }
            }
        ],
        marketRows: [], pipelineTraces: [], regimeLabel: 'TREND'
    };
};

// Also mock fetch for BTC confirmation so it doesn't block LONGs
global.fetch = async () => ({
    json: async () => [
        [0, 60000, 61000, 59000, 60500], // Old
        [0, 60500, 61000, 59000, 60600], // Prev
        [0, 60600, 61000, 59000, 60700], // Last
        [0, 60700, 61500, 60000, 61000]  // Current
    ]
} as any);

async function runTest() {
    console.log(`--- RUNNING CIRCUIT BREAKER TEST ---`);
    console.log(`Initial Config -> Circuit Breaker: ${autoTrader.CIRCUIT_BREAKER_ENABLED}, Max Concurrent: ${autoTrader.MAX_CONCURRENT_TRADES}`);
    
    // Hack the toggle to ON so the engine runs its internal iteration
    autoTrader.toggleAutoTrade(true);

    // Call inner iteration directly
    // @ts-ignore
    await autoTrader.runTraderLoop();

    // Check logs
    console.log("\n--- TRADER LOGS ---");
    autoTrader.tradeLogs.slice(0, 5).forEach(l => console.log(l));
    console.log("-----------------------------------");
}

runTest().catch(console.error);
