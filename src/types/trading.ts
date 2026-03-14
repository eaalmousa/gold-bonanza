// ============================================
// Gold Bonanza — Trading Types & Constants
// ============================================

export interface ModeConfig {
  key: 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';
  riskPct: number;
  maxTrades: number;
  leverage: number;
  pullback: PullbackConfig;
  breakout: BreakoutConfig;
}

export interface PullbackConfig {
  rsiMin: number;
  rsiMax: number;
  volMult: number;
  minDollarVol15m: number;
  volSpikeMult: number;
  accelPctMin: number;
  atrPctMin: number;
  atrPctMax: number;
  valueZoneSlack: number;
  scoreMin: number;
}

export interface BreakoutConfig {
  breakPct: number;
  volMult: number;
  minDollarVol15m: number;
  volSpikeMult: number;
  accelPctMin: number;
  coilBars: number;
  coilRangePctMax: number;
  rsiMin: number;
  rsiMax: number;
  scoreMin: number;
}

export interface Signal {
  kind: 'SNIPER' | 'SUPER_SNIPER';
  side: 'LONG' | 'SHORT';
  score: number;
  reasons: string[];
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  takeProfit2?: number;
  qty: number;
  sizeUSDT: number;
  atr15: number;
  volRatio: number;
  entryModel?: string;
  entryHint?: string;
}

export interface SignalRow {
  symbol: string;
  signal: Signal;
  price?: number;
  change24h?: number;
  timestamp?: number;
}

export interface MarketRow {
  symbol: string;
  lastPrice: number;
  changePct: number;
}

export interface ActiveTrade {
  symbol: string;
  kind: string;
  type: string;
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  qty: number;
  qtyBase: number;
  sizeUSDT: number;
  t1: number;
  t2?: number;
  sl: number;
  stopPrice: number;
  leverage: number;
  deployedAt: number;
  status: string;
  dynamicSL?: number;
}

export interface ExitSignal {
  label: 'HOLD' | 'EXIT' | 'TAKE PARTIAL' | 'TIGHTEN STOP';
  detail: string;
  trail: number | null;
}

export interface Kline {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
}

export interface PriceData {
  last: number;
  ts?: number;
}

export interface SignalHistoryEntry {
  kind: string;
  symbol: string;
  price?: number;
  change24h?: number;
  score?: number;
  ts: number;
}

export interface MicrostructureRow {
  symbol: string;
  cvd: string;
  icebergs: number;
  agFlow: string;
  liqCascade: string;
  liqVolume: string;
  score: string;
}

export interface LiquidityLayer {
  price: number;
  type: 'bid' | 'ask' | 'current';
  volume: number;
  intensity: number;
  isInstitutional: boolean;
}

export interface TriggerLevel {
  symbol: string;
  level: number;
  state: 'WAIT' | 'BROKE' | 'RETEST' | 'TRIGGERED';
  type: string;
  confidence: number;
}

export interface BlockedSignal {
  symbol: string;
  reason: string;
  time: string;
  score: number;
}

export interface PipelineHealth {
  label: string;
  value: number;
  status: 'ok' | 'warn' | 'error';
}

// ============================================
// Market Regime & Order Flow
// ============================================

export type MarketRegime = 'TRENDING_UP' | 'TRENDING_DOWN' | 'RANGING' | 'CRASH';

export interface OrderFlowSnapshot {
  cvd: number;            // Cumulative Volume Delta — positive = buyers dominating
  bidVolume: number;      // Total bid volume in top levels
  askVolume: number;      // Total ask volume in top levels
  imbalanceRatio: number; // bid/ask ratio — >1.3 = bullish, <0.7 = bearish
  largeBlocksBid: number; // Institutional-size bid blocks
  largeBlocksAsk: number; // Institutional-size ask blocks
  lastTradeAggressor: 'BUY' | 'SELL' | 'NEUTRAL';
}

export type DealStatus = 'ACTIVE' | 'CONFIRMED' | 'CANCELLED';

// ============================================
// RISK MODE CONSTANTS
// ============================================

