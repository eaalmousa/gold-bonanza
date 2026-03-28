// ============================================
// Strategy Context Builder — Gold Bonanza
// Shared Market Context Layer
//
// Computes all reusable analytical data ONCE per
// symbol so strategies never duplicate indicator
// work. Injected into every strategy evaluator.
// ============================================

import type { Kline, ModeConfig, MarketRegime, OrderFlowSnapshot } from '../types/trading';
import {
  calcEMA, calcRSI, calcATR, calcSMA, calcZLSMA,
  calcSessionVolumeProfile, calcChandelierExit, calcMACD,
  calcBollingerBands, findPivots
} from './indicators';
import type { VolumeProfile } from './indicators';

// ─── STRATEGY CONTEXT ─────────────────────────────────────────────────────────

export interface StrategyContext {
  // Symbol identity
  symbol: string;

  // Raw kline data
  tf15m: Kline[];
  tf1h:  Kline[];

  // ── Pre-computed 15m indicators ──
  closes15:    number[];
  highs15:     number[];
  lows15:      number[];
  vols15:      number[];
  opens15:     number[];
  ema20_15:    (number | null)[];
  ema50_15:    (number | null)[];
  zlsma_15:    (number | null)[];
  rsi14_15:    (number | null)[];
  atr14_15:    (number | null)[];
  volSMA20_15: (number | null)[];
  volSMA50_15: (number | null)[];
  ceLong_15:   (number | null)[];
  ceShort_15:  (number | null)[];
  svp5d:       VolumeProfile | null;
  macd_15: {
    macd: (number | null)[];
    signal: (number | null)[];
    histogram: (number | null)[];
  };
  bb_15: {
    upper: (number | null)[];
    middle: (number | null)[];
    lower: (number | null)[];
    percentB: (number | null)[];
    bandwidth: (number | null)[];
  };
  pivots15: {
    pivotHighs: { idx: number; price: number }[];
    pivotLows:  { idx: number; price: number }[];
  };

  // ── Pre-computed 1h indicators ──
  closes1h:   number[];
  highs1h:    number[];
  lows1h:     number[];
  vols1h:     number[];
  ema20_1h:   (number | null)[];
  ema50_1h:   (number | null)[];
  ema200_1h:  (number | null)[];
  zlsma_1h:   (number | null)[];
  rsi14_1h:   (number | null)[];
  atr14_1h:   (number | null)[];

  // ── Derived bias ──
  htfBias: 'BULL' | 'BEAR' | 'RECOVERY' | 'BREAKDOWN';

  // ── Candle indices ──
  lastIdx15: number;   // Last CLOSED candle index on 15m
  lastIdx1h: number;   // Last index on 1h

  // ── Market metadata ──
  lastPrice:  number;
  change24h:  number;

  // ── BTC regime (injected from global) ──
  regime:             MarketRegime;
  btc4hTrend:         'UP' | 'DOWN' | 'RANGING';
  regimeScoreBonusLong:  number;
  regimeScoreBonusShort: number;
  regimeLabel:        string;
  btcRsi?:            number;

  // ── Order flow (when available) ──
  orderFlow?: OrderFlowSnapshot;

  // ── Config ──
  balance:    number;
  activeMode: ModeConfig;
}

// ─── BUILDER ──────────────────────────────────────────────────────────────────

export function buildStrategyContext(
  symbol: string,
  tf15m: Kline[],
  tf1h: Kline[],
  activeMode: ModeConfig,
  balance: number,
  regime: MarketRegime,
  btc4hTrend: 'UP' | 'DOWN' | 'RANGING',
  regimeScoreBonusLong: number,
  regimeScoreBonusShort: number,
  regimeLabel: string,
  change24h: number,
  orderFlow?: OrderFlowSnapshot,
  btcRsi?: number
): StrategyContext | null {
  // Minimum data requirements
  if (!tf1h || tf1h.length < 210 || !tf15m || tf15m.length < 90) {
    return null;
  }

  // ── 15m arrays ──
  const closes15 = tf15m.map(c => c.close);
  const highs15  = tf15m.map(c => c.high);
  const lows15   = tf15m.map(c => c.low);
  const vols15   = tf15m.map(c => c.volume);
  const opens15  = tf15m.map(c => c.open);

  // ── 15m indicators ──
  const ema20_15    = calcEMA(closes15, 20);
  const ema50_15    = calcEMA(closes15, 50);
  const zlsma_15    = calcZLSMA(closes15, 20);
  const rsi14_15    = calcRSI(closes15, 14);
  const atr14_15    = calcATR(highs15, lows15, closes15, 14);
  const volSMA20_15 = calcSMA(vols15, 20);
  const volSMA50_15 = calcSMA(vols15, 50);
  const { ceLong, ceShort } = calcChandelierExit(highs15, lows15, closes15, 22, 3.0);
  const svp5d = calcSessionVolumeProfile(
    tf1h.map(c => c.high), tf1h.map(c => c.low),
    tf1h.map(c => c.close), tf1h.map(c => c.volume), 120, 50
  );
  const macd_15 = calcMACD(closes15);
  const bb_15   = calcBollingerBands(closes15, 20, 2.0);
  const pivots15 = findPivots(highs15, lows15, 5);

  // ── 1h arrays ──
  const closes1h = tf1h.map(c => c.close);
  const highs1h  = tf1h.map(c => c.high);
  const lows1h   = tf1h.map(c => c.low);
  const vols1h   = tf1h.map(c => c.volume);

  // ── 1h indicators ──
  const ema20_1h  = calcEMA(closes1h, 20);
  const ema50_1h  = calcEMA(closes1h, 50);
  const ema200_1h = calcEMA(closes1h, 200);
  const zlsma_1h  = calcZLSMA(closes1h, 50);
  const rsi14_1h  = calcRSI(closes1h, 14);
  const atr14_1h  = calcATR(highs1h, lows1h, closes1h, 14);

  // ── Derived bias ──
  const idx1h = closes1h.length - 1;
  const e50_1h_val  = ema50_1h[idx1h];
  const e200_1h_val = ema200_1h[idx1h];
  const close1h = closes1h[idx1h];

  let htfBias: 'BULL' | 'BEAR' | 'RECOVERY' | 'BREAKDOWN' = 'RECOVERY';
  if (e50_1h_val != null && e200_1h_val != null) {
    if (close1h > e50_1h_val) {
      htfBias = e50_1h_val > e200_1h_val ? 'BULL' : 'RECOVERY';
    } else {
      htfBias = e50_1h_val < e200_1h_val ? 'BEAR' : 'BREAKDOWN';
    }
  }

  // ── Last closed candle index (15m) ──
  const lastIdx15 = closes15.length - 2;
  const lastPrice = tf15m.length ? tf15m[tf15m.length - 1].close : 0;

  return {
    symbol,
    tf15m, tf1h,
    closes15, highs15, lows15, vols15, opens15,
    ema20_15, ema50_15, zlsma_15, rsi14_15, atr14_15,
    volSMA20_15, volSMA50_15,
    ceLong_15: ceLong, ceShort_15: ceShort,
    svp5d,
    macd_15, bb_15, pivots15,
    closes1h, highs1h, lows1h, vols1h,
    ema20_1h, ema50_1h, ema200_1h, zlsma_1h, rsi14_1h, atr14_1h,
    htfBias,
    lastIdx15,
    lastIdx1h: idx1h,
    lastPrice,
    change24h,
    regime, btc4hTrend,
    regimeScoreBonusLong, regimeScoreBonusShort,
    regimeLabel, btcRsi,
    orderFlow,
    balance, activeMode,
  };
}
