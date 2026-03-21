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

const STATE_FILE = path.resolve(__dirname, '../../trader_state.json');
const SIGNALS_FILE = path.resolve(__dirname, '../../backend_signals.json');

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
  isAutoTradingEnabled: false
};

// Persistence
try {
  if (fs.existsSync(STATE_FILE)) {
    const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    Object.assign(TRADER_CONFIG, saved);
  }
} catch { console.warn('[Persistence] Loading config failed.'); }

const saveState = () => {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(TRADER_CONFIG, null, 2)); } catch (_) {}
};

export function updateTraderConfig(c: any) { 
  // Strict Case-Mapping: Link lowercase incoming JSON to uppercase master runtime
  if (c.riskPerTrade !== undefined)   TRADER_CONFIG.RISK_PER_TRADE = c.riskPerTrade;
  if (c.maxConcurrent !== undefined)  TRADER_CONFIG.MAX_CONCURRENT_TRADES = c.maxConcurrent;
  if (c.leverage !== undefined)       TRADER_CONFIG.LEVERAGE = c.leverage;
  if (c.slEnabled !== undefined)      TRADER_CONFIG.SL_ENABLED = c.slEnabled;
  if (c.tpEnabled !== undefined)      TRADER_CONFIG.TP_ENABLED = c.tpEnabled;
  if (c.tp1Only !== undefined)        TRADER_CONFIG.TP1_ONLY = c.tp1Only;
  if (c.tp1RR !== undefined)          TRADER_CONFIG.TP1_RR = c.tp1RR;
  if (c.tp2RR !== undefined)          TRADER_CONFIG.TP2_RR = c.tp2RR;
  if (c.minScore !== undefined)       TRADER_CONFIG.MIN_SCORE = c.minScore;
  if (c.btcGateEnabled !== undefined) TRADER_CONFIG.BTC_GATE_ENABLED = c.btcGateEnabled;
  if (c.trailTpEnabled !== undefined) TRADER_CONFIG.TRAIL_TP_ENABLED = c.trailTpEnabled;
  if (c.circuitBreakerEnabled !== undefined) TRADER_CONFIG.CIRCUIT_BREAKER_ENABLED = c.circuitBreakerEnabled;
  
  // Explicitly handle enabled flag if present in body
  if (c.enabled !== undefined)        TRADER_CONFIG.isAutoTradingEnabled = !!c.enabled;

  saveState(); 
  logMsg(`Config updated: MIN_SCORE=${TRADER_CONFIG.MIN_SCORE} AUTO=${TRADER_CONFIG.isAutoTradingEnabled}`);
}

export function toggleAutoTrade(e: boolean) { 
  TRADER_CONFIG.isAutoTradingEnabled = e; 
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

      // Diagnostic Heartbeat
      console.log(`[AutoTrader] Scan Cycle End. Signals: ${latestMarketState.pipelineSignals.length} | Traces: ${latestMarketState.pipelineTraces.length} | Regime: ${latestMarketState.regime}`);

      if (TRADER_CONFIG.isAutoTradingEnabled && result.pipelineSignals.length > 0) {
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
  if (!TRADER_CONFIG.isAutoTradingEnabled) return backendSignalCache;

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
