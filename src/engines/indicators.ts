// ============================================
// Technical Indicators — Pure Functions
// ============================================

export function calcEMA(values: number[], period: number): (number | null)[] {
  const k = 2 / (period + 1);
  const ema: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return ema;

  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  ema[period - 1] = sum / period;

  for (let i = period; i < values.length; i++) {
    ema[i] = (values[i] - (ema[i - 1] as number)) * k + (ema[i - 1] as number);
  }
  return ema;
}

export function calcRSI(closes: number[], period: number = 14): (number | null)[] {
  const rsi: (number | null)[] = new Array(closes.length).fill(null);
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

    if (avgLoss === 0) rsi[i] = 100;
    else {
      const rs = avgGain / avgLoss;
      rsi[i] = 100 - (100 / (1 + rs));
    }
  }
  return rsi;
}

export function calcATR(highs: number[], lows: number[], closes: number[], period: number = 14): (number | null)[] {
  const atr: (number | null)[] = new Array(highs.length).fill(null);
  if (highs.length <= period) return atr;

  const tr: number[] = [];
  for (let i = 0; i < highs.length; i++) {
    if (i === 0) tr.push(highs[i] - lows[i]);
    else {
      const highLow = highs[i] - lows[i];
      const highClose = Math.abs(highs[i] - closes[i - 1]);
      const lowClose = Math.abs(lows[i] - closes[i - 1]);
      tr.push(Math.max(highLow, highClose, lowClose));
    }
  }

  let sumTR = 0;
  for (let i = 0; i < period; i++) sumTR += tr[i];
  let prevATR = sumTR / period;
  atr[period] = prevATR;

  for (let i = period + 1; i < tr.length; i++) {
    const currentATR = ((prevATR * (period - 1)) + tr[i]) / period;
    atr[i] = currentATR;
    prevATR = currentATR;
  }
  return atr;
}

export function calcSMA(values: number[], period: number = 20): (number | null)[] {
  const sma: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return sma;

  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) sma[i] = sum / period;
  }
  return sma;
}

// ─── MACD ─────────────────────────────────────────────────────────────────────
// Returns { macd, signal, histogram } arrays. Standard settings: 12, 26, 9
export function calcMACD(closes: number[], fast = 12, slow = 26, signal = 9): {
  macd: (number | null)[];
  signal: (number | null)[];
  histogram: (number | null)[];
} {
  const emaFast = calcEMA(closes, fast);
  const emaSlow = calcEMA(closes, slow);
  const macd: (number | null)[] = closes.map((_, i) => {
    if (emaFast[i] == null || emaSlow[i] == null) return null;
    return (emaFast[i] as number) - (emaSlow[i] as number);
  });

  // Signal line = EMA of MACD values (need valid macd values)
  const macdValues = macd.map(v => v ?? 0);
  const rawSignal = calcEMA(macdValues, signal);
  // We only want signal where macd was valid
  const signalLine: (number | null)[] = macd.map((v, i) =>
    v == null ? null : rawSignal[i]
  );
  const histogram: (number | null)[] = macd.map((v, i) =>
    v == null || signalLine[i] == null ? null : (v as number) - (signalLine[i] as number)
  );

  return { macd, signal: signalLine, histogram };
}

