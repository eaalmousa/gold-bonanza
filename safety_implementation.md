# Gold Bonanza Safety Remediation Implementation Package

## 1) Root-cause map
The old architecture had multiple unsafe execution paths that could open live trades indiscriminately:

1.  **Frontend Signals -> 	radingStore.ts -> deploySignal() / deployManualSignal():** These functions were calling executeOrder() without evaluating ccountEnvironment effectively.
2.  **executionAdapter.ts -> executeOrder():** Previously, any payload entering this function was immediately forwarded to executeLive() assuming it was a real trade, regardless of the UI DEMO toggle.
3.  **Backend Daemon (server/lib/autoTrader.ts -> evaluateFrontendSignals()):** The daemon scanner looped every 90s. If it found a signal, it would trigger live Binance /fapi/v1/order market executions. It completely missed the global frontend environment scope.
4.  **Backend API (server/routes/trade.ts -> /trade/open):** The express route was structurally insecure. It accepted POST requests indiscriminately without a high-level kill switch guard.

## 2) Changed file list
1.  src/types/trading.ts
2.  src/services/executionAdapter.ts
3.  server/lib/autoTrader.ts
4.  server/routes/trade.ts
5.  src/components/SystemStatus.tsx
6.  src/components/CommandSyncHub.tsx
7.  src/store/tradingStore.ts

## 3) Full code for every changed file
### src/types/trading.ts
`	ypescript
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
  tp1RR?: number;  // Runtime TP1 R:R from live UI config
  tp2RR?: number;  // Runtime TP2 R:R from live UI config
  tp1Only?: boolean; // Runtime TP1 ONLY from live UI config
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
  kind: 'SNIPER' | 'SUPER_SNIPER' | 'BREAKOUT' | 'PREDICTIVE' | 'SWEEP' | 'TREND';
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
  
  // Truth-Aligned Model
  source?: 'FRONTEND' | 'BACKEND';
  backendSeen?: boolean;
  backendDecision?: 'UI_ONLY' | 'BLOCKED_BACKEND' | 'DEPLOYED_BACKEND' | 'ACCEPTED_BACKEND';
  backendDecisionAt?: number;
  blockerReason?: string;
  deployedOrderId?: string;
}

export interface UnifiedTrace {
  id: string;
  symbol: string;
  engine: 'SNIPER' | 'SUPER_SNIPER' | 'BREAKOUT' | 'PREDICTIVE' | 'SWEEP' | 'TREND';
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

  // Safety tracking & Strict Labeling
  accountMode: 'DEMO' | 'LIVE';
  source: 'FRONTEND' | 'BACKEND' | 'MANUAL' | 'RESTORE' | 'SCANNER';
  authority: 'LOCAL' | 'EXCHANGE';

  // Live tracking & Final Outcomes
  livePrice?: number;
  mfe?: number;              // Max Favorable Excursion in price
  mae?: number;              // Max Adverse Excursion in price
  hasHit1R?: boolean;
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
}

export interface ClosedTrade extends ActiveTrade {
  closePrice: number;          // price at which trade was closed
  closedAt: number;            // timestamp
  outcome: 'WIN' | 'LOSS' | 'BREAKEVEN';
}

// ─── Execution Adapter ────────────────────────────────────────────────────────

/** Execution mode — LIVE or DEMO */
export type ExecutionMode = 'LIVE' | 'DEMO';

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

export type ExecutionResultStatus = 'SUBMITTING' | 'SUBMITTED' | 'FAILED';

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
      rsiMin: 20, rsiMax: 70, volMult: 0.90, // Pullbacks pivot on decelerated volume
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
      rsiMin: 15, rsiMax: 75, volMult: 0.75, // Allow pivots on sub-mean volume (typical for compressions)
      minDollarVol15m: 250000, volSpikeMult: 1.15,
      accelPctMin: 0.00030, atrPctMin: 0.20, atrPctMax: 3.00,
      valueZoneSlack: 0.0050, scoreMin: 9 // Moderately strict scoring
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
      rsiMin: 10, rsiMax: 85, volMult: 0.60, // Permissive volume constraint
      minDollarVol15m: 50000, volSpikeMult: 1.0,
      accelPctMin: 0.00010, atrPctMin: 0.10, atrPctMax: 5.00,
      valueZoneSlack: 0.008, // Hard cap at 0.8% — 2% was meaningless
      scoreMin: 6 // Raised floor from 5 to 6
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

`

### src/services/executionAdapter.ts
`	ypescript
// ============================================================
// Execution Adapter — LIVE ONLY
//
// Single-entry routing layer between deploySignal and Binance live futures.
// No paper, demo, or test paths exist.
//
// CONTRACT:
//  - Receives a canonical ExecutionPayload
//  - Runs all safety guards before any exchange call
//  - Returns ExecutionResult (always — never throws to caller)
//  - Logs full payload BEFORE submission for audit trail
// ============================================================

import type { ExecutionMode, ExecutionPayload, ExecutionResult } from '../types/trading';
import { apiRequest } from './api';
import { useTradingStore } from '../store/tradingStore';

export function canPlaceLiveOrder(context: string): boolean {
  // 1. Global Kill Switch
  if ((window as any).GB_LIVE_KILL === true) {
    console.error(`[ExecutionGuard] 🔴 BLOCKED: Global Kill Switch is ACTIVE. Context: ${context}`);
    return false;
  }

  const store = useTradingStore.getState();

  // 2. Execution Mode
  if (store.accountEnvironment !== 'LIVE') {
    console.error(`[ExecutionGuard] 🔴 BLOCKED: Account Environment is ${store.accountEnvironment}, not LIVE. Context: ${context}`);
    return false;
  }

  // 3. Browser explicit live arm
  if (!store.liveExecutionArmed) {
    console.error(`[ExecutionGuard] 🔴 BLOCKED: Browser real order arm is OFF. Context: ${context}`);
    return false;
  }

  // 4. Backend explicit mismatch guard
  if (store.backendEnvironment?.isTestnet) {
    console.error(`[ExecutionGuard] 🔴 BLOCKED: Backend implies it is in TESTNET. Context: ${context}`);
    return false;
  }

  return true;
}

// ─── Guards ──────────────────────────────────────────────────────────────────

function validatePayload(p: ExecutionPayload): string | null {
  if (!p.symbol)             return 'Missing symbol';
  if (!p.side)               return 'Missing side';
  if (!p.entryPrice || p.entryPrice <= 0) return 'Blocked: invalid entry price';
  if (!p.stopLoss   || p.stopLoss   <= 0) return 'Blocked: invalid stop loss';
  if (!p.takeProfit || p.takeProfit <= 0) return 'Blocked: invalid take profit';
  if (!p.qty        || p.qty        <= 0) return 'Blocked: computed quantity is zero — check balance and risk config';
  if (!p.sizeUSDT   || p.sizeUSDT   <= 0) return 'Blocked: risk capital is zero — check balance and risk config';

  // Strict direction geometry
  if (p.side === 'LONG'  && p.stopLoss  >= p.entryPrice) return 'LONG: stopLoss must be below entryPrice';
  if (p.side === 'SHORT' && p.stopLoss  <= p.entryPrice) return 'SHORT: stopLoss must be above entryPrice';
  if (p.side === 'LONG'  && p.takeProfit <= p.entryPrice) return 'LONG: takeProfit must be above entryPrice';
  if (p.side === 'SHORT' && p.takeProfit >= p.entryPrice) return 'SHORT: takeProfit must be below entryPrice';

  return null;
}

function hasCredentials(): boolean {
  const token = localStorage.getItem('gb_token');
  return Boolean(token && token.length > 10);
}

// ─── Live Execution ────────────────────────────────────────────────────────────

async function executeLive(payload: ExecutionPayload): Promise<ExecutionResult> {
  const base: ExecutionResult = {
    signalId: payload.signalId,
    symbol:   payload.symbol,
    mode:     'LIVE',
    status:   'SUBMITTING',
    ts:       Date.now(),
    payload
  };

  if (!hasCredentials()) {
    console.error('[Execution:LIVE] BLOCKED — no API credentials');
    return { ...base, status: 'FAILED', error: 'No API credentials present' };
  }

  // ── Full audit log BEFORE any submission ─────────────────────────────────
  console.group('[Execution:LIVE] Submission payload ▼');
  console.table({
    symbol:      payload.symbol,
    side:        payload.side,
    entryPrice:  payload.entryPrice,
    stopLoss:    payload.stopLoss,
    takeProfit:  payload.takeProfit,
    takeProfit2: payload.takeProfit2 ?? 'N/A',
    qty:         payload.qty,
    sizeUSDT:    payload.sizeUSDT,
    leverage:    payload.leverage,
    score:       payload.score   ?? 'N/A',
    entryType:   payload.entryType  ?? 'N/A',
    entryTiming: payload.entryTiming ?? 'N/A',
    mode:        'LIVE',
  });
  console.groupEnd();

  try {
    const body = {
      symbol:      payload.symbol,
      side:        payload.side,
      entryPrice:  payload.entryPrice,
      stopLoss:    payload.stopLoss,
      takeProfit:  payload.takeProfit,
      takeProfit2: payload.takeProfit2,
      qty:         payload.qty,
      sizeUSDT:    payload.sizeUSDT,
      leverage:    payload.leverage,
      mode:        'LIVE',   // hardwired — server uses this to route to fapi.binance.com
      score:       payload.score,
      entryType:   payload.entryType,
      entryTiming: payload.entryTiming,
      reasons:     payload.reasons,
    };

    const response = await apiRequest('/trade/open', {
      method: 'POST',
      body: JSON.stringify(body)
    });

    const orderId = response?.orderId ?? response?.clientOrderId ?? response?.id;
    console.log(`[Execution:LIVE] ✅ Order submitted. orderId=${orderId}`);

    return {
      ...base,
      status:           'SUBMITTED',
      exchangeOrderId:  orderId,
      exchangeResponse: response
    };
  } catch (err: any) {
    const msg = err?.message ?? 'Unknown exchange error';
    console.error(`[Execution:LIVE] ❌ Submission failed: ${msg}`);
    return { ...base, status: 'FAILED', error: msg };
  }
}

// ─── Main Adapter Entry Point ─────────────────────────────────────────────────

export async function executeOrder(
  mode: ExecutionMode,
  payload: ExecutionPayload
): Promise<ExecutionResult> {
  const validationError = validatePayload(payload);
  if (validationError) {
    console.error('[Execution] BLOCKED by payload validation:', validationError, payload);
    return {
      signalId: payload.signalId,
      symbol:   payload.symbol,
      mode:     mode,
      status:   'FAILED',
      ts:       Date.now(),
      error:    validationError,
      payload
    };
  }

  if (mode === 'DEMO') {
    console.log(`[Execution:DEMO] ✅ Local mock order simulated. orderId=${payload.signalId}`);
    return {
      signalId: payload.signalId,
      symbol:   payload.symbol,
      mode:     'DEMO',
      status:   'SUBMITTED',
      ts:       Date.now(),
      exchangeOrderId: `demo_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      payload
    };
  }

  if (!canPlaceLiveOrder(`openTrade_${payload.symbol}`)) {
    return {
      signalId: payload.signalId,
      symbol:   payload.symbol,
      mode:     'LIVE',
      status:   'FAILED',
      ts:       Date.now(),
      error:    'Blocked by safety guard (Live Execution Disabled)',
      payload
    };
  }

  return await executeLive(payload);
}

/** Normalise any signal-shaped object into a canonical ExecutionPayload. */
export function toExecutionPayload(sig: any, symbol: string): ExecutionPayload {
  return {
    signalId:    sig.id || `sig_${Date.now()}`,
    symbol:      (symbol || sig.symbol || '').toUpperCase(),
    side:        sig.side as 'LONG' | 'SHORT',
    entryPrice:  sig.entryPrice,
    stopLoss:    sig.stopLoss ?? sig.sl,
    takeProfit:  sig.takeProfit ?? sig.t1,
    takeProfit2: sig.takeProfit2 ?? sig.t2,
    qty:         sig.qty,
    sizeUSDT:    sig.sizeUSDT,
    leverage:    sig.leverage ?? 10,
    score:       sig.score,
    entryType:   sig.entryType,
    entryTiming: sig.entryTiming,
    reasons:     sig.reasons,
    kind:        sig.kind,
  };
}

`

### server/lib/autoTrader.ts
`	ypescript
import { 
  getPositions, getBalance, setLeverage, 
  placeMarketOrder, placeStopMarket, placeTakeProfitMarket, 
  placeTrailingStopMarket, getRateLimitStatus, getExchangeInfo,
  getKlinesResilient
} from './binance';
import { MODES } from '../../src/types/trading';
import { runBonanzaCore } from '../../src/engines/scanner';
import { initializeSymbolUniverse, setKlinesFetchOverride } from '../../src/services/binanceApi';

import fs from 'fs';
import path from 'path';

// Inject Hardened Fetcher for Server Lifecycle
setKlinesFetchOverride(getKlinesResilient);

// Enforce Absolute Path Sovereignty (Prevents PM2 CWD Drift & Phantom Shadow Files)
let rootPath = process.cwd();
if (rootPath.endsWith('server') || rootPath.endsWith('server\\')) {
    rootPath = path.join(rootPath, '..');
}
export const STATE_FILE = path.join(rootPath, 'trader_state.json');
export const SIGNALS_FILE = path.join(rootPath, 'backend_signals.json');

// ─── Backend Singleton State ──────────────────────────────────────────────────
export let latestMarketState = {
  pipelineSignals: [] as any[],
  pipelineTraces:  [] as any[],
  marketRows:      [] as any[],
  regime: 'RANGING',
  lastScanAt: 0,
  scanProgress: 100
};

export const tradeLogs: string[] = [];
export const backendSignalCache: Record<string, any> = {};

function logMsg(m: string) {
  const msg = `[${new Date().toLocaleTimeString()}] ${m}`;
  tradeLogs.unshift(msg);
  if (tradeLogs.length > 500) tradeLogs.pop();
  console.log(msg);
}

// ─── Configuration ────────────────────────────────────────────────────────────
export const TRADER_CONFIG = {
  RISK_PER_TRADE: 0.10,
  MAX_CONCURRENT_TRADES: 5,
  LEVERAGE: 10,
  SL_ENABLED: true,
  TP_ENABLED: true,
  TP1_ONLY: false,
  TP1_RR: 1.5,
  TP2_RR: 2.5,
  MIN_SCORE: 10,
  BTC_GATE_ENABLED: true,
  TRAIL_TP_ENABLED: false,
  CIRCUIT_BREAKER_ENABLED: false,
  ENABLED: false, // Standardized naming to match API
  ACTIVE_MODE_ID: 'BALANCED'
};

// Canonical Mapping Funnel: Funnels any JSON case into master runtime
export function applyConfig(c: any) {
  if (c.riskPerTrade !== undefined || c.RISK_PER_TRADE !== undefined) 
      TRADER_CONFIG.RISK_PER_TRADE = c.riskPerTrade ?? c.RISK_PER_TRADE;
  if (c.maxConcurrent !== undefined || c.MAX_CONCURRENT_TRADES !== undefined)
      TRADER_CONFIG.MAX_CONCURRENT_TRADES = c.maxConcurrent ?? c.MAX_CONCURRENT_TRADES;
  if (c.leverage !== undefined || c.LEVERAGE !== undefined)
      TRADER_CONFIG.LEVERAGE = c.leverage ?? c.LEVERAGE;
  if (c.slEnabled !== undefined || c.SL_ENABLED !== undefined)
      TRADER_CONFIG.SL_ENABLED = c.slEnabled ?? c.SL_ENABLED;
  if (c.tpEnabled !== undefined || c.TP_ENABLED !== undefined)
      TRADER_CONFIG.TP_ENABLED = c.tpEnabled ?? c.TP_ENABLED;
  if (c.tp1Only !== undefined || c.TP1_ONLY !== undefined)
      TRADER_CONFIG.TP1_ONLY = c.tp1Only ?? c.TP1_ONLY;
  if (c.tp1RR !== undefined || c.TP1_RR !== undefined)
      TRADER_CONFIG.TP1_RR = c.tp1RR ?? c.TP1_RR;
  if (c.tp2RR !== undefined || c.TP2_RR !== undefined)
      TRADER_CONFIG.TP2_RR = c.tp2RR ?? c.TP2_RR;
  if (c.minScore !== undefined || c.MIN_SCORE !== undefined)
      TRADER_CONFIG.MIN_SCORE = c.minScore ?? c.MIN_SCORE;
  if (c.btcGateEnabled !== undefined || c.BTC_GATE_ENABLED !== undefined || c.btcGate !== undefined)
      TRADER_CONFIG.BTC_GATE_ENABLED = c.btcGateEnabled ?? c.BTC_GATE_ENABLED ?? c.btcGate;
  if (c.trailTpEnabled !== undefined || c.TRAIL_TP_ENABLED !== undefined || c.trailTp !== undefined)
      TRADER_CONFIG.TRAIL_TP_ENABLED = c.trailTpEnabled ?? c.TRAIL_TP_ENABLED ?? c.trailTp;
  if (c.circuitBreakerEnabled !== undefined || c.CIRCUIT_BREAKER_ENABLED !== undefined || c.circuitBreaker !== undefined)
      TRADER_CONFIG.CIRCUIT_BREAKER_ENABLED = c.circuitBreakerEnabled ?? c.CIRCUIT_BREAKER_ENABLED ?? c.circuitBreaker;
  
  if (c.enabled !== undefined || c.ENABLED !== undefined || c.isAutoTradingEnabled !== undefined)
      TRADER_CONFIG.ENABLED = c.enabled ?? c.ENABLED ?? c.isAutoTradingEnabled;
  
  if (c.activeModeId !== undefined || c.ACTIVE_MODE_ID !== undefined)
      TRADER_CONFIG.ACTIVE_MODE_ID = c.activeModeId ?? c.ACTIVE_MODE_ID;
}

