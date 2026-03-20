import { evaluateSniperSignal } from '../src/engines/sniperEngine';
import { MODES, DEFAULT_SYMBOLS } from '../src/types/trading';

async function runAudit() {
    console.log("=== GATEWAY OVER-REJECTION AUDIT (LIVE DATA) ===\n");
    const symbols = DEFAULT_SYMBOLS.slice(0, 50); // Audit first 50 for speed
    const stats: Record<string, number> = {};

    const fetchKlines = async (s: string, tf: string, limit: number) => {
        try {
            const res = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${s}&interval=${tf}&limit=${limit}`);
            if (!res.ok) return null;
            const data = await res.json() as any[];
            return data.map(d => ({
                time: d[0], open: parseFloat(d[1]), high: parseFloat(d[2]), 
                low: parseFloat(d[3]), close: parseFloat(d[4]), volume: parseFloat(d[5])
            }));
        } catch { return null; }
    };

    console.log(`Auditing ${symbols.length} symbols...`);

    for (const sym of symbols) {
        process.stdout.write(`.` );
        const tf1h = await fetchKlines(sym, "1h", 300);
        const tf15m = await fetchKlines(sym, "15m", 100);
        
        if (!tf1h || !tf15m) continue;

        const debugLog: string[] = [];
        // We capture the debugLog by passing it to evaluateSniperSignal if modified, 
        // but for now we'll just check the result and the existing logs pattern.
        // SniperEngine v3 uses a diag object too.

        const res = evaluateSniperSignal(
            tf1h, tf15m, MODES.BALANCED, 1000, 'TRENDING', 0, {} as any, 'UP', 'BTC_UP', sym
        );

        // evaluateSniperSignal prints diagnostics to console
    }
}

runAudit();
