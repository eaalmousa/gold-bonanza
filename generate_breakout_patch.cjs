const fs = require('fs');

const fileOut = './GB_FINAL_ANTI_SHORT.html';
let html = fs.readFileSync(fileOut, 'utf8');

const newBreakoutSignal = `function evaluateBreakoutSignal(tf1h, tf15m) {
  if (!tf1h || tf1h.length < 210 || !tf15m || tf15m.length < 140) return null;

  const closes1h = tf1h.map(c => c.close);
  const ema20_1h = calcEMA(closes1h, 20);
  const ema50_1h = calcEMA(closes1h, 50);
  const ema200_1h = calcEMA(closes1h, 200);

  const idx1h = closes1h.length - 1;
  const close1h = closes1h[idx1h];
  const e20_1h = ema20_1h[idx1h];
  const e50_1h = ema50_1h[idx1h];
  const e200_1h = ema200_1h[idx1h];

  if ([e20_1h, e50_1h, e200_1h].some(v => v == null)) return null;

  const closes15 = tf15m.map(c => c.close);
  const highs15 = tf15m.map(c => c.high);
  const lows15 = tf15m.map(c => c.low);
  const vols15 = tf15m.map(c => c.volume);
  const rsi14_15 = calcRSI(closes15, 14);
  const atr14_15 = calcATR(highs15, lows15, closes15, 14);
  const volSMA20_15 = calcSMA(vols15, 20);

  const lastIdx = closes15.length - 2;
  if (lastIdx < 60) return null;

  const cfg = ACTIVE_MODE.breakout;
  const bars = cfg.coilBars;
  const start = lastIdx - bars;
  if (start < 0) return null;

  const atr = atr14_15[lastIdx];
  const c2 = tf15m[lastIdx];
  const range2 = Math.max(1e-9, c2.high - c2.low);
  const body2 = Math.abs(c2.close - c2.open);

  const isUptrend = close1h > e200_1h && e20_1h > e50_1h && e50_1h > e200_1h;
  const isDowntrend = close1h < e200_1h && e20_1h < e50_1h && e50_1h < e200_1h;

  const side = isUptrend ? 'LONG' : (isDowntrend ? 'SHORT' : null);
  if (!side) return null;

  const atrX = 0.35;
  let score = 0;
  const reasons = [];

  const coilHigh = Math.max(...highs15.slice(start, lastIdx + 1));
  const coilLow = Math.min(...lows15.slice(start, lastIdx + 1));

  if (side === 'LONG') {
    const dynBreak = Math.max(coilHigh * cfg.breakPct, atr * atrX);
    const breakLevel = coilHigh + dynBreak;

    const twoCloseConfirm = (c2.close > breakLevel) && (c2.close > c2.open) && ((body2/range2)*100 >= 62);
    if (!twoCloseConfirm) return null;

    const chasePct = ((c2.close - breakLevel) / breakLevel) * 100;
    if (chasePct > 0.85 || (c2.close - breakLevel) > atr * 0.60) return null; // Reject exhausted breakouts
    reasons.push('Breakout above compression confirmed');
    score += 12; // fast bypass

    const entryPrice = c2.close;
    const structureStop = coilLow * (1 - 0.003);
    const atrStop = entryPrice - atr * 2.0;
    const stopLoss = Math.min(structureStop, atrStop);
    const stopDistance = Math.max(entryPrice - stopLoss, entryPrice * 0.0038);
    const takeProfit = entryPrice + 2.7 * stopDistance;
    const balance = parseFloat(document.getElementById('balance')?.value || 300);
    const qty = (balance * ACTIVE_MODE.riskPct) / stopDistance;
    return { kind: 'SUPER_SNIPER', side: 'LONG', score, reasons, entryPrice, stopLoss, takeProfit, qty, sizeUSDT: qty * entryPrice, atr15: atr, volRatio: 2.0 };
  } else {
    // ---- SHORT ANTI-BOTTOM BREAKDOWN LOGIC ----
    const candleAtrRatio = range2 / atr;
    
    // Anti-Exhaustion Cap: Do not sell a massive breakdown flush candle
    if (candleAtrRatio > 1.8) return null;

    const dynBreakDown = Math.max(coilLow * cfg.breakPct, atr * atrX);
    const breakLevel = coilLow - dynBreakDown;

    const isBearCandle = c2.close < c2.open;
    const twoCloseConfirm = (c2.close < breakLevel) && isBearCandle && ((body2/range2)*100 >= 62);
    if (!twoCloseConfirm) return null;

    // Late Entry Blocker
    const chasePct = ((breakLevel - c2.close) / breakLevel) * 100;
    if (chasePct > 0.85 || (breakLevel - c2.close) > atr * 0.60) return null; // Bounce-then-fail strict entry
    reasons.push('Breakdown below compression without extreme exhaustion');
    score += 12;

    const entryPrice = c2.close;
    const structureStop = coilHigh * (1 + 0.003);
    const atrStop = entryPrice + atr * 2.0;
    const stopLoss = Math.max(structureStop, atrStop);
    const stopDistance = Math.max(stopLoss - entryPrice, entryPrice * 0.0038);
    const takeProfit = entryPrice - 2.7 * stopDistance;
    const balance = parseFloat(document.getElementById('balance')?.value || 300);
    const qty = (balance * ACTIVE_MODE.riskPct) / stopDistance;
    return { kind: 'SUPER_SNIPER', side: 'SHORT', score, reasons, entryPrice, stopLoss, takeProfit, qty, sizeUSDT: qty * entryPrice, atr15: atr, volRatio: 2.0 };
  }
}`;

const startIdx = html.indexOf('function evaluateBreakoutSignal(tf1h, tf15m) {');
const endIdx = html.indexOf('function renderMarketTable(rows) {') - 30; // Find the next function

if (startIdx !== -1 && endIdx !== -1) {
  html = html.substring(0, startIdx) + newBreakoutSignal + '\n\n    ' + html.substring(endIdx);
  fs.writeFileSync(fileOut, html);
  console.log('Breakout HTML patch applied successfully');
} else {
  console.log('Error locating function');
}
