// Standalone engine diagnostic — runs directly with: node debug_engine.mjs
// Tests AGGRESSIVE fast-path with real Binance data

function calcEMA(values, period) {
  const k = 2 / (period + 1);
  const ema = new Array(values.length).fill(null);
  if (values.length < period) return ema;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  ema[period - 1] = sum / period;
  for (let i = period; i < values.length; i++) {
    ema[i] = (values[i] - ema[i - 1]) * k + ema[i - 1];
  }
  return ema;
}

function calcRSI(closes, period = 14) {
  const rsi = new Array(closes.length).fill(null);
  if (closes.length <= period) return rsi;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  rsi[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = ((avgGain * (period - 1)) + gain) / period;
    avgLoss = ((avgLoss * (period - 1)) + loss) / period;
    rsi[i] = avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));
  }
  return rsi;
}

function calcATR(highs, lows, closes, period = 14) {
  const atr = new Array(highs.length).fill(null);
  if (highs.length <= period) return atr;
  const tr = [];
  for (let i = 0; i < highs.length; i++) {
    if (i === 0) tr.push(highs[i] - lows[i]);
    else {
      tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i-1]), Math.abs(lows[i] - closes[i-1])));
    }
  }
  let sumTR = 0;
  for (let i = 0; i < period; i++) sumTR += tr[i];
  let prevATR = sumTR / period;
  atr[period] = prevATR;
  for (let i = period + 1; i < tr.length; i++) {
    const cur = ((prevATR * (period - 1)) + tr[i]) / period;
    atr[i] = cur;
    prevATR = cur;
  }
  return atr;
}

function calcSMA(values, period = 20) {
  const sma = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) sma[i] = sum / period;
  }
  return sma;
}

async function fetchKlines(symbol, interval, limit = 110) {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed: ${res.status}`);
  const raw = await res.json();
  return raw.map(k => ({
    openTime: k[0], open: parseFloat(k[1]), high: parseFloat(k[2]),
    low: parseFloat(k[3]), close: parseFloat(k[4]), volume: parseFloat(k[5])
  }));
}

function testSniper(tf15m) {
  const closes15 = tf15m.map(c => c.close);
  const highs15 = tf15m.map(c => c.high);
  const lows15 = tf15m.map(c => c.low);
  const vols15 = tf15m.map(c => c.volume);
  const lastIdx = closes15.length - 2;

  const ema20_15 = calcEMA(closes15, 20);
  const rsi14_15 = calcRSI(closes15, 14);
  const atr14_15 = calcATR(highs15, lows15, closes15, 14);
  const volSMA_15 = calcSMA(vols15, 20);

  const close15 = closes15[lastIdx];
  const e20 = ema20_15[lastIdx];
  const rsiNow = rsi14_15[lastIdx];
  const rsiPrev = rsi14_15[lastIdx - 1];
  const atr = atr14_15[lastIdx];
  const volAvg = volSMA_15[lastIdx];
  const vol = vols15[lastIdx];

  if (e20 == null || rsiNow == null || rsiPrev == null || atr == null || !close15) {
    return { result: null, debug: 'INDICATORS_NULL' };
  }

  const volRatio = volAvg && volAvg > 0 ? vol / volAvg : 1;
  const isAboveEMA = close15 > e20;
  const rsiTurningUp = rsiNow > rsiPrev;

  const debug = { close15, e20, rsiNow, rsiPrev, isAboveEMA, rsiTurningUp, volRatio };

  if (isAboveEMA && rsiTurningUp && rsiNow < 70) {
    return { result: 'LONG_SIGNAL', debug };
  } else if (!isAboveEMA && !rsiTurningUp && rsiNow > 30) {
    return { result: 'SHORT_SIGNAL', debug };
  } else {
    return { result: null, reason: 'NO_MOMENTUM', debug };
  }
}

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'AVAXUSDT', 'LINKUSDT'];

console.log('🔍 Running engine diagnostic against live Binance data...\n');

let signalCount = 0;
for (const sym of SYMBOLS) {
  try {
    const tf15m = await fetchKlines(sym, '15m', 110);
    const { result, debug, reason } = testSniper(tf15m);
    if (result) {
      signalCount++;
      console.log(`✅ ${sym}: ${result} | RSI=${debug.rsiNow?.toFixed(1)} | EMA=${debug.e20?.toFixed(4)} | close=${debug.close15?.toFixed(4)} | volRatio=${debug.volRatio?.toFixed(2)}x`);
    } else {
      console.log(`❌ ${sym}: NO SIGNAL (${reason || 'FILT'}) | aboveEMA=${debug?.isAboveEMA} | rsiUp=${debug?.rsiTurningUp} | RSI=${debug?.rsiNow?.toFixed(1)}`);
    }
  } catch (e) {
    console.log(`🔥 ${sym}: FETCH ERROR — ${e.message}`);
  }
}

console.log(`\n📊 Result: ${signalCount}/${SYMBOLS.length} coins produced signals`);
if (signalCount === 0) {
  console.log('⚠️  ENGINE ITSELF PRODUCES ZERO SIGNALS — the engine logic is the bottleneck');
} else {
  console.log('✅ ENGINE IS WORKING — problem is in the app UI/store pipeline');
}