export const MODES: Record<string, ModeConfig> = {
  CONSERVATIVE: {
    key: 'CONSERVATIVE',
    riskPct: 0.0075,
    maxTrades: 2,
    leverage: 3,
    pullback: {
      rsiMin: 28, rsiMax: 52, volMult: 1.50, // Require 1.5x volume
      minDollarVol15m: 500000, volSpikeMult: 1.25,
      accelPctMin: 0.00040, atrPctMin: 0.25, atrPctMax: 2.00,
      valueZoneSlack: 0.0030, scoreMin: 14 // Extremely strict scoring
    },
    breakout: {
      breakPct: 0.0040, volMult: 1.75, // Require 1.75x volume
      minDollarVol15m: 600000, volSpikeMult: 1.30,
      accelPctMin: 0.00045, coilBars: 12, coilRangePctMax: 1.80,
      rsiMin: 55, rsiMax: 78, scoreMin: 14 // Extremely strict scoring
    }
  },
  BALANCED: {
    key: 'BALANCED',
    riskPct: 0.01,
    maxTrades: 3,
    leverage: 5,
    pullback: {
      rsiMin: 22, rsiMax: 58, volMult: 1.25, // Require 1.25x volume
      minDollarVol15m: 250000, volSpikeMult: 1.15,
      accelPctMin: 0.00030, atrPctMin: 0.20, atrPctMax: 3.00,
      valueZoneSlack: 0.0050, scoreMin: 11 // Moderately strict scoring
    },
    breakout: {
      breakPct: 0.0035, volMult: 1.40, // Require 1.4x volume
      minDollarVol15m: 350000, volSpikeMult: 1.20,
      accelPctMin: 0.00035, coilBars: 8, coilRangePctMax: 2.50,
      rsiMin: 50, rsiMax: 82, scoreMin: 11 // Moderately strict scoring
    }
  },
  AGGRESSIVE: {
    key: 'AGGRESSIVE',
    riskPct: 0.015,
    maxTrades: 8,
    leverage: 7,
    pullback: {
      rsiMin: 15, rsiMax: 70, volMult: 1.0, // Any volume is fine
      minDollarVol15m: 50000, volSpikeMult: 1.0,
      accelPctMin: 0.00010, atrPctMin: 0.10, atrPctMax: 5.00,
      valueZoneSlack: 0.02, scoreMin: 5 // Low bar
    },
    breakout: {
      breakPct: 0.0010, volMult: 1.0, // Any volume is fine
      minDollarVol15m: 50000, volSpikeMult: 1.0,
      accelPctMin: 0.00010, coilBars: 4, coilRangePctMax: 6.00, // Very loose compression
      rsiMin: 40, rsiMax: 90, scoreMin: 5 // Low bar
    }
  }
};

export const DEFAULT_SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
  'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT', 'LINKUSDT', 'TONUSDT',
  'TRXUSDT', 'OPUSDT', 'ARBUSDT', 'NEARUSDT', 'APTUSDT',
  'MATICUSDT', 'LTCUSDT', 'BCHUSDT', 'UNIUSDT', 'ATOMUSDT',
  'STXUSDT', 'INJUSDT', 'SEIUSDT', 'PEPEUSDT', 'RUNEUSDT',
  'AAVEUSDT', 'SANDUSDT', 'MANAUSDT', 'FILUSDT', 'ICPUSDT',
  'AXSUSDT', 'THETAUSDT', 'VETUSDT', 'EGLDUSDT', 'FETUSDT',
  'GRTUSDT', 'SNXUSDT', 'CRVUSDT', 'MKRUSDT', 'QNTUSDT',
  'ALGOUSDT', 'EOSUSDT', 'FTMUSDT', 'ZILUSDT', 'COMPUSDT',
  'KAVAUSDT', 'CHZUSDT', 'ENJUSDT', 'ROSEUSDT', 'WAVESUSDT',
  'GALAUSDT', 'CELOUSDT', 'YFIUSDT', 'SUSHIUSDT', 'KSMUSDT',
  'ZECUSDT', 'DASHUSDT', 'XMRUSDT', 'NEOUSDT', 'RNDRUSDT',
  'AGIXUSDT', 'INJUSDT', 'IDUSDT', 'MAGICUSDT', 'GMXUSDT',
  'LDOUSDT', 'ENSUSDT', 'MINAUSDT', 'IMXUSDT', '1INCHUSDT',
  'BATUSDT', 'ENJUSDT', 'LRCUSDT', 'HOTUSDT', 'RVNUSDT',
  'ONEUSDT', 'OCEANUSDT', 'BANDUSDT', 'ONTUSDT', 'IOTAUSDT',
  'FLRUSDT', 'XEMUSDT', 'ZRXUSDT', 'IOSTUSDT', 'ANKRUSDT',
  'DGBUSDT', 'SCUSDT', 'LSKUSDT', 'XVGUSDT', 'SFPUSDT',
  'C98USDT', 'SXPUSDT', 'ALPHAUSDT', 'DODOUSDT', 'REEFUSDT',
  'TWTUSDT', 'BALUSDT', 'RENUSDT', 'CELRUSDT', 'STORJUSDT',
  'BLURUSDT'
];

export const METAL_SYMBOLS = ['XAUUSDT', 'XAGUSDT'];

export const SPOT_API = 'https://api.binance.com';
export const FUTURES_API = 'https://fapi.binance.com';
