import { getPositions, getBalance, setLeverage, placeMarketOrder, placeStopMarket, placeTakeProfitMarket, placeTrailingStopMarket } from './binance';
import { runBonanzaCore } from '../../src/engines/scanner';
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
  isAutoTradingEnabled: false
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
    console.log(`[Persistence] Loaded state: AUTO=${TRADER_CONFIG.isAutoTradingEnabled} MIN_SCORE=${TRADER_CONFIG.MIN_SCORE} BTC_GATE=${TRADER_CONFIG.BTC_GATE_ENABLED} TRAIL=${TRADER_CONFIG.TRAIL_TP_ENABLED} CB=${TRADER_CONFIG.CIRCUIT_BREAKER_ENABLED}`);
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

export async function runTraderLoop() {
  if (!TRADER_CONFIG.isAutoTradingEnabled) return;
  
  logMsg('--- STARTING AUTO-TRADER SCAN ---');
  try {
    const positions = await getPositions();
    if (positions.length >= TRADER_CONFIG.MAX_CONCURRENT_TRADES) {
      logMsg(`Max capacity reached (${positions.length}/${TRADER_CONFIG.MAX_CONCURRENT_TRADES}). Skipping scan.`);
      return;
    }

    // Symbols to scan: Dynamic if Binance connected, else default list
    let activeSymbols: string[] = [];
    if (!activeSymbols.length) {
      try {
        logMsg(`Fetching latest Top-200 dynamic universe...`);
        const { initializeSymbolUniverse } = require('../../src/services/binanceApi');
        activeSymbols = await initializeSymbolUniverse();
        logMsg(`Loaded ${activeSymbols.length} symbols for backend scanning.`);
      } catch (e: any) {
        logMsg(`Failed to load dynamic symbols, falling back to defaults. Error: ${e.message}`);
        activeSymbols = [...DEFAULT_SYMBOLS, 'XAUUSDT', 'XAGUSDT'];
      }
    }
    logMsg(`Scanning ${activeSymbols.length} dynamic symbols...`);
    // Use AGGRESSIVE mode mathematically, but we'll enforce the score threshold ourselves.
    const mode = TRADER_CONFIG.MAX_CONCURRENT_TRADES > 5 ? MODES.AGGRESSIVE : TRADER_CONFIG.MAX_CONCURRENT_TRADES > 2 ? MODES.BALANCED : MODES.CONSERVATIVE;
    let balance = BASE_CAPITAL;
    try {
      const actualBalance = await getBalance();
      if (actualBalance > 0) balance = actualBalance; // Use real if available, else fallback to BASE_CAPITAL
    } catch (e) {
      logMsg(`Could not fetch actual balance, using base capital of ${BASE_CAPITAL} USD`);
    }
    
    // We pass empty objects for snapshots since this is server side mapping
    // NOTE: runBonanzaCore returns { pipelineSignals, pipelineTraces, marketRows, regimeLabel }
    const results = await runBonanzaCore(activeSymbols, mode, balance, undefined, {}, undefined);
    const allSignals = results.pipelineSignals || [];

    // --- TRUTH SYNCHRONIZATION: Cache everything seen by core scan ---
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
      
      // If score is too low, mark as blocked immediately
      if (s.signal.score < TRADER_CONFIG.MIN_SCORE) {
        backendSignalCache[sigId].backendDecision = 'BLOCKED_BACKEND';
        backendSignalCache[sigId].blockerReason = `Score ${s.signal.score.toFixed(1)} below required ${TRADER_CONFIG.MIN_SCORE}.`;
      }
    });
    
    // Sort combined by score desc, but EXCLUDE pending/invalidated breakouts
    const combined = allSignals
      .filter(s => {
        if (!s.signal || s.signal.score < TRADER_CONFIG.MIN_SCORE) return false;
        const et = s.signal.entryType;
        // Only trade ACCEPTED sniper signals and RETEST_CONFIRMED breakouts
        if (s.status !== 'ACCEPTED') return false;
        if (et === 'PENDING_BREAKOUT' || et === 'INVALIDATED' || et === 'EXPIRED_NO_RETEST') {
          return false;
        }
        return true;
      })
      .sort((a, b) => b.signal.score - a.signal.score);

    if (combined.length === 0) {
      logMsg(`Scan done. No signals >= ${TRADER_CONFIG.MIN_SCORE} found.`);
      return;
    }
    logMsg(`Found ${combined.length} valid signals (Score >= ${TRADER_CONFIG.MIN_SCORE}). Portfolio Wave Analysis running...`);

    // ─── PORTFOLIO WAVE & CIRCUIT BREAKER LOGIC ───
    const currentActivePos = await getPositions();
    const activeLongs = currentActivePos.filter(p => parseFloat(p.positionAmt) > 0);
    const activeShorts = currentActivePos.filter(p => parseFloat(p.positionAmt) < 0);

    let longsInDeepRed = 0;
    activeLongs.forEach(p => {
      const pnl = parseFloat(p.unRealizedProfit);
      const margin = (parseFloat(p.positionAmt) * parseFloat(p.entryPrice)) / parseFloat(p.leverage);
      if (margin > 0 && (pnl / margin) < -0.25) longsInDeepRed++; // ROI down > 25% (was 10% — too sensitive at 25x lever)
    });
    
    let shortsInDeepRed = 0;
    activeShorts.forEach(p => {
      const pnl = parseFloat(p.unRealizedProfit);
      const margin = Math.abs((parseFloat(p.positionAmt) * parseFloat(p.entryPrice)) / parseFloat(p.leverage));
      if (margin > 0 && (pnl / margin) < -0.25) shortsInDeepRed++; // ROI down > 25% (was 10% — too sensitive at 25x lever)
    });

    // Fetch BTC 15m context for confirmation gating
    const btcRes = await fetch('https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=15m&limit=20');
    const btcKlines = await btcRes.json();

    function checkBtcConfirmation(side: 'LONG' | 'SHORT') {
        const closes = btcKlines.map((k: any) => parseFloat(k[4]));
        const highs = btcKlines.map((k: any) => parseFloat(k[2]));
        const lows = btcKlines.map((k: any) => parseFloat(k[3]));
        
        const c1 = closes[closes.length - 2]; 
        const o1 = parseFloat(btcKlines[btcKlines.length - 2][1]);
        const c2 = closes[closes.length - 3];
        const o2 = parseFloat(btcKlines[btcKlines.length - 3][1]);

        const recentLows = lows.slice(-16, -2);
        const recentHighs = highs.slice(-16, -2);
        const localFloor = Math.min(...recentLows);
        const localCeiling = Math.max(...recentHighs);

        if (side === 'LONG') {
            const distToCeilingPct = ((localCeiling - c1) / c1) * 100;
            const consecutiveRed = (c1 < o1) && (c2 < o2);
            if (c1 < localCeiling && distToCeilingPct < 0.15) {
                 return { ok: false, reason: `BTC compressing at local resistance (dist: ${distToCeilingPct.toFixed(2)}%)` };
            }
            if (consecutiveRed) return { ok: false, reason: 'BTC printing consecutive red 15m candles (no continuation)' };
            return { ok: true, reason: '' };
        } else {
            const distToFloorPct = ((c1 - localFloor) / c1) * 100;
            const consecutiveGreen = (c1 > o1) && (c2 > o2);
            if (c1 > localFloor && distToFloorPct < 0.15) {
                 return { ok: false, reason: `BTC compressing at local support (dist: ${distToFloorPct.toFixed(2)}%)` };
            }
            if (consecutiveGreen) return { ok: false, reason: 'BTC printing consecutive green 15m candles (no continuation)' };
            return { ok: true, reason: '' };
        }
    }

    const MAX_SAME_SIDE_POSITIONS = TRADER_CONFIG.MAX_CONCURRENT_TRADES; // Match user's MAX TRADES — no arbitrary side cap
    const MAX_DEPLOY_PER_SCAN = 2;     // Allow 2 best signals per scan cycle (was 1)

    let deployedLongsThisScan = 0;
    let deployedShortsThisScan = 0;

    for (const row of combined) {
      const activePos = await getPositions();
      if (activePos.length >= TRADER_CONFIG.MAX_CONCURRENT_TRADES) break;

      const currentSideLongs = activePos.filter(p => parseFloat(p.positionAmt) > 0);
      const currentSideShorts = activePos.filter(p => parseFloat(p.positionAmt) < 0);

      const sym = row.symbol;
      const sigId = row.id;
      
      // Update from PENDING to ACCEPTED_BACKEND as it enters the gated loop
      if (backendSignalCache[sigId]) {
        backendSignalCache[sigId].backendDecision = 'ACCEPTED_BACKEND';
        backendSignalCache[sigId].backendDecisionAt = Date.now();
      }

      const sig = row.signal;

      if (activePos.some(p => p.symbol === sym)) {
         backendSignalCache[sigId].backendDecision = 'BLOCKED_BACKEND';
         backendSignalCache[sigId].backendDecisionAt = Date.now();
         backendSignalCache[sigId].blockerReason = `Already holding active position for ${sym}.`;
         continue;
      }

      // ─── WAVE DEPLOYMENT GATES — each logs the EXACT reason for blocking ───
      let isBlocked = false;
      let blockReason = '';

      if (sig.side === 'LONG') {
         if (currentSideLongs.length >= MAX_SAME_SIDE_POSITIONS) {
            blockReason = `Wave Cap: holding ${currentSideLongs.length}/${MAX_SAME_SIDE_POSITIONS} LONGs already.`;
            isBlocked = true;
         } else if (TRADER_CONFIG.CIRCUIT_BREAKER_ENABLED && longsInDeepRed >= 1) {
            blockReason = `Circuit Breaker: ${longsInDeepRed} LONG(s) in deep red (>25% loss). Not adding more risk.`;
            isBlocked = true;
         } else if (deployedLongsThisScan >= MAX_DEPLOY_PER_SCAN) {
            blockReason = `Cluster Limit: already deployed ${MAX_DEPLOY_PER_SCAN} LONGs this scan cycle.`;
            isBlocked = true;
         } else if (TRADER_CONFIG.BTC_GATE_ENABLED) {
            const btcCheck = checkBtcConfirmation('LONG');
            if (!btcCheck.ok) {
               blockReason = `BTC Gate: ${btcCheck.reason}`;
               isBlocked = true;
            }
         } else {
            logMsg(`⚠️ NOTE [${sym}] BTC Gate is OFF — skipping BTC candle confirmation.`);
         }
      } else {
         if (currentSideShorts.length >= MAX_SAME_SIDE_POSITIONS) {
            blockReason = `Wave Cap: holding ${currentSideShorts.length}/${MAX_SAME_SIDE_POSITIONS} SHORTs already.`;
            isBlocked = true;
         } else if (TRADER_CONFIG.CIRCUIT_BREAKER_ENABLED && shortsInDeepRed >= 1) {
            blockReason = `Circuit Breaker: ${shortsInDeepRed} SHORT(s) in deep red (>25% loss). Not adding more risk.`;
            isBlocked = true;
         } else if (deployedShortsThisScan >= MAX_DEPLOY_PER_SCAN) {
            blockReason = `Cluster Limit: already deployed ${MAX_DEPLOY_PER_SCAN} SHORTs this scan cycle.`;
            isBlocked = true;
         } else if (TRADER_CONFIG.BTC_GATE_ENABLED) {
            const btcCheck = checkBtcConfirmation('SHORT');
            if (!btcCheck.ok) {
               blockReason = `BTC Gate: ${btcCheck.reason}`;
               isBlocked = true;
            }
         } else {
            logMsg(`⚠️ NOTE [${sym}] BTC Gate is OFF — skipping BTC candle confirmation.`);
         }
      }

      if (isBlocked) {
         logMsg(`❌ BLOCKED [${sym}] Score:${sig.score} — ${blockReason}`);
         backendSignalCache[sigId].backendDecision = 'BLOCKED_BACKEND';
         backendSignalCache[sigId].backendDecisionAt = Date.now();
         backendSignalCache[sigId].blockerReason = blockReason;
         continue;
      }

      const tradeSizeUSDT = balance * TRADER_CONFIG.RISK_PER_TRADE; // e.g. 10% of base capital
      const leverageQty = tradeSizeUSDT * TRADER_CONFIG.LEVERAGE;
      const qty = Math.max(0.001, leverageQty / sig.entryPrice); // Note: proper step-size rounding needed per coin ideally

      logMsg(`🚀 EXECUTING: ${sym} ${sig.side} (Score: ${sig.score}) | Risk Size: $${tradeSizeUSDT.toFixed(2)} at ${TRADER_CONFIG.LEVERAGE}x leverage`);

      try {
        logMsg(`[${sym}] Setting leverage to ${TRADER_CONFIG.LEVERAGE}x...`);
        await setLeverage(sym, TRADER_CONFIG.LEVERAGE);
        
        logMsg(`[${sym}] Placing entry MARKET ${sig.side} order...`);
        const entryRes = await placeMarketOrder(sym, sig.side === 'LONG' ? 'BUY' : 'SELL', qty);
        logMsg(`[${sym}] Entry filled. OrderID: ${entryRes.orderId}`);
        
        // Wait a bit for entry order to register before setting stops
        await new Promise(r => setTimeout(r, 1500));
        
        const closeSide = sig.side === 'LONG' ? 'SELL' : 'BUY';

        // 🛡️ Place STOP LOSS (Technical - recalculated based on RR if needed, but here we use engine's stopLoss)
        if (TRADER_CONFIG.SL_ENABLED) {
          logMsg(`[${sym}] Setting technical SL at ${sig.stopLoss.toFixed(4)}...`);
          await placeStopMarket(sym, closeSide, sig.stopLoss);
        } else {
          logMsg(`[${sym}] SL disabled in config. Skipping.`);
        }
        
        // 💰 Place TAKE PROFIT orders — ENFORCED. If TP fails, we abort and log loudly.
        if (TRADER_CONFIG.TP_ENABLED) {
          const stopPrice = sig.entryPrice;
          const stopDist = Math.abs(stopPrice - sig.stopLoss);
          
          const tp1Price = sig.side === 'LONG'
            ? stopPrice + (stopDist * TRADER_CONFIG.TP1_RR)
            : stopPrice - (stopDist * TRADER_CONFIG.TP1_RR);

          if (TRADER_CONFIG.TRAIL_TP_ENABLED) {
            logMsg(`[${sym}] TRAIL TP ON: Setting trailing stop (0.5% callback) activating at TP1 (${tp1Price.toFixed(4)})...`);
            try {
              await placeTrailingStopMarket(sym, closeSide, 0.5, tp1Price, qty);
              logMsg(`[${sym}] ✅ Trailing Stop placed successfully (activates at TP1).`);
            } catch (tsErr: any) {
              logMsg(`[${sym}] ⚠️ Trailing Stop rejected dynamically (likely price blasted past TP1 instantly): ${tsErr.message}`);
              logMsg(`[${sym}] 🔄 FALLBACK: Placing instant-activation Trailing Stop (market is already in profit!)...`);
              try {
                // Retry without activationPrice, which forces Binance to activate it exactly at the CURRENT real-time matching engine price
                await placeTrailingStopMarket(sym, closeSide, 0.5, undefined, qty);
                logMsg(`[${sym}] ✅ Dynamic Trailing Stop successfully forced active.`);
              } catch (retryErr: any) {
                logMsg(`[${sym}] ❌ CRITICAL: Fallback Trailing Stop ALSO FAILED: ${retryErr.message}. Emergency closing to secure capital...`);
                try {
                  await placeMarketOrder(sym, closeSide, qty);
                } catch (e) { /* silent fail on emergency */ }
              }
            }
          } else if (TRADER_CONFIG.TP1_ONLY) {
            // TP1 ONLY mode: close 100% of position at TP1
            logMsg(`[${sym}] TP1-ONLY mode: Setting TP1 (100%) at ${tp1Price.toFixed(4)} (${TRADER_CONFIG.TP1_RR}R)...`);
            try {
              await placeTakeProfitMarket(sym, closeSide, tp1Price); // closePosition=true → full close
              logMsg(`[${sym}] ✅ TP1 placed successfully (full position).`);
            } catch (tpErr: any) {
              logMsg(`[${sym}] ❌ CRITICAL: TP1 placement FAILED: ${tpErr.message}. Trade entry will be closed to prevent unprotected position!`);
              // Attempt to close the entry immediately to avoid naked exposure
              try {
                await placeMarketOrder(sym, closeSide, qty);
                logMsg(`[${sym}] 🔴 Emergency close executed — unprotected position avoided.`);
              } catch (closeErr: any) {
                logMsg(`[${sym}] ⚠️ Emergency close ALSO failed: ${closeErr.message}. MANUAL INTERVENTION REQUIRED!`);
              }
            }
          } else {
            // TP1 + TP2 mode: 50/50 split
            const tp2Price = sig.side === 'LONG'
              ? stopPrice + (stopDist * TRADER_CONFIG.TP2_RR)
              : stopPrice - (stopDist * TRADER_CONFIG.TP2_RR);
            const tp1Qty = qty * 0.5;
            const tp2Qty = qty * 0.5;

            logMsg(`[${sym}] Setting TP1 (50%) at ${tp1Price.toFixed(4)} (${TRADER_CONFIG.TP1_RR}R)...`);
            try {
              await placeTakeProfitMarket(sym, closeSide, tp1Price, tp1Qty);
              logMsg(`[${sym}] ✅ TP1 placed successfully.`);
            } catch (tp1Err: any) {
              logMsg(`[${sym}] ❌ CRITICAL: TP1 placement FAILED: ${tp1Err.message}. Aborting TP2 & closing position!`);
              try {
                await placeMarketOrder(sym, closeSide, qty);
                logMsg(`[${sym}] 🔴 Emergency close executed — unprotected position avoided.`);
              } catch (closeErr: any) {
                logMsg(`[${sym}] ⚠️ Emergency close ALSO failed: ${closeErr.message}. MANUAL INTERVENTION REQUIRED!`);
              }
              continue; // Skip TP2
            }

            logMsg(`[${sym}] Setting TP2 (50%) at ${tp2Price.toFixed(4)} (${TRADER_CONFIG.TP2_RR}R)...`);
            try {
              await placeTakeProfitMarket(sym, closeSide, tp2Price, tp2Qty);
              logMsg(`[${sym}] ✅ TP2 placed successfully.`);
            } catch (tp2Err: any) {
              logMsg(`[${sym}] ⚠️ TP2 placement failed (TP1 is live): ${tp2Err.message}. Position is partially protected.`);
            }
          }
        } else {
          logMsg(`[${sym}] TP disabled in config. Skipping.`);
        }

        logMsg(`✅ DEPLOYED: ${sym} ${sig.side} | SL: ${TRADER_CONFIG.SL_ENABLED ? sig.stopLoss.toFixed(4) : 'OFF'} | TP: ${TRADER_CONFIG.TP_ENABLED ? (TRADER_CONFIG.TP1_ONLY ? 'TP1-ONLY' : 'TP1+TP2') : 'OFF'}`);
        
        backendSignalCache[sigId].backendDecision = 'DEPLOYED_BACKEND';
        backendSignalCache[sigId].backendDecisionAt = Date.now();
        backendSignalCache[sigId].deployedOrderId = String(entryRes.orderId || 'PENDING');

        if (sig.side === 'LONG') deployedLongsThisScan++;
        if (sig.side === 'SHORT') deployedShortsThisScan++;

      } catch (err: any) {
        logMsg(`❌ DEPLOY FAILED [${sym}]: ${err.message}`);
        backendSignalCache[sigId].backendDecision = 'BLOCKED_BACKEND';
        backendSignalCache[sigId].backendDecisionAt = Date.now();
        backendSignalCache[sigId].blockerReason = `Exchange execution rejected: ${err.message}`;
        console.error(`Full error for ${sym}:`, err);
      }
    }

    // Persist current cache truth for verification
    fs.writeFileSync(path.resolve(__dirname, '../../backend_signals.json'), JSON.stringify(backendSignalCache, null, 2));

  } catch (error: any) {
    logMsg(`CRITICAL ERROR inside runTraderLoop: ${error.message}`);
  }
}

// Start loop
setInterval(() => {
  runTraderLoop();
}, 60 * 1000); // Poll every 1 minute
