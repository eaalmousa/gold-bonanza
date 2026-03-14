// ============================================
// ChartModal — Self-hosted candlestick chart
// Uses lightweight-charts (TradingView OSS lib)
// + Binance public klines API. No iframe needed.
// ============================================

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  createChart,
  ColorType,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  type IChartApi,
  type CandlestickData,
  type Time,
} from 'lightweight-charts';
import { X, TrendingUp, ExternalLink, RefreshCw, BarChart2 } from 'lucide-react';

interface ChartModalProps {
  symbol: string;
  side: 'LONG' | 'SHORT';
  score: number;
  onClose: () => void;
}

type Interval = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';

const INTERVALS: { label: string; value: Interval }[] = [
  { label: '5m',  value: '5m'  },
  { label: '15m', value: '15m' },
  { label: '1H',  value: '1h'  },
  { label: '4H',  value: '4h'  },
  { label: '1D',  value: '1d'  },
];

async function fetchBinanceKlines(symbol: string, interval: Interval, limit = 150) {
  const timeout = (ms: number) =>
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));

  const tryFetch = async (url: string) => {
    const res = await Promise.race([fetch(url), timeout(4000)]);
    if (!res.ok) throw new Error('not ok');
    return res.json();
  };

  // Try both spot and futures in parallel — return whichever responds first
  try {
    return await Promise.any([
      tryFetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`),
      tryFetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`),
    ]);
  } catch {
    throw new Error(`Could not fetch klines for ${symbol}. Check your internet connection.`);
  }
}

// Simple EMA calculation for overlay
function calcEMA(data: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const result: number[] = [];
  let prev = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result.push(...Array(period - 1).fill(NaN), prev);
  for (let i = period; i < data.length; i++) {
    prev = data[i] * k + prev * (1 - k);
    result.push(prev);
  }
  return result;
}

// Simple SMA + std dev for Bollinger Bands
function calcBB(closes: number[], period = 20, mult = 2) {
  const upper: number[] = [], lower: number[] = [], mid: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) { upper.push(NaN); lower.push(NaN); mid.push(NaN); continue; }
    const slice = closes.slice(i - period + 1, i + 1);
    const avg = slice.reduce((a, b) => a + b, 0) / period;
    const std = Math.sqrt(slice.reduce((s, v) => s + (v - avg) ** 2, 0) / period);
    upper.push(avg + mult * std);
    lower.push(avg - mult * std);
    mid.push(avg);
  }
  return { upper, lower, mid };
}

// MACD histogram
function calcMACD(closes: number[]) {
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signal = calcEMA(macdLine.filter(v => !isNaN(v)), 9);
  const padded = Array(macdLine.length - signal.length).fill(NaN).concat(signal);
  const hist = macdLine.map((v, i) => v - padded[i]);
  return { macdLine, signal: padded, hist };
}

