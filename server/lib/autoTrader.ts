import { getPositions, getBalance, setLeverage, placeMarketOrder, placeStopMarket, placeTakeProfitMarket, placeTrailingStopMarket } from './binance';
import { runBonanzaCore } from '../../src/engines/scanner';
import { MODES } from '../../src/types/trading';
import { DEFAULT_SYMBOLS } from '../../src/types/trading';

import fs from 'fs';
import path from 'path';

const STATE_FILE = path.join(process.cwd(), 'trader_state.json');

export let RISK_PER_TRADE = parseFloat(process.env.RISK_PER_TRADE || '0.10');
export let MAX_CONCURRENT_TRADES = parseInt(process.env.MAX_CONCURRENT_TRADES || '8', 10);
export let LEVERAGE = parseInt(process.env.LEVERAGE || '10', 10);
export let SL_ENABLED = true;
export let TP_ENABLED = true;
export let TP1_ONLY = false;   // When true: 100% exit at TP1 only, no TP2
export let TP1_RR = 1.25;
export let TP2_RR = 2.50;
export let MIN_SCORE = parseInt(process.env.MIN_SCORE_TO_DEPLOY || '15', 10);
export let BTC_GATE_ENABLED = true; // When true: block LONGs if BTC printing consecutive red candles
export let TRAIL_TP_ENABLED = false; // When true: uses a tight trailing stop instead of fixed TP
export let isAutoTradingEnabled = false;
const BASE_CAPITAL = parseFloat(process.env.BASE_CAPITAL || '300');

// Load persisted state on startup
try {
  if (fs.existsSync(STATE_FILE)) {
    const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    RISK_PER_TRADE = saved.RISK_PER_TRADE ?? RISK_PER_TRADE;
    MAX_CONCURRENT_TRADES = saved.MAX_CONCURRENT_TRADES ?? MAX_CONCURRENT_TRADES;
    LEVERAGE = saved.LEVERAGE ?? LEVERAGE;
    SL_ENABLED = saved.SL_ENABLED ?? SL_ENABLED;
    TP_ENABLED = saved.TP_ENABLED ?? TP_ENABLED;
    TP1_ONLY = saved.TP1_ONLY ?? TP1_ONLY;
    TP1_RR = saved.TP1_RR ?? TP1_RR;
    TP2_RR = saved.TP2_RR ?? TP2_RR;
    MIN_SCORE = saved.MIN_SCORE ?? MIN_SCORE;
    BTC_GATE_ENABLED = saved.BTC_GATE_ENABLED ?? BTC_GATE_ENABLED;
    TRAIL_TP_ENABLED = saved.TRAIL_TP_ENABLED ?? TRAIL_TP_ENABLED;
    isAutoTradingEnabled = saved.isAutoTradingEnabled ?? isAutoTradingEnabled;
    console.log(`[Persistence] Loaded state: AUTO=${isAutoTradingEnabled} MIN_SCORE=${MIN_SCORE} BTC_GATE=${BTC_GATE_ENABLED} TRAIL=${TRAIL_TP_ENABLED}`);
  }
} catch (e) {
  console.warn('[Persistence] Failed to load state file');
}

function saveState() {
  try {
    const data = { RISK_PER_TRADE, MAX_CONCURRENT_TRADES, LEVERAGE, SL_ENABLED, TP_ENABLED, TP1_ONLY, TP1_RR, TP2_RR, MIN_SCORE, BTC_GATE_ENABLED, TRAIL_TP_ENABLED, isAutoTradingEnabled };
    fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2));
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
}) {
  if (config.riskPerTrade !== undefined) RISK_PER_TRADE = config.riskPerTrade;
  if (config.maxConcurrent !== undefined) MAX_CONCURRENT_TRADES = config.maxConcurrent;
  if (config.leverage !== undefined) LEVERAGE = config.leverage;
  if (config.slEnabled !== undefined) SL_ENABLED = config.slEnabled;
  if (config.tpEnabled !== undefined) TP_ENABLED = config.tpEnabled;
  if (config.tp1Only !== undefined) TP1_ONLY = config.tp1Only;
  if (config.tp1RR !== undefined) TP1_RR = config.tp1RR;
  if (config.tp2RR !== undefined) TP2_RR = config.tp2RR;
  if (config.minScore !== undefined) MIN_SCORE = config.minScore;
  if (config.btcGateEnabled !== undefined) BTC_GATE_ENABLED = config.btcGateEnabled;
  if (config.trailTpEnabled !== undefined) TRAIL_TP_ENABLED = config.trailTpEnabled;
  
  saveState();
  logMsg(`Config Updated & Saved: MIN_SCORE=${MIN_SCORE} TRAIL=${TRAIL_TP_ENABLED} SL=${SL_ENABLED} TP=${TP_ENABLED}`);
}

export function toggleAutoTrade(enabled: boolean) {
  isAutoTradingEnabled = enabled;
  saveState();
  logMsg(`State changed and saved to: ${enabled ? 'ON' : 'OFF'}`);
}

export const tradeLogs: string[] = [];