// ─── BOLLINGER BANDS ──────────────────────────────────────────────────────────
// Returns upper, middle (SMA), lower, and %B (position within bands)
export function calcBollingerBands(
  closes: number[],
  period = 20,
  stdDevMult = 2.0
): {
  upper: (number | null)[];
  middle: (number | null)[];
  lower: (number | null)[];
  percentB: (number | null)[];
  bandwidth: (number | null)[];
} {
  const middle = calcSMA(closes, period);
  const upper: (number | null)[] = closes.map(() => null);
  const lower: (number | null)[] = closes.map(() => null);
  const percentB: (number | null)[] = closes.map(() => null);
  const bandwidth: (number | null)[] = closes.map(() => null);

  for (let i = period - 1; i < closes.length; i++) {
    if (middle[i] == null) continue;
    const slice = closes.slice(i - period + 1, i + 1);
    const avg = middle[i] as number;
    const variance = slice.reduce((s, v) => s + (v - avg) ** 2, 0) / period;
    const stdDev = Math.sqrt(variance);
    upper[i] = avg + stdDevMult * stdDev;
    lower[i] = avg - stdDevMult * stdDev;
    const bw = (upper[i] as number) - (lower[i] as number);
    bandwidth[i] = bw / avg;
    // %B: 0 = at lower band, 1 = at upper band
    percentB[i] = bw > 0 ? (closes[i] - (lower[i] as number)) / bw : 0.5;
  }

  return { upper, middle, lower, percentB, bandwidth };
}

// ─── PIVOT DETECTOR ───────────────────────────────────────────────────────────
// Finds local high/low pivots over a look-left/look-right window
export function findPivots(
  highs: number[],
  lows: number[],
  window = 5
): { pivotHighs: { idx: number; price: number }[]; pivotLows: { idx: number; price: number }[] } {
  const pivotHighs: { idx: number; price: number }[] = [];
  const pivotLows: { idx: number; price: number }[] = [];

  for (let i = window; i < highs.length - window; i++) {
    const slice = highs.slice(i - window, i + window + 1);
    if (highs[i] === Math.max(...slice)) pivotHighs.push({ idx: i, price: highs[i] });
    const sliceL = lows.slice(i - window, i + window + 1);
    if (lows[i] === Math.min(...sliceL)) pivotLows.push({ idx: i, price: lows[i] });
  }
  return { pivotHighs, pivotLows };
}

// ─── DOUBLE TOP / DOUBLE BOTTOM DETECTOR ─────────────────────────────────────
// Looks at the last few pivots to find a classic W or M pattern
export function detectDoublePattern(
  highs: number[],
  lows: number[],
  closes: number[],
  tolerance = 0.012 // % price difference allowed between two highs/lows
): 'DOUBLE_TOP' | 'DOUBLE_BOTTOM' | null {
  const { pivotHighs, pivotLows } = findPivots(highs, lows, 5);

  // ── Double Top (M Shape): two recent pivot highs at similar level ──────────
  if (pivotHighs.length >= 2) {
    const last = pivotHighs[pivotHighs.length - 1];
    const prev = pivotHighs[pivotHighs.length - 2];
    const priceDiff = Math.abs(last.price - prev.price) / prev.price;
    const idxGap = last.idx - prev.idx;

    if (priceDiff <= tolerance && idxGap >= 5 && idxGap <= 60) {
      // Neckline: must be a pivot low between the two tops
      const neckLow = pivotLows.find(p => p.idx > prev.idx && p.idx < last.idx);
      if (neckLow) {
        const currentClose = closes[closes.length - 2];
        // Confirm: current price should be breaking below neckline
        if (currentClose < neckLow.price) return 'DOUBLE_TOP';
      }
    }
  }

  // ── Double Bottom (W Shape): two recent pivot lows at similar level ────────
  if (pivotLows.length >= 2) {
    const last = pivotLows[pivotLows.length - 1];
    const prev = pivotLows[pivotLows.length - 2];
    const priceDiff = Math.abs(last.price - prev.price) / prev.price;
    const idxGap = last.idx - prev.idx;

    if (priceDiff <= tolerance && idxGap >= 5 && idxGap <= 60) {
      // Neckline: must be a pivot high between the two bottoms
      const neckHigh = pivotHighs.find(p => p.idx > prev.idx && p.idx < last.idx);
      if (neckHigh) {
        const currentClose = closes[closes.length - 2];
        // Confirm: current price should be breaking above neckline
        if (currentClose > neckHigh.price) return 'DOUBLE_BOTTOM';
      }
    }
  }

  return null;
}
