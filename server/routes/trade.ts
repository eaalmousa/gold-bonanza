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

// ─── Post-Entry Audit Helper ─────────────────────────────────────────────────
// Normalises a raw Binance order response into a compact, grep-friendly string.
// Works for both /fapi/v1/order (trade.ts binanceRequest) and helper responses.
export function formatOrderLog(res: any): string {
  if (!res) return 'null';
  const id      = res.orderId      ?? res.algoId      ?? res.id      ?? 'N/A';
  const status  = res.status       ?? res.algoStatus  ?? 'UNKNOWN';
  const filled  = res.executedQty  ?? res.qty          ?? '?';
  const price   = res.avgPrice     ?? res.price        ?? res.stopPrice ?? '?';
  return `id=${id} status=${status} filledQty=${filled} price=${price}`;
}

// Module-level idempotency and concurrency state
let inFlightExecutions = 0;
const recentSignals = new Map<string, number>();

// Async mutex: serializes the check-positions-then-reserve critical section
// so only ONE request at a time can evaluate capacity and claim a slot.
class ExecutionMutex {
  private queue: (() => void)[] = [];
  private locked = false;

  async acquire(): Promise<() => void> {
    return new Promise<() => void>(resolve => {
      const tryAcquire = () => {
        if (!this.locked) {
          this.locked = true;
          resolve(() => {
            this.locked = false;
            if (this.queue.length > 0) {
              const next = this.queue.shift()!;
              next();
            }
          });
        } else {
          this.queue.push(tryAcquire);
        }
      };
      tryAcquire();
    });
  }
}
const executionMutex = new ExecutionMutex();

// Dynamic execution URL resolution mapped to the execution mode state
function resolveBaseUrl(): string {
  if (TRADER_CONFIG.BACKEND_EXECUTION_MODE === 'LIVE') return 'https://fapi.binance.com';
  return 'https://testnet.binancefuture.com'; // DEMO or LOCKED
}