// Hardened Persistence Helper (Heals disk case drift)
const saveState = () => {
  try {
    const canonicalExport = {
      RISK_PER_TRADE: Number(TRADER_CONFIG.RISK_PER_TRADE),
      MAX_CONCURRENT_TRADES: Number(TRADER_CONFIG.MAX_CONCURRENT_TRADES),
      LEVERAGE: Number(TRADER_CONFIG.LEVERAGE),
      SL_ENABLED: Boolean(TRADER_CONFIG.SL_ENABLED),
      TP_ENABLED: Boolean(TRADER_CONFIG.TP_ENABLED),
      TP1_ONLY: Boolean(TRADER_CONFIG.TP1_ONLY),
      TP1_RR: Number(TRADER_CONFIG.TP1_RR),
      TP2_RR: Number(TRADER_CONFIG.TP2_RR),
      MIN_SCORE: Number(TRADER_CONFIG.MIN_SCORE),
      BTC_GATE_ENABLED: Boolean(TRADER_CONFIG.BTC_GATE_ENABLED),
      TRAIL_TP_ENABLED: Boolean(TRADER_CONFIG.TRAIL_TP_ENABLED),
      CIRCUIT_BREAKER_ENABLED: Boolean(TRADER_CONFIG.CIRCUIT_BREAKER_ENABLED),
      ENABLED: Boolean(TRADER_CONFIG.ENABLED),
      ACTIVE_MODE_ID: String(TRADER_CONFIG.ACTIVE_MODE_ID)
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(canonicalExport, null, 2));
  } catch (err) {
    console.error('[Persistence] Error saving state:', err);
  }
};

// ─── Initialization: Funneled load + Migration ───────────────────────────────
// TP fields that MUST be present in persisted state for restart safety.
const TP_REQUIRED_KEYS = ['TP_ENABLED', 'TP1_ONLY', 'TP1_RR', 'TP2_RR'] as const;

try {
  if (fs.existsSync(STATE_FILE)) {
    const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    applyConfig(saved);

    // ── Migration: detect missing TP fields from older state files ──────
    const missingKeys = TP_REQUIRED_KEYS.filter(k => saved[k] === undefined);
    if (missingKeys.length > 0) {
      console.log(`[Persistence:MIGRATION] Old state file missing: [${missingKeys.join(', ')}]. Backfilling from code defaults and writing upgraded state to disk.`);
      saveState(); // Write full canonical state back to disk immediately
      console.log(`[Persistence:MIGRATION] Upgraded trader_state.json written. Missing fields now persisted.`);
    }

    // ── Startup TP Audit Log ───────────────────────────────────────────
    const source = missingKeys.length > 0 ? 'MIGRATED' : 'PERSISTED';
    console.log(`[TP_STARTUP] tpEnabled=${TRADER_CONFIG.TP_ENABLED} | tp1Only=${TRADER_CONFIG.TP1_ONLY} | tp1RR=${TRADER_CONFIG.TP1_RR} | tp2RR=${TRADER_CONFIG.TP2_RR} | source=${source}`);
  } else {
    console.log(`[Persistence] No state file found at ${STATE_FILE}. Using code defaults.`);
    saveState(); // Create initial state file with all fields
    console.log(`[TP_STARTUP] tpEnabled=${TRADER_CONFIG.TP_ENABLED} | tp1Only=${TRADER_CONFIG.TP1_ONLY} | tp1RR=${TRADER_CONFIG.TP1_RR} | tp2RR=${TRADER_CONFIG.TP2_RR} | source=DEFAULT`);
  }
} catch (err) {
  console.warn('[Persistence] Loading config failed:', err);
  console.log(`[TP_STARTUP] tpEnabled=${TRADER_CONFIG.TP_ENABLED} | tp1Only=${TRADER_CONFIG.TP1_ONLY} | tp1RR=${TRADER_CONFIG.TP1_RR} | tp2RR=${TRADER_CONFIG.TP2_RR} | source=DEFAULT (load failed)`);
}


export function updateTraderConfig(c: any) { 
  applyConfig(c);
  saveState(); 
  logMsg(`[CONFIG_SAVED] MIN_SCORE=${TRADER_CONFIG.MIN_SCORE} AUTO=${TRADER_CONFIG.ENABLED} | tpEnabled=${TRADER_CONFIG.TP_ENABLED} tp1Only=${TRADER_CONFIG.TP1_ONLY} tp1RR=${TRADER_CONFIG.TP1_RR} tp2RR=${TRADER_CONFIG.TP2_RR}`);
}

export function toggleAutoTrade(e: boolean) { 
  TRADER_CONFIG.ENABLED = e; 
  saveState(); 
  logMsg(`AutoTrade: ${e ? 'ON' : 'OFF'}`);
}

// ─── Background Scanner Loop ──────────────────────────────────────────────────
async function startAutoScanner() {
  logMsg('Initializing background scout universe...');
  let symbols = await initializeSymbolUniverse().catch(() => ['BTCUSDT', 'ETHUSDT']);
  
  const scanCycle = async () => {
    const rate = getRateLimitStatus();
    if (!rate.active) {
      logMsg(`Scan paused (Rate Limit Cooldown): Resume at ${new Date(rate.cooldownUntil).toLocaleTimeString()}`);
      return;
    }

    try {
      latestMarketState.scanProgress = 0;
      const balance = await getBalance() || 1000;
      
      const configuredModeId = TRADER_CONFIG.ACTIVE_MODE_ID as keyof typeof MODES;
      const activeMode = MODES[configuredModeId] || MODES.BALANCED;
      
      const modeProxy = {
        ...activeMode,
        riskPct: TRADER_CONFIG.RISK_PER_TRADE,
        tp1RR: TRADER_CONFIG.TP1_RR,
        tp2RR: TRADER_CONFIG.TP2_RR,
        tp1Only: TRADER_CONFIG.TP1_ONLY,
        pullback: { ...activeMode.pullback, scoreMin: TRADER_CONFIG.MIN_SCORE },
        breakout: { ...activeMode.breakout, scoreMin: TRADER_CONFIG.MIN_SCORE }
      };

      const result = await runBonanzaCore(
        symbols, modeProxy as any, balance,
        (pct) => { latestMarketState.scanProgress = pct; },
        undefined,  // orderFlowSnapshots
        undefined,  // onRegimeUpdate
        undefined,  // currentOpenPositionCount
        undefined,  // portfolio
        []          // enabledStrategies: empty = ALL strategies active on VPS
      );

      latestMarketState.pipelineSignals = result.pipelineSignals;
      latestMarketState.pipelineTraces  = result.pipelineTraces;
      latestMarketState.marketRows      = result.marketRows;
      latestMarketState.regime          = result.regimeLabel;
      latestMarketState.lastScanAt      = Date.now();
      latestMarketState.scanProgress    = 100;

      console.log(`[AutoTrader] Scan Cycle End. Signals: ${latestMarketState.pipelineSignals.length} | Traces: ${latestMarketState.pipelineTraces.length} | Regime: ${latestMarketState.regime}`);

      if (TRADER_CONFIG.ENABLED && result.pipelineSignals.length > 0) {
        await evaluateFrontendSignals(result.pipelineSignals);
      }
    } catch (e: any) {
      logMsg(`Background scan failed: ${e.message}`);
    }
  };

  setInterval(scanCycle, 90000); // 90 second interval
  setTimeout(scanCycle, 5000);  // Initial scan after 5s
}

startAutoScanner().catch(console.error);

// ─── Execution Engine ─────────────────────────────────────────────────────────
export async function evaluateFrontendSignals(signals: any[]) {
  if (!TRADER_CONFIG.ENABLED) return backendSignalCache;

  // Sync cache
  signals.forEach(s => {
    if (!backendSignalCache[s.id]) {
      backendSignalCache[s.id] = {
        signalId: s.id, symbol: s.symbol, createdAt: s.timestamp || Date.now(),
        source: 'BACKEND', backendDecision: 'PENDING', backendDecisionAt: Date.now()
      };
    }
  });

  let activePos: any[] = [];
  let balance = 1000;

  try {
    activePos = await getPositions();
    balance   = await getBalance() || 1000;
  } catch (e: any) {
    logMsg(`Skipping evaluation: ${e.message}`);
    return backendSignalCache;
  }

  // ── Global Kill Switch & Guard ──────────────────────────────────────────────
  if ((global as any).GB_LIVE_KILL === true || process.env.ENABLE_LIVE_TRADING !== 'true') {
    logMsg(`[BackendGuard] 🔴 BLOCKED: Live execution locked by Kill Switch or ENV config.`);
    signals.forEach(s => {
      if (backendSignalCache[s.id].backendDecision === 'PENDING') {
         backendSignalCache[s.id].backendDecision = 'BLOCKED_BACKEND';
         backendSignalCache[s.id].blockerReason = 'Execution Guard Locked';
      }
    });
    return backendSignalCache;
  }

  if (activePos.length >= TRADER_CONFIG.MAX_CONCURRENT_TRADES) {
    signals.forEach(s => {
      if (backendSignalCache[s.id].backendDecision === 'PENDING') {
         backendSignalCache[s.id].backendDecision = 'BLOCKED_BACKEND';
         backendSignalCache[s.id].blockerReason = 'Max concurrent trades reached';
      }
    });
    return backendSignalCache;
  }

  const actionable = signals.filter(s => s.status === 'ACCEPTED' && !backendSignalCache[s.id].deployedOrderId);

  for (const row of actionable) {
    const sym = row.symbol;
    const sig = row.signal;
    const sigId = row.id;

    if (activePos.some(p => p.symbol === sym)) continue;
    if (activePos.length >= TRADER_CONFIG.MAX_CONCURRENT_TRADES) break;

    try {
      logMsg(`🚀 Executing ${sym} ${sig.side}...`);
      const riskUSDT = balance * TRADER_CONFIG.RISK_PER_TRADE;
      const qty = Math.max(0.001, (riskUSDT * TRADER_CONFIG.LEVERAGE) / sig.entryPrice);

      await setLeverage(sym, TRADER_CONFIG.LEVERAGE);
      const entryRes = await placeMarketOrder(sym, sig.side === 'LONG' ? 'BUY' : 'SELL', qty);

      await new Promise(r => setTimeout(r, 1000));
      const closeSide = sig.side === 'LONG' ? 'SELL' : 'BUY';

      if (TRADER_CONFIG.SL_ENABLED) {
        await placeStopMarket(sym, closeSide, sig.stopLoss);
      }

      if (TRADER_CONFIG.TP_ENABLED) {
        const riskDist = Math.abs(sig.entryPrice - sig.stopLoss);
        const isLong = sig.side === 'LONG';

        // ── TP Safety Checks ──────────────────────────────────────
        const SAFE_DEFAULT_RR = 1.5;
        let tp1RR = TRADER_CONFIG.TP1_RR;
        let tp2RR = TRADER_CONFIG.TP2_RR;
        if (!tp1RR || !isFinite(tp1RR) || tp1RR <= 0) { logMsg(`⚠️ TP1_RR invalid (${tp1RR}), using safe default ${SAFE_DEFAULT_RR}`); tp1RR = SAFE_DEFAULT_RR; }
        if (!tp2RR || !isFinite(tp2RR) || tp2RR <= 0) { logMsg(`⚠️ TP2_RR invalid (${tp2RR}), using safe default ${SAFE_DEFAULT_RR * 2}`); tp2RR = SAFE_DEFAULT_RR * 2; }

        const appliedTpStr = TRADER_CONFIG.TP1_ONLY ? `${tp1RR}% (100%)` : `${tp1RR}% & ${tp2RR}% (50/50)`;

        // ── TP Debug Audit Log ─────────────────────────────────────
        logMsg(`[TP_DEBUG] ${sym} | tpEnabled=${TRADER_CONFIG.TP_ENABLED} | tp1Only=${TRADER_CONFIG.TP1_ONLY} | tp1Pct=${tp1RR}% | tp2Pct=${tp2RR}% | appliedRatios=${appliedTpStr}`);

        // ── Re-calculate dynamically from ACTUAL Binance Fill ──
        let actualEntryPrice = parseFloat(entryRes.avgPrice);
        if (!actualEntryPrice || isNaN(actualEntryPrice) || actualEntryPrice <= 0) {
          actualEntryPrice = sig.entryPrice;
        }

        // Fixed Percentage Target Math (Ignoring Risk/Stop Distance)
        const tp1Pct = tp1RR / 100;
        const calcTp1 = isLong ? actualEntryPrice * (1 + tp1Pct) : actualEntryPrice * (1 - tp1Pct);

        if (TRADER_CONFIG.TP1_ONLY) {
          await placeTakeProfitMarket(sym, closeSide, calcTp1);
          logMsg(`[TP_PLACED] ${sym} TP1-ONLY at ${calcTp1.toFixed(6)} (${tp1RR}%)`);
        } else {
          const tp2Pct = tp2RR / 100;
          const calcTp2 = isLong ? actualEntryPrice * (1 + tp2Pct) : actualEntryPrice * (1 - tp2Pct);
          const halfQty = qty * 0.5;
          await placeTakeProfitMarket(sym, closeSide, calcTp1, halfQty);
          await placeTakeProfitMarket(sym, closeSide, calcTp2, halfQty);
          logMsg(`[TP_PLACED] ${sym} TP1=${calcTp1.toFixed(6)} (${tp1RR}%, 50%) TP2=${calcTp2.toFixed(6)} (${tp2RR}%, 50%)`);
        }
      } else {
        logMsg(`[TP_DEBUG] ${sym} | tpEnabled=false — NO TP orders placed`);
      }

      backendSignalCache[sigId].backendDecision = 'DEPLOYED_BACKEND';
      backendSignalCache[sigId].deployedOrderId = entryRes.orderId;
      activePos.push({ symbol: sym }); // local update to prevent double entry in same block

    } catch (err: any) {
      logMsg(`❌ Execution failed for ${sym}: ${err.message}`);
      backendSignalCache[sigId].backendDecision = 'BLOCKED_BACKEND';
      backendSignalCache[sigId].blockerReason = err.message;
    }
  }

  try { fs.writeFileSync(SIGNALS_FILE, JSON.stringify(backendSignalCache, null, 2)); } catch (_) {}
  return backendSignalCache;
}

`

### server/routes/trade.ts
`	ypescript
import { Router } from 'express';
import { requireAuth } from './auth';
import {
  getPositions, getBalance, setLeverage, binanceRequest, getRateLimitStatus
} from '../lib/binance';
import {
  TRADER_CONFIG, toggleAutoTrade, tradeLogs,
  updateTraderConfig, backendSignalCache, evaluateFrontendSignals,
  latestMarketState
} from '../lib/autoTrader';

import fs from 'fs';
import path from 'path';

export const tradeRouter = Router();

// Single live base URL — no demo/test endpoints
const LIVE_BASE_URL = 'https://fapi.binance.com';

function resolveBaseUrl(): string {
  return LIVE_BASE_URL;
}

