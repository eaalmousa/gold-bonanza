import { evaluateSniperSignal } from '../src/engines/sniperEngine';

async function runLiveProof() {
    console.log("=== LIVE RUNTIME SIZING PROOF (ACTUAL BINANCE DATA) ===\n");
    const sym = "WIFUSDT";
    
    const fetchKlines = async (s: string, tf: string, limit: number) => {
        const res = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${s}&interval=${tf}&limit=${limit}`);
        const data = await res.json() as any[];
        return data.map(d => ({
            time: d[0], open: parseFloat(d[1]), high: parseFloat(d[2]), 
            low: parseFloat(d[3]), close: parseFloat(d[4]), volume: parseFloat(d[5])
        }));
    };

    try {
        const tf1h = await fetchKlines(sym, "1h", 300);
        const tf15m = await fetchKlines(sym, "15m", 100);
        
        const activeMode = {
            key: 'BALANCED',
            riskPct: 0.01,
            pullback: {
                rsiMin: 0, rsiMax: 100, volMult: 0, scoreMin: 0, 
                valueZoneSlack: 10.0, atrPctMin: 0, atrPctMax: 100
            }
        } as any;

        // Ensure we see anything
        console.log(`Evaluating ${sym} | Price: ${tf15m[tf15m.length-1].close}`);
        
        // We call the inner function to ensure we see its console logs
        const signal = evaluateSniperSignal(
            tf1h, tf15m, activeMode, 1000, 'TRENDING', 10, {} as any, 'UP', 'BTC_UP', 'WIF'
        );
        
        if (!signal) {
            console.log("\nSignal produced: NONE (Check engine gates)");
        } else {
            console.log("\nSignal produced: SUCCESS");
        }
        
    } catch (err) {
        console.error("Failed:", err);
    }
}

runLiveProof();