function logMsg(msg: string) {
  console.log(`[AutoTrader] ${msg}`);
  tradeLogs.unshift(`[${new Date().toISOString()}] ${msg}`);
  if (tradeLogs.length > 200) tradeLogs.pop();
}

let activeSymbols: string[] = [];

export async function runTraderLoop() {
  if (!isAutoTradingEnabled) return;
  
  try {
    const positions = await getPositions();
    if (positions.length >= MAX_CONCURRENT_TRADES) {
      logMsg(`Max capacity reached (${positions.length}/${MAX_CONCURRENT_TRADES}). Skipping scan.`);
      return;
    }

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
    const mode = MODES.AGGRESSIVE;
    let balance = BASE_CAPITAL;
    try {
      const actualBalance = await getBalance();
      if (actualBalance > 0) balance = actualBalance; // Use real if available, else fallback to BASE_CAPITAL
    } catch (e) {
      logMsg(`Could not fetch actual balance, using base capital of ${BASE_CAPITAL} USD`);
    }
    
    // We pass empty objects for snapshots since this is server side mapping
    const results = await runBonanzaCore(activeSymbols, mode, balance, undefined, {}, undefined);
    const snipers = results.sniperSignals || [];
    const breakouts = results.breakoutSignals || [];
    
    // Sort combined by score desc, but EXCLUDE pending/invalidated breakouts
    const combined = [...snipers, ...breakouts]
      .filter(s => {
        if (s.signal.score < MIN_SCORE) return false;
        const et = s.signal.entryType;
        // Breakout engine returns PENDING_BREAKOUT for the initial pump.
        // We only want to auto-trade RETEST_CONFIRMED or normal Sniper signals.
        if (et === 'PENDING_BREAKOUT' || et === 'INVALIDATED' || et === 'EXPIRED_NO_RETEST') {
          return false;
        }
        return true;
      })
      .sort((a, b) => b.signal.score - a.signal.score);

    if (combined.length === 0) {
      logMsg(`Scan done. No signals >= ${MIN_SCORE} found.`);
      return;
    }
    logMsg(`Found ${combined.length} valid signals (Score >= ${MIN_SCORE}). Portfolio Wave Analysis running...`);

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

    const MAX_SAME_SIDE_POSITIONS = MAX_CONCURRENT_TRADES; // Match user's MAX TRADES — no arbitrary side cap
    const MAX_DEPLOY_PER_SCAN = 2;     // Allow 2 best signals per scan cycle (was 1)

    let deployedLongsThisScan = 0;
    let deployedShortsThisScan = 0;

    for (const row of combined) {
      const activePos = await getPositions();
      if (activePos.length >= MAX_CONCURRENT_TRADES) break;

      const currentSideLongs = activePos.filter(p => parseFloat(p.positionAmt) > 0);
      const currentSideShorts = activePos.filter(p => parseFloat(p.positionAmt) < 0);

      const sym = row.symbol;
      if (activePos.some(p => p.symbol === sym)) continue;

      const sig = row.signal;

      // ─── WAVE DEPLOYMENT GATES — each logs the EXACT reason for blocking ───
      if (sig.side === 'LONG') {
         if (currentSideLongs.length >= MAX_SAME_SIDE_POSITIONS) {
            logMsg(`❌ BLOCKED [${sym}] Score:${sig.score} — Wave Cap: holding ${currentSideLongs.length}/${MAX_SAME_SIDE_POSITIONS} LONGs already.`);
            continue;
         }
         if (longsInDeepRed >= 1) {
            logMsg(`❌ BLOCKED [${sym}] Score:${sig.score} — Circuit Breaker: ${longsInDeepRed} LONG(s) in deep red (>25% loss). Not adding more risk.`);
            continue;
         }
         if (deployedLongsThisScan >= MAX_DEPLOY_PER_SCAN) {
            logMsg(`❌ BLOCKED [${sym}] Score:${sig.score} — Cluster Limit: already deployed ${MAX_DEPLOY_PER_SCAN} LONGs this scan cycle.`);
            continue;
         }
         if (BTC_GATE_ENABLED) {
            const btcCheck = checkBtcConfirmation('LONG');
            if (!btcCheck.ok) {
               logMsg(`❌ BLOCKED [${sym}] Score:${sig.score} — BTC Gate: ${btcCheck.reason}`);
               continue;
            }
         } else {
            logMsg(`⚠️ NOTE [${sym}] BTC Gate is OFF — skipping BTC candle confirmation.`);
         }
      } else {
         if (currentSideShorts.length >= MAX_SAME_SIDE_POSITIONS) {
            logMsg(`❌ BLOCKED [${sym}] Score:${sig.score} — Wave Cap: holding ${currentSideShorts.length}/${MAX_SAME_SIDE_POSITIONS} SHORTs already.`);
            continue;
         }
         if (shortsInDeepRed >= 1) {
            logMsg(`❌ BLOCKED [${sym}] Score:${sig.score} — Circuit Breaker: ${shortsInDeepRed} SHORT(s) in deep red (>25% loss). Not adding more risk.`);
            continue;
         }
         if (deployedShortsThisScan >= MAX_DEPLOY_PER_SCAN) {
            logMsg(`❌ BLOCKED [${sym}] Score:${sig.score} — Cluster Limit: already deployed ${MAX_DEPLOY_PER_SCAN} SHORTs this scan cycle.`);
            continue;
         }
         if (BTC_GATE_ENABLED) {
            const btcCheck = checkBtcConfirmation('SHORT');
            if (!btcCheck.ok) {
               logMsg(`❌ BLOCKED [${sym}] Score:${sig.score} — BTC Gate: ${btcCheck.reason}`);
               continue;
            }
         } else {
            logMsg(`⚠️ NOTE [${sym}] BTC Gate is OFF — skipping BTC candle confirmation.`);
         }
      }

      const tradeSizeUSDT = balance * RISK_PER_TRADE; // e.g. 10% of base capital
      const leverageQty = tradeSizeUSDT * LEVERAGE;
      const qty = Math.max(0.001, leverageQty / sig.entryPrice); // Note: proper step-size rounding needed per coin ideally

      logMsg(`🚀 EXECUTING: ${sym} ${sig.side} (Score: ${sig.score}) | Risk Size: $${tradeSizeUSDT.toFixed(2)} at ${LEVERAGE}x leverage`);

      try {
        logMsg(`[${sym}] Setting leverage to ${LEVERAGE}x...`);
        await setLeverage(sym, LEVERAGE);
        
        logMsg(`[${sym}] Placing entry MARKET ${sig.side} order...`);
        const entryRes = await placeMarketOrder(sym, sig.side === 'LONG' ? 'BUY' : 'SELL', qty);
        logMsg(`[${sym}] Entry filled. OrderID: ${entryRes.orderId}`);
        
        // Wait a bit for entry order to register before setting stops
        await new Promise(r => setTimeout(r, 1500));
        
        const closeSide = sig.side === 'LONG' ? 'SELL' : 'BUY';

        // 🛡️ Place STOP LOSS (Technical - recalculated based on RR if needed, but here we use engine's stopLoss)
        if (SL_ENABLED) {
          logMsg(`[${sym}] Setting technical SL at ${sig.stopLoss.toFixed(4)}...`);
          await placeStopMarket(sym, closeSide, sig.stopLoss);
        } else {
          logMsg(`[${sym}] SL disabled in config. Skipping.`);
        }
        
        // 💰 Place TAKE PROFIT orders — ENFORCED. If TP fails, we abort and log loudly.
        if (TP_ENABLED) {
          const stopPrice = sig.entryPrice;
          const stopDist = Math.abs(stopPrice - sig.stopLoss);
          
          const tp1Price = sig.side === 'LONG'
            ? stopPrice + (stopDist * TP1_RR)
            : stopPrice - (stopDist * TP1_RR);

          if (TRAIL_TP_ENABLED) {
            logMsg(`[${sym}] TRAIL TP ON: Setting trailing stop (0.5% callback) activating at TP1 (${tp1Price.toFixed(4)})...`);
            try {
              await placeTrailingStopMarket(sym, closeSide, 0.5, tp1Price, qty);
              logMsg(`[${sym}] ✅ Trailing Stop placed successfully (activates at TP1).`);
            } catch (tsErr: any) {
              logMsg(`[${sym}] ❌ CRITICAL: Trailing Stop placement FAILED: ${tsErr.message}. Emergency closing...`);
              try {
                await placeMarketOrder(sym, closeSide, qty);
              } catch (e) { /* silent fail on emergency */ }
            }
          } else if (TP1_ONLY) {
            // TP1 ONLY mode: close 100% of position at TP1
            logMsg(`[${sym}] TP1-ONLY mode: Setting TP1 (100%) at ${tp1Price.toFixed(4)} (${TP1_RR}R)...`);
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
              ? stopPrice + (stopDist * TP2_RR)
              : stopPrice - (stopDist * TP2_RR);
            const tp1Qty = qty * 0.5;
            const tp2Qty = qty * 0.5;

            logMsg(`[${sym}] Setting TP1 (50%) at ${tp1Price.toFixed(4)} (${TP1_RR}R)...`);
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

            logMsg(`[${sym}] Setting TP2 (50%) at ${tp2Price.toFixed(4)} (${TP2_RR}R)...`);
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

        logMsg(`✅ DEPLOYED: ${sym} ${sig.side} | SL: ${SL_ENABLED ? sig.stopLoss.toFixed(4) : 'OFF'} | TP: ${TP_ENABLED ? (TP1_ONLY ? 'TP1-ONLY' : 'TP1+TP2') : 'OFF'}`);
        
        if (sig.side === 'LONG') deployedLongsThisScan++;
        if (sig.side === 'SHORT') deployedShortsThisScan++;

      } catch(e: any) {
        logMsg(`❌ ERR executing ${sym}: ${e.message}`);
        console.error(`Full error for ${sym}:`, e);
      }
    }

  } catch (error: any) {
    logMsg(`CRITICAL ERROR inside runTraderLoop: ${error.message}`);
  }
}

// Start loop
setInterval(() => {
  runTraderLoop();
}, 60 * 1000); // Poll every 1 minute
