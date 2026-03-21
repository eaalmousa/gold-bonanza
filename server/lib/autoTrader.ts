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
  MIN_SCORE: 20,
  BTC_GATE_ENABLED: true,
  TRAIL_TP_ENABLED: false,
  CIRCUIT_BREAKER_ENABLED: false,
  ENABLED: false // Standardized naming to match API
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
}

// Hardened Persistence Helper (Heals disk case drift)
const saveState = () => {
  try {
    const canonicalExport = { ...TRADER_CONFIG };
    fs.writeFileSync(STATE_FILE, JSON.stringify(canonicalExport, null, 2));
  } catch (_) {}
};

// Initialization: Funneled load
try {
  if (fs.existsSync(STATE_FILE)) {
    const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    applyConfig(saved);
    console.log('[Persistence] Master configuration hydrated from VPS disk.');
  }
} catch { console.warn('[Persistence] Loading config failed.'); }


export function updateTraderConfig(c: any) { 
  applyConfig(c);
  saveState(); 
  logMsg(`Config updated: MIN_SCORE=${TRADER_CONFIG.MIN_SCORE} AUTO=${TRADER_CONFIG.ENABLED}`);
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
      
      const activeMode = MODES.BALANCED;
      const modeProxy = {
        ...activeMode,
        riskPct: TRADER_CONFIG.RISK_PER_TRADE,
        pullback: { ...activeMode.pullback, scoreMin: TRADER_CONFIG.MIN_SCORE }
      };

      const result = await runBonanzaCore(
        symbols, modeProxy as any, balance,
        (pct) => { latestMarketState.scanProgress = pct; }
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
        const tp1Price = sig.side === 'LONG' ? sig.entryPrice + riskDist * TRADER_CONFIG.TP1_RR : sig.entryPrice - riskDist * TRADER_CONFIG.TP1_RR;
        await placeTakeProfitMarket(sym, closeSide, tp1Price);
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