export default function ChartModal({ symbol, side, score, onClose }: ChartModalProps) {
  const sym = symbol.replace('USDT', '');
  const chartRef = useRef<HTMLDivElement>(null);
  const macdRef  = useRef<HTMLDivElement>(null);
  const chartApi = useRef<IChartApi | null>(null);
  const macdApi  = useRef<IChartApi | null>(null);
  const [interval, setInterval] = useState<Interval>('15m');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isLong       = side === 'LONG';
  const accentColor  = isLong ? '#22c55e' : '#ef4444';
  const accentBg     = isLong ? 'rgba(34,197,94,0.14)' : 'rgba(239,68,68,0.14)';
  const accentBorder = isLong ? 'rgba(34,197,94,0.3)'  : 'rgba(239,68,68,0.3)';
  const glowColor    = isLong ? 'rgba(34,197,94,0.10)' : 'rgba(239,68,68,0.10)';

  const BG   = '#0a0a0f';
  const GRID = 'rgba(255,255,255,0.04)';

  function destroyCharts() {
    if (chartApi.current) { chartApi.current.remove(); chartApi.current = null; }
    if (macdApi.current)  { macdApi.current.remove();  macdApi.current = null; }
  }

  async function loadChart() {
    if (!chartRef.current || !macdRef.current) return;
    destroyCharts();
    setLoading(true);
    setError(null);

    try {
      const raw = await fetchBinanceKlines(symbol, interval, 250);

      // Parse klines: [openTime, open, high, low, close, volume, ...]
      const candles: CandlestickData<Time>[] = raw.map((k: any[]) => ({
        time: Math.floor(k[0] / 1000) as Time,
        open:  parseFloat(k[1]),
        high:  parseFloat(k[2]),
        low:   parseFloat(k[3]),
        close: parseFloat(k[4]),
      }));
      const closes = candles.map(c => c.close);
      const times  = candles.map(c => c.time as number);

      // ─── Main Chart ───────────────────────────────────────
      const mainChart = createChart(chartRef.current, {
        layout: {
          background: { type: ColorType.Solid, color: BG },
          textColor: 'rgba(255,255,255,0.5)',
          fontSize: 11,
        },
        grid: {
          vertLines: { color: GRID },
          horzLines: { color: GRID },
        },
        crosshair: { mode: 1 },
        rightPriceScale: { borderColor: 'rgba(255,255,255,0.1)' },
        timeScale: {
          borderColor: 'rgba(255,255,255,0.1)',
          timeVisible: true,
          secondsVisible: false,
        },
        width:  chartRef.current.clientWidth,
        height: chartRef.current.clientHeight,
      });
      chartApi.current = mainChart;

      // Candlestick series
      const candleSeries = mainChart.addSeries(CandlestickSeries, {
        upColor:   '#22c55e', downColor: '#ef4444',
        borderUpColor: '#22c55e', borderDownColor: '#ef4444',
        wickUpColor:   '#22c55e', wickDownColor:   '#ef4444',
      });
      candleSeries.setData(candles);

      // EMA 20 (gold)
      const ema20Series = mainChart.addSeries(LineSeries, {
        color: '#d4af37', lineWidth: 1, priceScaleId: 'right',
        lastValueVisible: false, priceLineVisible: false,
      });
      const ema20 = calcEMA(closes, 20);
      ema20Series.setData(times.map((t, i) => ({ time: t as Time, value: ema20[i] })).filter(p => !isNaN(p.value)));

      // EMA 50 (blue)
      const ema50Series = mainChart.addSeries(LineSeries, {
        color: '#60a5fa', lineWidth: 1, priceScaleId: 'right',
        lastValueVisible: false, priceLineVisible: false,
      });
      const ema50 = calcEMA(closes, 50);
      ema50Series.setData(times.map((t, i) => ({ time: t as Time, value: ema50[i] })).filter(p => !isNaN(p.value)));

      // Bollinger Bands
      const bb = calcBB(closes);
      const bbColor = 'rgba(147,51,234,0.6)';
      for (const [key, color] of [['upper', bbColor], ['lower', bbColor], ['mid', 'rgba(147,51,234,0.3)']] as const) {
        const s = mainChart.addSeries(LineSeries, {
          color, lineWidth: 1, lineStyle: key === 'mid' ? 2 : 0,
          priceScaleId: 'right', lastValueVisible: false, priceLineVisible: false,
        });
        s.setData(times.map((t, i) => ({ time: t as Time, value: bb[key][i] })).filter(p => !isNaN(p.value)));
      }

      mainChart.timeScale().fitContent();

      // ─── MACD Sub-Chart ─────────────────────────────────
      const macdChart = createChart(macdRef.current, {
        layout: { background: { type: ColorType.Solid, color: BG }, textColor: 'rgba(255,255,255,0.4)', fontSize: 10 },
        grid: { vertLines: { color: GRID }, horzLines: { color: GRID } },
        rightPriceScale: { borderColor: 'rgba(255,255,255,0.08)' },
        timeScale: { borderColor: 'rgba(255,255,255,0.08)', timeVisible: true, secondsVisible: false },
        width:  macdRef.current.clientWidth,
        height: macdRef.current.clientHeight,
        crosshair: { mode: 1 },
      });
      macdApi.current = macdChart;

      const { hist } = calcMACD(closes);
      const macdHist = macdChart.addSeries(HistogramSeries, {
        color: '#22c55e',
        priceScaleId: 'right',
        priceLineVisible: false,
      });
      macdHist.setData(
        times.map((t, i) => ({
          time: t as Time,
          value: isNaN(hist[i]) ? 0 : hist[i],
          color: hist[i] >= 0 ? 'rgba(34,197,94,0.7)' : 'rgba(239,68,68,0.7)',
        })).filter(p => !isNaN(p.value))
      );
      macdChart.timeScale().fitContent();

      // Sync crosshair
      mainChart.timeScale().subscribeVisibleLogicalRangeChange(range => {
        if (range) macdChart.timeScale().setVisibleLogicalRange(range);
      });
      macdChart.timeScale().subscribeVisibleLogicalRangeChange(range => {
        if (range) mainChart.timeScale().setVisibleLogicalRange(range);
      });

      // Responsive resize
      const ro = new ResizeObserver(() => {
        if (chartRef.current) mainChart.resize(chartRef.current.clientWidth, chartRef.current.clientHeight);
        if (macdRef.current)  macdChart.resize(macdRef.current.clientWidth, macdRef.current.clientHeight);
      });
      if (chartRef.current) ro.observe(chartRef.current);
      if (macdRef.current)  ro.observe(macdRef.current);

    } catch (e: any) {
      setError(e.message || 'Failed to load chart data');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadChart();
    return destroyCharts;
  }, [symbol, interval]);

  // Keyboard & scroll lock
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = prev; };
  }, [onClose]);

  const modal = (
    <>
      <style>{`
        @keyframes chartSlideUp {
          from { opacity:0; transform:translateY(18px) scale(0.97); }
          to   { opacity:1; transform:translateY(0) scale(1); }
        }
        .iv-btn { cursor:pointer; padding:5px 11px; border-radius:6px; font-size:10px; font-weight:800;
          letter-spacing:.08em; border:1px solid rgba(255,255,255,0.1); background:rgba(255,255,255,0.04);
          color:rgba(255,255,255,0.45); transition:all .15s; }
        .iv-btn:hover { background:rgba(255,255,255,0.1); color:#fff; }
        .iv-btn.active { background:rgba(212,175,55,0.15); border-color:rgba(212,175,55,0.4); color:#f5d97e; }
      `}</style>

      {/* Backdrop */}
      <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        style={{
          position:'fixed', inset:0, zIndex:99999,
          background:'rgba(0,0,0,0.82)', backdropFilter:'blur(12px)',
          display:'flex', alignItems:'center', justifyContent:'center', padding:'16px',
        }}
      >
        {/* Panel */}
        <div style={{
          width:'100%', maxWidth:'1160px', height:'min(90vh,860px)',
          background:BG, border:`1px solid ${accentBorder}`, borderRadius:'14px',
          display:'flex', flexDirection:'column', overflow:'hidden',
          boxShadow:`0 0 100px ${glowColor}, inset 0 0 0 1px rgba(255,255,255,0.03)`,
          animation:'chartSlideUp .22s cubic-bezier(.16,1,.3,1)',
        }}>

          {/* Header */}
          <div style={{
            display:'flex', alignItems:'center', justifyContent:'space-between',
            padding:'12px 16px', borderBottom:'1px solid rgba(255,255,255,0.06)',
            background:'rgba(0,0,0,0.5)', flexShrink:0, gap:12,
          }}>
            <div style={{display:'flex', alignItems:'center', gap:10}}>
              <div style={{ width:30, height:30, borderRadius:7, background:accentBg, border:`1px solid ${accentBorder}`, display:'flex', alignItems:'center', justifyContent:'center' }}>
                <TrendingUp size={14} color={accentColor} />
              </div>
              <div>
                <div style={{ display:'flex', alignItems:'center', gap:7, marginBottom:2 }}>
                  <span style={{ fontSize:15, fontWeight:900, fontStyle:'italic', fontFamily:"'JetBrains Mono',monospace" }}>
                    {sym}<span style={{ color:'rgba(255,255,255,0.25)', fontSize:10 }}>USDT</span>
                  </span>
                  {[
                    { t:side,            bg:accentBg,              c:accentColor, b:accentBorder },
                    { t:`SCORE ${score}`,bg:'rgba(212,175,55,0.1)',c:'#f5d97e',   b:'rgba(212,175,55,0.3)' },
                  ].map(x => (
                    <span key={x.t} style={{ fontSize:9, fontWeight:900, padding:'2px 7px', borderRadius:4, letterSpacing:'.1em', background:x.bg, color:x.c, border:`1px solid ${x.b}` }}>{x.t}</span>
                  ))}
                </div>
                <div style={{fontSize:10, color:'rgba(255,255,255,0.28)'}}>
                  <BarChart2 size={10} style={{display:'inline',marginRight:4,verticalAlign:'middle'}} />
                  EMA 20/50 (gold/blue) · Bollinger Bands (purple) · MACD histogram
                </div>
              </div>
            </div>

            <div style={{display:'flex', alignItems:'center', gap:8}}>
              {/* Interval selector */}
              <div style={{display:'flex', gap:4}}>
                {INTERVALS.map(iv => (
                  <button key={iv.value} className={`iv-btn${interval === iv.value ? ' active' : ''}`}
                    onClick={() => setInterval(iv.value)}>
                    {iv.label}
                  </button>
                ))}
              </div>
              <button className="iv-btn" onClick={loadChart} title="Refresh">
                <RefreshCw size={11} />
              </button>
              <a href={`https://www.tradingview.com/chart/?symbol=BINANCE:${symbol}.P&interval=${interval === '15m' ? '15' : interval}`}
                target="_blank" rel="noopener noreferrer"
                style={{ display:'flex', alignItems:'center', gap:4, fontSize:10, fontWeight:700, color:'rgba(255,255,255,0.35)', textDecoration:'none', padding:'5px 10px', borderRadius:6, border:'1px solid rgba(255,255,255,0.08)', background:'rgba(255,255,255,0.03)' }}>
                <ExternalLink size={10} /> TradingView
              </a>
              <button onClick={onClose} title="Close (Esc)" style={{ background:'rgba(244,63,94,0.1)', border:'1px solid rgba(244,63,94,0.25)', borderRadius:7, padding:'5px 6px', cursor:'pointer', color:'#f43f5e', display:'flex' }}>
                <X size={14} />
              </button>
            </div>
          </div>

          {/* Legend */}
          <div style={{ display:'flex', gap:16, padding:'6px 16px', background:'rgba(0,0,0,0.3)', borderBottom:'1px solid rgba(255,255,255,0.04)', flexShrink:0 }}>
            {[
              { color:'#d4af37', label:'EMA 20' },
              { color:'#60a5fa', label:'EMA 50' },
              { color:'rgba(147,51,234,0.9)', label:'Bollinger Bands' },
              { color:'rgba(34,197,94,0.8)', label:'MACD ↑' },
              { color:'rgba(239,68,68,0.8)', label:'MACD ↓' },
            ].map(l => (
              <div key={l.label} style={{ display:'flex', alignItems:'center', gap:5, fontSize:10, color:'rgba(255,255,255,0.45)' }}>
                <div style={{ width:22, height:2, background:l.color, borderRadius:1 }} />
                {l.label}
              </div>
            ))}
          </div>

          {/* Chart area */}
          <div style={{ flex:1, display:'flex', flexDirection:'column', minHeight:0, position:'relative' }}>
            {loading && (
              <div style={{ position:'absolute', inset:0, background:BG, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:12, zIndex:10 }}>
                <div style={{ width:26, height:26, border:'2px solid rgba(212,175,55,0.15)', borderTopColor:'rgba(212,175,55,0.8)', borderRadius:'50%', animation:'spin 0.8s linear infinite' }} />
                <span style={{ fontSize:12, color:'rgba(255,255,255,0.35)', fontFamily:"'JetBrains Mono',monospace" }}>Fetching {symbol} · {interval}</span>
                <style>{`@keyframes spin { to { transform:rotate(360deg); } }`}</style>
              </div>
            )}
            {error && (
              <div style={{ position:'absolute', inset:0, background:BG, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:10, zIndex:10 }}>
                <span style={{ fontSize:13, color:'#ef4444' }}>⚠ {error}</span>
                <button className="iv-btn" onClick={loadChart}>Retry</button>
              </div>
            )}
            {/* Main candlestick chart */}
            <div ref={chartRef} style={{ flex:3, minHeight:0 }} />
            {/* MACD sub-chart */}
            <div style={{ height:1, background:'rgba(255,255,255,0.06)', flexShrink:0 }} />
            <div ref={macdRef} style={{ flex:1, minHeight:80, maxHeight:160 }} />
          </div>

          {/* Footer */}
          <div style={{ padding:'6px 16px', background:'rgba(0,0,0,0.35)', borderTop:'1px solid rgba(255,255,255,0.04)', fontSize:10, color:'rgba(255,255,255,0.18)', textAlign:'center', flexShrink:0 }}>
            Live data from Binance · Confirm patterns before deploying ·{' '}
            <kbd style={{ background:'rgba(255,255,255,0.07)', padding:'1px 5px', borderRadius:3, fontFamily:'monospace' }}>Esc</kbd> or click outside to close
          </div>
        </div>
      </div>
    </>
  );

  return createPortal(modal, document.body);
}