tradeRouter.get('/status', requireAuth, (req: any, res: any) => {
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
      baseUrl: process.env.BINANCE_BASE_URL || 'https://fapi.binance.com',
      diagnosticFileTruth: fileBaseUrl,
      diagnosticLineCount: fileLines,
      executionMode: TRADER_CONFIG.BACKEND_EXECUTION_MODE // 'DEMO' | 'LIVE' | 'LOCKED'
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
      activeModeId: TRADER_CONFIG.ACTIVE_MODE_ID,
      frontendModePref: TRADER_CONFIG.FRONTEND_MODE_PREF,
      enabledStrategies: TRADER_CONFIG.ENABLED_STRATEGIES
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
  if (!['LIVE', 'DEMO', 'LOCKED'].includes(target)) {
    return res.status(400).json({ error: 'Invalid execution mode target' });
  }

  // Update in-memory and write to trader_state.json via updateTraderConfig
  updateTraderConfig({ BACKEND_EXECUTION_MODE: target });
  
  if (target !== 'LIVE') {
      toggleAutoTrade(false); // Safety shutdown when leaving LIVE mode
  }
  
  tradeLogs.unshift(`[ExecutionMode] Changed dynamically to ${target}`);
  res.json({ success: true, message: `Backend Execution Mode updated to ${target}.` });
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

  // ── Application-Level Execution Guard ───────────────────────────────────────
  if (TRADER_CONFIG.BACKEND_EXECUTION_MODE !== 'LIVE') {
     return res.status(403).json({
       error: `Live execution rejected because Backend Execution Mode is ${TRADER_CONFIG.BACKEND_EXECUTION_MODE}. Must be LIVE.`
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

  // ── Idempotency Duplicate Rejection (Synchronous) ──────────────────────────
  const RECENT_COOLDOWN_MS = 60 * 1000;
  const sigKey = `${symbol}_${side}_${entryType || 'UNKNOWN'}`;
  const lastTime = recentSignals.get(sigKey);
  const now = Date.now();
  if (lastTime && (now - lastTime) < RECENT_COOLDOWN_MS) {
    console.warn(`[Trade:open] PRE-EXEC BLOCK: ${symbol} — Duplicate signal detected within cooldown`);
    tradeLogs.unshift(`[${new Date().toISOString()}] [BLOCKED_DUPLICATE_SIGNAL] ${symbol} — Prevented duplicate execution within 60s.`);
    return res.status(429).json({ error: 'BLOCKED_DUPLICATE_SIGNAL: The same signal was triggered locally within the last 60 seconds.' });
  }

  // ── Synchronous Pre-check (fast reject before mutex wait) ─────────────────
  if (inFlightExecutions >= TRADER_CONFIG.MAX_CONCURRENT_TRADES) {
    tradeLogs.unshift(`[${new Date().toISOString()}] [CAP_BLOCK_PRECHECK] ${symbol} — In-flight ${inFlightExecutions} >= max ${TRADER_CONFIG.MAX_CONCURRENT_TRADES}.`);
    return res.status(429).json({ error: `CAP_BLOCK_PRECHECK: In-flight ${inFlightExecutions} >= max ${TRADER_CONFIG.MAX_CONCURRENT_TRADES}.` });
  }

  // ── ACQUIRE MUTEX: serialize check-then-reserve ───────────────────────────
  const releaseMutex = await executionMutex.acquire();
  let reserved = false;
  try {
    // Re-check inflight after acquiring mutex (another request may have reserved while we waited)
    if (inFlightExecutions >= TRADER_CONFIG.MAX_CONCURRENT_TRADES) {
      tradeLogs.unshift(`[${new Date().toISOString()}] [CAP_BLOCK_PRECHECK] ${symbol} — Post-mutex in-flight ${inFlightExecutions} >= max ${TRADER_CONFIG.MAX_CONCURRENT_TRADES}.`);
      releaseMutex();
      return res.status(429).json({ error: `CAP_BLOCK_PRECHECK: Post-mutex in-flight ${inFlightExecutions} >= max ${TRADER_CONFIG.MAX_CONCURRENT_TRADES}.` });
    }

    // Fetch real exchange positions while holding the mutex
    let currentPositions: any[] = [];
    try {
      currentPositions = await getPositions();
    } catch (err) {
      tradeLogs.unshift(`[${new Date().toISOString()}] [BLOCKED] ${symbol} — Failed to fetch exchange positions.`);
      releaseMutex();
      return res.status(500).json({ error: 'Failed to fetch current positions for limit check.' });
    }

    // Audit: if exchange already exceeds cap from external causes
    if (currentPositions.length > TRADER_CONFIG.MAX_CONCURRENT_TRADES) {
      console.error(`[Trade:open] CAP_EXCEEDED_ACTUAL: Exchange has ${currentPositions.length} positions, max is ${TRADER_CONFIG.MAX_CONCURRENT_TRADES}`);
      tradeLogs.unshift(`[${new Date().toISOString()}] [CAP_EXCEEDED_ACTUAL] Exchange=${currentPositions.length} > Max=${TRADER_CONFIG.MAX_CONCURRENT_TRADES}`);
    }

    // Hard capacity: exchange positions + other pending in-flight (this request is NOT counted yet)
    const totalActive = currentPositions.length + inFlightExecutions;
    if (totalActive >= TRADER_CONFIG.MAX_CONCURRENT_TRADES) {
      console.warn(`[Trade:open] CAP_BLOCK_POSTSYNC: ${symbol} — Exchange=${currentPositions.length}, InFlight=${inFlightExecutions}, Max=${TRADER_CONFIG.MAX_CONCURRENT_TRADES}`);
      tradeLogs.unshift(`[${new Date().toISOString()}] [CAP_BLOCK_POSTSYNC] ${symbol} — Total ${totalActive} >= Max ${TRADER_CONFIG.MAX_CONCURRENT_TRADES}`);
      releaseMutex();
      return res.status(429).json({ error: `CAP_BLOCK_POSTSYNC: Exchange=${currentPositions.length} + InFlight=${inFlightExecutions} = ${totalActive} >= Max ${TRADER_CONFIG.MAX_CONCURRENT_TRADES}.` });
    }

    // RESERVE SLOT: only reached if check passed while holding mutex
    inFlightExecutions++;
    recentSignals.set(sigKey, now);
    reserved = true;
    console.log(`[Trade:open] SLOT RESERVED for ${symbol}. InFlight=${inFlightExecutions}, Exchange=${currentPositions.length}, Max=${TRADER_CONFIG.MAX_CONCURRENT_TRADES}`);
  } finally {
    releaseMutex();
  }

  // ── Validation (after mutex released, slot is reserved) ──────────────────
  const notional = qty * entryPrice;

  if (!balFromBinance || balFromBinance <= 0) {
    const reason = `Blocked: balance is zero ($${balFromBinance}) — cannot size order`;
    console.warn(`[Trade:open] PRE-EXEC BLOCK: ${symbol} — ${reason}`);
    tradeLogs.unshift(`[${new Date().toISOString()}] [BLOCKED] ${symbol} — ${reason}`);
    if (reserved) inFlightExecutions--;
    return res.status(400).json({ error: reason, debug: { symbol, balance: balFromBinance, riskPct: riskPctEnv, leverage: lev, qty, notional } });
  }
  if (!qty || qty <= 0) {
    const reason = `Blocked: computed quantity is zero — check balance ($${balFromBinance.toFixed(2)}) and risk config`;
    console.warn(`[Trade:open] PRE-EXEC BLOCK: ${symbol} — ${reason}`);
    tradeLogs.unshift(`[${new Date().toISOString()}] [BLOCKED] ${symbol} — ${reason}`);
    if (reserved) inFlightExecutions--;
    return res.status(400).json({ error: reason, debug: { symbol, balance: balFromBinance, riskPct: riskPctEnv, leverage: lev, qty, notional } });
  }
  if (notional < 5.00) {
    const reason = `Blocked: below minimum executable notional ($${notional.toFixed(2)} < $5.00) — qty=${qty.toFixed(6)} @ ${entryPrice}`;
    console.warn(`[Trade:open] PRE-EXEC BLOCK: ${symbol} — ${reason}`);
    tradeLogs.unshift(`[${new Date().toISOString()}] [BLOCKED] ${symbol} — ${reason}`);
    if (reserved) inFlightExecutions--;
    return res.status(400).json({ error: reason, debug: { symbol, balance: balFromBinance, riskPct: riskPctEnv, leverage: lev, qty, notional } });
  }

  console.log(`[Trade:open] PRE-EXEC PASS: ${symbol} | balance=$${balFromBinance.toFixed(2)} | qty=${qty.toFixed(6)} | notional=$${notional.toFixed(2)} | lev=${lev}x`);

  // ── Precision: fetch from exchange info ─────────────────────────────────────
  function roundTo(v: number, dp: number) { return dp === 0 ? Math.round(v).toString() : v.toFixed(dp); }
  let pricePrec = 2, qtyPrec = 3;
  try {
    const info = await fetch(`${baseUrl}/fapi/v1/exchangeInfo`).then(r => r.json()) as any;
    const sym  = info?.symbols?.find((s: any) => s.symbol === symbol);
    if (sym) { pricePrec = sym.pricePrecision; qtyPrec = sym.quantityPrecision; }
  } catch (err: any) {
    console.warn(`[Trade:open] Warning: Failed to fetch ExchangeInfo (${err.message}). Using defaults.`);
  }

  // ── Audit log ───────────────────────────────────────────────────────────────
  const auditPayload = {
    symbol, side, entryPrice, stopLoss, 
    qty: roundTo(qty, qtyPrec), leverage: lev, mode: 'LIVE', baseUrl,
    score, entryType, entryTiming, reasons
  };
  console.log('[Trade:open] Outbound payload:', JSON.stringify(auditPayload, null, 2));
  tradeLogs.unshift(`[${new Date().toISOString()}] [LIVE] SUBMITTING: ${symbol} ${side}`);

  // ── [ENTRY_REQUEST] ──────────────────────────────────────────────────────────
  const execMode = TRADER_CONFIG.BACKEND_EXECUTION_MODE;
  const entryReqMsg = `[ENTRY_REQUEST] ${symbol} ${side} | mode=${execMode} | score=${score ?? 'N/A'} | entryType=${entryType ?? 'N/A'} | entryTiming=${entryTiming ?? 'N/A'} | tpEnabled=${TRADER_CONFIG.TP_ENABLED} | slEnabled=${TRADER_CONFIG.SL_ENABLED}`;
  console.log(entryReqMsg);
  tradeLogs.unshift(`[${new Date().toISOString()}] ${entryReqMsg}`);

  // Audit state variables for the final summary
  let entryOk   = false;
  let entryId: string | number = 'N/A';
  let entryFillPrice = 0;
  let entryFilledQty = '?';
  let slOk      = false;
  let slId: string | number = 'N/A';
  let slErr     = '';
  let tpOk      = false;
  let tpId: string | number = 'N/A';
  let tpPrice   = 0;
  let tpErr     = '';

  // Orders returned in API response
  let entryOrder: any = null;
  let stopOrder:  any = null;
  let tp1Order:   any = null;
  let tp2Order:   any = null;

  try {
    // 1. Set leverage
    await binanceRequest('POST', '/fapi/v1/leverage', { symbol, leverage: lev }, baseUrl);

    // 2. Market entry order
    entryOrder = await binanceRequest('POST', '/fapi/v1/order', {
      symbol,
      side:     side === 'LONG' ? 'BUY' : 'SELL',
      type:     'MARKET',
      quantity: roundTo(qty, qtyPrec)
    }, baseUrl);
    entryOk        = true;
    entryId        = entryOrder.orderId ?? 'N/A';
    entryFillPrice = parseFloat(entryOrder.avgPrice) || entryPrice;
    entryFilledQty = entryOrder.executedQty ?? roundTo(qty, qtyPrec);

    const entryFilledMsg = `[ENTRY_FILLED] ${symbol} ${side} | ok=true | binanceId=${entryId} | filledQty=${entryFilledQty} | avgPrice=${entryFillPrice} | mode=${execMode}`;
    console.log(entryFilledMsg);
    tradeLogs.unshift(`[${new Date().toISOString()}] ${entryFilledMsg}`);

    // Brief pause so position risk is updated before placing stops
    await new Promise(r => setTimeout(r, 1000));

    // 3. Stop-loss (independent try/catch — failures logged, not swallowed)
    if (TRADER_CONFIG.SL_ENABLED) {
      try {
        stopOrder = await binanceRequest('POST', '/fapi/v1/order', {
          symbol,
          side:          side === 'LONG' ? 'SELL' : 'BUY',
          type:          'STOP_MARKET',
          stopPrice:     roundTo(stopLoss, pricePrec),
          closePosition: 'true',
          timeInForce:   'GTE_GTC'
        }, baseUrl);
        slOk = true;
        slId = stopOrder.orderId ?? 'N/A';
        const slMsg = `[SL_PLACED] ${symbol} | binanceId=${slId} | stopPrice=${roundTo(stopLoss, pricePrec)} | closePosition=true | reduceOnly=N/A | ${formatOrderLog(stopOrder)}`;
        console.log(slMsg);
        tradeLogs.unshift(`[${new Date().toISOString()}] ${slMsg}`);
      } catch (slEx: any) {
        slErr = slEx?.message ?? 'Unknown SL error';
        const slFailMsg = `[SL_FAILED] ${symbol} | slEnabled=${TRADER_CONFIG.SL_ENABLED} | stopPrice=${roundTo(stopLoss, pricePrec)} | reason="${slErr}"`;
        console.error(slFailMsg);
        tradeLogs.unshift(`[${new Date().toISOString()}] ${slFailMsg}`);
      }
    } else {
      const slSkipMsg = `[SL_SKIPPED] ${symbol} | slEnabled=false — no SL order placed`;
      console.log(slSkipMsg);
      tradeLogs.unshift(`[${new Date().toISOString()}] ${slSkipMsg}`);
    }

    // 4. TP placement (independent try/catch per TP order)
    if (TRADER_CONFIG.TP_ENABLED) {
      const isLong   = side === 'LONG';
      const closeSide = isLong ? 'SELL' : 'BUY';

      const SAFE_DEFAULT_RR = 1.5;
      let tp1RR = TRADER_CONFIG.TP1_RR;
      let tp2RR = TRADER_CONFIG.TP2_RR;
      if (!tp1RR || !isFinite(tp1RR) || tp1RR <= 0) { tp1RR = SAFE_DEFAULT_RR; }
      if (!tp2RR || !isFinite(tp2RR) || tp2RR <= 0) { tp2RR = SAFE_DEFAULT_RR * 2; }

      const appliedTpStr = TRADER_CONFIG.TP1_ONLY ? `${tp1RR}% (100%)` : `${tp1RR}% & ${tp2RR}% (50/50)`;
      const tpDebugMsg = `[TP_DEBUG:ROUTE] ${symbol} | tpEnabled=${TRADER_CONFIG.TP_ENABLED} | tp1Only=${TRADER_CONFIG.TP1_ONLY} | tp1Pct=${tp1RR}% | tp2Pct=${tp2RR}% | appliedRatios=${appliedTpStr}`;
      console.log(tpDebugMsg);
      tradeLogs.unshift(`[${new Date().toISOString()}] ${tpDebugMsg}`);

      const tp1Pct  = tp1RR / 100;
      const calcTp1 = isLong ? entryFillPrice * (1 + tp1Pct) : entryFillPrice * (1 - tp1Pct);
      tpPrice       = calcTp1;

      if (TRADER_CONFIG.TP1_ONLY) {
        try {
          tp1Order = await binanceRequest('POST', '/fapi/v1/order', {
            symbol, side: closeSide, type: 'TAKE_PROFIT_MARKET',
            stopPrice: roundTo(calcTp1, pricePrec), closePosition: 'true', timeInForce: 'GTE_GTC'
          }, baseUrl);
          tpOk = true;
          tpId = tp1Order.orderId ?? 'N/A';
          const tpMsg = `[TP_PLACED] ${symbol} | tp1Only=true | tpPrice=${roundTo(calcTp1, pricePrec)} | reduceOnly=false (closePosition) | binanceId=${tpId} | ${formatOrderLog(tp1Order)}`;
          console.log(tpMsg);
          tradeLogs.unshift(`[${new Date().toISOString()}] ${tpMsg}`);
        } catch (tpEx: any) {
          tpErr = tpEx?.message ?? 'Unknown TP error';
          const tpFailMsg = `[TP_FAILED] ${symbol} | tp1Only=true | tpEnabled=${TRADER_CONFIG.TP_ENABLED} | tpPrice=${roundTo(calcTp1, pricePrec)} | reduceOnly=false | reason="${tpErr}"`;
          console.error(tpFailMsg);
          tradeLogs.unshift(`[${new Date().toISOString()}] ${tpFailMsg}`);
        }
      } else {
        const tp2Pct  = tp2RR / 100;
        const calcTp2 = isLong ? entryFillPrice * (1 + tp2Pct) : entryFillPrice * (1 - tp2Pct);
        const halfQty = roundTo(qty * 0.5, qtyPrec);

        // TP1 (50%)
        try {
          tp1Order = await binanceRequest('POST', '/fapi/v1/order', {
            symbol, side: closeSide, type: 'TAKE_PROFIT_MARKET',
            stopPrice: roundTo(calcTp1, pricePrec), quantity: halfQty, reduceOnly: 'true', timeInForce: 'GTE_GTC'
          }, baseUrl);
          tpOk = true;
          tpId = tp1Order.orderId ?? 'N/A';
          const tp1Msg = `[TP_PLACED] ${symbol} | leg=TP1 | tp1Only=false | tpPrice=${roundTo(calcTp1, pricePrec)} | reduceOnly=true | qty=${halfQty} | binanceId=${tpId} | ${formatOrderLog(tp1Order)}`;
          console.log(tp1Msg);
          tradeLogs.unshift(`[${new Date().toISOString()}] ${tp1Msg}`);
        } catch (tp1Ex: any) {
          tpErr = tp1Ex?.message ?? 'Unknown TP1 error';
          const tp1FailMsg = `[TP_FAILED] ${symbol} | leg=TP1 | tpEnabled=${TRADER_CONFIG.TP_ENABLED} | tpPrice=${roundTo(calcTp1, pricePrec)} | reduceOnly=true | qty=${halfQty} | reason="${tpErr}"`;
          console.error(tp1FailMsg);
          tradeLogs.unshift(`[${new Date().toISOString()}] ${tp1FailMsg}`);
        }

        // TP2 (50%)
        try {
          tp2Order = await binanceRequest('POST', '/fapi/v1/order', {
            symbol, side: closeSide, type: 'TAKE_PROFIT_MARKET',
            stopPrice: roundTo(calcTp2, pricePrec), quantity: halfQty, reduceOnly: 'true', timeInForce: 'GTE_GTC'
          }, baseUrl);
          const tp2Logged = `[TP_PLACED] ${symbol} | leg=TP2 | tp1Only=false | tpPrice=${roundTo(calcTp2, pricePrec)} | reduceOnly=true | qty=${halfQty} | binanceId=${tp2Order.orderId ?? 'N/A'} | ${formatOrderLog(tp2Order)}`;
          console.log(tp2Logged);
          tradeLogs.unshift(`[${new Date().toISOString()}] ${tp2Logged}`);
        } catch (tp2Ex: any) {
          const tp2Err = tp2Ex?.message ?? 'Unknown TP2 error';
          const tp2FailMsg = `[TP_FAILED] ${symbol} | leg=TP2 | tpEnabled=${TRADER_CONFIG.TP_ENABLED} | tpPrice=${roundTo(calcTp2, pricePrec)} | reduceOnly=true | qty=${halfQty} | reason="${tp2Err}"`;
          console.error(tp2FailMsg);
          tradeLogs.unshift(`[${new Date().toISOString()}] ${tp2FailMsg}`);
          if (!tpErr) tpErr = tp2Err; // record at least one TP failure
        }
      }
    } else {
      const tpSkipMsg = `[TP_SKIPPED] ${symbol} | tpEnabled=false — no TP orders placed`;
      console.log(tpSkipMsg);
      tradeLogs.unshift(`[${new Date().toISOString()}] ${tpSkipMsg}`);
    }

    // ── [EXECUTION_SUMMARY] ─────────────────────────────────────────────────────
    const verdict = slOk && tpOk
      ? 'ENTRY_OK_TP_OK_SL_OK'
      : slOk && !tpOk
        ? 'ENTRY_OK_TP_FAIL_SL_OK'
        : !slOk && tpOk
          ? 'ENTRY_OK_TP_OK_SL_FAIL'
          : 'ENTRY_OK_TP_FAIL_SL_FAIL';

    const tpStr = tpOk  ? `tp=OK id=${tpId} @ ${roundTo(tpPrice, pricePrec)}`      : `tp=FAIL reason="${tpErr}"`;
    const slStr = slOk  ? `sl=OK id=${slId} @ ${roundTo(stopLoss, pricePrec)}`     : `sl=FAIL reason="${slErr}"`;
    const summaryMsg = `[EXECUTION_SUMMARY] ${symbol} ${side} | entry=OK @ ${entryFillPrice} | ${tpStr} | ${slStr} | mode=${execMode}`;
    console.log(`\n${'='.repeat(80)}\n${summaryMsg}\nVerdict: ${verdict}\n${'='.repeat(80)}\n`);
    tradeLogs.unshift(`[${new Date().toISOString()}] ${summaryMsg} | verdict=${verdict}`);

    return res.json({
      success: true, mode: execMode, baseUrl, verdict,
      orderId: entryOrder.orderId, clientOrderId: entryOrder.clientOrderId,
      orders: { entry: entryOrder, stopLoss: stopOrder, takeProfit: tp1Order, takeProfit2: tp2Order },
      submittedPayload: auditPayload
    });

  } catch (e: any) {
    const errMsg = e?.message ?? 'Unknown error';
    // ── [EXECUTION_SUMMARY] on full entry failure ────────────────────────────
    const failSummary = `[EXECUTION_SUMMARY] ${symbol} ${side} | entry=FAIL reason="${errMsg}" | mode=${execMode}`;
    console.error(`\n${'='.repeat(80)}\n${failSummary}\nVerdict: ENTRY_FAIL\n${'='.repeat(80)}\n`);
    tradeLogs.unshift(`[${new Date().toISOString()}] ${failSummary} | verdict=ENTRY_FAIL`);
    tradeLogs.unshift(`[${new Date().toISOString()}] [ENTRY_FAILED] ${symbol} — ${errMsg}`);
    return res.status(500).json({
      error: errMsg, mode: execMode, baseUrl, symbol, verdict: 'ENTRY_FAIL',
      failedAt: Date.now(), submittedPayload: auditPayload
    });
  } finally {
    if (reserved) inFlightExecutions--;
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
