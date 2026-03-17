import { evaluateSniperSignal } from '../src/engines/sniperEngine';
import { evaluateBreakoutSignal } from '../src/engines/breakoutEngine';
import { MODES } from '../src/types/trading';
import type { Kline } from '../src/types/trading';

async function fetchKlines(symbol: string, interval: string, limit: number): Promise<Kline[]> {
  const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    const raw: any[][] = await res.json();
    return raw.map(k => ({ openTime: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5], closeTime: k[6] }));
  } catch(e) { clearTimeout(t); throw e; }
}

const SYMBOLS = [
  'BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT',
  'LINKUSDT','AVAXUSDT','DOGEUSDT','ADAUSDT','MATICUSDT',
  'NEARUSDT','INJUSDT','APTUSDT','ARBUSDT','OPUSDT',
  'LDOUSDT','RUNEUSDT','ATOMUSDT','DOTUSDT','LTCUSDT',
];

async function main() {
  const mode = MODES.AGGRESSIVE;
  console.log(`\n=== REJECTION REASON AUDIT — ${new Date().toLocaleTimeString()} ===\n`);

  const btc1h = await fetchKlines('BTCUSDT', '1h', 220);
  console.log(`BTC 1H candles: ${btc1h.length}`);

  const results: {sym: string, verdict: string, reason: string}[] = [];

  for (const sym of SYMBOLS) {
    try {
      const [tf1h, tf15m] = await Promise.all([
        fetchKlines(sym, '1h', 260),
        fetchKlines(sym, '15m', 400),
      ]);

      const sniper = evaluateSniperSignal(tf1h, tf15m, mode, 300, 'TRENDING_UP', 0, undefined, 'UP', 'Debug', sym);
      const breakout = evaluateBreakoutSignal(tf1h, tf15m, mode, 300, 'TRENDING_UP', 0, undefined, 'UP', 'Debug', sym);

      if (sniper) {
        results.push({ sym, verdict: '✅ SNIPER', reason: `score=${sniper.score} side=${sniper.side} type=${sniper.entryType}` });
      } else if (breakout) {
        results.push({ sym, verdict: '✅ BREAKOUT', reason: `score=${breakout.score} type=${breakout.entryType}` });
      } else {
        // Get last reject reason from debugLog
        const debugSig = evaluateSniperSignal(tf1h, tf15m, {...mode, pullback: {...mode.pullback, scoreMin: 1}, breakout: {...mode.breakout, scoreMin: 1}}, 300, 'TRENDING_UP', 0, undefined, 'UP', 'Debug', sym);
        const lastReason = debugSig?.debugLog?.slice(-1)[0] ?? 'NULL — no signal, early gate (data/regime/zone)';
        results.push({ sym, verdict: '🚫 REJECTED', reason: lastReason });
      }
    } catch (e: any) {
      results.push({ sym, verdict: '⚠️ ERROR', reason: e.message });
    }
    await new Promise(r => setTimeout(r, 200)); // Avoid rate limit
  }

  console.log('\n--- RESULTS ---');
  for (const r of results) {
    console.log(`${r.verdict.padEnd(14)} ${r.sym.padEnd(12)} → ${r.reason}`);
  }

  const accepted = results.filter(r => r.verdict.startsWith('✅')).length;
  console.log(`\nSummary: ${accepted}/${results.length} symbols produced a signal.`);
}

main();