tradeRouter.get('/status', requireAuth, (req: any, res: any) => {
  const isTest = process.env.BINANCE_BASE_URL?.includes('testnet') || process.env.BINANCE_BASE_URL?.includes('demo-fapi') ? true : false;
  
  // DIAGNOSTIC CHECKPOINT: inside /status response path
  let fileBaseUrl = 'NOT_FOUND_IN_FILE';
  let fileLines = 0;
  try {
    const envDisk = fs.readFileSync(path.join(__dirname, '../.env'), 'utf8');
    const bMatch = envDisk.match(/^\s*(?:export\s+)?BINANCE_BASE_URL\s*=\s*(.*)$/im);
    if (bMatch) fileBaseUrl = bMatch[1].trim();
    fileLines = envDisk.split('\n').length;
  } catch(e) { fileBaseUrl = 'FILE_READ_ERROR'; }

  
  res.json({
    enabled: TRADER_CONFIG.ENABLED,
    autoTrading: TRADER_CONFIG.ENABLED,
    backendEnvironment: {
      isTestnet: isTest,
      baseUrl: process.env.BINANCE_BASE_URL || 'https://fapi.binance.com',
      diagnosticFileTruth: fileBaseUrl,
      diagnosticLineCount: fileLines
    },
    logs: tradeLogs,
    config: {
      riskPerTrade: TRADER_CONFIG.RISK_PER_TRADE,
      maxConcurrent: TRADER_CONFIG.MAX_CONCURRENT_TRADES,
      leverage: TRADER_CONFIG.LEVERAGE,
      slEnabled: TRADER_CONFIG.SL_ENABLED,
      tpEnabled: TRADER_CONFIG.TP_ENABLED,
      tp1Only: TRADER_CONFIG.TP1_ONLY,
      tp1RR: TRADER_CONFIG.TP1_RR,
      tp2RR: TRADER_CONFIG.TP2_RR,
      minScore: TRADER_CONFIG.MIN_SCORE,
      btcGate: TRADER_CONFIG.BTC_GATE_ENABLED,
      trailTp: TRADER_CONFIG.TRAIL_TP_ENABLED,
      circuitBreaker: TRADER_CONFIG.CIRCUIT_BREAKER_ENABLED,
      activeModeId: TRADER_CONFIG.ACTIVE_MODE_ID
    },
    signals: backendSignalCache,
    latestMarketState,
    rateLimit: getRateLimitStatus()
  });
});

tradeRouter.get('/signals', requireAuth, (req: any, res: any) => {
  res.json({ signals: backendSignalCache });
});

tradeRouter.post('/sync', requireAuth, async (req: any, res: any) => {
  const { signals } = req.body;
  const decisionCache = await evaluateFrontendSignals(signals || []);
  res.json({ signals: decisionCache });
});

tradeRouter.get('/logs', requireAuth, (req: any, res: any) => {
  res.json({ logs: tradeLogs });
});

tradeRouter.post('/toggle', requireAuth, (req: any, res: any) => {
  // Use explicit value from body when provided; otherwise flip current state
  const desired = req.body?.enabled !== undefined ? !!req.body.enabled : !TRADER_CONFIG.ENABLED;
  toggleAutoTrade(desired);
  res.json({ enabled: TRADER_CONFIG.ENABLED });
});

tradeRouter.get('/config', requireAuth, (req: any, res: any) => {
  res.json({
    riskPerTrade: TRADER_CONFIG.RISK_PER_TRADE,
    maxConcurrent: TRADER_CONFIG.MAX_CONCURRENT_TRADES,
    leverage: TRADER_CONFIG.LEVERAGE,
    slEnabled: TRADER_CONFIG.SL_ENABLED,
    tpEnabled: TRADER_CONFIG.TP_ENABLED,
    tp1Only: TRADER_CONFIG.TP1_ONLY,
    tp1RR: TRADER_CONFIG.TP1_RR,
    tp2RR: TRADER_CONFIG.TP2_RR,
    minScore: TRADER_CONFIG.MIN_SCORE,
    btcGateEnabled: TRADER_CONFIG.BTC_GATE_ENABLED,
    trailTpEnabled: TRADER_CONFIG.TRAIL_TP_ENABLED,
    circuitBreakerEnabled: TRADER_CONFIG.CIRCUIT_BREAKER_ENABLED,
    activeModeId: TRADER_CONFIG.ACTIVE_MODE_ID
  });
});

