import { MODES } from '../src/types/trading';
import type { Kline } from '../src/types/trading';
import { calcEMA, calcRSI, calcATR, calcSMA, calcMACD, calcBollingerBands } from '../src/engines/indicators';

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

async function diagnose(sym: string) {
  const mode = MODES.AGGRESSIVE;
  const [tf1h, tf15m] = await Promise.all([
    fetchKlines(sym, '1h', 260),
    fetchKlines(sym, '15m', 400),
  ]);

  const closes1h = tf1h.map(c => c.close);
  const ema20_1h = calcEMA(closes1h, 20);
  const ema50_1h = calcEMA(closes1h, 50);
  const ema200_1h = calcEMA(closes1h, 200);
  const idx1h = closes1h.length - 1;
  const close1h = closes1h[idx1h];
  const e20_1h = ema20_1h[idx1h];
  const e50_1h = ema50_1h[idx1h];
  const e200_1h = ema200_1h[idx1h];

  // Gate 1: Data sufficiency
  if (!tf1h || tf1h.length < 210) { console.log(`${sym}: ❌ GATE1 — tf1h too short (${tf1h.length})`); return; }
  if (!tf15m || tf15m.length < 90) { console.log(`${sym}: ❌ GATE1 — tf15m too short (${tf15m.length})`); return; }
  console.log(`${sym}: ✅ GATE1 — data ok. tf1h=${tf1h.length} tf15m=${tf15m.length}`);

  // Gate 2: EMAs available
  if ([e20_1h, e50_1h, e200_1h].some(v => v == null)) { console.log(`${sym}: ❌ GATE2 — EMA null`); return; }
  console.log(`${sym}: ✅ GATE2 — 1H EMAs ready. close=${close1h.toFixed(4)} e20=${e20_1h!.toFixed(4)} e50=${e50_1h!.toFixed(4)} e200=${e200_1h!.toFixed(4)}`);

  // Direction in AGGRESSIVE mode
  const side = close1h > e50_1h! ? 'LONG' : 'SHORT';
  console.log(`${sym}: 🎯 Direction: ${side} (close ${close1h > e50_1h! ? '>' : '<'} e50)`);

  // Gate: 15m indicators
  const closes15 = tf15m.map(c => c.close);
  const highs15  = tf15m.map(c => c.high);
  const lows15   = tf15m.map(c => c.low);
  const vols15   = tf15m.map(c => c.volume);
  const ema20_15 = calcEMA(closes15, 20);
  const ema50_15 = calcEMA(closes15, 50);
  const rsi14_15 = calcRSI(closes15, 14);
  const atr14_15 = calcATR(highs15, lows15, closes15, 14);
  const volSMA20_15 = calcSMA(vols15, 20);
  const lastIdx = closes15.length - 2;
  if (lastIdx <= 60) { console.log(`${sym}: ❌ GATE3 — tf15m lastIdx too low (${lastIdx})`); return; }

  const close15 = closes15[lastIdx];
  const high15 = highs15[lastIdx];
  const low15 = lows15[lastIdx];
  const open15 = tf15m[lastIdx].open;
  const e20_15 = ema20_15[lastIdx];
  const e50_15 = ema50_15[lastIdx];
  const rsiNow = rsi14_15[lastIdx];
  const atr = atr14_15[lastIdx];
  const volAvg = volSMA20_15[lastIdx];
  const range = Math.max(1e-9, high15 - low15);
  const candleAtrRatio = range / atr!;

  if ([e20_15, e50_15, rsiNow, atr, volAvg].some(v => v == null)) { console.log(`${sym}: ❌ GATE3 — 15m indicators null`); return; }
  console.log(`${sym}: ✅ GATE3 — 15m indicators ready. close15=${close15.toFixed(4)} e20=${e20_15!.toFixed(4)} e50=${e50_15!.toFixed(4)} RSI=${rsiNow!.toFixed(1)} ATR=${atr!.toFixed(4)}`);
  console.log(`${sym}: 📊 Candle AtrRatio=${candleAtrRatio.toFixed(3)} (gate: 1.15x)`);

  // Candle size gate
  if (candleAtrRatio > 1.15) { console.log(`${sym}: ❌ CANDLE GATE — oversized candle ${candleAtrRatio.toFixed(2)}x`); return; }

  // Value zone gate (LONG side)
  if (side === 'LONG') {
    const slack = mode.pullback.valueZoneSlack; // 0.008 for aggressive
    const zoneTop    = e20_15! * (1 + slack);
    const zoneBottom = e50_15! * (1 - slack);
    const inZone = low15 <= zoneTop && high15 >= zoneBottom;
    console.log(`${sym}: 📍 Zone check: low=${low15.toFixed(4)} zoneTop=${zoneTop.toFixed(4)} zoneBottom=${zoneBottom.toFixed(4)} inZone=${inZone}`);

    // EMA hold gate
    const heldAboveE20ByClose = close15 >= e20_15! * 1.001;
    console.log(`${sym}: 📌 EMA20 hold: close15=${close15.toFixed(4)} e20*1.001=${(e20_15! * 1.001).toFixed(4)} held=${heldAboveE20ByClose}`);
    
    if (!heldAboveE20ByClose) { console.log(`${sym}: ❌ EMA20 HOLD GATE — price below EMA20`); return; }
    if (!inZone) { console.log(`${sym}: ❌ VALUE ZONE GATE — price not in EMA zone`); return; }
  }
  console.log(`${sym}: ✅ All key gates passed — deeper gates (reversal, candle anatomy) must be rejecting`);
}

async function main() {
  const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'LINKUSDT', 'BNBUSDT'];
  for (const sym of symbols) {
    console.log(`\n${'─'.repeat(60)}`);
    await diagnose(sym);
    await new Promise(r => setTimeout(r, 300));
  }
}

main();
