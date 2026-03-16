// ============================================
// CurrencyAnalyzer — REAL 4H Predictive Engine
// Powered by live Binance klines + real indicators:
// EMA trend, RSI, MACD, Bollinger Bands, ATR,
// BTC macro regime, volume, and pattern detection.
// ============================================

import { useState, useEffect, useRef } from 'react';
import { useTradingStore } from '../store/tradingStore';
import { Search, Activity, TrendingUp, Crosshair, AlertTriangle, ChevronRight, CheckCircle, XCircle, Minus, Rocket, ListFilter, RefreshCw } from 'lucide-react';
import { calcEMA, calcRSI, calcATR, calcSMA, calcMACD, calcBollingerBands, detectDoublePattern } from '../engines/indicators';

// ─── Types ────────────────────────────────────────────────────────────────────
interface IndicatorCheck {
  name: string;
  value: string;
  verdict: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  weight: number; // How much this contributes to confidence
}

interface RealAnalysis {
  symbol: string;
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  confidence: number;
  expectedMovePct: number;
  volatilityPct: number;
  volatilityLabel: string;
  checks: IndicatorCheck[];
  narrative: string[];
  targets: { label: string; price: number; type: 'TP' | 'SL' | 'ENTRY' }[];
  analysisTime: string;
}

interface TopMover {
  symbol: string;
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  confidence: number;
  expectedMovePct: number;
  volatilityLabel: string;
  currentPrice: number;
}