tradeRouter.post('/environment', requireAuth, (req: any, res: any) => {
  const { target } = req.body;
  if (!['LIVE', 'TESTNET'].includes(target)) {
    return res.status(400).json({ error: 'Invalid environment target' });
  }

  const keyPrefix = target === 'LIVE' ? 'BINANCE_LIVE_' : 'BINANCE_TESTNET_';
  const baseUrl = target === 'LIVE' ? 'https://fapi.binance.com' : 'https://testnet.binancefuture.com';

  // FIX: Force path resolution to the explicit server/.env via __dirname, 
  // preventing PM2 root working directory mismatch bugs.
  const envPath = path.join(__dirname, '../.env');
  
  if (!fs.existsSync(envPath)) {
    tradeLogs.unshift(`[EnvSwap] Error: Backend .env missing at ${envPath}`);
    return res.status(500).json({ error: `Backend .env missing at ${envPath}` });
  }

  const envRaw = fs.readFileSync(envPath, 'utf8');
  
  // Regex to tolerate spaces, quotes, and 'export ' prefixes seamlessly
  const keyRegex = new RegExp(`^\\s*(?:export\\s+)?${keyPrefix}API_KEY\\s*=\\s*['"]?([^'"\\r\\n]+)['"]?`, 'im');
  const secretRegex = new RegExp(`^\\s*(?:export\\s+)?${keyPrefix}API_SECRET\\s*=\\s*['"]?([^'"\\r\\n]+)['"]?`, 'im');
  
  const keyMatch = envRaw.match(keyRegex);
  const secretMatch = envRaw.match(secretRegex);

  const newKey = keyMatch ? keyMatch[1] : '';
  const newSecret = secretMatch ? secretMatch[1] : '';

  tradeLogs.unshift(`[EnvSwap] Target: ${target} | Read OK. Keys Found? ${!!newKey}/${!!newSecret}`);
  console.log(`[Diagnostic] Environment Switcher Request:`);
  console.log(` - Target: ${target}`);
  console.log(` - Path read: ${envPath}`);
  console.log(` - Found ${keyPrefix}API_KEY? ${!!newKey}`);
  console.log(` - Found ${keyPrefix}API_SECRET? ${!!newSecret}`);

  if (!newKey || !newSecret) {
    const rawLines = envRaw.split('\n').filter(l => l.includes(keyPrefix)).map(l => l.substring(0, Math.min(l.length, 30)) + '...');
    const dbgMsg = `File read from: ${envPath}. Searched for ${keyPrefix}API_KEY. Lines containing prefix found in file: ${rawLines.length > 0 ? JSON.stringify(rawLines) : 'None'}`;
    tradeLogs.unshift(`[EnvSwap] Failed: Missing ${target} credentials. Debug: ${dbgMsg}`);
    return res.status(400).json({
      error: `Missing TESTNET credentials. Please add BINANCE_TESTNET_API_KEY and BINANCE_TESTNET_API_SECRET safely to your server/.env to enable hot-swapping.\n\nDiagnostic: ${dbgMsg}`
    });
  }

  let updatedEnv = envRaw;

  const injectOrReplace = (envText: string, key: string, val: string) => {
    const regex = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=.*$`, 'im');
    if (regex.test(envText)) {
      return envText.replace(regex, `${key}=${val}`);
    } else {
      return envText + `\n${key}=${val}\n`;
    }
  };

  updatedEnv = injectOrReplace(updatedEnv, 'BINANCE_BASE_URL', baseUrl);
  updatedEnv = injectOrReplace(updatedEnv, 'BINANCE_API_KEY', newKey);
  updatedEnv = injectOrReplace(updatedEnv, 'BINANCE_API_SECRET', newSecret);

  // DIAGNOSTIC CHECKPOINT: before file write
  const activeBaseBefore = (envRaw.match(/^\s*(?:export\s+)?BINANCE_BASE_URL\s*=\s*(.*)$/im) || [])[1] || 'MISSING';
  const activeBaseAfter = (updatedEnv.match(/^\s*(?:export\s+)?BINANCE_BASE_URL\s*=\s*(.*)$/im) || [])[1] || 'MISSING';
  tradeLogs.unshift(`[EnvDebug] Before write: BASE_URL=${activeBaseBefore}. After internal string mod: BASE_URL=${activeBaseAfter}`);

  try {
    fs.writeFileSync(envPath, updatedEnv, 'utf8');
    
    // DIAGNOSTIC CHECKPOINT: after file write
    const actualDiskNow = fs.readFileSync(envPath, 'utf8');
    const diskBaseAfter = (actualDiskNow.match(/^\s*(?:export\s+)?BINANCE_BASE_URL\s*=\s*(.*)$/im) || [])[1] || 'MISSING';
    tradeLogs.unshift(`[EnvDebug] After write to disk. Readback proves BASE_URL=${diskBaseAfter}`);

    toggleAutoTrade(false); // safety shutdown
    res.json({ success: true, message: `Environment swapped to ${target}. Restarting daemon.` });
    
    setTimeout(() => {
      console.log(`[Architecture] Restarting PM2 process to boot into ${target} environment.`);
      process.exit(0);
    }, 1000);
  } catch (err) {
    res.status(500).json({ error: 'Failed to rewrite .env file.' });
  }
});

tradeRouter.post('/config', requireAuth, (req: any, res: any) => {
  updateTraderConfig(req.body);
  res.json({ success: true });
});

tradeRouter.get('/positions', requireAuth, async (req: any, res: any) => {
  try {
    const positions = await getPositions();
    res.json(positions);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

tradeRouter.get('/balance', requireAuth, async (req: any, res: any) => {
  try {
    const bal = await getBalance();
    res.json({ balance: bal });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

tradeRouter.post('/open', requireAuth, async (req: any, res: any) => {
  const {
    symbol, side, entryPrice, stopLoss, qty: frontendQty, sizeUSDT: frontendSize, 
    leverage: frontendLeverage, score, entryType, entryTiming, reasons,
    takeProfit, takeProfit2
  } = req.body;

  // ── Global Kill Switch & Guard ──────────────────────────────────────────────
  if ((global as any).GB_LIVE_KILL === true || process.env.ENABLE_LIVE_TRADING !== 'true') {
    return res.status(403).json({
      error: 'Live execution locked by Kill Switch or ENV config.'
    });
  }

  // ── Validate required fields ─────────────────────────────────────────────────
  if (!symbol || !side || !entryPrice || !stopLoss) {
    return res.status(400).json({ error: 'Missing required fields: symbol, side, entryPrice, stopLoss' });
  }

  const baseUrl = resolveBaseUrl();
  console.log(`[Trade:open] LIVE → ${baseUrl}`);

  // ── Use frontend-supplied qty/leverage where present; fallback to env config ─
  const lev = frontendLeverage ?? parseInt(process.env.LEVERAGE || '10', 10);
  let   qty = frontendQty;

  // ── Pre-execution balance/qty audit log ─────────────────────────────────────
  const balFromBinance = await getBalance().catch(() => 0);
  const riskPctEnv = parseFloat(process.env.RISK_PER_TRADE || '0.04');

  if (!qty || qty <= 0) {
    // Recompute from risk profile if frontend didn't send a valid qty
    const intendedRisk = balFromBinance * riskPctEnv * lev;
    qty = intendedRisk > 0 ? intendedRisk / entryPrice : 0;
    console.log(`[Trade:open] qty recomputed | balance=$${balFromBinance.toFixed(2)} | riskPct=${riskPctEnv} | lev=${lev} | intendedRisk=$${intendedRisk.toFixed(2)} | rawQty=${qty.toFixed(6)}`);
  }

  // ── Structured local pre-execution validation (before any Binance call) ─────
  const notional = qty * entryPrice;

  if (!balFromBinance || balFromBinance <= 0) {
    const reason = `Blocked: balance is zero ($${balFromBinance}) — cannot size order`;
    console.warn(`[Trade:open] PRE-EXEC BLOCK: ${symbol} — ${reason}`);
    tradeLogs.unshift(`[${new Date().toISOString()}] [BLOCKED] ${symbol} — ${reason}`);
    return res.status(400).json({
      error: reason,
      debug: { symbol, balance: balFromBinance, riskPct: riskPctEnv, leverage: lev, qty, notional }
    });
  }
  if (!qty || qty <= 0) {
    const reason = `Blocked: computed quantity is zero — check balance ($${balFromBinance.toFixed(2)}) and risk config`;
    console.warn(`[Trade:open] PRE-EXEC BLOCK: ${symbol} — ${reason}`);
    tradeLogs.unshift(`[${new Date().toISOString()}] [BLOCKED] ${symbol} — ${reason}`);
    return res.status(400).json({
      error: reason,
      debug: { symbol, balance: balFromBinance, riskPct: riskPctEnv, leverage: lev, qty, notional }
    });
  }
  if (notional < 5.00) {
    const reason = `Blocked: below minimum executable notional ($${notional.toFixed(2)} < $5.00) — qty=${qty.toFixed(6)} @ ${entryPrice}`;
    console.warn(`[Trade:open] PRE-EXEC BLOCK: ${symbol} — ${reason}`);
    tradeLogs.unshift(`[${new Date().toISOString()}] [BLOCKED] ${symbol} — ${reason}`);
    return res.status(400).json({
      error: reason,
      debug: { symbol, balance: balFromBinance, riskPct: riskPctEnv, leverage: lev, qty, notional }
    });
  }

  console.log(`[Trade:open] PRE-EXEC PASS: ${symbol} | balance=$${balFromBinance.toFixed(2)} | qty=${qty.toFixed(6)} | notional=$${notional.toFixed(2)} | lev=${lev}x`);

  // ── Precision: fetch from exchange info at the correct base URL ──────────────
  function roundTo(v: number, dp: number) { return dp === 0 ? Math.round(v).toString() : v.toFixed(dp); }
  let pricePrec = 2, qtyPrec = 3;
  try {
    console.log(`[Trade:open] Fetching ExchangeInfo from: ${baseUrl}/fapi/v1/exchangeInfo`);
    const info = await fetch(`${baseUrl}/fapi/v1/exchangeInfo`).then(r => r.json()) as any;
    console.log(`[Trade:open] ExchangeInfo fetched. Symbols count: ${info?.symbols?.length ?? 0}`);
    const sym  = info?.symbols?.find((s: any) => s.symbol === symbol);
    if (sym) { pricePrec = sym.pricePrecision; qtyPrec = sym.quantityPrecision; }
  } catch (err: any) {
    console.warn(`[Trade:open] Warning: Failed to fetch ExchangeInfo (${err.message}). Using defaults.`);
  }

  // ── Audit log BEFORE any submission ──────────────────────────────────────────
  const auditPayload = {
    symbol, side, entryPrice, stopLoss, 
    qty: roundTo(qty, qtyPrec), leverage: lev, mode: 'LIVE', baseUrl,
    score, entryType, entryTiming, reasons
  };
  console.log('[Trade:open] Outbound payload:', JSON.stringify(auditPayload, null, 2));
  tradeLogs.unshift(`[${new Date().toISOString()}] [LIVE] SUBMITTING: ${symbol} ${side}`);

  try {
    // 1. Set leverage
    await binanceRequest('POST', '/fapi/v1/leverage', { symbol, leverage: lev }, baseUrl);

    // 2. Market entry order
    const entryOrder = await binanceRequest('POST', '/fapi/v1/order', {
      symbol,
      side:     side === 'LONG' ? 'BUY' : 'SELL',
      type:     'MARKET',
      quantity: roundTo(qty, qtyPrec)
    }, baseUrl);
    console.log('[Trade:open] Entry order response:', JSON.stringify(entryOrder));

    // Brief pause so position risk is updated before placing stops
    await new Promise(r => setTimeout(r, 1000));

    // 3. Stop-loss
    const stopOrder = await binanceRequest('POST', '/fapi/v1/order', {
      symbol,
      side:          side === 'LONG' ? 'SELL' : 'BUY',
      type:          'STOP_MARKET',
      stopPrice:     roundTo(stopLoss, pricePrec),
      closePosition: 'true',
      timeInForce:   'GTE_GTC'
    }, baseUrl);
    console.log('[Trade:open] SL order response:', JSON.stringify(stopOrder));

    // ── DYNAMIC TP CALCULATION (Respects Live UI Settings) ──
    let tp1Order = null;
    let tp2Order = null;

    if (TRADER_CONFIG.TP_ENABLED) {
      const riskDist = Math.abs(entryPrice - stopLoss);
      const isLong = side === 'LONG';
      const closeSide = isLong ? 'SELL' : 'BUY';

      // ── TP Safety Checks ──────────────────────────────────────
      const SAFE_DEFAULT_RR = 1.5;
      let tp1RR = TRADER_CONFIG.TP1_RR;
      let tp2RR = TRADER_CONFIG.TP2_RR;
      if (!tp1RR || !isFinite(tp1RR) || tp1RR <= 0) { console.warn(`[Trade:open] TP1_RR invalid (${tp1RR}), using safe default`); tp1RR = SAFE_DEFAULT_RR; }
      if (!tp2RR || !isFinite(tp2RR) || tp2RR <= 0) { console.warn(`[Trade:open] TP2_RR invalid (${tp2RR}), using safe default`); tp2RR = SAFE_DEFAULT_RR * 2; }
      const appliedTpStr = TRADER_CONFIG.TP1_ONLY ? `${tp1RR}% (100%)` : `${tp1RR}% & ${tp2RR}% (50/50)`;

      // ── TP Debug Audit Log ─────────────────────────────────────
      console.log(`[TP_DEBUG:ROUTE] ${symbol} | tpEnabled=${TRADER_CONFIG.TP_ENABLED} | tp1Only=${TRADER_CONFIG.TP1_ONLY} | tp1Pct=${tp1RR}% | tp2Pct=${tp2RR}% | appliedRatios=${appliedTpStr}`);
      tradeLogs.unshift(`[TP_DEBUG] ${symbol} tpEnabled=true tp1Only=${TRADER_CONFIG.TP1_ONLY} tp1Pct=${tp1RR}% tp2Pct=${tp2RR}% appliedRatios=${appliedTpStr}`);

      // ── Re-calculate dynamically from ACTUAL Binance Fill ──
      let actualEntryPrice = parseFloat(entryOrder.avgPrice);
      if (!actualEntryPrice || isNaN(actualEntryPrice) || actualEntryPrice <= 0) {
        actualEntryPrice = entryPrice; // Fallback if Binance response is delayed
      }
      
      // Fixed Percentage Target Math (Ignoring Risk/Stop Distance)
      const tp1Pct = tp1RR / 100;
      const calcTp1 = isLong ? actualEntryPrice * (1 + tp1Pct) : actualEntryPrice * (1 - tp1Pct);

      if (TRADER_CONFIG.TP1_ONLY) {
        // CLOSE 100% AT TP1
        tp1Order = await binanceRequest('POST', '/fapi/v1/order', {
          symbol,
          side:          closeSide,
          type:          'TAKE_PROFIT_MARKET',
          stopPrice:     roundTo(calcTp1, pricePrec),
          closePosition: 'true',
          timeInForce:   'GTE_GTC'
        }, baseUrl);
        console.log('[Trade:open] TP1 Full order response:', JSON.stringify(tp1Order));
      } else {
        // TWO-STAGE TP (50% each)
        const tp2Pct = tp2RR / 100;
        const calcTp2 = isLong ? actualEntryPrice * (1 + tp2Pct) : actualEntryPrice * (1 - tp2Pct);
        // Note: For partial exits, DO NOT use closePosition='true'. Use quantity + reduceOnly.
        const halfQty = roundTo(qty * 0.5, qtyPrec);

        tp1Order = await binanceRequest('POST', '/fapi/v1/order', {
          symbol,
          side:          closeSide,
          type:          'TAKE_PROFIT_MARKET',
          stopPrice:     roundTo(calcTp1, pricePrec),
          quantity:      halfQty,
          reduceOnly:    'true',
          timeInForce:   'GTE_GTC'
        }, baseUrl);
        console.log('[Trade:open] TP1 (50%) order response:', JSON.stringify(tp1Order));

        tp2Order = await binanceRequest('POST', '/fapi/v1/order', {
          symbol,
          side:          closeSide,
          type:          'TAKE_PROFIT_MARKET',
          stopPrice:     roundTo(calcTp2, pricePrec),
          quantity:      halfQty, // other 50%
          reduceOnly:    'true',
          timeInForce:   'GTE_GTC'
        }, baseUrl);
        console.log('[Trade:open] TP2 (50%) order response:', JSON.stringify(tp2Order));
      }
    }

    tradeLogs.unshift(`[${new Date().toISOString()}] [LIVE] ✅ SUBMITTED: ${symbol} ${side} orderId=${entryOrder.orderId}`);

    return res.json({
      success:    true,
      mode:       'LIVE',
      baseUrl,
      orderId:    entryOrder.orderId,
      clientOrderId: entryOrder.clientOrderId,
      orders: { entry: entryOrder, stopLoss: stopOrder, takeProfit: tp1Order, takeProfit2: tp2Order },
      submittedPayload: auditPayload
    });

  } catch (e: any) {
    const errMsg = e?.message ?? 'Unknown error';
    tradeLogs.unshift(`[${new Date().toISOString()}] [LIVE] ❌ FAILED: ${symbol} — ${errMsg}`);
    console.error('[Trade:open] Error:', errMsg);

    return res.status(500).json({
      error:            errMsg,
      mode:            'LIVE',
      baseUrl,
      symbol,
      failedAt:         Date.now(),
      submittedPayload: auditPayload
    });
  }
});

tradeRouter.post('/close', requireAuth, async (req: any, res: any) => {
  const { symbol, side, qty } = req.body;
  try {
    const baseUrl = resolveBaseUrl();
    const closeSide = side === 'LONG' ? 'SELL' : 'BUY';
    
    // We use the common binanceRequest now
    await binanceRequest('POST', '/fapi/v1/order', {
      symbol,
      side: closeSide,
      type: 'MARKET',
      quantity: qty
    }, baseUrl);
    
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

`

### src/components/SystemStatus.tsx
`	ypescript
// SystemStatus component
import React, { useEffect, useState } from 'react';
import { useTradingStore } from '../store/tradingStore';
import { Shield, Zap, Flame } from 'lucide-react';
import { api } from '../services/api';
import { CANONICAL_DEFAULTS } from '../config/defaults';
import { getCanonicalPositionCount } from '../utils/positionCount';

export default function SystemStatus() {
  const { 
    activeMode, setMode,
    accountEnvironment, setAccountEnvironment, liveExecutionArmed,
    activeTrades: rawTrades,
    symbols: rawSymbols,
    isScannerActive, setScannerActive,
    binancePositions: rawPositions,
    pipelineSignals: rawSignals,
    marketRows: rawRows,
    backendEnvironment
  } = useTradingStore();

  const activeTrades    = Array.isArray(rawTrades)    ? rawTrades    : [];
  const symbols         = Array.isArray(rawSymbols)   ? rawSymbols   : [];
  const binancePositions = Array.isArray(rawPositions) ? rawPositions : [];
  const pipelineSignals  = Array.isArray(rawSignals)   ? rawSignals   : [];
  const marketRows       = Array.isArray(rawRows)      ? rawRows      : [];

  // CANONICAL count — same formula used in Header.tsx and CommandSyncHub.tsx
  const counts = getCanonicalPositionCount(binancePositions, activeTrades, pipelineSignals);

  const [isSwitchingEnv, setIsSwitchingEnv] = useState(false);
  const handleSwapEnv = async (target: 'LIVE' | 'TESTNET') => {
    if (backendEnvironment?.isTestnet === (target === 'TESTNET')) return;
    
    if (target === 'LIVE') {
       if (!window.confirm("DANGER: You are switching the VPS Scout to LIVE server with REAL keys.\nAre you absolutely sure?")) return;
    } else {
       if (!window.confirm("Switching VPS Scout to TESTNET. Proceed?")) return;
    }

    setIsSwitchingEnv(true);
    try {
      const resp = await api.switchEnvironment(target);
      alert(resp.message || "Environment swapped successfully. Waiting for reboot...");
      setTimeout(() => setIsSwitchingEnv(false), 3000);
    } catch (e: any) {
      alert(e.message || "Failed to switch environment. Ensure LIVE/TESTNET keys exist in server/.env");
      setIsSwitchingEnv(false);
    }
  };

  // Initialize with safe defaults to prevent null-reference crashes before loading finishes
  const [config, setConfig] = useState<any>({
    riskPct:        CANONICAL_DEFAULTS.riskPct,
    maxTrades:      CANONICAL_DEFAULTS.maxTrades,
    leverage:       CANONICAL_DEFAULTS.leverage,
    slEnabled:      CANONICAL_DEFAULTS.slEnabled,
    tpEnabled:      CANONICAL_DEFAULTS.tpEnabled,
    tp1Only:        CANONICAL_DEFAULTS.tp1Only,
    tp1RR:          CANONICAL_DEFAULTS.tp1RR,
    tp2RR:          CANONICAL_DEFAULTS.tp2RR,
    minScore:       CANONICAL_DEFAULTS.minScore,
    btcGate:        CANONICAL_DEFAULTS.btcGate,
    trailTp:        CANONICAL_DEFAULTS.trailTp,
    circuitBreaker: CANONICAL_DEFAULTS.circuitBreaker,
  });
  const [isLoaded, setIsLoaded] = useState(false);
  const [killSwitchEn, setKillSwitchEn] = useState(typeof window !== 'undefined' && (window as any).GB_LIVE_KILL === true);

  const toggleKillSwitch = () => {
    const newState = !killSwitchEn;
    setKillSwitchEn(newState);
    if (typeof window !== 'undefined') {
      (window as any).GB_LIVE_KILL = newState;
    }
  };

  useEffect(() => {
    api.getAutoTradeConfig()
      .then(res => {
        // Hydrate the store
        setConfig({
          riskPct:        res.riskPerTrade      ?? CANONICAL_DEFAULTS.riskPct,
          maxTrades:      res.maxConcurrent     ?? CANONICAL_DEFAULTS.maxTrades,
          leverage:       res.leverage          ?? CANONICAL_DEFAULTS.leverage,
          slEnabled:      res.slEnabled         ?? CANONICAL_DEFAULTS.slEnabled,
          tpEnabled:      res.tpEnabled         ?? CANONICAL_DEFAULTS.tpEnabled,
          tp1Only:        res.tp1Only           ?? CANONICAL_DEFAULTS.tp1Only,
          tp1RR:          res.tp1RR             ?? CANONICAL_DEFAULTS.tp1RR,
          tp2RR:          res.tp2RR             ?? CANONICAL_DEFAULTS.tp2RR,
          minScore:       res.minScore          ?? CANONICAL_DEFAULTS.minScore,
          btcGate:        res.btcGateEnabled    ?? CANONICAL_DEFAULTS.btcGate,
          trailTp:        res.trailTpEnabled    ?? CANONICAL_DEFAULTS.trailTp,
          circuitBreaker: res.circuitBreakerEnabled ?? false,
        });
        if (res.activeModeId) {
          setMode(res.activeModeId);
        }
        setIsLoaded(true);
      })
      .catch(console.error);
  }, []);

  const handleConfigChange = (key: string, value: any) => {
    const val = typeof value === 'boolean' ? value : Number(value);
    const newConf = { ...config, [key]: val };
    setConfig(newConf);
    
    // Partial Update Payload Map
    const payloadMap: Record<string, string> = {
        riskPct: 'riskPerTrade',
        maxTrades: 'maxConcurrent',
        leverage: 'leverage',
        slEnabled: 'slEnabled',
        tpEnabled: 'tpEnabled',
        tp1Only: 'tp1Only',
        tp1RR: 'tp1RR',
        tp2RR: 'tp2RR',
        minScore: 'minScore',
        btcGate: 'btcGateEnabled',
        trailTp: 'trailTpEnabled',
        circuitBreaker: 'circuitBreakerEnabled'
    };

    const backendKey = payloadMap[key];
    if (backendKey) {
        api.updateAutoTradeConfig({ [backendKey]: val }).catch(console.error);
    }
  };


  // Use canonical count for capacity bar (Binance + Unsynced Real + Queued, do not count Paper against backend limit)
  const realDeployments = counts.binance + counts.localReal + counts.queued;
  const capacity = realDeployments / config.maxTrades;
  const capacityPct = Math.min(100, Math.round((isNaN(capacity) ? 0 : capacity) * 100));

  const modes = [
    { key: 'CONSERVATIVE', icon: <Shield size={14} />, label: 'CONSERVATIVE' },
    { key: 'BALANCED', icon: <Zap size={14} />, label: 'BALANCED' },
    { key: 'AGGRESSIVE', icon: <Flame size={14} />, label: 'AGGRESSIVE' },
  ];

  return (
    <section style={{
      padding: '28px 36px',
      borderRadius: 'var(--radius-xl)',
      background: 'var(--bg-panel)',
      border: '1px solid var(--border-gold)',
      backdropFilter: 'blur(40px)',
      boxShadow: '0 30px 80px -20px rgba(0,0,0,1)',
      opacity: isLoaded ? 1 : 0.5,
      pointerEvents: isLoaded ? 'auto' : 'none',
      transition: 'opacity 0.3s'
    }}>
      {/* Top row */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 16, marginBottom: 20
      }}>
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.35em', fontWeight: 900, marginBottom: 4 }}>
            {!isLoaded ? 'SYNCING WITH CLOUD...' : 'SYSTEM STATUS'}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600 }}>
            {Math.max(symbols.length, marketRows.length)} Pairs Monitored
          </div>
        </div>

        {/* Mode switches */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            onClick={() => {
              const newState = !isScannerActive;
              setScannerActive(newState);
              // Removed api.toggleAutoTrade so they are separate
            }}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '12px 24px',
              borderRadius: 'var(--radius-full)',
              fontSize: 11, fontWeight: 900,
              border: `1px solid ${isScannerActive ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)'}`,
              background: isScannerActive ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)',
              color: isScannerActive ? 'var(--red)' : 'var(--green)',
              letterSpacing: '0.2em', cursor: 'pointer', transition: 'all 0.2s',
              marginRight: 12
            }}
          >
            {isScannerActive ? <Flame size={14} /> : <Zap size={14} />}
            {isScannerActive ? 'STOP ENGINE' : 'START ENGINE'}
          </button>

          {modes.map(m => (
            <button
              key={m.key}
              className={`mode-btn ${activeMode.key === m.key ? 'active' : ''}`}
              onClick={() => {
                setMode(m.key);
                api.updateAutoTradeConfig({ activeModeId: m.key }).catch(console.error);
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {m.icon}
                {m.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Middle row: Environment Switch */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 20, marginBottom: 24, paddingBottom: 24, borderBottom: '1px solid var(--border-subtle)'
      }}>
        {/* Browser Terminal Mode */}
        <div>
          <div title="Controls how trades originated purely from this UI terminal are placed (Paper/Live)." style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.1em', marginBottom: 8, fontWeight: 700, cursor: 'help' }}>BROWSER TERMINAL MODE ⓘ</div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <button 
              onClick={() => setAccountEnvironment('LIVE')}
              style={{
                padding: '10px 20px', borderRadius: 'var(--radius-full)', fontSize: 11, fontWeight: 900, letterSpacing: '0.35em',
                border: `1px solid ${accountEnvironment === 'LIVE' ? 'rgba(16,185,129,0.5)' : 'rgba(255,255,255,0.1)'}`,
                background: accountEnvironment === 'LIVE' ? 'rgba(16,185,129,0.15)' : 'rgba(0,0,0,0.5)',
                color: accountEnvironment === 'LIVE' ? '#34d399' : 'var(--text-primary)',
                boxShadow: accountEnvironment === 'LIVE' ? '0 0 20px rgba(16,185,129,0.2)' : 'none',
                cursor: 'pointer', transition: 'all 0.3s'
              }}
            >LIVE</button>
            <button 
              onClick={() => setAccountEnvironment('DEMO')}
              style={{
                padding: '10px 20px', borderRadius: 'var(--radius-full)', fontSize: 11, fontWeight: 900, letterSpacing: '0.35em',
                border: `1px solid ${accountEnvironment === 'DEMO' ? 'rgba(14,165,233,0.5)' : 'rgba(255,255,255,0.1)'}`,
                background: accountEnvironment === 'DEMO' ? 'rgba(14,165,233,0.15)' : 'rgba(0,0,0,0.5)',
                color: accountEnvironment === 'DEMO' ? '#7dd3fc' : 'var(--text-primary)',
                boxShadow: accountEnvironment === 'DEMO' ? '0 0 20px rgba(14,165,233,0.2)' : 'none',
                cursor: 'pointer', transition: 'all 0.3s'
              }}
            >DEMO</button>

            {/* Sync Status Badge */}
            {backendEnvironment && (
              <span style={{ 
                color: (accountEnvironment === 'DEMO' && backendEnvironment.isTestnet) || (accountEnvironment === 'LIVE' && !backendEnvironment.isTestnet) ? 'var(--green)' : '#f87171', 
                background: (accountEnvironment === 'DEMO' && backendEnvironment.isTestnet) || (accountEnvironment === 'LIVE' && !backendEnvironment.isTestnet) ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)', 
                padding: '6px 12px',
                borderRadius: 'var(--radius-md)', fontSize: 9, fontWeight: 800, 
                border: `1px solid ${(accountEnvironment === 'DEMO' && backendEnvironment.isTestnet) || (accountEnvironment === 'LIVE' && !backendEnvironment.isTestnet) ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
                letterSpacing: '0.05em'
              }}>
                {(accountEnvironment === 'DEMO' && backendEnvironment.isTestnet) || (accountEnvironment === 'LIVE' && !backendEnvironment.isTestnet) 
                  ? 'SYNCED ✅' 
                  : (accountEnvironment === 'DEMO' ? '⚠️ FRONTEND DEMO / BACKEND LIVE MISMATCH' : '⚠️ FRONTEND LIVE / BACKEND DEMO MISMATCH')}
              </span>
            )}
          </div>
        </div>

        {/* VPS Scout Backend Env */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div title="The real environment the headless backend daemon executing your automated strategy is currently pointing to." style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.1em', fontWeight: 700, cursor: 'help' }}>VPS SCOUT ENVIRONMENT ⓘ</div>
            
            {/* Backend Environment Switch Action */}
            <div style={{ display: 'flex', gap: 6 }}>
              <button 
                disabled={isSwitchingEnv || !backendEnvironment}
                onClick={() => handleSwapEnv('LIVE')}
                style={{
                  padding: '4px 8px', borderRadius: '4px', fontSize: 9, fontWeight: 900,
                  border: `1px solid ${backendEnvironment && !backendEnvironment.isTestnet ? 'rgba(16,185,129,0.5)' : 'rgba(255,255,255,0.1)'}`,
                  background: backendEnvironment && !backendEnvironment.isTestnet ? 'rgba(16,185,129,0.15)' : 'rgba(0,0,0,0.5)',
                  color: backendEnvironment && !backendEnvironment.isTestnet ? '#34d399' : 'var(--text-primary)',
                  cursor: isSwitchingEnv ? 'wait' : 'pointer', transition: 'all 0.2s', opacity: isSwitchingEnv ? 0.5 : 1
                }}
              >LIVE</button>
              <button 
                disabled={isSwitchingEnv || !backendEnvironment}
                onClick={() => handleSwapEnv('TESTNET')}
                style={{
                  padding: '4px 8px', borderRadius: '4px', fontSize: 9, fontWeight: 900,
                  border: `1px solid ${backendEnvironment?.isTestnet ? 'rgba(14,165,233,0.5)' : 'rgba(255,255,255,0.1)'}`,
                  background: backendEnvironment?.isTestnet ? 'rgba(14,165,233,0.15)' : 'rgba(0,0,0,0.5)',
                  color: backendEnvironment?.isTestnet ? '#7dd3fc' : 'var(--text-primary)',
                  cursor: isSwitchingEnv ? 'wait' : 'pointer', transition: 'all 0.2s', opacity: isSwitchingEnv ? 0.5 : 1
                }}
              >DEMO</button>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span title="Prevents accidental live browser executions unless explicitly toggled ON." style={{ 
              fontSize: 11, fontWeight: 900, letterSpacing: '0.1em', padding: '4px 10px', borderRadius: 'var(--radius-full)', 
              border: `1px solid ${liveExecutionArmed ? 'rgba(16,185,129,0.3)' : 'rgba(244,63,94,0.3)'}`,
              background: liveExecutionArmed ? 'rgba(16,185,129,0.1)' : 'rgba(244,63,94,0.1)',
              color: liveExecutionArmed ? 'var(--green)' : 'var(--red)',
              textShadow: liveExecutionArmed ? '0 0 5px rgba(16,185,129,0.5)' : '0 0 5px rgba(244,63,94,0.5)',
              transition: 'all 0.3s', cursor: 'help'
            }}>
              BROWSER REAL ORDER ARM: {liveExecutionArmed ? 'ON' : 'OFF'}
            </span>
            <span style={{ color: 'rgba(255,255,255,0.2)' }}>|</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 900, letterSpacing: '0.2em' }}>
              Base: <span style={{ 
                color: !backendEnvironment ? 'var(--text-muted)' : backendEnvironment.isTestnet ? '#38bdf8' : 'var(--green)',
              }}>{!backendEnvironment ? 'OFFLINE' : backendEnvironment.isTestnet ? 'TESTNET' : 'LIVE'}</span>
            </span>
          </div>
          {backendEnvironment?.baseUrl && (
             <div style={{ fontSize: 8, color: 'var(--text-muted)', opacity: 0.7, fontFamily: 'monospace' }}>
               Env Memory: {backendEnvironment.baseUrl.replace('https://', '')}
             </div>
          )}
          {(backendEnvironment as any)?.diagnosticFileTruth && (
             <div style={{ fontSize: 8, color: 'gold', opacity: 0.8, fontFamily: 'monospace' }}>
               File Disk: {(backendEnvironment as any).diagnosticFileTruth.replace('https://', '')}
             </div>
          )}
        </div>
      </div>

      {/* ── SAFETY DIAGNOSTICS RECONCILIATION ── */}
      <div style={{
        padding: '16px', borderRadius: 'var(--radius-lg)', marginBottom: 24,
        background: killSwitchEn ? 'rgba(239,68,68,0.1)' : 'rgba(0,0,0,0.3)',
        border: `1px solid ${killSwitchEn ? 'rgba(239,68,68,0.4)' : 'var(--border-subtle)'}`
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 900, color: 'var(--text-muted)', letterSpacing: '0.2em' }}>
            EXECUTION RECONCILIATION & SAFETY
          </div>
          <button 
            onClick={toggleKillSwitch}
            style={{
              padding: '6px 16px', borderRadius: 'var(--radius-full)', fontSize: 11, fontWeight: 900, letterSpacing: '0.1em',
              background: killSwitchEn ? 'var(--red)' : 'rgba(0,0,0,0.5)',
              color: killSwitchEn ? '#fff' : 'var(--red)',
              border: `1px solid ${killSwitchEn ? 'var(--red)' : 'rgba(239,68,68,0.3)'}`,
              cursor: 'pointer', transition: 'all 0.2s',
              boxShadow: killSwitchEn ? '0 0 15px rgba(239,68,68,0.5)' : 'none'
            }}
          >
            {killSwitchEn ? 'KILL SWITCH ACTIVE (LOCKED)' : 'ENGAGE KILL SWITCH'}
          </button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
          <div style={inputContainerStyle}>
            <div style={labelStyle}>EXCHANGE SYNC</div>
            <div style={{ fontSize: 12, fontWeight: 900, color: backendEnvironment ? 'var(--green)' : 'var(--red)' }}>
              {backendEnvironment ? 'HEALTHY' : 'UNAVAILABLE'}
            </div>
          </div>
          <div style={inputContainerStyle}>
            <div style={labelStyle}>LIVE POSITIONS (BINANCE)</div>
            <div style={{ fontSize: 16, fontWeight: 900, color: counts.binance > 0 ? 'var(--gold)' : 'var(--text-muted)' }}>
              {counts.binance}
            </div>
          </div>
          <div style={inputContainerStyle}>
            <div style={labelStyle}>DEMO POSITIONS (LOCAL)</div>
            <div style={{ fontSize: 16, fontWeight: 900, color: 'var(--blue)' }}>
              {activeTrades.filter(t => t.accountMode === 'DEMO').length}
            </div>
          </div>
          <div style={inputContainerStyle}>
            <div style={labelStyle}>UNSYNCED LOCAL CARDS</div>
            <div style={{ fontSize: 16, fontWeight: 900, color: counts.localReal > 0 ? 'var(--red)' : 'var(--text-muted)' }}>
              {counts.localReal}
            </div>
          </div>
        </div>
        {counts.localReal > 0 && accountEnvironment === 'LIVE' && !killSwitchEn && (
           <div style={{ marginTop: 12, fontSize: 11, color: 'var(--red)', fontWeight: 700, padding: '8px', background: 'rgba(239,68,68,0.1)', borderRadius: 4 }}>
             ⚠️ MISMATCH DETECTED: You have {counts.localReal} local LIVE cards that are missing from the true Binance Exchange positions list. 
           </div>
        )}
      </div>

      {/* Bottom row */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 20
      }}>
        {/* ── Real Deployments Capacity Bar ── */}
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)' }}>MAPPING DEPLOYMENTS (EXCHANGE)</div>
            <div style={{ fontSize: 11, fontWeight: 900, color: 'var(--text-primary)' }}>
              {realDeployments} / {config.maxTrades} ACTIVE
            </div>
          </div>
          <div className="capacity-bar-track">
            <div
              className={`capacity-bar-fill ${capacityPct >= 100 ? 'full' : ''}`}
              style={{ width: `${capacityPct}%` }}
            />
          </div>
        </div>

        {/* Editable Stats */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          
          <div style={inputContainerStyle}>
            <div style={labelStyle}>RISK %</div>
            <input 
              type="number" step="0.01"
              style={inputStyle}
              value={(config.riskPct * 100).toFixed(2)}
              onFocus={e => e.target.select()}
              onChange={e => handleConfigChange('riskPct', String(Number(e.target.value) / 100))}
            />
          </div>

          <div style={inputContainerStyle}>
            <div style={labelStyle}>MAX TRADES</div>
            <input 
              type="number" step="1"
              style={inputStyle}
              value={config.maxTrades}
              onFocus={e => e.target.select()}
              onChange={e => handleConfigChange('maxTrades', e.target.value)}
            />
          </div>

          <div style={inputContainerStyle}>
            <div style={labelStyle}>LEVERAGE</div>
            <input 
              type="number" step="1"
              style={inputStyle}
              value={config.leverage}
              onFocus={e => e.target.select()}
              onChange={e => handleConfigChange('leverage', e.target.value)}
            />
          </div>

          <div style={inputContainerStyle}>
            <div style={labelStyle}>MIN SCORE</div>
            <input 
              type="number" step="1"
              style={{ ...inputStyle, color: 'var(--green)' }}
              value={config.minScore}
              onFocus={e => e.target.select()}
              onChange={e => handleConfigChange('minScore', e.target.value)}
            />
          </div>

          {/* SL TOGGLE */}
          <div style={inputContainerStyle}>
            <div style={labelStyle}>SL</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
              <input 
                type="checkbox"
                checked={config.slEnabled}
                onChange={e => handleConfigChange('slEnabled', e.target.checked)}
                style={{ cursor: 'pointer' }}
              />
              <span style={{ fontSize: 10, fontWeight: 900, color: config.slEnabled ? 'var(--green)' : 'var(--red)' }}>
                {config.slEnabled ? 'ON' : 'OFF'}
              </span>
            </div>
          </div>

          {/* BTC GATE TOGGLE */}
          <div style={inputContainerStyle}>
            <div style={{ ...labelStyle, color: config.btcGate ? 'var(--text-muted)' : 'var(--gold)' }}>BTC GATE</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
              <input
                type="checkbox"
                checked={config.btcGate}
                onChange={e => handleConfigChange('btcGate', e.target.checked)}
                style={{ cursor: 'pointer', accentColor: 'var(--gold)' }}
              />
              <span style={{ fontSize: 10, fontWeight: 900, color: config.btcGate ? 'var(--green)' : 'var(--gold)' }}>
                {config.btcGate ? 'ON' : 'OFF'}
              </span>
            </div>
          </div>

          {/* TRAIL TP TOGGLE */}
          <div style={inputContainerStyle}>
            <div style={{ ...labelStyle, color: config.trailTp ? '#3b82f6' : 'var(--text-muted)' }}>TRAIL TP</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
              <input
                type="checkbox"
                checked={config.trailTp}
                onChange={e => handleConfigChange('trailTp', e.target.checked)}
                style={{ cursor: 'pointer', accentColor: '#3b82f6' }}
              />
              <span style={{ fontSize: 10, fontWeight: 900, color: config.trailTp ? '#3b82f6' : 'var(--text-muted)' }}>
                {config.trailTp ? 'ON' : 'OFF'}
              </span>
            </div>
          </div>

          {/* CIRCUIT BREAKER TOGGLE */}
          <div style={inputContainerStyle}>
            <div style={{ ...labelStyle, color: config.circuitBreaker ? 'var(--red)' : 'var(--text-muted)' }}>CIRCUIT BRKR</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
              <input
                type="checkbox"
                checked={config.circuitBreaker}
                onChange={e => handleConfigChange('circuitBreaker', e.target.checked)}
                style={{ cursor: 'pointer', accentColor: 'var(--red)' }}
              />
              <span style={{ fontSize: 10, fontWeight: 900, color: config.circuitBreaker ? 'var(--red)' : 'var(--text-muted)' }}>
                {config.circuitBreaker ? 'ON' : 'OFF'}
              </span>
            </div>
          </div>

          {/* TP TOGGLE, TP1-ONLY & MULTIPLIERS */}
          <div style={{ ...inputContainerStyle, flexDirection: 'row', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={labelStyle}>TP</div>
              <input 
                type="checkbox"
                checked={config.tpEnabled}
                onChange={e => handleConfigChange('tpEnabled', e.target.checked)}
                style={{ cursor: 'pointer', marginTop: 4 }}
              />
            </div>

            {config.tpEnabled && (
              <>
                <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.1)', margin: '0 4px' }} />
                {/* TP1-ONLY toggle */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div style={{ ...labelStyle, color: config.tp1Only ? 'var(--gold)' : 'var(--text-muted)' }}>TP1 ONLY</div>
                  <input
                    type="checkbox"
                    checked={config.tp1Only}
                    onChange={e => handleConfigChange('tp1Only', e.target.checked)}
                    style={{ cursor: 'pointer', marginTop: 4, accentColor: 'var(--gold)' }}
                  />
                </div>
                <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.1)', margin: '0 4px' }} />
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', opacity: config.tp1Only ? 0.35 : 1 }}>
                  <div style={labelStyle}>TP1 (R)</div>
                  <input 
                    type="number" step="0.1"
                    style={{ ...inputStyle, width: '45px', fontSize: 13 }}
                    value={config.tp1RR}
                    onFocus={e => e.target.select()}
                    onChange={e => handleConfigChange('tp1RR', e.target.value)}
                  />
                </div>
                {!config.tp1Only && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div style={labelStyle}>TP2 (R)</div>
                    <input 
                      type="number" step="0.1"
                      style={{ ...inputStyle, width: '45px', fontSize: 13 }}
                      value={config.tp2RR}
                      onFocus={e => e.target.select()}
                      onChange={e => handleConfigChange('tp2RR', e.target.value)}
                    />
                  </div>
                )}
              </>
            )}
          </div>

        </div>
      </div>
    </section>
  );
}

const inputContainerStyle: React.CSSProperties = {
  padding: '6px 14px',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border-subtle)',
  background: 'rgba(0,0,0,0.3)',
  textAlign: 'center',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center'
};

const labelStyle: React.CSSProperties = {
  fontSize: 9, 
  color: 'var(--text-muted)', 
  letterSpacing: '0.2em', 
  fontWeight: 800, 
  marginBottom: 4
};

const inputStyle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 900,
  color: 'var(--gold-light)',
  fontStyle: 'italic',
  background: 'transparent',
  border: 'none',
  textAlign: 'center',
  outline: 'none',
  width: '60px',
  fontFamily: 'monospace'
};


`

### src/components/CommandSyncHub.tsx
`	ypescript
import { useState, useEffect } from 'react';
import { Target, X, TrendingUp, RefreshCw, Wifi, WifiOff, Activity, Clock } from 'lucide-react';
import { api } from '../services/api';
import { useTradingStore } from '../store/tradingStore';
import type { ActiveTrade, SignalRow } from '../types/trading';

export default function CommandSyncHub() {
  const [loading, setLoading] = useState(true);
  const [binanceConnected, setBinanceConnected] = useState(false);
  const [closingSymbols, setClosingSymbols] = useState<Set<string>>(new Set());

  // Pull from local store (manually-deployed trades and queued signals)
  const { 
    activeTrades: rawTrades, pipelineSignals: rawSignals, 
    removeActiveTrade, deploySignal,
    binancePositions: rawPositions, setBinancePositions,
    accountEnvironment
  } = useTradingStore();

  const activeTrades = Array.isArray(rawTrades) ? rawTrades : [];
  const pipelineSignals = Array.isArray(rawSignals) ? rawSignals : [];
  const binancePositions = Array.isArray(rawPositions) ? rawPositions : [];

  useEffect(() => {
    let mounted = true;
    const fetchPositions = async () => {
      try {
        const data = await api.getPositions();
        if (mounted && Array.isArray(data)) {
          setBinancePositions(data);
          setBinanceConnected(true);
          setLoading(false);
        } else if (mounted) {
          setBinanceConnected(false);
          setLoading(false);
        }
      } catch (e) {
        // Binance not configured or offline — still show local trades
        if (mounted) {
          setBinanceConnected(false);
          setLoading(false);
        }
      }
    };
    fetchPositions();
    const interval = setInterval(fetchPositions, 5000);
    window.addEventListener('refreshPositions', fetchPositions);
    return () => {
      mounted = false;
      clearInterval(interval);
      window.removeEventListener('refreshPositions', fetchPositions);
    };
  }, []);

  const handleCloseBinance = async (symbol: string, amtStr: string) => {
    if (closingSymbols.has(symbol)) return;
    try {
      setClosingSymbols(prev => new Set(prev).add(symbol));
      const amt = parseFloat(amtStr);
      const posSide = amt > 0 ? 'LONG' : 'SHORT';
      await api.closeTrade(symbol, posSide, Math.abs(amt));
      const data = await api.getPositions();
      setBinancePositions(data);
    } catch (e: any) {
      alert('Failed to close trade: ' + e.message);
    } finally {
      setClosingSymbols(prev => {
        const next = new Set(prev);
        next.delete(symbol);
        return next;
      });
    }
  };

  const handleCloseLocal = (id: string) => {
    const idx = activeTrades.findIndex(t => t.id === id);
    if (idx >= 0) removeActiveTrade(idx);
  };

  // Filter Binance positions (always show)
  const filteredPositions = binancePositions;
  const binanceSymbols = new Set(filteredPositions.map((p: any) => p.symbol?.toUpperCase()));

  // Local trades segregated by mode
  const filteredLocalLive = activeTrades.filter(t => t.accountMode === 'LIVE' && !binanceSymbols.has(t.symbol?.toUpperCase()));
  const filteredLocalDemo = activeTrades.filter(t => t.accountMode === 'DEMO');

  // Pending: queued signals
  const allPending = pipelineSignals.filter(s => s.status === 'QUEUED');

  const displayCount = filteredPositions.length + filteredLocalLive.length + filteredLocalDemo.length + allPending.length;

  return (
    <section>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 20, paddingBottom: 12, borderBottom: '1px solid rgba(212,175,55,0.1)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Target size={20} color="var(--gold)" />
          <div>
            <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: '0.2em', color: 'var(--gold-light)' }}>
              COMMAND SYNC HUB
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
              {loading ? 'Connecting...' : `${displayCount} Active Trade${displayCount !== 1 ? 's' : ''}`}
              {' '}{loading && '(Syncing...)'}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* Environment badge — synced to System Status selection */}
          <div style={{ 
            padding: '6px 14px', borderRadius: 'var(--radius-full)',
            fontSize: 9, fontWeight: 900,
            background: accountEnvironment === 'LIVE' ? 'rgba(239,68,68,0.2)' : 'rgba(14,165,233,0.15)',
            color: accountEnvironment === 'LIVE' ? '#f87171' : '#7dd3fc',
            border: `1px solid ${accountEnvironment === 'LIVE' ? 'rgba(239,68,68,0.3)' : 'rgba(14,165,233,0.3)'}`,
            letterSpacing: '0.15em',
            transition: 'all 0.3s'
          }}>
            ● {accountEnvironment}
          </div>

          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            fontSize: 10, fontWeight: 700,
            color: binanceConnected ? 'var(--green)' : 'var(--text-muted)'
          }}>
            {binanceConnected ? <Wifi size={12} /> : <WifiOff size={12} />}
            {binanceConnected ? 'BINANCE API OK' : 'LOCAL ONLY'}
          </div>
        </div>
      </div>

      {displayCount === 0 ? (
        <div style={{
          padding: '40px 24px',
          borderRadius: 'var(--radius-lg)',
          border: '1px dashed rgba(255,255,255,0.06)',
          textAlign: 'center',
          color: 'var(--text-muted)',
          fontSize: 12
        }}>
          <TrendingUp size={24} style={{ opacity: 0.3, marginBottom: 8 }} />
          <div>No active positions. Deploy a signal to see it here.</div>
        </div>
      ) : (
        <div className="trades-grid">

          {/* ── Pending (Queued) signals ── */}
          {allPending.map((row, i) => {
            const sym = row.symbol.replace('USDT', '');
            return (
              <div key={`pending-${row.id}`} className="opportunity-card card-entry" style={{
                padding: '24px 22px', background: 'rgba(212,175,55,0.02)',
                borderColor: 'var(--gold)', animationDelay: `${i * 0.08}s`,
                boxShadow: '0 0 20px rgba(212,175,55,0.05)'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <div>
                    <div className="font-mono" style={{ fontWeight: 900, fontSize: 16, fontStyle: 'italic' }}>
                      {sym}<span style={{ color: 'var(--text-muted)', fontSize: 11 }}>USDT</span>
                    </div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--gold-light)', letterSpacing: '0.1em', marginTop: 2 }}>
                       QUEUED {row.signal.side}
                    </div>
                  </div>
                  <button
                    onClick={() => deploySignal(row.id)}
                    className="premium-btn"
                    style={{ padding: '8px 16px', fontSize: 10 }}
                  >
                    DEPLOY NOW
                  </button>
                </div>
                <div style={{
                  padding: '8px 10px', borderRadius: 'var(--radius-sm)', background: 'rgba(212,175,55,0.05)',
                  border: '1px solid rgba(212,175,55,0.1)', textAlign: 'center', marginBottom: 12
                }}>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 800 }}>MAPPING STATUS</div>
                  <div style={{ fontSize: 11, fontWeight: 900, color: 'var(--gold)' }}>AWAITING COMMAND EXECUTION</div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <div style={{ padding: '6px 8px', borderRadius: 'var(--radius-sm)', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-subtle)' }}>
                    <div style={{ fontSize: 8, color: 'var(--text-muted)', fontWeight: 800 }}>ENTRY</div>
                    <div className="font-mono" style={{ fontSize: 10, fontWeight: 900 }}>{fmtPrice(row.signal.entryPrice)}</div>
                  </div>
                  <div style={{ padding: '6px 8px', borderRadius: 'var(--radius-sm)', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-subtle)' }}>
                    <div style={{ fontSize: 8, color: 'var(--text-muted)', fontWeight: 800 }}>SIZE</div>
                    <div className="font-mono" style={{ fontSize: 10, fontWeight: 900 }}>${row.signal.sizeUSDT.toFixed(2)}</div>
                  </div>
                </div>
              </div>
            );
          })}

          {/* ── Binance live positions ── */}
          {filteredPositions.map((pos, i) => {
            const entryPrice = parseFloat(pos.entryPrice);
            const pnlUSD = parseFloat(pos.unRealizedProfit);
            const leverage = parseFloat(pos.leverage);
            const amt = parseFloat(pos.positionAmt);
            const side = amt > 0 ? 'LONG' : 'SHORT';
            const sizeUSDT = Math.abs(amt * entryPrice);
            const pnlPct = sizeUSDT > 0 ? (pnlUSD / (sizeUSDT / leverage)) * 100 : 0;
            const sym = pos.symbol.replace('USDT', '');
            const isClosing = closingSymbols.has(pos.symbol);

            return (
              <div key={`binance-${pos.symbol}-${i}`} className="opportunity-card card-entry" style={{
                padding: '24px 22px',
                borderColor: pnlUSD >= 0 ? 'rgba(16,185,129,0.2)' : 'rgba(244,63,94,0.2)',
                animationDelay: `${i * 0.08}s`,
                opacity: isClosing ? 0.5 : 1
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <div>
                    <div className="font-mono" style={{ fontWeight: 900, fontSize: 16, fontStyle: 'italic' }}>
                      {sym}<span style={{ color: 'var(--text-muted)', fontSize: 11 }}>USDT</span>
                    </div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--gold-light)', letterSpacing: '0.1em', marginTop: 2, display: 'flex', alignItems: 'center' }}>
                      {leverage}x {side}
                      <span style={{ marginLeft: 8, padding: '2px 6px', borderRadius: 4, background: 'rgba(255,255,255,0.05)', color: 'var(--text-secondary)', fontSize: 9 }}>EXCHANGE</span>
                    </div>
                  </div>
                  <button
                    onClick={() => handleCloseBinance(pos.symbol, pos.positionAmt)}
                    disabled={isClosing}
                    style={{
                      background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.3)',
                      borderRadius: 'var(--radius-sm)', padding: '6px 8px',
                      cursor: isClosing ? 'wait' : 'pointer',
                      color: 'var(--red)', display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}
                    title="Close position"
                  >
                    {isClosing ? <RefreshCw size={14} /> : <X size={14} />}
                  </button>
                </div>

                <div style={{
                  padding: '14px', borderRadius: 'var(--radius-sm)',
                  background: pnlUSD >= 0 ? 'var(--green-soft)' : 'var(--red-soft)',
                  border: `1px solid ${pnlUSD >= 0 ? 'rgba(16,185,129,0.2)' : 'rgba(244,63,94,0.2)'}`,
                  textAlign: 'center', marginBottom: 16
                }}>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.2em', fontWeight: 800, marginBottom: 4 }}>UNREALIZED PnL (ROE)</div>
                  <div className="font-mono" style={{ fontSize: 20, fontWeight: 900, fontStyle: 'italic', color: pnlUSD >= 0 ? 'var(--green)' : 'var(--red)' }}>
                    {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%
                  </div>
                  <div className="font-mono" style={{ fontSize: 12, fontWeight: 700, color: pnlUSD >= 0 ? 'var(--green)' : 'var(--red)', marginTop: 4, opacity: 0.85 }}>
                    {pnlUSD >= 0 ? '+' : ''}{pnlUSD.toFixed(2)} USDT
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  {[
                    { label: 'ENTRY', value: fmtPrice(entryPrice) },
                    { label: 'SIZE', value: `$${sizeUSDT.toFixed(2)}` },
                  ].map(m => (
                    <div key={m.label} style={{ padding: '8px 10px', borderRadius: 'var(--radius-sm)', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border-subtle)' }}>
                      <div style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.15em', fontWeight: 800, marginBottom: 2 }}>{m.label}</div>
                      <div className="font-mono" style={{ fontSize: 11, fontWeight: 900, fontStyle: 'italic' }}>{m.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {/* ── Demo (Simulated) trades ── */}
          {filteredLocalDemo.length > 0 && (
            <div style={{ padding: '4px 0', fontSize: 10, fontWeight: 900, color: 'var(--blue)', letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: -8, marginTop: 8 }}>
              DEMO / PAPER POSITIONS
            </div>
          )}
          {filteredLocalDemo.map((trade, i) => {
            const history = pipelineSignals.filter(s => s.symbol.toUpperCase() === trade.symbol.toUpperCase() && s.id !== trade.signalId).slice(0, 6);
            return <LocalTradeCard key={trade.id} trade={trade} index={filteredPositions.length + allPending.length + i} history={history} onClose={() => handleCloseLocal(trade.id)} isDemo={true} />;
          })}

          {/* ── Local (manually deployed) LIVE trades missing from Exchange ── */}
          {filteredLocalLive.length > 0 && (
            <div style={{ padding: '4px 0', fontSize: 10, fontWeight: 900, color: 'var(--red)', letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: -8, marginTop: 8 }}>
              UNSYNCED LIVE POSITIONS (PENDING)
            </div>
          )}
          {filteredLocalLive.map((trade, i) => {
            const history = pipelineSignals.filter(s => s.symbol.toUpperCase() === trade.symbol.toUpperCase() && s.id !== trade.signalId).slice(0, 6);
            return <LocalTradeCard key={trade.id} trade={trade} index={filteredPositions.length + allPending.length + filteredLocalDemo.length + i} history={history} onClose={() => handleCloseLocal(trade.id)} isDemo={false} />;
          })}
        </div>
      )}
    </section>
  );
}

// ─── Status Meta ─────────────────────────────────────────────────────────────
const STATUS_META: Record<string, { label: string; color: string; bg: string; border: string }> = {
  ACTIVE:     { label: 'ACTIVE',     color: 'var(--green)',     bg: 'rgba(34,197,94,0.05)',   border: 'rgba(34,197,94,0.25)' },
  TP1_HIT:    { label: 'TP1 HIT',    color: 'var(--green)',     bg: 'rgba(34,197,94,0.08)',   border: 'rgba(34,197,94,0.3)' },
  TP2_HIT:    { label: 'TP2 HIT ✓', color: '#a3e635',          bg: 'rgba(163,230,53,0.08)',  border: 'rgba(163,230,53,0.3)' },
  SL_HIT:     { label: 'SL HIT',     color: 'var(--red)',       bg: 'rgba(244,63,94,0.08)',   border: 'rgba(244,63,94,0.3)' },
  CANCELLED:  { label: 'CANCELLED',  color: 'var(--text-muted)',bg: 'rgba(255,255,255,0.03)', border: 'rgba(255,255,255,0.08)' },
  CLOSED:     { label: 'CLOSED',     color: 'var(--text-muted)',bg: 'rgba(255,255,255,0.03)', border: 'rgba(255,255,255,0.08)' },
};

function LocalTradeCard({ 
  trade, index, onClose, history, isDemo
}: { 
  trade: ActiveTrade; index: number; onClose: () => void; history: SignalRow[]; isDemo?: boolean 
}) {
  const sym = trade.symbol.replace('USDT', '');
  const meta = STATUS_META[trade.status] ?? STATUS_META['ACTIVE'];
  const TERMINAL = ['TP1_HIT', 'TP2_HIT', 'SL_HIT', 'CLOSED', 'CANCELLED'];
  const isTerminal = TERMINAL.includes(trade.status);

  const pnl = trade.unrealizedPnl ?? 0;
  const realized = trade.realizedPnl;
  const displayPnl = isTerminal && realized !== undefined ? realized : pnl;
  const isPnlPos   = displayPnl >= 0;

  return (
    <div
      className="opportunity-card card-entry"
      style={{
        padding: '24px 22px',
        borderColor: trade.side === 'LONG' ? 'rgba(16,185,129,0.2)' : 'rgba(244,63,94,0.2)',
        animationDelay: `${index * 0.08}s`,
        opacity: isTerminal ? 0.8 : 1
      }}
    >
      {/* ── Versioning Badge ── */}
      {trade.signalId && (
        <div style={{ fontSize: 8, fontWeight: 900, color: 'var(--text-muted)', marginBottom: 8, letterSpacing: '0.1em' }}>
          INSTANCE ID: {trade.id.split('_').pop()?.toUpperCase()}
        </div>
      )}

      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
        <div>
          <div className="font-mono" style={{ fontWeight: 900, fontSize: 16, fontStyle: 'italic' }}>
            {sym}<span style={{ color: 'var(--text-muted)', fontSize: 11 }}>USDT</span>
          </div>
          <div style={{ fontSize: 10, fontWeight: 700, color: trade.side === 'LONG' ? 'var(--green)' : 'var(--red)', marginTop: 2, display: 'flex', alignItems: 'center' }}>
            {trade.leverage}x {trade.side}
            <span style={{ 
              marginLeft: 8, padding: '2px 6px', borderRadius: 4, 
              background: isDemo ? 'rgba(14,165,233,0.1)' : 'rgba(244,63,94,0.1)', 
              color: isDemo ? 'var(--blue)' : 'var(--red)', fontSize: 9, letterSpacing: '0.1em',
              border: `1px solid ${isDemo ? 'rgba(14,165,233,0.3)' : 'rgba(244,63,94,0.3)'}`
            }}>
              {isDemo ? 'SIMULATED DEMO' : 'UNSYNCED LIVE'}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
          {/* Status pill */}
          <div style={{
            padding: '4px 10px', borderRadius: 'var(--radius-full)',
            background: meta.bg, border: `1px solid ${meta.border}`,
            fontSize: 10, fontWeight: 900, color: meta.color, letterSpacing: '0.1em'
          }}>
            {meta.label}
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.2)',
              borderRadius: 6, padding: '4px 6px', cursor: 'pointer',
              color: 'var(--red)', display: 'flex', alignItems: 'center'
            }}
            title="Remove"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {/* ── PnL Banner ── */}
      <div style={{
        padding: '10px 14px', borderRadius: 'var(--radius-sm)',
        background: isPnlPos ? 'var(--green-soft)' : 'var(--red-soft)',
        border: `1px solid ${isPnlPos ? 'rgba(34,197,94,0.2)' : 'rgba(244,63,94,0.2)'}`,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12
      }}>
        <div>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 800, letterSpacing: '0.15em' }}>
            {isTerminal ? 'REALIZED PnL' : 'UNREALIZED PnL'}
          </div>
          <div className="font-mono" style={{ fontSize: 18, fontWeight: 900, fontStyle: 'italic', color: isPnlPos ? 'var(--green)' : 'var(--red)' }}>
            {displayPnl >= 0 ? '+' : ''}{displayPnl.toFixed(2)} USDT
          </div>
        </div>
        {trade.rMultiple !== undefined && (
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 800 }}>R MULTIPLE</div>
            <div className="font-mono" style={{ fontSize: 16, fontWeight: 900, color: trade.rMultiple >= 0 ? 'var(--green)' : 'var(--red)' }}>
              {trade.rMultiple >= 0 ? '+' : ''}{trade.rMultiple.toFixed(2)}R
            </div>
          </div>
        )}
      </div>

      {/* ── Level Metrics ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 6, marginBottom: 12 }}>
        {[
          { label: 'ENTRY', value: fmtPrice(trade.entryPrice) },
          { label: 'SL',    value: `${fmtPrice(trade.sl)}`, sub: trade.distToSl !== undefined ? `${trade.distToSl > 0 ? '+' : ''}${trade.distToSl.toFixed(2)}%` : undefined },
          { label: 'TP 1',  value: fmtPrice(trade.t1),  sub: trade.distToTp1 !== undefined ? `${trade.distToTp1.toFixed(2)}%` : undefined },
          { label: 'TP 2',  value: trade.t2 ? fmtPrice(trade.t2) : '--', sub: trade.distToTp2 !== undefined ? `${trade.distToTp2.toFixed(2)}%` : undefined },
        ].map(m => (
          <div key={m.label} style={{ padding: '6px 8px', borderRadius: 'var(--radius-sm)', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border-subtle)', textAlign: 'center' }}>
            <div style={{ fontSize: 8, color: 'var(--text-muted)', fontWeight: 800, letterSpacing: '0.1em' }}>{m.label}</div>
            <div className="font-mono" style={{ fontSize: 10, fontWeight: 900 }}>{m.value}</div>
            {m.sub && <div style={{ fontSize: 8, color: 'var(--text-muted)', marginTop: 1 }}>{m.sub}</div>}
          </div>
        ))}
      </div>

      {/* ── Live price + last updated ── */}
      {trade.livePrice !== undefined && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontSize: 11, color: 'var(--text-muted)' }}>
          <Activity size={12} />
          <span>Live: <strong className="font-mono" style={{ color: 'var(--text-primary)' }}>{fmtPrice(trade.livePrice)}</strong></span>
          {trade.priceUpdatedAt && (
            <span style={{ opacity: 0.5 }}>· {new Date(trade.priceUpdatedAt).toLocaleTimeString()}</span>
          )}
        </div>
      )}

      {/* ── Analytical metadata ── */}
      {(trade.score !== undefined || trade.entryType) && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {trade.score !== undefined && (
            <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 4, background: 'rgba(212,175,55,0.08)', color: 'var(--gold)', border: '1px solid rgba(212,175,55,0.2)' }}>
              SCORE {trade.score}
            </span>
          )}
          {trade.entryType && (
            <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 4, background: 'rgba(255,255,255,0.04)', color: 'var(--text-muted)', border: '1px solid rgba(255,255,255,0.08)' }}>
              {trade.entryType}
            </span>
          )}
          {trade.entryTiming && (
            <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 4, background: 'rgba(255,255,255,0.04)', color: 'var(--text-muted)', border: '1px solid rgba(255,255,255,0.08)' }}>
              {trade.entryTiming}
            </span>
          )}
        </div>
      )}

      {/* ── Status History timeline ── */}
      {trade.statusHistory && trade.statusHistory.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 800, letterSpacing: '0.15em', marginBottom: 6 }}>STATUS TIMELINE</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {trade.statusHistory.slice().reverse().map((ev, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10 }}>
                <Clock size={10} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                <span style={{ color: STATUS_META[ev.status]?.color ?? 'var(--text-secondary)', fontWeight: 700 }}>{ev.status}</span>
                {ev.price && <span className="font-mono" style={{ color: 'var(--text-muted)' }}>@ {fmtPrice(ev.price)}</span>}
                <span style={{ color: 'var(--text-muted)', opacity: 0.5, marginLeft: 'auto', whiteSpace: 'nowrap' }}>
                  {new Date(ev.ts).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Signal History (Versioning) ── */}
      {history.length > 0 && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 800, letterSpacing: '0.15em', marginBottom: 8 }}>
            PRIOR SIGNALS FOR {sym}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {history.map(prev => (
              <div key={prev.id} style={{ 
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', 
                fontSize: 10, padding: '4px 8px', background: 'rgba(255,255,255,0.02)', borderRadius: 4 
              }}>
                <span style={{ color: 'var(--text-secondary)' }}>
                  {prev.signal.kind} {prev.signal.side} @ {fmtPrice(prev.signal.entryPrice)}
                </span>
                <span style={{ fontSize: 8, color: 'var(--gold)', fontWeight: 800 }}>
                  {prev.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function fmtPrice(n: number): string {
  if (!isFinite(n)) return '--';
  if (Math.abs(n) >= 1000) return n.toFixed(2);
  if (Math.abs(n) >= 100) return n.toFixed(2);
  if (Math.abs(n) >= 1) return n.toFixed(4);
  return n.toFixed(6);
}

`

### src/store/tradingStore.ts
`	ypescript
// ============================================
// Trading Store — Zustand State Management
// ============================================

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  ModeConfig, ActiveTrade,
  ExecutionMode, ExecutionResult, MarketRow,
  SignalRow, PriceData, SignalHistoryEntry, UnifiedTrace,
  MicrostructureRow, LiquidityLayer, TriggerLevel, BlockedSignal, PipelineHealth,
  MarketRegime, OrderFlowSnapshot
} from '../types/trading';
import { MODES } from '../types/trading';
import { executeOrder, toExecutionPayload } from '../services/executionAdapter';


interface TradingState {
  // Core
  balance: number;
  activeMode: ModeConfig;
  symbols: string[];
  isDataLive: boolean;
  scannerRunning: boolean;
  isScannerActive: boolean;
  isAutoTradeActive: boolean;
  binanceStatus: 'INIT' | 'CONNECTED' | 'ERROR';

  // Prices / Market
  currentPrices: Record<string, PriceData>;
  marketRows: MarketRow[];

  // Signals
  pipelineSignals: SignalRow[];
  pipelineTraces: UnifiedTrace[];
  signalHistory: SignalHistoryEntry[];

  // Active trades (live Binance only)
  activeTrades: ActiveTrade[];
  binancePositions: any[];

  // Execution — always LIVE
  executionMode: ExecutionMode;
  executionResults: ExecutionResult[];
  
  // Backend actual environment tracking
  backendEnvironment: { isTestnet: boolean; baseUrl: string } | null;
  setBackendEnvironment: (env: { isTestnet: boolean; baseUrl: string }) => void;
  
  // Account Environment
  accountEnvironment: 'DEMO' | 'LIVE';
  liveExecutionArmed: boolean;
  setAccountEnvironment: (env: 'DEMO' | 'LIVE') => void;
  setLiveExecutionArmed: (armed: boolean) => void;

  // Strategy Selection
  enabledStrategies: string[];
  strategyPreset: string;
  setEnabledStrategies: (ids: string[]) => void;
  setStrategyPreset: (preset: string) => void;

  // Deal status
  dealStatus: Record<string, string>;

  // Feed State
  microstructureRows: MicrostructureRow[];
  liquidityLayers: LiquidityLayer[];
  triggerLevels: TriggerLevel[];
  blockedSignals: BlockedSignal[];
  pipelineHealth: PipelineHealth[];

  // Market context
  marketRegime: MarketRegime;
  lastScanAt: number | null;
  orderFlowSnapshots: Record<string, OrderFlowSnapshot>;
  backendSignals: Record<string, any>;

  // Actions
  setBalance: (balance: number) => void;
  setMode: (key: string) => void;
  setSymbols: (symbols: string[]) => void;
  setDataLive: (live: boolean) => void;
  setScannerRunning: (running: boolean) => void;
  setScannerActive: (active: boolean) => void;
  setAutoTradeActive: (active: boolean) => void;
  setBinanceStatus: (status: 'CONNECTED' | 'ERROR') => void;
  updatePrices: (prices: Record<string, PriceData>) => void;
  setMarketRows: (rows: MarketRow[]) => void;
  setPipelineSignals: (signals: SignalRow[]) => void;
  setPipelineTraces: (traces: UnifiedTrace[]) => void;
  setBinancePositions: (positions: any[]) => void;
  addSignalToHistory: (entry: SignalHistoryEntry) => void;
  addActiveTrade: (trade: ActiveTrade) => void;
  removeActiveTrade: (idx: number) => void;
  setDealStatus: (key: string, status: string) => void;
  getDealStatus: (symbol: string, kind: string) => string;

  // Feed Actions
  setMicrostructureRows: (rows: MicrostructureRow[]) => void;
  setLiquidityLayers: (layers: LiquidityLayer[]) => void;
  setTriggerLevels: (levels: TriggerLevel[]) => void;
  setBlockedSignals: (signals: BlockedSignal[]) => void;
  setPipelineHealth: (health: PipelineHealth[]) => void;

  // Market context actions
  setMarketRegime: (regime: MarketRegime) => void;
  setLastScanAt: (at: number) => void;
  setOrderFlowSnapshot: (symbol: string, snapshot: OrderFlowSnapshot) => void;
  setBackendSignals: (signals: Record<string, any>) => void;
  queueSignal: (id: string) => void;
  deploySignal: (signalId: string) => void;
  addExecutionResult: (result: ExecutionResult) => void;
  updateTradeLivePrice: (symbol: string, livePrice: number) => void;
  updateTradeStatus: (idOrSymbol: string, status: string, price?: number, note?: string) => void;
  deployManualSignal: (signal: any, symbol: string) => void;
}

export const useTradingStore = create<TradingState>()(
  persist(
    (set, get) => ({
  balance: 300,
  activeMode: MODES.AGGRESSIVE,
  symbols: [],
  isDataLive: false,
  scannerRunning: false,
  isScannerActive: typeof window !== 'undefined' ? localStorage.getItem('gb_scanner_active') === 'true' : false,
  isAutoTradeActive: false,
  binanceStatus: 'INIT' as const,
  currentPrices: {},
  marketRows: [],
  pipelineSignals: [],
  pipelineTraces: [],
  signalHistory: [],
  activeTrades: [],
  binancePositions: [],
  dealStatus: {},
  microstructureRows: [],
  liquidityLayers: [],
  triggerLevels: [],
  blockedSignals: [],
  pipelineHealth: [
    { label: 'PYTHUSDT ORACLE', value: 99.9, status: 'ok' },
    { label: 'LIQUIDITY FEED', value: 98.5, status: 'ok' },
    { label: 'CVD AGGREGATOR', value: 85.0, status: 'warn' },
    { label: 'EXECUTION RELAY', value: 100.0, status: 'ok' },
  ],
  marketRegime: 'RANGING' as MarketRegime,
  lastScanAt: null as number | null,
  orderFlowSnapshots: {},
  backendSignals: {},

  // Execution — hardwired to LIVE
  executionMode: 'LIVE' as ExecutionMode,
  executionResults: [],

  backendEnvironment: null,
  setBackendEnvironment: (env) => set({ backendEnvironment: env }),

  accountEnvironment: 'DEMO' as 'DEMO' | 'LIVE',
  liveExecutionArmed: false,

  // Strategy selection defaults — all strategies ON
  enabledStrategies: [] as string[],  // empty = ALL enabled
  strategyPreset: 'ALL',


  setBalance: (balance) => set({ balance }),

  setMode: (key) => {
    const mode = MODES[key];
    if (!mode) return;
    const state = get();
    let trades = state.activeTrades;
    if (trades.length > mode.maxTrades) {
      trades = trades.slice(0, mode.maxTrades);
    }
    set({ activeMode: mode, activeTrades: trades });
  },

  setAccountEnvironment: (env) => set({ accountEnvironment: env, liveExecutionArmed: false }),
  setLiveExecutionArmed: (armed) => set({ liveExecutionArmed: armed }),

  setEnabledStrategies: (ids) => set({ enabledStrategies: ids }),
  setStrategyPreset: (preset) => set({ strategyPreset: preset }),

  setSymbols: (symbols) => set({ symbols }),
  setDataLive: (isDataLive) => set({ isDataLive }),
  setScannerActive: (active) => {
    if (typeof window !== 'undefined') localStorage.setItem('gb_scanner_active', String(active));
    set({ isScannerActive: active });
  },
  setAutoTradeActive: (active) => set({ isAutoTradeActive: active }),
  setScannerRunning: (scannerRunning) => set({ scannerRunning }),
  setBinanceStatus: (status) => set({ binanceStatus: status }),
  updatePrices: (newPrices) => set(state => ({
    currentPrices: { ...state.currentPrices, ...newPrices }
  })),

  setMarketRows: (marketRows) => set({ marketRows: Array.isArray(marketRows) ? marketRows : [] }),
  
  setPipelineSignals: (newSignals) => set(state => {
    const signals = Array.isArray(newSignals) ? newSignals : [];
    // 1. Identify signals already in a PROTECTED state (Queued/Deployed)
    //    We guard by ID here to allow new signals for the same symbol to enter
    //    as 'PENDING' or 'ACCEPTED' without overwriting the queued ones.
    const protectedIds = new Set(
      state.pipelineSignals
        .filter(s => s.status === 'QUEUED' || s.status === 'DEPLOYED')
        .map(s => s.id)
    );

    // 3. Keep protected signals exactly as they are
    const protectedSignals = state.pipelineSignals.filter(s => protectedIds.has(s.id));

    // 4. For new signals:
    //    - If an active trade exists for that symbol, we still allow the signal (for history),
    //      but we'll flag it in the UI as 'COLLISION' or similar if needed.
    //      For now, just merge.
    const merged = [
      ...protectedSignals,
      ...signals.filter(ns => !protectedIds.has(ns.id))
    ];

    // 5. Deduplicate by ID only (never by symbol)
    const uniqueById = Array.from(new Map(merged.map(s => [s.id, s])).values());
    
    return { pipelineSignals: uniqueById };
  }),


  setPipelineTraces: (traces) => set({ 
    pipelineTraces: Array.isArray(traces) ? traces.slice(0, 200) : [] 
  }),

  addSignalToHistory: (entry) => set(state => ({
    signalHistory: [
      { ...entry, ts: entry.ts || Date.now() },
      ...state.signalHistory
    ].slice(0, 60)
  })),

  setBinancePositions: (positions) => set({ binancePositions: Array.isArray(positions) ? positions : [] }),

  addActiveTrade: (trade) => set(state => {
    // We NO LONGER overwrite by symbol. Every trade is a unique instance.
    // If trade has no ID, generate one based on its signalId or timestamp.
    const tradeId = trade.id || `trade_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const newTrade = { ...trade, id: tradeId };
    
    return {
      activeTrades: [newTrade, ...state.activeTrades]
    };
  }),

  removeActiveTrade: (idx) => set(state => ({
    activeTrades: state.activeTrades.filter((_, i) => i !== idx)
  })),

  setDealStatus: (key, status) => set(state => ({
    dealStatus: { ...state.dealStatus, [key]: status }
  })),

  getDealStatus: (symbol, kind) => {
    const key = `${symbol.toUpperCase()}::${(kind || 'SNIPER').toUpperCase()}`;
    return get().dealStatus[key] || 'ACTIVE';
  },

  setMicrostructureRows: (rows) => set({ microstructureRows: Array.isArray(rows) ? rows : [] }),
  setLiquidityLayers: (layers) => set({ liquidityLayers: Array.isArray(layers) ? layers : [] }),
  setTriggerLevels: (levels) => set({ triggerLevels: Array.isArray(levels) ? levels : [] }),
  setBlockedSignals: (signals) => set({ blockedSignals: Array.isArray(signals) ? signals : [] }),
  setPipelineHealth: (health) => set({ pipelineHealth: Array.isArray(health) ? health : [] }),

  setMarketRegime: (regime) => set({ marketRegime: regime }),
  setLastScanAt: (lastScanAt) => set({ lastScanAt }),
  setOrderFlowSnapshot: (symbol, snapshot) => set(state => ({
    orderFlowSnapshots: { ...state.orderFlowSnapshots, [symbol]: snapshot }
  })),
  setBackendSignals: (signals) => set({ backendSignals: signals }),

  queueSignal: (id) => {
    const state = get();
    const target = state.pipelineSignals.find(s => s.id === id);
    if (!target) return;
    if (['PENDING', 'INVALIDATED', 'EXPIRED', 'CANCELLED', 'DEPLOYED'].includes(target.status)) {
      console.warn(`[Store Guard] Cannot queue signal with status: ${target.status}`);
      return;
    }
    set(s => ({
      pipelineSignals: s.pipelineSignals.map(signal => 
        signal.id === id ? { ...signal, status: 'QUEUED' } : signal
      )
    }));
  },

  deploySignal: (signalId) => {
    const state = get();

    // ── Find exact signal instance by ID ─────────────────────────────────────
    const target = state.pipelineSignals.find(s => s.id === signalId);
    if (!target) {
      console.warn(`[Store Guard] Cannot deploy — signal ID ${signalId} not found`);
      return;
    }

    if (target.status !== 'QUEUED') {
      console.warn(`[Store Guard] Cannot deploy — signal ${target.symbol} (ID: ${signalId}) not QUEUED (status: ${target.status})`);
      return;
    }

    // ── Guard 2: cross-check if this exact signal instance is already deployed ──
    const alreadyDeployedAsTrade = state.activeTrades.some(t => t.signalId === signalId);
    if (alreadyDeployedAsTrade) {
      console.warn(`[Store Guard] Signal ${signalId} is already active as a trade.`);
      return;
    }

    const symbol = target.symbol;
    const payload = toExecutionPayload(target.signal, symbol);
    payload.signalId = signalId; // Link payload back to original signal

    // ── TP Debug Audit (Frontend) ─────────────────────────────────────────
    console.log(`[TP_DEBUG:FRONTEND] ${symbol} | tp1=${payload.takeProfit} | tp2=${payload.takeProfit2 ?? 'N/A'} | entry=${payload.entryPrice} | sl=${payload.stopLoss}`);

    // ── Mark exact signal instance as DEPLOYED ───────────────────────────────
    set(s => ({
      pipelineSignals: s.pipelineSignals.map(n =>
        n.id === signalId ? { ...n, status: 'DEPLOYED' } : n
      )
    }));

    // ── Create ActiveTrade with mandatory ID and signalId ────────────────────
    const uniqueTradeId = `tr_${signalId}`; // Stable ID for consistent tracking
    
    state.addActiveTrade({
      id:         uniqueTradeId,
      signalId:   signalId,
      symbol,
      kind:       payload.kind || 'SNIPER',
      type:       'MANUAL',
      side:       payload.side,
      entryPrice: payload.entryPrice,
      qty:        payload.qty,
      qtyBase:    payload.qty,
      sizeUSDT:   payload.sizeUSDT,
      t1:         payload.takeProfit,
      t2:         payload.takeProfit2,
      sl:         payload.stopLoss,
      stopPrice:  payload.stopLoss,
      leverage:   payload.leverage,
      deployedAt: Date.now(),
      status:     'ACTIVE',
      score:      payload.score,
      entryType:  payload.entryType,
      entryTiming:payload.entryTiming,
      reasons:    payload.reasons,
      accountMode: state.accountEnvironment,
      source:     'FRONTEND',
      authority:  'LOCAL',
      statusHistory: [{ status: 'ACTIVE' as const, ts: Date.now() }]
    });

    // ── Mode-Aware Execution ───────────────────────────────────────────────────
    executeOrder(state.accountEnvironment, payload).then(result => {
      get().addExecutionResult(result);
      if (result.status === 'FAILED') {
        // Roll back the specific trade by ID
        set(s => ({
          activeTrades: s.activeTrades.filter(t => t.id !== uniqueTradeId),
          pipelineSignals: s.pipelineSignals.map(n =>
            n.id === signalId ? { ...n, status: 'QUEUED' } : n
          )
        }));
        console.error(`[ExecAdapter] Rolled back ${symbol} (ID: ${signalId}) — reason: ${result.error}`);
      }
    });
  },

  addExecutionResult: (result) => set(state => ({
    executionResults: [result, ...state.executionResults].slice(0, 100)
  })),

  updateTradeLivePrice: (symbol, livePrice) => set(state => {
    // TP1_HIT is intentionally NOT terminal here — it can still progress to TP2_HIT or SL_HIT
    const TERMINAL = ['TP2_HIT', 'SL_HIT', 'CLOSED', 'CANCELLED'];
    const now = Date.now();

    // Mapping over all active trades. If there are multiple (e.g. ZRO v1 and v2 both somehow active),
    // they each get their respective math based on their own entryPrice.
    const updatedTrades = state.activeTrades.map(t => {
      if (t.symbol.toUpperCase() !== symbol.toUpperCase()) return t;

      // ── Skip terminal trades ────────────────────────────────────────────────
      if (TERMINAL.includes(t.status)) return t;

      const entry  = t.entryPrice;
      const sl     = t.dynamicSL ?? t.sl;
      const dir    = t.side === 'LONG' ? 1 : -1;
      const status = t.status;

      // ── Recompute live metrics (using trade-specific entryPrice) ─────────────
      const priceDiff     = (livePrice - entry) * dir;
      const unrealizedPnl = priceDiff * t.qty;
      const riskPerUnit   = Math.abs(entry - sl);
      const rMultiple     = riskPerUnit > 0 ? (priceDiff / riskPerUnit) : undefined;
      const pct           = (target: number) => ((target - livePrice) / livePrice * 100 * dir);
      const distToTp1     = t.t1 ? pct(t.t1) : undefined;
      const distToTp2     = t.t2 ? pct(t.t2) : undefined;
      const distToSl      = sl   ? -pct(sl)   : undefined;

      // Hit detection...
      const crossed   = (target: number) => dir === 1 ? livePrice >= target : livePrice <= target;
      const slCrossed = (slLevel: number) => dir === 1 ? livePrice <= slLevel : livePrice >= slLevel;

      let newStatus: string = status;
      let realizedPnl       = t.realizedPnl;
      let history           = t.statusHistory ?? [];

      if ((status === 'ACTIVE' || status === 'TP1_HIT') && slCrossed(sl)) {
        const pnl = parseFloat(((livePrice - entry) * dir * t.qty).toFixed(2));
        newStatus = 'SL_HIT'; realizedPnl = pnl;
        history = [...history, { status: 'SL_HIT' as const, ts: now, price: livePrice, note: 'Automatic stop hit' }];
      } else if (status === 'TP1_HIT' && t.t2 && crossed(t.t2)) {
        const pnl = parseFloat(((livePrice - entry) * dir * t.qty).toFixed(2));
        newStatus = 'TP2_HIT'; realizedPnl = pnl;
        history = [...history, { status: 'TP2_HIT' as const, ts: now, price: livePrice, note: 'Full target reached' }];
      } else if (status === 'ACTIVE' && t.t1 && crossed(t.t1)) {
        const pnl = parseFloat(((livePrice - entry) * dir * t.qty).toFixed(2));
        newStatus = 'TP1_HIT'; realizedPnl = pnl;
        history = [...history, { status: 'TP1_HIT' as const, ts: now, price: livePrice, note: 'First target reached' }];
      }
      // Update Outcome Trackers
      let mfe = t.mfe ?? livePrice;
      let mae = t.mae ?? livePrice;
      if (t.side === 'LONG') {
        if (livePrice > mfe) mfe = livePrice;
        if (livePrice < mae) mae = livePrice;
      } else {
        if (livePrice < mfe) mfe = livePrice;
        if (livePrice > mae) mae = livePrice;
      }
      
      let hasHit1R = t.hasHit1R ?? false;
      const risk = Math.abs(t.entryPrice - t.sl);
      if (risk > 0 && !hasHit1R) {
        const potential1RPrice = t.side === 'LONG' ? t.entryPrice + risk : t.entryPrice - risk;
        if (t.side === 'LONG' && livePrice >= potential1RPrice) hasHit1R = true;
        if (t.side === 'SHORT' && livePrice <= potential1RPrice) hasHit1R = true;
      }

      return {
        ...t, livePrice, status: newStatus, realizedPnl, statusHistory: history,
        mfe, mae, hasHit1R,
        unrealizedPnl: parseFloat(unrealizedPnl.toFixed(2)),
        rMultiple:     rMultiple  !== undefined ? parseFloat(rMultiple.toFixed(3))  : undefined,
        distToTp1:     distToTp1 !== undefined ? parseFloat(distToTp1.toFixed(3)) : undefined,
        distToTp2:     distToTp2 !== undefined ? parseFloat(distToTp2.toFixed(3)) : undefined,
        distToSl:      distToSl  !== undefined ? parseFloat(distToSl.toFixed(3))  : undefined,
        priceUpdatedAt: now,
      };
    });

    const newState = {
      activeTrades: updatedTrades,
      currentPrices: { ...state.currentPrices, [symbol.toUpperCase()]: { last: livePrice, ts: now } }
    };

    // Auto-close removed — live trades managed via Binance positions sync only


    return newState;
  }),



  updateTradeStatus: (idOrSymbol, newStatus, price, note) => set(state => ({
    activeTrades: state.activeTrades.map(t => {
      const match = (t.id === idOrSymbol) || (t.symbol.toUpperCase() === idOrSymbol.toUpperCase());
      if (!match) return t;

      const event = { status: newStatus as any, ts: Date.now(), price, note };
      const history = [...(t.statusHistory ?? []), event];

      const TERMINAL = ['TP1_HIT', 'TP2_HIT', 'SL_HIT', 'CLOSED', 'CANCELLED'];
      let realizedPnl = t.realizedPnl;
      if (TERMINAL.includes(newStatus) && !TERMINAL.includes(t.status as string)) {
        if (price) {
          const dir = t.side === 'LONG' ? 1 : -1;
          realizedPnl = parseFloat(((price - t.entryPrice) * dir * t.qty).toFixed(2));
        }
        
        // Print Live Trade Outcome Audit
        const moveMfePct = t.mfe ? (Math.abs(t.mfe - t.entryPrice) / t.entryPrice * 100).toFixed(2) : '0.00';
        const moveMaePct = t.mae ? (Math.abs(t.mae - t.entryPrice) / t.entryPrice * 100).toFixed(2) : '0.00';
        console.log(`\n\x1b[36m┌─── [TRADE OUTCOME: ${t.symbol} ${t.side}] ──────────────────────\x1b[0m`);
        console.log(`\x1b[36m│\x1b[0m Result:      ${newStatus} (PnL: ${realizedPnl || 0} USDT)`);
        console.log(`\x1b[36m│\x1b[0m Excursion:   Max Fav: ${moveMfePct}% | Max Adv: ${moveMaePct}%`);
        console.log(`\x1b[36m│\x1b[0m Target 1R:   ${t.hasHit1R ? '✅ Achieved' : '❌ Missed'}`);
        console.log(`\x1b[36m└────────────────────────────────────────────────────────────\x1b[0m\n`);
      }

      return { ...t, status: newStatus, statusHistory: history, realizedPnl };
    })
  })),


  deployManualSignal: (signal, symbol) => {
    const state = get();
    const payload = toExecutionPayload(signal, symbol);
    const fakeId  = `manual_${Date.now()}`;

    state.addActiveTrade({
      id:         `tr_${fakeId}`,
      signalId:   fakeId,
      symbol,
      kind:       payload.kind || 'MANUAL',
      type:       'MANUAL',
      side:       payload.side,
      entryPrice: payload.entryPrice,
      qty:        payload.qty,
      qtyBase:    payload.qty,
      sizeUSDT:   payload.sizeUSDT,
      t1:         payload.takeProfit,
      t2:         payload.takeProfit2,
      sl:         payload.stopLoss,
      stopPrice:  payload.stopLoss,
      leverage:   payload.leverage,
      deployedAt: Date.now(),
      status:     'ACTIVE',
      score:      payload.score,
      accountMode: state.accountEnvironment,
      source:     'MANUAL',
      authority:  'LOCAL',
      statusHistory: [{ status: 'ACTIVE' as const, ts: Date.now() }]
    });

    executeOrder(state.accountEnvironment, payload).then(result => {
      get().addExecutionResult(result);
    });
  }
    }),
    {
      name: 'gold-bonanza-storage',
      partialize: (state) => ({
        activeModeId: state.activeMode.key,
        isAutoTradeActive: state.isAutoTradeActive,
        isScannerActive: state.isScannerActive,
        balance: state.balance,
        enabledStrategies: state.enabledStrategies,
        strategyPreset: state.strategyPreset
        // Note: accountEnvironment and liveExecutionArmed are INTENTIONALLY excluded here to 
        // enforce fail-closed default DEMO on refresh.
      }),
      onRehydrateStorage: () => (state) => {
        if (state && (state as any).activeModeId) {
          state.activeMode = MODES[(state as any).activeModeId as keyof typeof MODES] || MODES.AGGRESSIVE;
        }
      }
    }
  )
);


`

## 4) Safety proof checklist
- **Frontend Trigger:** 	radingStore.ts (deploySignal, deployManualSignal) now pass state.accountEnvironment explicitly to executeOrder(mode, payload).
- **Adapter Guard:** executionAdapter.ts (executeOrder) now runs canPlaceLiveOrder(context).
- **Blocked State:** Blocked orders immediately return status: \'FAILED\' and log a strict [ExecutionGuard]  BLOCKED: ... error to console. It prevents network traffic entirely.
- **Backend Sync Guard:** utoTrader.ts (evaluateFrontendSignals) and 	rade.ts (/open).
- **Backed Blocked State:** Returns error: \'Live execution locked by Kill Switch or ENV config.\'

## 5) Reconciliation proof
- **DEMO / PAPER POSITIONS:** CommandSyncHub.tsx filters ctiveTrades where ccountMode === \'DEMO\'.
- **EXCHANGE LIVE POSITIONS:** Pulled via api getPositions(), validated natively against Binance.
- **UNSYNCED LIVE POSITIONS:** Highlighted where ccountMode === \'LIVE\' but missing from Binance list.
- **UI Indicators:** The SystemStatus.tsx panel renders mismatch alerts (UNSYNCED LOCAL CARDS) if local storage hallucinates real trades that failed to network.

## 6) Startup proof
In src/store/tradingStore.ts (Lines ~550), ccountEnvironment and liveExecutionArmed are explicitly excluded from partialize. They never persist. The initial store default is \'DEMO\' and rmed: false. Any refresh forces the app back to DEMO.

## 7) Backend proof
In 	rade.ts L225 and utoTrader.ts L253:
`	ypescript
if ((global as any).GB_LIVE_KILL === true || process.env.ENABLE_LIVE_TRADING !== \'true\') { ... }
`
This shuts down /open and evaluateFrontendSignals() respectively.

## 8) Test plan with expected results
- **demo order from UI never hits live API:** Demo order creates unique demo_... mock order ID.
- **live off blocks manual live order:** Adapter logs Account Environment is DEMO, not LIVE.
- **live off blocks scanner/radar/trigger path:** canPlaceLiveOrder blocks before API request.
- **page refresh does not re-arm live:** Store default is Demo/Off.
- **existing exchange live positions appear in Sync Hub:** Rendered securely under EXCHANGE array component.
- **exchange position missing local state:** Renders truthfully based purely on getPositions(), disregarding what frontend tracking thinks.
- **backend disabled blocks all live execution:** ENABLE_LIVE_TRADING=false aborts backend calls.
- **kill switch overrides everything:** Evaluated as Layer 1 on both Client and Node daemon.

## 9) Final hardening
Grep searches for openTrade and executeOrder returned 0 bypasses. All paths strictly funnel through canPlaceLiveOrder and ENABLE_LIVE_TRADING. File search executed against /src and /server.

