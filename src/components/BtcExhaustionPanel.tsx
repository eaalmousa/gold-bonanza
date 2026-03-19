import { useEffect, useState } from 'react';
import { Zap, TrendingDown, TrendingUp, RefreshCw } from 'lucide-react';

interface IndicatorResult {
  name: string;
  triggered: boolean;
  value: string;
  detail: string;
}

interface ExhaustionData {
  longExhaustion: IndicatorResult[];  // signals BTC topping → flip SHORT
  shortExhaustion: IndicatorResult[]; // signals BTC bottoming → flip LONG
  longScore: number;
  shortScore: number;
  lastUpdated: string;
}

// ─── Math helpers ────────────────────────────────────────────────────────────

function calcRSI(closes: number[], period = 14): number {
  if (closes.length < period + 2) return 50;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff; else losses += Math.abs(diff);
  }
  const avgG = gains / period, avgL = losses / period;
  if (avgL === 0) return 100;
  return 100 - 100 / (1 + avgG / avgL);
}

function calcMACD(closes: number[]): { macd: number[]; signal: number[]; hist: number[] } {
  const ema = (data: number[], p: number): number[] => {
    const k = 2 / (p + 1);
    const result: number[] = [data[0]];
    for (let i = 1; i < data.length; i++) result.push(data[i] * k + result[i - 1] * (1 - k));
    return result;
  };
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macd = ema12.map((v, i) => v - ema26[i]);
  const signal = ema(macd, 9);
  const hist = macd.map((v, i) => v - signal[i]);
  return { macd, signal, hist };
}

function calcStochRSI(closes: number[], rsiPeriod = 14, stochPeriod = 14): { k: number; d: number } {
  // Compute RSI series over last ~60 candles
  const rsiSeries: number[] = [];
  for (let i = rsiPeriod; i < closes.length; i++) {
    rsiSeries.push(calcRSI(closes.slice(0, i + 1), rsiPeriod));
  }
  if (rsiSeries.length < stochPeriod) return { k: 50, d: 50 };
  const recent = rsiSeries.slice(-stochPeriod);
  const minRSI = Math.min(...recent);
  const maxRSI = Math.max(...recent);
  const range = maxRSI - minRSI;
  const k = range === 0 ? 50 : ((rsiSeries[rsiSeries.length - 1] - minRSI) / range) * 100;
  const prevK = range === 0 ? 50 : ((rsiSeries[rsiSeries.length - 2] - minRSI) / range) * 100;
  const d = (k + prevK) / 2; // Simple 2-period smoothing
  return { k, d };
}

function hasBearishDivergence(closes: number[], rsiSeries: number[], window = 10): boolean {
  // Price makes higher high but RSI makes lower high
  const priceSlice = closes.slice(-window);
  const rsiSlice = rsiSeries.slice(-window);
  const priceMax = Math.max(...priceSlice);
  const rsiAtPriceMax = rsiSlice[priceSlice.indexOf(priceMax)];
  const latestRSI = rsiSlice[rsiSlice.length - 1];
  const latestPrice = priceSlice[priceSlice.length - 1];
  return latestPrice > priceSlice[0] && latestRSI < rsiAtPriceMax;
}

