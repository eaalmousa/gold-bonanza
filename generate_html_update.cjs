const fs = require('fs');

const fileIn = './gold_bonanza_v13_anti_short.html';
const fileOut = './GB_FINAL_ANTI_SHORT.html';

let html = fs.readFileSync(fileIn, 'utf8');

const newSniperSignal = `    function evaluateSniperSignal(tf1h, tf15m) {
  if (!tf1h || tf1h.length < 210 || !tf15m || tf15m.length < 90) return null;

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
  const ema20_15 = calcEMA(closes15, 20);
  const ema50_15 = calcEMA(closes15, 50);
  const rsi14_15 = calcRSI(closes15, 14);
  const atr14_15 = calcATR(highs15, lows15, closes15, 14);
  const volSMA20_15 = calcSMA(vols15, 20);

  const lastIdx = closes15.length - 2;
  if (lastIdx <= 60) return null;

  const candle = tf15m[lastIdx];
  const prev = tf15m[lastIdx - 1];
  const prev2 = tf15m[lastIdx - 2];

  const close15 = candle.close;
  const open15 = candle.open;
  const high15 = candle.high;
  const low15 = candle.low;

  const e20_15 = ema20_15[lastIdx];
  const e50_15 = ema50_15[lastIdx];
  const rsiNow = rsi14_15[lastIdx];
  const rsiPrev = rsi14_15[lastIdx - 1];
  const atr = atr14_15[lastIdx];
  const vol = vols15[lastIdx];
  const volAvg = volSMA20_15[lastIdx];

  const range = Math.max(1e-9, high15 - low15);
  const body = Math.abs(close15 - open15);

  const isUptrend = close1h > e200_1h && e20_1h > e50_1h && e50_1h > e200_1h;
  const isDowntrend = close1h < e200_1h && e20_1h < e50_1h && e50_1h < e200_1h;
  
  const side = isUptrend ? 'LONG' : (isDowntrend ? 'SHORT' : null);
  if (!side) return null;

  const cfg = ACTIVE_MODE.pullback;
  const slack = cfg.valueZoneSlack || 0.005;
  const reasons = [];
  let score = 0;

  if (side === 'LONG') {
    const isBullCandle = close15 > open15;
    const candleAtrRatio = range / atr;
    if (candleAtrRatio > 1.15) return null;

    const tradedIntoZone = (low15 <= e20_15 * (1 + slack)) && (high15 >= e50_15 * (1 - slack));
    const closesNearZone = (close15 <= e20_15 * (1 + slack)) && (close15 >= e50_15 * (1 - slack));
    if (!(tradedIntoZone && closesNearZone)) return null;
    reasons.push('Pullback into upper value zone (LONG)');

    if (!(rsiNow >= cfg.rsiMin && rsiNow <= cfg.rsiMax)) return null;
    score += 3;

    const bodyPct = (body / range) * 100;
    const closePos = (close15 - low15) / range;
    if (!(isBullCandle && bodyPct >= 55 && closePos >= 0.70)) return null;
    score += 4; reasons.push('Bullish confirmation');

    const confirmed = (close15 > prev.high) && (close15 >= e20_15 * 1.001);
    if (!confirmed) return null;

    if (score < Math.max(cfg.scoreMin, 11)) return null;

    const triggerBuffer = 0.0015;
    const triggerPrice = high15 * (1 + triggerBuffer);
    const stopLoss = Math.min(Math.min(low15, e50_15), triggerPrice - atr * 1.6);
    const stopDistance = Math.max(triggerPrice - stopLoss, triggerPrice * 0.0035);
    const takeProfit = triggerPrice + 2.5 * stopDistance;
    const balance = parseFloat(document.getElementById('balance')?.value || 300);
    const qty = (balance * ACTIVE_MODE.riskPct) / stopDistance;
    return { kind: 'SNIPER', side: 'LONG', score, reasons, entryPrice: triggerPrice, stopLoss, takeProfit, qty, sizeUSDT: qty * triggerPrice, atr15: atr, volRatio: vol/volAvg };
  } else {
    // ---- SHORT ANTI-EXHAUSTION LOGIC (BOUNCE-THEN-FAIL) ----
    const isBearCandle = close15 < open15;
    const candleAtrRatio = range / atr;
    
    // 1. Expansion Cap - prevent shorting the flush
    if (candleAtrRatio > 1.8) return null;

    // 2. Zone check - price must have bounced into / retested the EMAs upward
    const zoneTop = e50_15 * (1 + slack);
    const zoneBottom = e20_15 * (1 - slack);
    const inZone = high15 >= zoneBottom && low15 <= zoneTop;
    if (!inZone) return null;
    
    const extensionBelowZone = (e20_15 - close15) / atr;
    if (extensionBelowZone > 1.0) return null; // Stale

    // 3. RSI Exhaustion check (wait for bounce to exhaust)
    const rsiMaxShort = 100 - cfg.rsiMin;
    const rsiMinShort = Math.max(15, cfg.rsiMin);
    if (!(rsiNow >= rsiMinShort && rsiNow <= rsiMaxShort)) return null;
    if (!(rsiNow < rsiPrev && (rsiPrev - rsiNow) >= 0.7)) return null;
    score += 3; reasons.push('Bounce exhausted, RSI turning down');

    // 4. Structural Failure / Anatomy
    const bodyPct = (body / range) * 100;
    const closePos = (high15 - close15) / range;
    if (!(isBearCandle && bodyPct >= 55 && closePos >= 0.70)) return null;
    score += 4; reasons.push('Bearish confirmation candle');

    // Anti-bottom Proximity Check (Local Floor) prevent selling right at the swing low support
    const recentLows = lows15.slice(Math.max(0, lastIdx - 15), lastIdx);
    const localFloor = Math.min(...recentLows);
    const isBreakingFloor = close15 <= localFloor + (atr * 0.15);
    const cleanCloseBelow = close15 < localFloor;
    const followThrough = close15 < prev.close && isBearCandle;
    if (isBreakingFloor && (!cleanCloseBelow || !followThrough)) return null;

    // Reject bounce -> lower high confirming weakness
    const lowerHigh = (high15 < prev.high) && (close15 < e20_15);
    const upperWick = high15 - Math.max(open15, close15);
    const upperWickRatio = upperWick / Math.max(1e-9, body);
    const strongRejection = upperWickRatio >= 1.35;
    if (!(lowerHigh || strongRejection || cleanCloseBelow)) return null;
    reasons.push('Lower high / strong rejection confirms weakness');

    if (score < Math.max(cfg.scoreMin, 11)) return null;

    const triggerBuffer = 0.0015;
    const triggerPrice = low15 * (1 - triggerBuffer);
    const stopLoss = Math.max(Math.max(high15, e50_15), triggerPrice + atr * 1.6);
    const stopDistance = Math.max(stopLoss - triggerPrice, triggerPrice * 0.0035);
    const takeProfit = triggerPrice - 2.5 * stopDistance;
    const balance = parseFloat(document.getElementById('balance')?.value || 300);
    const qty = (balance * ACTIVE_MODE.riskPct) / stopDistance;
    return { kind: 'SNIPER', side: 'SHORT', score, reasons, entryPrice: triggerPrice, stopLoss, takeProfit, qty, sizeUSDT: qty * triggerPrice, atr15: atr, volRatio: vol/volAvg };
  }
}`;

const startIdx = html.indexOf('    function evaluateSniperSignal(tf1h, tf15m) {');
const endIdx = html.indexOf('function evaluateBreakoutSignal(tf1h, tf15m) {');

if (startIdx !== -1 && endIdx !== -1) {
  html = html.substring(0, startIdx) + newSniperSignal + '\n\n    ' + html.substring(endIdx);
  fs.writeFileSync(fileOut, html);
  console.log('HTML patch applied successfully');
} else {
  console.log('Error locating function');
}
