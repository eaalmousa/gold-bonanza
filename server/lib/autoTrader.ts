import { getPositions, getBalance, setLeverage, placeMarketOrder, placeStopMarket, placeTakeProfitMarket, placeTrailingStopMarket } from './binance';
import { MODES } from '../../src/types/trading';
import { DEFAULT_SYMBOLS } from '../../src/types/trading';

import fs from 'fs';
import path from 'path';

const STATE_FILE = path.resolve(__dirname, '../../trader_state.json');

// ─── Config ───────────────────────────────────────────────────────────────────
// executionMode is permanently LIVE — no other modes exist in this codebase.
export const TRADER_CONFIG = {
  RISK_PER_TRADE:         parseFloat(process.env.RISK_PER_TRADE || '0.10'),
  MAX_CONCURRENT_TRADES:  100, // TEMPORARY RELAXATION FOR TRACE CAPTURE
  LEVERAGE:               parseInt(process.env.LEVERAGE || '10', 10),
  SL_ENABLED:             true,
  TP_ENABLED:             true,
  TP1_ONLY:               false,
  TP1_RR:                 1.50,   // raised from 1.25
  TP2_RR:                 2.50,
  MIN_SCORE:              -100,  // TEMPORARY RELAXATION FOR TRACE CAPTURE
  BTC_GATE_ENABLED:       false,
  TRAIL_TP_ENABLED:       false,
  CIRCUIT_BREAKER_ENABLED: false,
  isAutoTradingEnabled:   true,
};

const BASE_CAPITAL = parseFloat(process.env.BASE_CAPITAL || '300');
const LIVE_BASE_URL = 'https://fapi.binance.com';

// ─── Persistence ──────────────────────────────────────────────────────────────
try {
  if (fs.existsSync(STATE_FILE)) {
    const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    TRADER_CONFIG.RISK_PER_TRADE          = saved.RISK_PER_TRADE          ?? TRADER_CONFIG.RISK_PER_TRADE;
    TRADER_CONFIG.MAX_CONCURRENT_TRADES   = saved.MAX_CONCURRENT_TRADES   ?? TRADER_CONFIG.MAX_CONCURRENT_TRADES;
    TRADER_CONFIG.LEVERAGE                = saved.LEVERAGE                ?? TRADER_CONFIG.LEVERAGE;
    TRADER_CONFIG.SL_ENABLED              = saved.SL_ENABLED              ?? TRADER_CONFIG.SL_ENABLED;
    TRADER_CONFIG.TP_ENABLED              = saved.TP_ENABLED              ?? TRADER_CONFIG.TP_ENABLED;
    TRADER_CONFIG.TP1_ONLY                = saved.TP1_ONLY                ?? TRADER_CONFIG.TP1_ONLY;
    TRADER_CONFIG.TP1_RR                  = saved.TP1_RR                  ?? TRADER_CONFIG.TP1_RR;
    TRADER_CONFIG.TP2_RR                  = saved.TP2_RR                  ?? TRADER_CONFIG.TP2_RR;
    TRADER_CONFIG.MIN_SCORE               = saved.MIN_SCORE               ?? TRADER_CONFIG.MIN_SCORE;
    TRADER_CONFIG.BTC_GATE_ENABLED        = saved.BTC_GATE_ENABLED        ?? TRADER_CONFIG.BTC_GATE_ENABLED;
    TRADER_CONFIG.TRAIL_TP_ENABLED        = saved.TRAIL_TP_ENABLED        ?? TRADER_CONFIG.TRAIL_TP_ENABLED;
    TRADER_CONFIG.CIRCUIT_BREAKER_ENABLED = saved.CIRCUIT_BREAKER_ENABLED ?? TRADER_CONFIG.CIRCUIT_BREAKER_ENABLED;
    TRADER_CONFIG.isAutoTradingEnabled    = saved.isAutoTradingEnabled    ?? TRADER_CONFIG.isAutoTradingEnabled;
    console.log(`[Persistence] Loaded: AUTO=${TRADER_CONFIG.isAutoTradingEnabled} MIN_SCORE=${TRADER_CONFIG.MIN_SCORE}`);
  }
} catch (e) {
  console.warn('[Persistence] Failed to load state file');
}