function hasBullishDivergence(closes: number[], rsiSeries: number[], window = 10): boolean {
  // Price makes lower low but RSI makes higher low
  const priceSlice = closes.slice(-window);
  const rsiSlice = rsiSeries.slice(-window);
  const priceMin = Math.min(...priceSlice);
  const rsiAtPriceMin = rsiSlice[priceSlice.indexOf(priceMin)];
  const latestRSI = rsiSlice[rsiSlice.length - 1];
  const latestPrice = priceSlice[priceSlice.length - 1];
  return latestPrice < priceSlice[0] && latestRSI > rsiAtPriceMin;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function BtcExhaustionPanel() {
  const [data, setData] = useState<ExhaustionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchAndAnalyze = async () => {
    setLoading(true);
    try {
      // Fetch 4h klines (200 candles ≈ 33 days) + daily (100 candles)
      const [res4h, res1d] = await Promise.all([
        fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=4h&limit=200'),
        fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=100'),
      ]);
      const raw4h: any = await res4h.json();
      const raw1d: any = await res1d.json();

      if (!Array.isArray(raw4h) || !Array.isArray(raw1d)) {
        throw new Error('Invalid response from Binance API (likely rate limited)');
      }

      const closes4h = raw4h.map(k => parseFloat(k[4]));
      const closes1d = raw1d.map(k => parseFloat(k[4]));

      // Build RSI series for divergence calc
      const rsiSeries4h: number[] = [];
      for (let i = 20; i < closes4h.length; i++) rsiSeries4h.push(calcRSI(closes4h.slice(0, i + 1)));

      const rsi4h = calcRSI(closes4h);
      const stoch  = calcStochRSI(closes4h);
      const { hist } = calcMACD(closes4h);

      const currentPrice = closes4h[closes4h.length - 1];
      const price30dAgo  = closes1d[closes1d.length - 31] ?? closes1d[0];
      const priceChangePct = ((currentPrice - price30dAgo) / price30dAgo) * 100;

      // Volume trend: compare avg vol of last 5 up-candles vs prev 5 up-candles
      const upCandles   = raw4h.slice(-20).filter((_, i, a) => parseFloat(a[i][4]) > parseFloat(a[i][1]));
      const downCandles = raw4h.slice(-20).filter((_, i, a) => parseFloat(a[i][4]) < parseFloat(a[i][1]));
      const upVolTrend   = upCandles.length > 4   ? upCandles.slice(-3).reduce((a, k) => a + parseFloat(k[5]), 0) / upCandles.slice(-6, -3).reduce((a, k) => a + parseFloat(k[5]), 0) : 1;
      const downVolTrend = downCandles.length > 4 ? downCandles.slice(-3).reduce((a, k) => a + parseFloat(k[5]), 0) / downCandles.slice(-6, -3).reduce((a, k) => a + parseFloat(k[5]), 0) : 1;

      // MACD histogram trend: is histogram declining?
      const histSlice = hist.slice(-6);
      const histDeclining = histSlice[histSlice.length - 1] < histSlice[histSlice.length - 3];
      const histRising    = histSlice[histSlice.length - 1] > histSlice[histSlice.length - 3];

      const bearDiv = hasBearishDivergence(closes4h, rsiSeries4h);
      const bullDiv = hasBullishDivergence(closes4h, rsiSeries4h);

      // ─── LONG EXHAUSTION indicators (BTC topping → flip SHORT) ───
      const longExhaustion: IndicatorResult[] = [
        {
          name: 'RSI Overbought + Bearish Divergence',
          triggered: rsi4h > 72 && bearDiv,
          value: `RSI ${rsi4h.toFixed(1)}`,
          detail: bearDiv ? 'Price higher high / RSI lower high — divergence confirmed' : 'No divergence detected'
        },
        {
          name: 'StochRSI Overbought Crossover',
          triggered: stoch.k > 85 && stoch.k < stoch.d,
          value: `K=${stoch.k.toFixed(1)} D=${stoch.d.toFixed(1)}`,
          detail: stoch.k > 85 && stoch.k < stoch.d ? 'K crossed below D in overbought zone' : 'No bearish cross'
        },
        {
          name: 'MACD Histogram Declining',
          triggered: histDeclining && hist[hist.length - 1] > 0,
          value: `Hist ${hist[hist.length - 1].toFixed(0)}`,
          detail: histDeclining ? 'Momentum fading while price in uptrend' : 'Histogram not declining'
        },
        {
          name: 'Volume Contraction on Rallies',
          triggered: upVolTrend < 0.75,
          value: `${(upVolTrend * 100).toFixed(0)}% of prior`,
          detail: upVolTrend < 0.75 ? 'Rally volume shrinking — buyers weakening' : 'Volume healthy'
        },
        {
          name: 'Parabolic Blow-Off (+40% in 30d)',
          triggered: priceChangePct > 40,
          value: `+${priceChangePct.toFixed(1)}% (30d)`,
          detail: priceChangePct > 40 ? 'Vertical price extension — blow-off risk' : 'Normal pace'
        },
      ];

      // ─── SHORT EXHAUSTION indicators (BTC bottoming → flip LONG) ───
      const shortExhaustion: IndicatorResult[] = [
        {
          name: 'RSI Oversold + Bullish Divergence',
          triggered: rsi4h < 30 && bullDiv,
          value: `RSI ${rsi4h.toFixed(1)}`,
          detail: bullDiv ? 'Price lower low / RSI higher low — divergence confirmed' : 'No divergence detected'
        },
        {
          name: 'StochRSI Oversold Crossover',
          triggered: stoch.k < 15 && stoch.k > stoch.d,
          value: `K=${stoch.k.toFixed(1)} D=${stoch.d.toFixed(1)}`,
          detail: stoch.k < 15 && stoch.k > stoch.d ? 'K crossed above D in oversold zone' : 'No bullish cross'
        },
        {
          name: 'MACD Histogram Rising',
          triggered: histRising && hist[hist.length - 1] < 0,
          value: `Hist ${hist[hist.length - 1].toFixed(0)}`,
          detail: histRising ? 'Momentum recovering while price in downtrend' : 'Histogram not recovering'
        },
        {
          name: 'Volume Contraction on Selloffs',
          triggered: downVolTrend < 0.75,
          value: `${(downVolTrend * 100).toFixed(0)}% of prior`,
          detail: downVolTrend < 0.75 ? 'Selling volume drying up — sellers exhausted' : 'Volume still heavy'
        },
        {
          name: 'Capitulation (-35% in 30d)',
          triggered: priceChangePct < -35,
          value: `${priceChangePct.toFixed(1)}% (30d)`,
          detail: priceChangePct < -35 ? 'Vertical price crash — capitulation exhaustion' : 'Normal correction'
        },
      ];

      const longScore  = longExhaustion.filter(i => i.triggered).length;
      const shortScore = shortExhaustion.filter(i => i.triggered).length;

      setData({ longExhaustion, shortExhaustion, longScore, shortScore, lastUpdated: new Date().toLocaleTimeString() });
      setError('');
    } catch (e: any) {
      setError('Failed to compute exhaustion data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAndAnalyze();
    // Refresh every 4 hours
    const iv = setInterval(fetchAndAnalyze, 4 * 60 * 60 * 1000);
    return () => clearInterval(iv);
  }, []);

  const scoreLabel = (score: number) => {
    if (score <= 1) return { text: 'NO SIGNAL', color: 'rgba(255,255,255,0.3)' };
    if (score <= 2) return { text: '⚠️ CAUTION', color: '#f59e0b' };
    return { text: '🚨 HIGH RISK', color: '#ef4444' };
  };

  const renderSide = (
    title: string,
    subtitle: string,
    indicators: IndicatorResult[],
    score: number,
    accentColor: string,
    icon: React.ReactNode
  ) => {
    const sl = scoreLabel(score);
    return (
      <div style={{
        flex: 1, minWidth: 280,
        background: `linear-gradient(135deg, rgba(0,0,0,0.4), rgba(0,0,0,0.2))`,
        border: `1px solid ${accentColor}22`,
        borderRadius: 14, padding: '20px 22px'
      }}>
        {/* Side header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {icon}
            <div>
              <div style={{ fontSize: 11, fontWeight: 900, color: accentColor, letterSpacing: '0.15em' }}>{title}</div>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>{subtitle}</div>
            </div>
          </div>
          <div style={{
            padding: '4px 10px', borderRadius: 6,
            background: `${sl.color}18`,
            border: `1px solid ${sl.color}44`,
            color: sl.color, fontSize: 9, fontWeight: 900, letterSpacing: '0.12em'
          }}>
            {sl.text}
          </div>
        </div>

        {/* Score bar */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--text-muted)', marginBottom: 5 }}>
            <span>EXHAUSTION SCORE</span>
            <span style={{ color: sl.color, fontWeight: 900 }}>{score}/5</span>
          </div>
          <div style={{ height: 4, background: 'rgba(255,255,255,0.05)', borderRadius: 2 }}>
            <div style={{
              height: '100%', width: `${(score / 5) * 100}%`,
              background: score >= 3 ? '#ef4444' : score >= 2 ? '#f59e0b' : accentColor,
              borderRadius: 2, transition: 'width 0.8s ease'
            }} />
          </div>
        </div>

        {/* Indicators list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {indicators.map((ind) => (
            <div key={ind.name} style={{
              display: 'flex', gap: 10, alignItems: 'flex-start',
              padding: '8px 10px', borderRadius: 8,
              background: ind.triggered ? `${accentColor}12` : 'rgba(255,255,255,0.02)',
              border: `1px solid ${ind.triggered ? accentColor + '33' : 'rgba(255,255,255,0.04)'}`,
              opacity: ind.triggered ? 1 : 0.55
            }}>
              <div style={{
                width: 8, height: 8, borderRadius: '50%', flexShrink: 0, marginTop: 3,
                background: ind.triggered ? accentColor : 'rgba(255,255,255,0.15)',
                boxShadow: ind.triggered ? `0 0 8px ${accentColor}` : 'none'
              }} />
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: ind.triggered ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                    {ind.name}
                  </div>
                  <div style={{ fontSize: 10, fontWeight: 900, color: ind.triggered ? accentColor : 'rgba(255,255,255,0.2)', fontStyle: 'italic', marginLeft: 8, flexShrink: 0 }}>
                    {ind.value}
                  </div>
                </div>
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>
                  {ind.detail}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div style={{
      background: 'var(--bg-panel)',
      borderRadius: 'var(--radius-xl)',
      border: '1px solid var(--border-gold)',
      padding: '28px 32px',
      backdropFilter: 'blur(40px)',
      boxShadow: '0 30px 80px -20px rgba(0,0,0,0.8)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Zap size={22} color="var(--gold)" />
          <div>
            <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: '0.25em', color: 'var(--gold-light)' }}>
              BTC EXHAUSTION DETECTOR
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.15em', marginTop: 3 }}>
              MULTI-INDICATOR FLIP SIGNAL ENGINE — 4H TIMEFRAME
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>Updated: {data?.lastUpdated || '—'}</span>
          <button
            onClick={fetchAndAnalyze}
            style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(212,175,55,0.08)', border: '1px solid rgba(212,175,55,0.2)', borderRadius: 4, color: 'var(--gold)', fontSize: 9, padding: '4px 10px', cursor: 'pointer', letterSpacing: '0.1em' }}
          >
            <RefreshCw size={10} />
            REFRESH
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)', fontSize: 12 }}>
          Analyzing BTC exhaustion signals on 4H data...
        </div>
      ) : error ? (
        <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--red)', fontSize: 12 }}>{error}</div>
      ) : data && (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {renderSide(
            'LONG EXHAUSTION',
            'BTC topping signal — consider flipping SHORT',
            data.longExhaustion, data.longScore, '#ef4444',
            <TrendingDown size={18} color="#ef4444" />
          )}
          {renderSide(
            'SHORT EXHAUSTION',
            'BTC bottoming signal — consider flipping LONG',
            data.shortExhaustion, data.shortScore, '#22c55e',
            <TrendingUp size={18} color="#22c55e" />
          )}
        </div>
      )}

      {/* Methodology note */}
      <div style={{ marginTop: 20, padding: '10px 14px', background: 'rgba(212,175,55,0.04)', borderRadius: 8, border: '1px solid rgba(212,175,55,0.08)' }}>
        <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', lineHeight: 1.6 }}>
          ⚙️ Indicators: <strong style={{ color: 'rgba(255,255,255,0.4)' }}>RSI(14) Divergence</strong> · <strong style={{ color: 'rgba(255,255,255,0.4)' }}>Stochastic RSI</strong> · <strong style={{ color: 'rgba(255,255,255,0.4)' }}>MACD Histogram Divergence</strong> · <strong style={{ color: 'rgba(255,255,255,0.4)' }}>Volume Contraction</strong> · <strong style={{ color: 'rgba(255,255,255,0.4)' }}>Parabolic Extension</strong> — Score ≥ 3/5 = high-confidence flip signal
        </div>
      </div>
    </div>
  );
}
