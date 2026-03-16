
import { evaluateSniperSignal } from '../../src/engines/sniperEngine';
import type { Kline, ModeConfig } from '../../src/types/trading';
import { MODES } from '../../src/types/trading';

const BINANCE_FUTURES = 'https://fapi.binance.com';

async function fetchKlines(symbol: string, interval: string, limit: number): Promise<Kline[]> {
  const url = `${BINANCE_FUTURES}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  const raw: any[][] = await res.json();
  return raw.map(r => ({
    openTime: r[0], open: parseFloat(r[1]), high: parseFloat(r[2]),
    low: parseFloat(r[3]), close: parseFloat(r[4]), volume: parseFloat(r[5]),
    closeTime: r[6]
  }));
}

async function run() {
  const SWEEP_MODE = {
    ...MODES.AGGRESSIVE,
    pullback: { ...MODES.AGGRESSIVE.pullback, scoreMin: 1 },
    breakout: { ...MODES.AGGRESSIVE.breakout, scoreMin: 1 },
  } as ModeConfig;

  const tf15m = await fetchKlines('ETHUSDT', '15m', 400);
  const tf1h = await fetchKlines('ETHUSDT', '1h', 260);

  console.log(`tf15m length: ${tf15m.length}, tf1h length: ${tf1h.length}`);
  
  let accepted = 0;
  let rejected = 0;
  
  // Test last 20 candle positions  
  for (let i = 250; i < tf15m.length - 5; i++) {
    const slice = tf15m.slice(0, i + 1);
    const sig = evaluateSniperSignal(tf1h, slice, SWEEP_MODE, 300, 'TRENDING_DOWN' as any, 0, undefined, 'DOWN', 'Mock', 'ETHUSDT');
    if (sig) {
      accepted++;
      console.log(`✅ candle ${i}: score=${sig.score} side=${sig.side} type=${sig.entryType}`);
    } else {
      rejected++;
      const debugLogs = evaluateSniperSignal(tf1h, slice, SWEEP_MODE, 300, 'TRENDING_UP' as any, 0, undefined, 'UP', 'Mock', 'ETHUSDT');
      // wait, evaluateSniperSignal returns null without exposing debugLog.
      // So I can't easily see the debugLog unless I modify sniperEngine.ts
    }
  }
  
  console.log(`\nResult: ${accepted} accepted, ${rejected} rejected out of ${tf15m.length - 255} tested`);
  
  // Also test: does scoreMin=1 actually get passed in?
  console.log(`\nSWEEP_MODE scoreMin (pullback): ${SWEEP_MODE.pullback.scoreMin}`);
  console.log(`SWEEP_MODE scoreMin (breakout): ${SWEEP_MODE.breakout.scoreMin}`);
}

run();