function saveState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(TRADER_CONFIG, null, 2));
  } catch (e) {
    console.warn('[Persistence] Failed to save state');
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────
export function updateTraderConfig(config: {
  riskPerTrade?: number;
  maxConcurrent?: number;
  leverage?: number;
  slEnabled?: boolean;
  tpEnabled?: boolean;
  tp1Only?: boolean;
  tp1RR?: number;
  tp2RR?: number;
  minScore?: number;
  btcGateEnabled?: boolean;
  trailTpEnabled?: boolean;
  circuitBreakerEnabled?: boolean;
  executionMode?: string; // accepted but ignored — always LIVE
}) {
  if (config.riskPerTrade          !== undefined) TRADER_CONFIG.RISK_PER_TRADE          = config.riskPerTrade;
  if (config.maxConcurrent         !== undefined) TRADER_CONFIG.MAX_CONCURRENT_TRADES   = config.maxConcurrent;
  if (config.leverage              !== undefined) TRADER_CONFIG.LEVERAGE                = config.leverage;
  if (config.slEnabled             !== undefined) TRADER_CONFIG.SL_ENABLED              = config.slEnabled;
  if (config.tpEnabled             !== undefined) TRADER_CONFIG.TP_ENABLED              = config.tpEnabled;
  if (config.tp1Only               !== undefined) TRADER_CONFIG.TP1_ONLY                = config.tp1Only;
  if (config.tp1RR                 !== undefined) TRADER_CONFIG.TP1_RR                  = config.tp1RR;
  if (config.tp2RR                 !== undefined) TRADER_CONFIG.TP2_RR                  = config.tp2RR;
  if (config.minScore              !== undefined) TRADER_CONFIG.MIN_SCORE               = config.minScore;
  if (config.btcGateEnabled        !== undefined) TRADER_CONFIG.BTC_GATE_ENABLED        = config.btcGateEnabled;
  if (config.trailTpEnabled        !== undefined) TRADER_CONFIG.TRAIL_TP_ENABLED        = config.trailTpEnabled;
  if (config.circuitBreakerEnabled !== undefined) TRADER_CONFIG.CIRCUIT_BREAKER_ENABLED = config.circuitBreakerEnabled;
  // executionMode is permanently LIVE — any incoming value is silently discarded

  saveState();
  logMsg(`Config saved: MIN_SCORE=${TRADER_CONFIG.MIN_SCORE} SL=${TRADER_CONFIG.SL_ENABLED} TP=${TRADER_CONFIG.TP_ENABLED} TRAIL=${TRADER_CONFIG.TRAIL_TP_ENABLED}`);
}

export function toggleAutoTrade(enabled: boolean) {
  TRADER_CONFIG.isAutoTradingEnabled = enabled;
  saveState();
  logMsg(`AutoTrade: ${enabled ? 'ON' : 'OFF'}`);
}

// ─── Logs & Cache ─────────────────────────────────────────────────────────────
export const tradeLogs: string[] = [];

export interface BackendSignalState {
  signalId: string;
  symbol: string;
  createdAt: number;
  source: 'BACKEND';
  backendDecision: 'BLOCKED_BACKEND' | 'DEPLOYED_BACKEND' | 'PENDING' | 'ACCEPTED_BACKEND';
  backendDecisionAt: number;
  blockerReason?: string;
  deployedOrderId?: string;
}

export const backendSignalCache: Record<string, BackendSignalState> = {};

function logMsg(msg: string) {
  console.log(`[AutoTrader] ${msg}`);
  tradeLogs.unshift(`[${new Date().toISOString()}] ${msg}`);
  if (tradeLogs.length > 200) tradeLogs.pop();
}

// ─── Main Evaluation Loop ─────────────────────────────────────────────────────
export async function evaluateFrontendSignals(allSignals: any[]) {
  if (!TRADER_CONFIG.isAutoTradingEnabled) return backendSignalCache;

  logMsg(`--- LIVE EVALUATION START ---`);

  // 1. Seed cache for all incoming signals
  allSignals.forEach(s => {
    if (!backendSignalCache[s.id]) {
      backendSignalCache[s.id] = {
        signalId: s.id,
        symbol: s.symbol,
        createdAt: s.timestamp || Date.now(),
        source: 'BACKEND',
        backendDecision: 'PENDING',
        backendDecisionAt: Date.now()
      };
    }
  });

  // 2. Fetch live Binance state
  let activePos: any[] = [];
  let balance = BASE_CAPITAL;

  try {
    activePos = await getPositions(LIVE_BASE_URL);
    const actualBalance = await getBalance(LIVE_BASE_URL);
    if (actualBalance > 0) balance = actualBalance;
  } catch (e: any) {
    const is401 = e.message.includes('401');
    logMsg(`CRITICAL ${is401 ? 'Auth (401)' : 'Network'} error fetching live state: ${e.message}`);
    allSignals.forEach(s => {
      backendSignalCache[s.id].backendDecision = 'BLOCKED_BACKEND';
      backendSignalCache[s.id].blockerReason   = `Live exchange unreachable: ${e.message}`;
      backendSignalCache[s.id].backendDecisionAt = Date.now();
    });
    return backendSignalCache;
  }

  // 3. Capacity check
  if (activePos.length >= TRADER_CONFIG.MAX_CONCURRENT_TRADES) {
    logMsg(`Max capacity: ${activePos.length}/${TRADER_CONFIG.MAX_CONCURRENT_TRADES}`);
    allSignals.forEach(s => {
      if (s.status === 'ACCEPTED') {
        backendSignalCache[s.id].backendDecision = 'BLOCKED_BACKEND';
        backendSignalCache[s.id].blockerReason   = `Portfolio cap reached (${activePos.length}/${TRADER_CONFIG.MAX_CONCURRENT_TRADES})`;
      }
    });
    return backendSignalCache;
  }

  // 4. Filter actionable signals
  const combined = allSignals
    .filter(s => {
      if (!s.signal || s.signal.score < TRADER_CONFIG.MIN_SCORE) {
        backendSignalCache[s.id].backendDecision = 'BLOCKED_BACKEND';
        backendSignalCache[s.id].blockerReason   = `Score ${s.signal?.score?.toFixed(1)} < ${TRADER_CONFIG.MIN_SCORE}`;
        return false;
      }
      const et = s.signal.entryType;
      if (s.status !== 'ACCEPTED') return false;
      if (et === 'PENDING_BREAKOUT' || et === 'INVALIDATED' || et === 'EXPIRED_NO_RETEST') return false;
      return true;
    })
    .sort((a: any, b: any) => b.signal.score - a.signal.score);

  if (combined.length === 0) {
    logMsg(`No actionable signals passed gateway.`);
    return backendSignalCache;
  }

  // 5. Risk gates
  const activeLongsCount  = activePos.filter((p: any) => parseFloat(p.positionAmt) > 0).length;
  const activeShortsCount = activePos.filter((p: any) => parseFloat(p.positionAmt) < 0).length;

  let longsInDeepRed = 0;
  activePos.filter((p: any) => parseFloat(p.positionAmt) > 0).forEach((p: any) => {
    const pnl    = parseFloat(p.unRealizedProfit);
    const margin = (parseFloat(p.positionAmt) * parseFloat(p.entryPrice)) / parseFloat(p.leverage);
    if (margin > 0 && (pnl / margin) < -0.25) longsInDeepRed++;
  });

  let shortsInDeepRed = 0;
  activePos.filter((p: any) => parseFloat(p.positionAmt) < 0).forEach((p: any) => {
    const pnl    = parseFloat(p.unRealizedProfit);
    const margin = Math.abs((parseFloat(p.positionAmt) * parseFloat(p.entryPrice)) / parseFloat(p.leverage));
    if (margin > 0 && (pnl / margin) < -0.25) shortsInDeepRed++;
  });

  const MAX_DEPLOY_PER_SCAN   = 2;
  let deployedLongsThisScan   = 0;
  let deployedShortsThisScan  = 0;
  let currentCapacity         = activePos.length;

  // 6. Execute signals
  for (const row of combined) {
    if (currentCapacity >= TRADER_CONFIG.MAX_CONCURRENT_TRADES) break;

    const sym   = row.symbol;
    const sigId = row.id;
    const sig   = row.signal;

    // Already holding this symbol?
    if (activePos.some((p: any) => p.symbol === sym)) {
      backendSignalCache[sigId].backendDecision = 'BLOCKED_BACKEND';
      backendSignalCache[sigId].blockerReason   = `Already holding ${sym}.`;
      continue;
    }

    // Side-specific risk gates
    let isBlocked   = false;
    let blockReason = '';

    if (sig.side === 'LONG') {
      if (activeLongsCount + deployedLongsThisScan >= TRADER_CONFIG.MAX_CONCURRENT_TRADES)      { blockReason = 'Wave Cap (LONG)';              isBlocked = true; }
      else if (TRADER_CONFIG.CIRCUIT_BREAKER_ENABLED && longsInDeepRed  >= 1)                   { blockReason = 'Circuit Breaker (LONG)';       isBlocked = true; }
      else if (deployedLongsThisScan  >= MAX_DEPLOY_PER_SCAN)                                   { blockReason = 'Scan Cluster Limit (LONG)';    isBlocked = true; }
    } else {
      if (activeShortsCount + deployedShortsThisScan >= TRADER_CONFIG.MAX_CONCURRENT_TRADES)    { blockReason = 'Wave Cap (SHORT)';             isBlocked = true; }
      else if (TRADER_CONFIG.CIRCUIT_BREAKER_ENABLED && shortsInDeepRed >= 1)                   { blockReason = 'Circuit Breaker (SHORT)';      isBlocked = true; }
      else if (deployedShortsThisScan >= MAX_DEPLOY_PER_SCAN)                                   { blockReason = 'Scan Cluster Limit (SHORT)';   isBlocked = true; }
    }

    if (isBlocked) {
      backendSignalCache[sigId].backendDecision = 'BLOCKED_BACKEND';
      backendSignalCache[sigId].blockerReason   = blockReason;
      continue;
    }

    const riskUSDT = balance * TRADER_CONFIG.RISK_PER_TRADE;
    let   qty      = Math.max(0.001, (riskUSDT * TRADER_CONFIG.LEVERAGE) / sig.entryPrice);

    // ─── MINIMUM NOTIONAL GUARD (Security Enforcement) ─────────────
    // Binance minimum is 5.00 USDT. Signals from the sniper engine 
    // should already satisfy this before reaching this stage.
    const currentNotional = qty * sig.entryPrice;
    if (currentNotional < 5.00) {
      logMsg(`REJECT: ${sym} order notional ${currentNotional.toFixed(2)} USDT < 5.00 floor. Skipping.`);
      continue;
    }

    try {
      logMsg(`🚀 LIVE: ${sym} ${sig.side} | qty=${qty.toFixed(3)} | entry=${sig.entryPrice}`);
      console.warn(`[FORENSIC] ${sym} | side=${sig.side} → orderSide=${sig.side === 'LONG' ? 'BUY' : 'SELL'} | SL=${sig.stopLoss} TP=${sig.takeProfit}`);

      await setLeverage(sym, TRADER_CONFIG.LEVERAGE, LIVE_BASE_URL);
      const entryRes = await placeMarketOrder(sym, sig.side === 'LONG' ? 'BUY' : 'SELL', qty, LIVE_BASE_URL);

      await new Promise(r => setTimeout(r, 1000));
      const closeSide = sig.side === 'LONG' ? 'SELL' : 'BUY';

      if (TRADER_CONFIG.SL_ENABLED) {
        await placeStopMarket(sym, closeSide, sig.stopLoss, LIVE_BASE_URL);
      }

      if (TRADER_CONFIG.TP_ENABLED) {
        const riskDist = Math.abs(sig.entryPrice - sig.stopLoss);
        const tp1Price = sig.side === 'LONG'
          ? sig.entryPrice + riskDist * TRADER_CONFIG.TP1_RR
          : sig.entryPrice - riskDist * TRADER_CONFIG.TP1_RR;

        if (TRADER_CONFIG.TRAIL_TP_ENABLED) {
          await placeTrailingStopMarket(sym, closeSide, 0.5, tp1Price, qty, LIVE_BASE_URL);
        } else if (TRADER_CONFIG.TP1_ONLY) {
          await placeTakeProfitMarket(sym, closeSide, tp1Price, undefined, LIVE_BASE_URL);
        } else {
          const tp2Price = sig.side === 'LONG'
            ? sig.entryPrice + riskDist * TRADER_CONFIG.TP2_RR
            : sig.entryPrice - riskDist * TRADER_CONFIG.TP2_RR;
          await placeTakeProfitMarket(sym, closeSide, tp1Price, qty * 0.5, LIVE_BASE_URL);
          await placeTakeProfitMarket(sym, closeSide, tp2Price, qty * 0.5, LIVE_BASE_URL);
        }
      }

      backendSignalCache[sigId].backendDecision = 'DEPLOYED_BACKEND';
      backendSignalCache[sigId].deployedOrderId = String(entryRes.orderId || 'SUCCESS');
      currentCapacity++;
      if (sig.side === 'LONG') deployedLongsThisScan++; else deployedShortsThisScan++;

    } catch (err: any) {
      logMsg(`❌ FAILED [${sym}]: ${err.message}`);
      backendSignalCache[sigId].backendDecision = 'BLOCKED_BACKEND';
      backendSignalCache[sigId].blockerReason   = `Execution error: ${err.message}`;
    }
  }

  try {
    fs.writeFileSync(path.resolve(__dirname, '../../backend_signals.json'), JSON.stringify(backendSignalCache, null, 2));
  } catch (_) { /* non-critical write */ }

  logMsg(`--- EVALUATION COMPLETE ---`);
  return backendSignalCache;
}
