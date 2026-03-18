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
  kind: 'SNIPER' | 'SUPER_SNIPER' | 'BREAKOUT' | 'PREDICTIVE';
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
  // Quality Report
  entryType?: 'REVERSAL' | 'CONTINUATION' | 'BREAKOUT' | 'PENDING_BREAKOUT' | 'RETEST_CONFIRMED' | 'RETEST_FAILED' | 'EXPIRED_NO_RETEST' | 'INVALIDATED';
  zoneDistancePct?: number;   // How far price is from ideal entry zone (%)
  btcRegimeAtEntry?: string;  // BTC regime label at signal time
  entryTiming?: 'EARLY' | 'OPTIMAL' | 'LATE'; // Self-assessed timing
  entryModel?: string;
  entryHint?: string;
  debugLog?: string[];         // Why this signal was accepted
  breakLevel?: number;         // Internal tracking for retest engine
  status?: 'DETECTED' | 'QUEUED' | 'DEPLOYED' | 'EXPIRED' | 'CANCELLED';
  id?: string;                 // Unique identifier for signal instance
}

export interface SignalRow {
  symbol: string;
  signal: Signal;
  price?: number;
  change24h?: number;
  timestamp?: number;
  id: string; // Required for state tracking
  status: 'ACCEPTED' | 'REJECTED' | 'PENDING' | 'INVALIDATED' | 'EXPIRED' | 'DEPLOYED' | 'QUEUED' | 'CANCELLED';
}

export interface UnifiedTrace {
  id: string;
  symbol: string;
  engine: 'SNIPER' | 'SUPER_SNIPER' | 'BREAKOUT' | 'PREDICTIVE';
  status: 'ACCEPTED' | 'REJECTED' | 'PENDING' | 'INVALIDATED' | 'EXPIRED';
  score?: number;
  entryType?: string;
  entryTiming?: string;
  lastRejectReason?: string;
  usedBreakingDownBypass?: boolean;
  usedBtcBypass?: boolean;
  usedLateException?: boolean;
  timestamp: number;
}

export interface MarketRow {
  symbol: string;
  lastPrice: number;
  changePct: number;
}

export type TradeStatus =
  | 'ACTIVE'
  | 'TP1_HIT'
  | 'TP2_HIT'
  | 'SL_HIT'
  | 'CANCELLED'
  | 'CLOSED';

export interface TradeStatusEvent {
  status: TradeStatus;
  ts: number;
  price?: number;
  note?: string;
}

export interface ActiveTrade {
  id: string;                // Unique trade instance ID
  signalId?: string;         // ID of the source signal
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
  status: TradeStatus | string;  // string kept for AWAITING_BINANCE compatibility
  dynamicSL?: number;

  // Live tracking
  livePrice?: number;
  unrealizedPnl?: number;    // in USDT
  realizedPnl?: number;      // in USDT (set on close)
  rMultiple?: number;        // (exitPrice - entry) / (entry - sl) normalised to direction
  distToTp1?: number;        // % distance from livePrice to TP1
  distToTp2?: number;        // % distance from livePrice to TP2
  distToSl?: number;         // % distance from livePrice to SL
  priceUpdatedAt?: number;

  // Status history
  statusHistory?: TradeStatusEvent[];

  // Preserved pipeline traits
  score?: number;
  entryType?: string;
  entryTiming?: string;
  reasons?: string[];

  // Paper trading flag
  isPaperTrade?: boolean;
}

export interface ClosedTrade extends ActiveTrade {
  closePrice: number;          // price at which trade was closed
  closedAt: number;            // timestamp
  outcome: 'WIN' | 'LOSS' | 'BREAKEVEN';
}

export interface PaperSession {
  startBalance: number;
  currentBalance: number;
  totalPnl: number;
  openExposure: number;        // sum of sizeUSDT for open paper trades
  winCount: number;
  lossCount: number;
  breakevenCount: number;
  avgRMultiple: number;        // mean rMultiple across closed trades
  closedTrades: ClosedTrade[];
}

// ─── Execution Adapter ────────────────────────────────────────────────────────

export type ExecutionMode = 'PAPER' | 'BINANCE_TEST' | 'BINANCE_LIVE';

/** Canonical order payload passed to every execution path */
export interface ExecutionPayload {
  signalId: string; // Mandatory link to the source signal
  symbol: string;
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  takeProfit2?: number;
  qty: number;
  sizeUSDT: number;
  leverage: number;
  // Analytical provenance — preserved through all paths
  score?: number;
  entryType?: string;
  entryTiming?: string;
  reasons?: string[];
  kind?: string;
}

export type ExecutionResultStatus = 'SUBMITTING' | 'SUBMITTED' | 'FAILED' | 'PAPER';

export interface ExecutionResult {
  signalId: string;
  symbol: string;
  mode: ExecutionMode;
  status: ExecutionResultStatus;
  ts: number;
  exchangeOrderId?: string | number;
  exchangeResponse?: unknown;   // raw API response for audit log
  error?: string;
  payload: ExecutionPayload;    // logged before any send
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
  icebergBids: number;
  icebergAsks: number;
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

export type MarketRegime = 'TRENDING_UP' | 'TRENDING_DOWN' | 'RANGING' | 'CRASH' | 'CHOP';

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
      rsiMin: 15, rsiMax: 70, volMult: 1.0,
      minDollarVol15m: 50000, volSpikeMult: 1.0,
      accelPctMin: 0.00010, atrPctMin: 0.10, atrPctMax: 5.00,
      valueZoneSlack: 0.008, // Hard cap at 0.8% — 2% was meaningless
      scoreMin: 8 // Raised floor from 5 to 8
    },
    breakout: {
      breakPct: 0.0010, volMult: 1.0,
      minDollarVol15m: 50000, volSpikeMult: 1.0,
      accelPctMin: 0.00010, coilBars: 4, coilRangePctMax: 4.00, // Tightened from 6%
      rsiMin: 40, rsiMax: 90, scoreMin: 8
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