// ─── Binance Kline Fetcher ─────────────────────────────────────────────────────
async function fetchKlines(symbol: string, interval: string, limit: number) {
  const timeout = new Promise<never>((_, r) => setTimeout(() => r(new Error('timeout')), 5000));
  const tryUrl = async (url: string) => {
    const res = await Promise.race([fetch(url), timeout]);
    if (!res.ok) throw new Error('bad response');
    const raw: any[][] = await res.json();
    return raw.map(k => ({
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));
  };
  // Race spot vs futures — return fastest
  return Promise.any([
    tryUrl(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`),
    tryUrl(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`),
  ]);
}

// ─── Top Movers Scan ──────────────────────────────────────────────────────────
const TOP_MOVERS_UNIVERSE = [
  'BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT',
  'AVAXUSDT','LINKUSDT','ARBUSDT','OPUSDT','NEARUSDT',
  'INJUSDT','SUIUSDT','APTUSDT','LTCUSDT','DOGEUSDT',
  'DOTUSDT','ADAUSDT','ATOMUSDT','MATICUSDT','FTMUSDT',
  'RNDRUSDT','TIAUSDT','SEIUSDT','LDOUSDT','ORDIUSDT',
  'TRXUSDT','GALAUSDT','SANDUSDT','MANAUSDT','FILUSDT',
  '1000PEPEUSDT','WIFUSDT','BONKUSDT','FETUSDT','TAOUSDT',
  'ENAUSDT','JUPUSDT','STXUSDT','ARUSDT','AAVEUSDT',
];

async function runLightweightAnalysis(symbol: string, btc4h: any[]): Promise<TopMover | null> {
  try {
    const klines4h = await fetchKlines(symbol, '4h', 120);
    if (klines4h.length < 50) return null;
    const closes4h = klines4h.map(k => k.close);
    const highs4h  = klines4h.map(k => k.high);
    const lows4h   = klines4h.map(k => k.low);
    const vols4h   = klines4h.map(k => k.volume);
    const last = closes4h.length - 2;
    const currentPrice = closes4h[closes4h.length - 1];
    const ema20  = calcEMA(closes4h, 20);
    const ema50  = calcEMA(closes4h, 50);
    const ema200 = calcEMA(closes4h, 200);
    const rsi14  = calcRSI(closes4h, 14);
    const atr14  = calcATR(highs4h, lows4h, closes4h, 14);
    const macd   = calcMACD(closes4h);
    const bb     = calcBollingerBands(closes4h, 20, 2.0);
    const volSMA = calcSMA(vols4h, 20);
    const closeBtc = btc4h.map(k => k.close);
    const btcEma20 = calcEMA(closeBtc, 20);
    const btcEma50 = calcEMA(closeBtc, 50);
    const btcLast  = closeBtc.length - 2;
    const btcUp   = (btcEma20[btcLast]??0) > (btcEma50[btcLast]??0) && closeBtc[btcLast] > (btcEma20[btcLast]??0);
    const btcDown = (btcEma20[btcLast]??0) < (btcEma50[btcLast]??0) && closeBtc[btcLast] < (btcEma20[btcLast]??0);
    const e20 = ema20[last]??currentPrice, e50 = ema50[last]??currentPrice, e200 = ema200[last]??currentPrice;
    const rsi = rsi14[last]??50;
    const atr = atr14[last]??currentPrice*0.02;
    const vol = vols4h[last]; const avgVol = volSMA[last]??vol;
    const macdHist = macd.histogram[last]; const macdHistPrev = macd.histogram[last-1];
    const pctB = bb.percentB[last];
    let bull=0, bear=0, total=0;
    // EMA (w3)
    total+=3; if(currentPrice>e20&&currentPrice>e50&&currentPrice>e200) bull+=3;
              else if(currentPrice<e20&&currentPrice<e50&&currentPrice<e200) bear+=3;
    // RSI (w2)
    total+=2; if(rsi>60) bull+=2; else if(rsi<40) bear+=2;
    // MACD (w2)
    const mt = macdHist!=null&&macdHistPrev!=null?macdHist>macdHistPrev:null;
    total+=2; if(macdHist!=null&&macdHist>0&&mt) bull+=2; else if(macdHist!=null&&macdHist<0&&!mt) bear+=2;
    // BB (w2)
    total+=2; if(pctB!=null&&pctB<0.20) bull+=2; else if(pctB!=null&&pctB>0.80) bear+=2;
    // Volume (w1)
    const volRatio = avgVol>0?vol/avgVol:1;
    total+=1; if(volRatio>1.3) { if(currentPrice>e20) bull+=1; else bear+=1; }
    // BTC (w2)
    total+=2; if(btcUp) bull+=2; else if(btcDown) bear+=2;
    const bias = bull-bear;
    const direction: 'LONG'|'SHORT'|'NEUTRAL' = bias>2?'LONG':bias<-2?'SHORT':'NEUTRAL';
    if(direction==='NEUTRAL') return null; // skip neutral — not interesting for ranking
    const dirScore = direction==='LONG'?bull:bear;
    const rawConf  = total>0?(dirScore/total)*100:50;
    const confidence = Math.min(95,Math.max(50,Math.round(rawConf)));
    const atrPct = (atr/currentPrice)*100;
    const expectedMovePct = parseFloat((atrPct*2.5).toFixed(2));
    const volatilityLabel = atrPct>3?'HIGH':atrPct>1.5?'MODERATE':'LOW';
    return { symbol, direction, confidence, expectedMovePct, volatilityLabel, currentPrice };
  } catch { return null; }
}

// ─── Main Analysis Engine ──────────────────────────────────────────────────────
async function runRealAnalysis(symbol: string): Promise<RealAnalysis> {
  const sym = symbol.trim().toUpperCase();
  if (!sym.endsWith('USDT')) throw new Error('Please enter a USDT pair (e.g., BTCUSDT)');

  // Fetch 4H and 1H data simultaneously
  const [klines4h, klines1h, btc4h] = await Promise.all([
    fetchKlines(sym, '4h', 200),
    fetchKlines(sym, '1h', 200),
    fetchKlines('BTCUSDT', '4h', 100),
  ]);

  if (klines4h.length < 50) throw new Error('Insufficient kline data returned');

  // ─── Raw arrays ─────────────────────────────────────────────────
  const closes4h = klines4h.map(k => k.close);
  const highs4h  = klines4h.map(k => k.high);
  const lows4h   = klines4h.map(k => k.low);
  const vols4h   = klines4h.map(k => k.volume);

  const closes1h = klines1h.map(k => k.close);
  const closeBtc = btc4h.map(k => k.close);

  const last = closes4h.length - 2; // Use the last completed candle
  const currentPrice = closes4h[closes4h.length - 1]; // Current (forming) price

  // ─── Calculate all indicators ────────────────────────────────────
  const ema20   = calcEMA(closes4h, 20);
  const ema50   = calcEMA(closes4h, 50);
  const ema200  = calcEMA(closes4h, 200);
  const rsi14   = calcRSI(closes4h, 14);
  const atr14   = calcATR(highs4h, lows4h, closes4h, 14);
  const volSMA  = calcSMA(vols4h, 20);
  const macd    = calcMACD(closes4h);
  const bb      = calcBollingerBands(closes4h, 20, 2.0);
  const pattern = detectDoublePattern(highs4h, lows4h, closes4h, 0.02);

  // BTC macro trend
  const btcEma20 = calcEMA(closeBtc, 20);
  const btcEma50 = calcEMA(closeBtc, 50);
  const btcLast = closeBtc.length - 2;
  const btcTrendUp = (btcEma20[btcLast] ?? 0) > (btcEma50[btcLast] ?? 0) &&
                     closeBtc[btcLast] > (btcEma20[btcLast] ?? 0);
  const btcTrendDown = (btcEma20[btcLast] ?? 0) < (btcEma50[btcLast] ?? 0) &&
                       closeBtc[btcLast] < (btcEma20[btcLast] ?? 0);

  const e20  = ema20[last]  ?? currentPrice;
  const e50  = ema50[last]  ?? currentPrice;
  const e200 = ema200[last] ?? currentPrice;
  const rsi  = rsi14[last]  ?? 50;
  const atr  = atr14[last]  ?? currentPrice * 0.02;
  const vol  = vols4h[last];
  const avgVol = volSMA[last] ?? vol;
  const macdHist     = macd.histogram[last];
  const macdHistPrev = macd.histogram[last - 1];
  const pctB = bb.percentB[last];
  const bbBand = bb.bandwidth[last];
  const closes1hSlice = closes1h.slice(-24);
  const ema20_1h = calcEMA(closes1h, 20);
  const e20_1h = ema20_1h[closes1h.length - 2] ?? currentPrice;

  // ─── Indicator Scorecard ─────────────────────────────────────────
  const checks: IndicatorCheck[] = [];

  // 1. EMA Trend Alignment (weight 3)
  const aboveE20  = currentPrice > e20;
  const aboveE50  = currentPrice > e50;
  const aboveE200 = currentPrice > e200;
  const emaAlignedBull = aboveE20 && aboveE50 && aboveE200;
  const emaAlignedBear = !aboveE20 && !aboveE50 && !aboveE200;
  checks.push({
    name: 'EMA Trend (20/50/200)',
    value: emaAlignedBull ? 'Price above all EMAs' : emaAlignedBear ? 'Price below all EMAs' : `Mixed — above E${aboveE200 ? '200' : ''}${aboveE50 ? '50' : ''}, below E${!aboveE20 ? '20' : ''}${!aboveE50 ? '50' : ''}`.replace(/E,/, 'E'),
    verdict: emaAlignedBull ? 'BULLISH' : emaAlignedBear ? 'BEARISH' : 'NEUTRAL',
    weight: 3,
  });

  // 2. RSI (weight 2)
  const rsiFixed = rsi.toFixed(1);
  checks.push({
    name: 'RSI (14)',
    value: `${rsiFixed} — ${rsi > 70 ? 'Overbought' : rsi < 30 ? 'Oversold' : rsi > 55 ? 'Bullish zone' : rsi < 45 ? 'Bearish zone' : 'Neutral'}`,
    verdict: rsi > 60 ? 'BULLISH' : rsi < 40 ? 'BEARISH' : 'NEUTRAL',
    weight: 2,
  });

  // 3. MACD Histogram (weight 2)
  const macdTrending = macdHist != null && macdHistPrev != null ? macdHist > macdHistPrev : null;
  checks.push({
    name: 'MACD Histogram',
    value: macdHist != null
      ? `${macdHist > 0 ? '+' : ''}${macdHist.toFixed(4)} (${macdTrending ? 'expanding' : 'contracting'})`
      : 'Insufficient data',
    verdict: macdHist != null
      ? (macdHist > 0 && macdTrending ? 'BULLISH' : macdHist < 0 && !macdTrending ? 'BEARISH' : 'NEUTRAL')
      : 'NEUTRAL',
    weight: 2,
  });

  // 4. Bollinger Bands (weight 2)
  const bbVerdict = pctB != null
    ? (pctB > 0.80 ? 'BEARISH' : pctB < 0.20 ? 'BULLISH' : 'NEUTRAL')
    : 'NEUTRAL';
  checks.push({
    name: 'Bollinger Bands (%B)',
    value: pctB != null
      ? `${(pctB * 100).toFixed(0)}% — ${pctB > 0.80 ? 'Upper band (overextended)' : pctB < 0.20 ? 'Lower band (oversold)' : 'Inside bands'}`
      : 'N/A',
    verdict: bbVerdict,
    weight: 2,
  });

  // 5. Volume (weight 1)
  const volRatio = avgVol > 0 ? vol / avgVol : 1;
  checks.push({
    name: 'Volume Confirmation',
    value: `${volRatio.toFixed(2)}× avg — ${volRatio > 1.5 ? 'Strong' : volRatio > 1.0 ? 'Above average' : 'Below average'}`,
    verdict: volRatio > 1.3 ? (aboveE20 ? 'BULLISH' : 'BEARISH') : 'NEUTRAL',
    weight: 1,
  });

  // 6. BTC Macro Trend (weight 2)
  checks.push({
    name: 'BTC 4H Macro Trend',
    value: btcTrendUp ? 'Uptrend — EMA aligned bullish' : btcTrendDown ? 'Downtrend — EMA aligned bearish' : 'Ranging — no clear direction',
    verdict: btcTrendUp ? 'BULLISH' : btcTrendDown ? 'BEARISH' : 'NEUTRAL',
    weight: 2,
  });

  // 7. 1H Structure (weight 1)
  const price1h = closes1h[closes1h.length - 1];
  const trend1h = closes1hSlice[closes1hSlice.length - 1] > closes1hSlice[0];
  checks.push({
    name: '1H Price Structure',
    value: `Last 24 candles ${trend1h ? '↑ trending up' : '↓ trending down'} | vs EMA20: ${price1h > e20_1h ? '+' : ''}${(((price1h - e20_1h) / e20_1h) * 100).toFixed(2)}%`,
    verdict: trend1h ? 'BULLISH' : 'BEARISH',
    weight: 1,
  });

  // 8. Chart Pattern (weight 3 if found)
  if (pattern) {
    checks.push({
      name: 'Chart Pattern',
      value: pattern === 'DOUBLE_BOTTOM' ? 'Double Bottom (W) — neckline breakout confirmed' : 'Double Top (M) — neckline breakdown confirmed',
      verdict: pattern === 'DOUBLE_BOTTOM' ? 'BULLISH' : 'BEARISH',
      weight: 3,
    });
  }

  // ─── Score & Direction ───────────────────────────────────────────
  let bullScore = 0, bearScore = 0, totalWeight = 0;
  for (const c of checks) {
    totalWeight += c.weight;
    if (c.verdict === 'BULLISH') bullScore += c.weight;
    if (c.verdict === 'BEARISH') bearScore += c.weight;
  }

  const bias = bullScore - bearScore;
  const direction: 'LONG' | 'SHORT' | 'NEUTRAL' =
    bias >  2 ? 'LONG'  :
    bias < -2 ? 'SHORT' : 'NEUTRAL';

  // Confidence: percentage of maximum possible weight aligned with direction
  const dirScore = direction === 'LONG' ? bullScore : direction === 'SHORT' ? bearScore : Math.max(bullScore, bearScore);
  const rawConf = totalWeight > 0 ? (dirScore / totalWeight) * 100 : 50;
  // Normalize to 50-95% range (never claim 100% certainty on markets)
  const confidence = Math.min(95, Math.max(50, Math.round(rawConf)));

  // ATR-based expected move and targets
  const atrPct = (atr / currentPrice) * 100;
  // 4H ATR pct * 2.5 candles forward = expected 10H move
  const expectedMovePct = parseFloat((atrPct * 2.5).toFixed(2));

  const volatilityLabel = atrPct > 3 ? 'HIGH' : atrPct > 1.5 ? 'MODERATE' : 'LOW';

  // Real price levels based on ATR
  const tp1 = direction === 'LONG'
    ? currentPrice + 1.25 * atr
    : currentPrice - 1.25 * atr;
  const tp2 = direction === 'LONG'
    ? currentPrice + 2.5 * atr
    : currentPrice - 2.5 * atr;
  const slLevel = direction === 'LONG'
    ? currentPrice - 1.2 * atr
    : currentPrice + 1.2 * atr;

  // ─── Real Narrative Logs ─────────────────────────────────────────
  const narrative: string[] = [];

  // RSI narrative
  if (rsi > 65)       narrative.push(`RSI at ${rsiFixed} — momentum overextended, pullback risk elevated.`);
  else if (rsi < 35)  narrative.push(`RSI at ${rsiFixed} — deep oversold conditions, reversal probability increasing.`);
  else if (rsi > 55)  narrative.push(`RSI at ${rsiFixed} — momentum building in bullish zone.`);
  else                narrative.push(`RSI at ${rsiFixed} — neutral momentum, no directional extremes.`);

  // MACD narrative
  if (macdHist != null) {
    if (macdHist > 0 && macdTrending)         narrative.push(`MACD histogram expanding positively (${macdHist.toFixed(4)}) — bullish momentum accelerating.`);
    else if (macdHist < 0 && !macdTrending)   narrative.push(`MACD histogram contracting negatively (${macdHist.toFixed(4)}) — bearish momentum building.`);
    else if (macdHist > 0 && !macdTrending)   narrative.push(`MACD histogram turning down from positive — bullish momentum fading, watch for reversal.`);
    else                                       narrative.push(`MACD histogram rising from negative — early bullish divergence forming.`);
  }

  // Bollinger Bands narrative
  if (pctB != null) {
    if (pctB > 0.82)  narrative.push(`Price at ${(pctB*100).toFixed(0)}%B — sitting at upper Bollinger Band, statistically overextended short-term.`);
    else if (pctB < 0.18) narrative.push(`Price at ${(pctB*100).toFixed(0)}%B — touching lower Bollinger Band, mean-reversion probability elevated.`);
    if (bbBand != null && bbBand < 0.03) narrative.push(`Bollinger Band width at ${(bbBand*100).toFixed(1)}% — extreme compression detected, high-volatility breakout imminent.`);
  }

  // BTC regime narrative
  if (btcTrendUp)   narrative.push(`BTC 4H macro trending UP — broad market tailwind supports long bias.`);
  else if (btcTrendDown) narrative.push(`BTC 4H macro trending DOWN — broad market headwind suppresses rallies.`);

  // ATR/volatility narrative
  narrative.push(`4H ATR: ${atr.toFixed(4)} (${atrPct.toFixed(2)}% of price) — ${volatilityLabel} volatility. Expected range: ±${expectedMovePct.toFixed(2)}% over next 10H.`);

  // Pattern narrative
  if (pattern === 'DOUBLE_BOTTOM') narrative.push(`Double Bottom (W) pattern confirmed on 4H — neckline breakout signals trend reversal to upside.`);
  if (pattern === 'DOUBLE_TOP')    narrative.push(`Double Top (M) pattern confirmed on 4H — neckline breakdown signals trend reversal to downside.`);



  return {
    symbol: sym,
    direction,
    confidence,
    expectedMovePct,
    volatilityPct: parseFloat(atrPct.toFixed(2)),
    volatilityLabel,
    checks,
    narrative: narrative.slice(0, 5), // Cap at 5 bullet points
    targets: [
      { label: 'Current Price',   price: currentPrice, type: 'ENTRY' },
      { label: 'Target 1 (1.25R)', price: tp1, type: 'TP' },
      { label: 'Target 2 (2.5R)',  price: tp2, type: 'TP' },
      { label: 'Invalidation (SL)', price: slLevel, type: 'SL' },
    ],
    analysisTime: new Date().toLocaleTimeString(),
  };
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function CurrencyAnalyzer() {
  const { deploySignal } = useTradingStore();
  const [query, setQuery] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<RealAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [topMovers, setTopMovers] = useState<TopMover[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const scanRef = useRef(false);

  // Auto-scan top movers on mount, refresh every 5 minutes
  useEffect(() => {
    runTopScan();
    const id = setInterval(runTopScan, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  async function runTopScan() {
    if (scanRef.current) return;
    scanRef.current = true;
    setIsScanning(true);
    try {
      // Fetch BTC once to save 39 API calls and avoid instant rate limits
      const btc4h = await fetchKlines('BTCUSDT', '4h', 60);

      // Stagger requests in mini-batches of 5 to avoid rate limits
      const results: TopMover[] = [];
      for (let i = 0; i < TOP_MOVERS_UNIVERSE.length; i += 5) {
        const batch = TOP_MOVERS_UNIVERSE.slice(i, i + 5);
        const settled = await Promise.allSettled(batch.map(sym => runLightweightAnalysis(sym, btc4h)));
        settled.forEach(r => { if (r.status === 'fulfilled' && r.value) results.push(r.value); });
        await new Promise(res => setTimeout(res, 400));
      }
      results.sort((a, b) => b.confidence - a.confidence);
      setTopMovers(results.slice(0, 15));
      setLastScanned(new Date().toLocaleTimeString());
    } finally {
      scanRef.current = false;
      setIsScanning(false);
    }
  }

  const handleDeploy = () => {
    if (!result) return;
    const entry = result.targets.find(t => t.type === 'ENTRY')?.price || 0;
    const t1 = result.targets.find(t => t.label.includes('Target 1'))?.price || 0;
    const t2 = result.targets.find(t => t.label.includes('Target 2'))?.price || 0;
    const sl = result.targets.find(t => t.type === 'SL')?.price || 0;

    deploySignal({
      kind: 'MACD_PREDICTIVE',
      side: result.direction,
      entryPrice: entry,
      qty: 1, // Will be scaled by balance
      sizeUSDT: 100,
      takeProfit: t1,
      takeProfit2: t2,
      stopLoss: sl,
      leverage: 10,
    }, result.symbol);
  };

  const handleAnalyze = async () => {
    if (!query.trim()) return;
    setIsAnalyzing(true);
    setResult(null);
    setError(null);
    try {
      const analysis = await runRealAnalysis(query.trim());
      setResult(analysis);
    } catch (e: any) {
      setError(e.message || 'Analysis failed. Check symbol and try again.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const isLong    = result?.direction === 'LONG';
  const isShort   = result?.direction === 'SHORT';
  const dirColor  = isLong ? 'var(--green)' : isShort ? 'var(--red)' : 'var(--gold)';
  const dirSoft   = isLong ? 'var(--green-soft)' : isShort ? 'var(--red-soft)' : 'rgba(212,175,55,0.1)';

  const verdictIcon = (v: IndicatorCheck['verdict']) =>
    v === 'BULLISH' ? <CheckCircle size={12} color="#22c55e" /> :
    v === 'BEARISH' ? <XCircle size={12} color="#ef4444" /> :
    <Minus size={12} color="rgba(255,255,255,0.3)" />;

  return (
    <section>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:20, paddingBottom:12, borderBottom:'1px solid rgba(212,175,55,0.1)' }}>
        <Activity size={20} color="var(--gold)" />
        <div>
          <div style={{ fontSize:12, fontWeight:900, letterSpacing:'0.2em', color:'var(--gold-light)' }}>
            PREDICTIVE ENGINE (4H FORECAST)
          </div>
          <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:2 }}>
            Real-time: EMA Trend · RSI · MACD · Bollinger Bands · ATR · BTC Regime · Pattern Detection
          </div>
        </div>
      </div>

      {/* Search Row */}
      <div style={{ display:'flex', gap:16, marginBottom:24, flexWrap:'wrap' }}>
        <div style={{
          position:'relative', flex:1, minWidth:200,
          background:'rgba(0,0,0,0.4)', border:'1px solid var(--border-subtle)',
          borderRadius:'var(--radius-lg)', display:'flex', alignItems:'center', padding:'0 16px'
        }}>
          <Search size={16} color="var(--text-muted)" style={{ flexShrink:0 }} />
          <input
            type="text" placeholder="Enter pair (e.g. BTCUSDT, ETHUSDT)…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAnalyze()}
            style={{
              background:'transparent', border:'none', outline:'none',
              color:'var(--text-primary)', padding:'16px',
              fontFamily:'JetBrains Mono, monospace', fontSize:14, fontWeight:600, width:'100%'
            }}
          />
        </div>
        <button
          className="premium-btn"
          onClick={handleAnalyze}
          disabled={!query || isAnalyzing}
          style={{ padding:'0 32px', display:'flex', alignItems:'center', gap:10, opacity:(!query||isAnalyzing)?0.5:1, height:'54px' }}
        >
          {isAnalyzing ? (
            <><div style={{ animation:'spin 1s linear infinite' }}><Crosshair size={16}/></div><span>ANALYZING…</span></>
          ) : (
            <><TrendingUp size={16}/><span>RUN ANALYSIS</span></>
          )}
        </button>
      </div>

      {/* Loading */}
      {isAnalyzing && (
        <div style={{ padding:'40px 20px', textAlign:'center', background:'rgba(0,0,0,0.3)', borderRadius:'var(--radius-lg)', border:'1px dashed rgba(212,175,55,0.2)' }}>
          <Activity className="animate-pulse-gold" size={32} color="var(--gold)" style={{ margin:'0 auto 16px' }} />
          <div className="font-mono" style={{ fontSize:12, color:'var(--gold-light)', letterSpacing:'0.1em' }}>
            FETCHING LIVE 4H + 1H + BTC REGIME DATA…
          </div>
          <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:8 }}>
            Computing real indicators for {query.toUpperCase().trim()}
          </div>
        </div>
      )}

      {/* Error */}
      {error && !isAnalyzing && (
        <div style={{ padding:'20px', background:'rgba(239,68,68,0.07)', borderRadius:'var(--radius-lg)', border:'1px solid rgba(239,68,68,0.2)', color:'#ef4444', fontSize:13 }}>
          ⚠ {error}
        </div>
      )}

      {/* Result */}
      {result && !isAnalyzing && (
        <div className="opportunity-card card-entry" style={{ padding:'24px', position:'relative', overflow:'hidden' }}>
          {/* Top accent bar */}
          <div style={{ position:'absolute', top:0, left:0, right:0, height:3, background:dirColor, boxShadow:`0 0 20px ${dirColor}66` }} />

          <div style={{ display:'flex', flexWrap:'wrap', gap:28, alignItems:'flex-start' }}>

            {/* ─── Left: Summary + Indicators ─── */}
            <div style={{ flex:'1 1 300px' }}>
              {/* Direction badge */}
              <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:20 }}>
                <div style={{ padding:'8px 16px', borderRadius:'var(--radius-full)', background:dirSoft, color:dirColor, fontWeight:900, fontSize:13, letterSpacing:'0.2em' }}>
                  {result.direction} PREDICTION
                </div>
                <div className="font-mono" style={{ fontSize:16, fontWeight:900 }}>{result.symbol}</div>
                <button
                  className="premium-btn"
                  onClick={handleDeploy}
                  style={{
                    padding:'6px 14px', height:'auto', fontSize:10, marginLeft:12,
                    display:'flex', alignItems:'center', gap:6, background: 'rgba(212,175,55,0.1)',
                    border: '1px solid rgba(212,175,55,0.3)', color: 'var(--gold)'
                  }}
                >
                  <Rocket size={12} />
                  QUICK DEPLOY
                </button>
                <div style={{ fontSize:10, color:'rgba(255,255,255,0.25)', marginLeft:'auto' }}>
                  ⏱ {result.analysisTime}
                </div>
              </div>

              {/* Metrics row */}
              <div style={{ display:'flex', gap:20, marginBottom:20, flexWrap:'wrap' }}>
                {[
                  { label:'CONFIDENCE',   val:`${result.confidence}%`,              color:'var(--gold)' },
                  { label:'EXP. MOVE',    val:`±${result.expectedMovePct.toFixed(2)}%`, color:'var(--text-primary)' },
                  { label:'4H ATR',       val:`${result.volatilityPct.toFixed(2)}%`,    color:'var(--text-primary)' },
                  { label:'VOLATILITY',   val:result.volatilityLabel,              color: result.volatilityLabel === 'HIGH' ? '#ef4444' : result.volatilityLabel === 'MODERATE' ? '#f59e0b' : '#22c55e' },
                ].map(m => (
                  <div key={m.label}>
                    <div style={{ fontSize:9, color:'var(--text-muted)', letterSpacing:'0.1em', marginBottom:4 }}>{m.label}</div>
                    <div className="font-mono" style={{ fontSize:18, fontWeight:900, color:m.color }}>{m.val}</div>
                  </div>
                ))}
              </div>

              {/* Indicator scorecard */}
              <div style={{ fontSize:10, color:'var(--gold-light)', fontWeight:900, letterSpacing:'0.15em', marginBottom:10 }}>
                INDICATOR SCORECARD
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:6, marginBottom:20 }}>
                {result.checks.map((c, i) => (
                  <div key={i} style={{
                    display:'flex', alignItems:'center', gap:10,
                    padding:'9px 12px', borderRadius:8,
                    background: c.verdict === 'BULLISH' ? 'rgba(34,197,94,0.06)' : c.verdict === 'BEARISH' ? 'rgba(239,68,68,0.06)' : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${c.verdict === 'BULLISH' ? 'rgba(34,197,94,0.15)' : c.verdict === 'BEARISH' ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.06)'}`,
                  }}>
                    {verdictIcon(c.verdict)}
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:10, fontWeight:800, color:'var(--text-secondary)', letterSpacing:'.05em' }}>{c.name}</div>
                      <div style={{ fontSize:9, color:'var(--text-muted)', marginTop:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{c.value}</div>
                    </div>
                    <div style={{ fontSize:9, fontWeight:900, letterSpacing:'.08em',
                      color: c.verdict === 'BULLISH' ? '#22c55e' : c.verdict === 'BEARISH' ? '#ef4444' : 'rgba(255,255,255,0.25)'
                    }}>{c.verdict}</div>
                  </div>
                ))}
              </div>

              {/* Narrative log */}
              <div style={{ fontSize:10, color:'var(--gold-light)', fontWeight:900, letterSpacing:'0.15em', marginBottom:10 }}>
                ANALYSIS LOG
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:7 }}>
                {result.narrative.map((note, i) => (
                  <div key={i} style={{ display:'flex', gap:8, alignItems:'flex-start' }}>
                    <ChevronRight size={13} color="var(--gold)" style={{ flexShrink:0, marginTop:2 }} />
                    <div style={{ fontSize:11, color:'var(--text-secondary)', lineHeight:1.5 }}>{note}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* ─── Right: Price Levels ─── */}
            <div style={{ flex:'0 1 240px', background:'rgba(0,0,0,0.4)', borderRadius:'var(--radius-lg)', padding:'20px', border:'1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ fontSize:10, color:'var(--gold-light)', fontWeight:900, letterSpacing:'0.2em', marginBottom:16 }}>
                4H PROJECTED LEVELS
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                {result.targets.map((t, idx) => (
                  <div key={idx} style={{
                    display:'flex', justifyContent:'space-between', alignItems:'center',
                    padding:'12px 14px', background:'rgba(255,255,255,0.03)',
                    borderRadius:'var(--radius-sm)',
                    borderLeft: `3px solid ${t.type === 'TP' ? 'var(--green)' : t.type === 'SL' ? 'var(--red)' : 'var(--blue)'}`,
                  }}>
                    <div style={{ fontSize:10, color:'var(--text-secondary)', fontWeight:700, letterSpacing:'0.08em' }}>{t.label}</div>
                    <div className="font-mono" style={{ fontSize:13, fontWeight:900, color:'var(--text-primary)' }}>
                      {t.price >= 100 ? t.price.toFixed(2) : t.price >= 1 ? t.price.toFixed(4) : t.price.toFixed(6)}
                    </div>
                  </div>
                ))}
              </div>

              {/* Confidence bar */}
              <div style={{ marginTop:18 }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6 }}>
                  <span style={{ fontSize:9, color:'var(--text-muted)', letterSpacing:'0.1em' }}>SIGNAL STRENGTH</span>
                  <span style={{ fontSize:9, fontWeight:900, color: result.confidence >= 75 ? '#22c55e' : result.confidence >= 60 ? '#f59e0b' : '#ef4444' }}>
                    {result.confidence >= 75 ? 'STRONG' : result.confidence >= 65 ? 'MODERATE' : 'WEAK'}
                  </span>
                </div>
                <div style={{ height:6, background:'rgba(255,255,255,0.06)', borderRadius:3, overflow:'hidden' }}>
                  <div style={{
                    height:'100%', borderRadius:3,
                    width:`${result.confidence}%`,
                    background: result.confidence >= 75 ? 'linear-gradient(90deg,#22c55e,#4ade80)' : result.confidence >= 65 ? 'linear-gradient(90deg,#f59e0b,#fcd34d)' : 'linear-gradient(90deg,#ef4444,#f87171)',
                    transition:'width 0.8s ease',
                  }} />
                </div>
                <div style={{ display:'flex', justifyContent:'space-between', marginTop:4 }}>
                  <span style={{ fontSize:8, color:'rgba(255,255,255,0.2)' }}>WEAK (50%)</span>
                  <span style={{ fontSize:8, color:'rgba(255,255,255,0.2)' }}>STRONG (95%)</span>
                </div>
              </div>

              <div style={{ marginTop:16, padding:'10px 12px', background:'rgba(212,175,55,0.05)', borderRadius:8, display:'flex', alignItems:'flex-start', gap:8, fontSize:9, color:'var(--text-muted)' }}>
                <AlertTriangle size={13} color="var(--gold)" style={{ flexShrink:0 }} />
                <span style={{ lineHeight:1.5 }}>Based on real Binance data: EMA, RSI, MACD, Bollinger Bands, ATR, BTC regime. Not financial advice.</span>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* ─── Top 15 Predicted Movers Panel ─── */}
      <div style={{ marginTop: 32 }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 16, paddingBottom: 12,
          borderBottom: '1px solid rgba(212,175,55,0.12)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <ListFilter size={16} color="var(--gold)" />
            <div>
              <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: '0.18em', color: 'var(--gold-light)' }}>
                TOP 15 PREDICTED MOVERS
              </div>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>
                Live 4H indicator scan · {lastScanned ? `Last: ${lastScanned}` : 'Scanning universe…'}
              </div>
            </div>
          </div>
          <button
            onClick={runTopScan}
            disabled={isScanning}
            style={{
              background: 'rgba(212,175,55,0.08)', border: '1px solid rgba(212,175,55,0.2)',
              borderRadius: 8, padding: '6px 12px', cursor: isScanning ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
              color: 'var(--gold)', fontSize: 10, fontWeight: 800, opacity: isScanning ? 0.5 : 1
            }}
          >
            <RefreshCw size={12} style={{ animation: isScanning ? 'spin 1s linear infinite' : 'none' }} />
            {isScanning ? 'SCANNING…' : 'REFRESH'}
          </button>
        </div>

        {topMovers.length === 0 && (
          <div style={{
            padding: '24px', textAlign: 'center',
            background: 'rgba(0,0,0,0.25)', borderRadius: 'var(--radius-lg)',
            border: '1px dashed rgba(255,255,255,0.06)', color: 'var(--text-muted)', fontSize: 12
          }}>
            {isScanning ? '⚡ Scanning 40 symbols with live 4H indicators…' : 'No movers found above threshold.'}
          </div>
        )}

        {topMovers.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {topMovers.map((m, idx) => {
              const isLong  = m.direction === 'LONG';
              const dirColor = isLong ? 'var(--green)' : 'var(--red)';
              const dirBg    = isLong ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)';
              const dirBorder= isLong ? 'rgba(34,197,94,0.18)' : 'rgba(239,68,68,0.18)';
              const sym = m.symbol.replace('USDT', '');
              const confColor = m.confidence >= 80 ? '#22c55e' : m.confidence >= 65 ? '#f59e0b' : 'var(--text-secondary)';
              const priceStr = m.currentPrice >= 100 ? m.currentPrice.toFixed(2)
                             : m.currentPrice >= 1    ? m.currentPrice.toFixed(4)
                             :                          m.currentPrice.toFixed(6);
              return (
                <div key={m.symbol} style={{
                  display: 'flex', alignItems: 'center', gap: 14,
                  padding: '10px 14px', borderRadius: 10,
                  background: `${dirBg}`, border: `1px solid ${dirBorder}`,
                  animationDelay: `${idx * 0.03}s`
                }} className="card-entry">
                  {/* Rank */}
                  <div style={{ fontSize: 10, fontWeight: 900, color: 'var(--text-muted)', width: 18, textAlign: 'center' }}>
                    #{idx + 1}
                  </div>
                  {/* Symbol */}
                  <div style={{ flex: '0 0 80px' }}>
                    <div className="font-mono" style={{ fontWeight: 900, fontSize: 13 }}>
                      {sym}<span style={{ color: 'var(--text-muted)', fontSize: 9 }}>USDT</span>
                    </div>
                    <div className="font-mono" style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 1 }}>
                      ${priceStr}
                    </div>
                  </div>
                  {/* Direction badge */}
                  <div style={{
                    fontSize: 9, fontWeight: 900, letterSpacing: '0.12em',
                    padding: '3px 8px', borderRadius: 5,
                    background: isLong ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                    color: dirColor, border: `1px solid ${dirBorder}`, flexShrink: 0
                  }}>
                    {m.direction}
                  </div>
                  {/* Confidence bar + value */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ height: 4, background: 'rgba(255,255,255,0.05)', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{
                        height: '100%', borderRadius: 2,
                        width: `${m.confidence}%`,
                        background: m.confidence >= 80
                          ? 'linear-gradient(90deg,#22c55e,#4ade80)'
                          : m.confidence >= 65
                          ? 'linear-gradient(90deg,#f59e0b,#fcd34d)'
                          : 'linear-gradient(90deg,#94a3b8,#cbd5e1)',
                        transition: 'width 0.6s ease'
                      }} />
                    </div>
                  </div>
                  {/* Confidence % */}
                  <div style={{ fontSize: 12, fontWeight: 900, color: confColor, width: 38, textAlign: 'right', fontFamily: "'JetBrains Mono', monospace" }}>
                    {m.confidence}%
                  </div>
                  {/* Expected move */}
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', width: 52, textAlign: 'right', fontFamily: "'JetBrains Mono', monospace" }}>
                    ±{m.expectedMovePct}%
                  </div>
                  {/* Volatility chip */}
                  <div style={{
                    fontSize: 8, fontWeight: 900, letterSpacing: '0.1em',
                    color: m.volatilityLabel === 'HIGH' ? '#ef4444' : m.volatilityLabel === 'MODERATE' ? '#f59e0b' : '#22c55e',
                    flexShrink: 0
                  }}>
                    {m.volatilityLabel}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
