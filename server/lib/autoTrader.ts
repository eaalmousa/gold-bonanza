import { getPositions, getBalance, setLeverage, placeMarketOrder, placeStopMarket, placeTakeProfitMarket, placeTrailingStopMarket } from './binance';
import { MODES } from '../../src/types/trading';
import { DEFAULT_SYMBOLS } from '../../src/types/trading';

import fs from 'fs';
import path from 'path';

const STATE_FILE = path.resolve(__dirname, '../../trader_state.json');

export const TRADER_CONFIG = {
  RISK_PER_TRADE: parseFloat(process.env.RISK_PER_TRADE || '0.10'),
  MAX_CONCURRENT_TRADES: parseInt(process.env.MAX_CONCURRENT_TRADES || '8', 10),
  LEVERAGE: parseInt(process.env.LEVERAGE || '10', 10),
  SL_ENABLED: true,
  TP_ENABLED: true,
  TP1_ONLY: false,
  TP1_RR: 1.25,
  TP2_RR: 2.50,
  MIN_SCORE: parseInt(process.env.MIN_SCORE_TO_DEPLOY || '15', 10),
  BTC_GATE_ENABLED: true,
  TRAIL_TP_ENABLED: false,
  CIRCUIT_BREAKER_ENABLED: false,
  isAutoTradingEnabled: false,
  executionMode: 'BINANCE_TEST' as 'BINANCE_TEST' | 'BINANCE_LIVE'
};

const BASE_CAPITAL = parseFloat(process.env.BASE_CAPITAL || '300');

// Load persisted state on startup
try {
  if (fs.existsSync(STATE_FILE)) {
    const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    TRADER_CONFIG.RISK_PER_TRADE = saved.RISK_PER_TRADE ?? TRADER_CONFIG.RISK_PER_TRADE;
    TRADER_CONFIG.MAX_CONCURRENT_TRADES = saved.MAX_CONCURRENT_TRADES ?? TRADER_CONFIG.MAX_CONCURRENT_TRADES;
    TRADER_CONFIG.LEVERAGE = saved.LEVERAGE ?? TRADER_CONFIG.LEVERAGE;
    TRADER_CONFIG.SL_ENABLED = saved.SL_ENABLED ?? TRADER_CONFIG.SL_ENABLED;
    TRADER_CONFIG.TP_ENABLED = saved.TP_ENABLED ?? TRADER_CONFIG.TP_ENABLED;
    TRADER_CONFIG.TP1_ONLY = saved.TP1_ONLY ?? TRADER_CONFIG.TP1_ONLY;
    TRADER_CONFIG.TP1_RR = saved.TP1_RR ?? TRADER_CONFIG.TP1_RR;
    TRADER_CONFIG.TP2_RR = saved.TP2_RR ?? TRADER_CONFIG.TP2_RR;
    TRADER_CONFIG.MIN_SCORE = saved.MIN_SCORE ?? TRADER_CONFIG.MIN_SCORE;
    TRADER_CONFIG.BTC_GATE_ENABLED = saved.BTC_GATE_ENABLED ?? TRADER_CONFIG.BTC_GATE_ENABLED;
    TRADER_CONFIG.TRAIL_TP_ENABLED = saved.TRAIL_TP_ENABLED ?? TRADER_CONFIG.TRAIL_TP_ENABLED;
    TRADER_CONFIG.CIRCUIT_BREAKER_ENABLED = saved.CIRCUIT_BREAKER_ENABLED ?? TRADER_CONFIG.CIRCUIT_BREAKER_ENABLED;
    TRADER_CONFIG.isAutoTradingEnabled = saved.isAutoTradingEnabled ?? TRADER_CONFIG.isAutoTradingEnabled;
    TRADER_CONFIG.executionMode = saved.executionMode ?? TRADER_CONFIG.executionMode;
    console.log(`[Persistence] Loaded state: AUTO=${TRADER_CONFIG.isAutoTradingEnabled} MODE=${TRADER_CONFIG.executionMode} MIN_SCORE=${TRADER_CONFIG.MIN_SCORE}`);
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
  executionMode?: 'BINANCE_TEST' | 'BINANCE_LIVE';
}) {
  if (config.riskPerTrade !== undefined) TRADER_CONFIG.RISK_PER_TRADE = config.riskPerTrade;
  if (config.maxConcurrent !== undefined) TRADER_CONFIG.MAX_CONCURRENT_TRADES = config.maxConcurrent;
  if (config.leverage !== undefined) TRADER_CONFIG.LEVERAGE = config.leverage;
  if (config.slEnabled !== undefined) TRADER_CONFIG.SL_ENABLED = config.slEnabled;
  if (config.tpEnabled !== undefined) TRADER_CONFIG.TP_ENABLED = config.tpEnabled;
  if (config.tp1Only !== undefined) TRADER_CONFIG.TP1_ONLY = config.tp1Only;
  if (config.tp1RR !== undefined) TRADER_CONFIG.TP1_RR = config.tp1RR;
  if (config.tp2RR !== undefined) TRADER_CONFIG.TP2_RR = config.tp2RR;
  if (config.minScore !== undefined) TRADER_CONFIG.MIN_SCORE = config.minScore;
  if (config.btcGateEnabled !== undefined) TRADER_CONFIG.BTC_GATE_ENABLED = config.btcGateEnabled;
  if (config.trailTpEnabled !== undefined) TRADER_CONFIG.TRAIL_TP_ENABLED = config.trailTpEnabled;
  if (config.circuitBreakerEnabled !== undefined) TRADER_CONFIG.CIRCUIT_BREAKER_ENABLED = config.circuitBreakerEnabled;
  if (config.executionMode !== undefined) TRADER_CONFIG.executionMode = config.executionMode;
  
  saveState();
  logMsg(`Config Updated & Saved: MIN_SCORE=${TRADER_CONFIG.MIN_SCORE} TRAIL=${TRADER_CONFIG.TRAIL_TP_ENABLED} SL=${TRADER_CONFIG.SL_ENABLED} TP=${TRADER_CONFIG.TP_ENABLED}`);
}

export function toggleAutoTrade(enabled: boolean) {
  TRADER_CONFIG.isAutoTradingEnabled = enabled;
  saveState();
  logMsg(`State changed and saved to: ${enabled ? 'ON' : 'OFF'}`);
}

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

function resolveBaseUrl(mode: string): string {
  // If user has set a hard BASE_URL, we should respect it, 
  // but for TEST vs LIVE separation we enforce standard endpoints.
  if (mode === 'BINANCE_LIVE') return 'https://fapi.binance.com';
  return 'https://testnet.binancefuture.com';
}

export async function evaluateFrontendSignals(allSignals: any[]) {
  if (!TRADER_CONFIG.isAutoTradingEnabled) return backendSignalCache;
  
  const mode = TRADER_CONFIG.executionMode;
  const baseUrl = resolveBaseUrl(mode);

  logMsg(`--- STARTING EVALUATION [${mode}] ---`);
  
  // 1. TRUTH SYNCHRONIZATION: Always update cache first so UI sees "Backend Reached"
  allSignals.forEach(s => {
    const sigId = s.id;
    if (!backendSignalCache[sigId]) {
      backendSignalCache[sigId] = {
        signalId: sigId,
        symbol: s.symbol,
        createdAt: s.timestamp || Date.now(),
        source: 'BACKEND',
        backendDecision: 'PENDING',
        backendDecisionAt: Date.now()
      };
    }
  });

  try {
    // 2. Fetch Account State (with isolation for the chosen mode)
    let activePos: any[] = [];
    let balance = BASE_CAPITAL;
    
    try {
      activePos = await getPositions(baseUrl);
      const actualBalance = await getBalance(baseUrl);
      if (actualBalance > 0) balance = actualBalance;
    } catch (e: any) {
      const is401 = e.message.includes('401');
      const errorLabel = is401 ? 'Identity (401)' : 'Network';
      logMsg(`CRITICAL ${errorLabel} ERROR fetch state: ${e.message}`);
      
      // If we can't talk to the exchange, we MUST mark all signals as blocked
      allSignals.forEach(s => {
        const sigId = s.id;
        backendSignalCache[sigId].backendDecision = 'BLOCKED_BACKEND';
        backendSignalCache[sigId].blockerReason = `Exchange unreachable: ${e.message}`;
        backendSignalCache[sigId].backendDecisionAt = Date.now();
      });
      return backendSignalCache;
    }

    if (activePos.length >= TRADER_CONFIG.MAX_CONCURRENT_TRADES) {
      logMsg(`Max capacity reached (${activePos.length}/${TRADER_CONFIG.MAX_CONCURRENT_TRADES}). Marking as blocked.`);
      allSignals.forEach(s => {
        const sigId = s.id;
        if (s.status === 'ACCEPTED') {
          backendSignalCache[sigId].backendDecision = 'BLOCKED_BACKEND';
          backendSignalCache[sigId].blockerReason = `Portfolio Wave Cap Reached (${activePos.length}/${TRADER_CONFIG.MAX_CONCURRENT_TRADES})`;
        }
      });
      return backendSignalCache;
    }

    // 3. Filter and Evaluate Actionable Signals
    const combined = allSignals
      .filter(s => {
        const sigId = s.id;
        if (!s.signal || s.signal.score < TRADER_CONFIG.MIN_SCORE) {
          backendSignalCache[sigId].backendDecision = 'BLOCKED_BACKEND';
          backendSignalCache[sigId].blockerReason = `Score ${s.signal?.score?.toFixed(1)} < ${TRADER_CONFIG.MIN_SCORE}`;
          return false;
        }
        const et = s.signal.entryType;
        if (s.status !== 'ACCEPTED') return false;
        if (et === 'PENDING_BREAKOUT' || et === 'INVALIDATED' || et === 'EXPIRED_NO_RETEST') return false;
        return true;
      })
      .sort((a, b) => b.signal.score - a.signal.score);

    if (combined.length === 0) {
      logMsg(`Evaluation done. No actionable signals passed the gateway.`);
      return backendSignalCache;
    }

    // 4. Detailed Risk Gates
    const activeLongsCount = activePos.filter(p => parseFloat(p.positionAmt) > 0).length;
    const activeShortsCount = activePos.filter(p => parseFloat(p.positionAmt) < 0).length;

    let longsInDeepRed = 0;
    activePos.filter(p => parseFloat(p.positionAmt) > 0).forEach(p => {
       const pnl = parseFloat(p.unRealizedProfit);
       const margin = (parseFloat(p.positionAmt) * parseFloat(p.entryPrice)) / parseFloat(p.leverage);
       if (margin > 0 && (pnl / margin) < -0.25) longsInDeepRed++; 
    });
    
    let shortsInDeepRed = 0;
    activePos.filter(p => parseFloat(p.positionAmt) < 0).forEach(p => {
       const pnl = parseFloat(p.unRealizedProfit);
       const margin = Math.abs((parseFloat(p.positionAmt) * parseFloat(p.entryPrice)) / parseFloat(p.leverage));
       if (margin > 0 && (pnl / margin) < -0.25) shortsInDeepRed++; 
    });

    const MAX_DEPLOY_PER_SCAN = 2;     
    let deployedLongsThisScan = 0;
    let deployedShortsThisScan = 0;
    let currentCapacity = activePos.length;

    for (const row of combined) {
      if (currentCapacity >= TRADER_CONFIG.MAX_CONCURRENT_TRADES) break;

      const sym = row.symbol;
      const sigId = row.id;
      const sig = row.signal;

      if (activePos.some(p => p.symbol === sym)) {
         backendSignalCache[sigId].backendDecision = 'BLOCKED_BACKEND';
         backendSignalCache[sigId].blockerReason = `Already holding ${sym}.`;
         continue;
      }

      let isBlocked = false;
      let blockReason = '';

      if (sig.side === 'LONG') {
         if (activeLongsCount + deployedLongsThisScan >= TRADER_CONFIG.MAX_CONCURRENT_TRADES) {
            blockReason = `Wave Cap (LONG)`;
            isBlocked = true;
         } else if (TRADER_CONFIG.CIRCUIT_BREAKER_ENABLED && longsInDeepRed >= 1) {
            blockReason = `Circuit Breaker (Deep Red LONG)`;
            isBlocked = true;
         } else if (deployedLongsThisScan >= MAX_DEPLOY_PER_SCAN) {
            blockReason = `Scan Cluster Limit (LONG)`;
            isBlocked = true;
         } 
      } else {
         if (activeShortsCount + deployedShortsThisScan >= TRADER_CONFIG.MAX_CONCURRENT_TRADES) {
            blockReason = `Wave Cap (SHORT)`;
            isBlocked = true;
         } else if (TRADER_CONFIG.CIRCUIT_BREAKER_ENABLED && shortsInDeepRed >= 1) {
            blockReason = `Circuit Breaker (Deep Red SHORT)`;
            isBlocked = true;
         } else if (deployedShortsThisScan >= MAX_DEPLOY_PER_SCAN) {
            blockReason = `Scan Cluster Limit (SHORT)`;
            isBlocked = true;
         }
      }

      if (isBlocked) {
         backendSignalCache[sigId].backendDecision = 'BLOCKED_BACKEND';
         backendSignalCache[sigId].blockerReason = blockReason;
         continue;
      }

      const tradeSizeUSDT = balance * TRADER_CONFIG.RISK_PER_TRADE; 
      const qty = Math.max(0.001, (tradeSizeUSDT * TRADER_CONFIG.LEVERAGE) / sig.entryPrice); 

      try {
        logMsg(`🚀 EXECUTING: ${sym} ${sig.side} | Qty: ${qty.toFixed(3)} | Mode: ${mode}`);
        await setLeverage(sym, TRADER_CONFIG.LEVERAGE, baseUrl);
        const entryRes = await placeMarketOrder(sym, sig.side === 'LONG' ? 'BUY' : 'SELL', qty, baseUrl);
        
        await new Promise(r => setTimeout(r, 1000));
        const closeSide = sig.side === 'LONG' ? 'SELL' : 'BUY';

        if (TRADER_CONFIG.SL_ENABLED) {
          await placeStopMarket(sym, closeSide, sig.stopLoss, baseUrl);
        }
        
        if (TRADER_CONFIG.TP_ENABLED) {
          const tp1Price = sig.side === 'LONG'
            ? sig.entryPrice + (Math.abs(sig.entryPrice - sig.stopLoss) * TRADER_CONFIG.TP1_RR)
            : sig.entryPrice - (Math.abs(sig.entryPrice - sig.stopLoss) * TRADER_CONFIG.TP1_RR);

          if (TRADER_CONFIG.TRAIL_TP_ENABLED) {
            await placeTrailingStopMarket(sym, closeSide, 0.5, tp1Price, qty, baseUrl);
          } else if (TRADER_CONFIG.TP1_ONLY) {
            await placeTakeProfitMarket(sym, closeSide, tp1Price, undefined, baseUrl); 
          } else {
            const tp2Price = sig.side === 'LONG'
              ? sig.entryPrice + (Math.abs(sig.entryPrice - sig.stopLoss) * TRADER_CONFIG.TP2_RR)
              : sig.entryPrice - (Math.abs(sig.entryPrice - sig.stopLoss) * TRADER_CONFIG.TP2_RR);
            await placeTakeProfitMarket(sym, closeSide, tp1Price, qty * 0.5, baseUrl);
            await placeTakeProfitMarket(sym, closeSide, tp2Price, qty * 0.5, baseUrl);
          }
        }

        backendSignalCache[sigId].backendDecision = 'DEPLOYED_BACKEND';
        backendSignalCache[sigId].deployedOrderId = String(entryRes.orderId || 'SUCCESS');
        currentCapacity++;
        if (sig.side === 'LONG') deployedLongsThisScan++; else deployedShortsThisScan++;

      } catch (err: any) {
        logMsg(`❌ DEPLOY FAILED [${sym}]: ${err.message}`);
        backendSignalCache[sigId].backendDecision = 'BLOCKED_BACKEND';
        backendSignalCache[sigId].blockerReason = `Execution failed: ${err.message}`;
      }
    }

    fs.writeFileSync(path.resolve(__dirname, '../../backend_signals.json'), JSON.stringify(backendSignalCache, null, 2));
    return backendSignalCache;

  } catch (error: any) {
    logMsg(`CRITICAL ERROR UNHANDLED: ${error.message}`);
    return backendSignalCache;
  }
}
