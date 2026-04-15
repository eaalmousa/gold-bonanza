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

    // ── DYNAMIC TP CALCULATION ──
    let tp1Order = null;
    let tp2Order = null;

    if (TRADER_CONFIG.TP_ENABLED) {
      const isLong = side === 'LONG';
      const closeSide = isLong ? 'SELL' : 'BUY';

      const SAFE_DEFAULT_RR = 1.5;
      let tp1RR = TRADER_CONFIG.TP1_RR;
      let tp2RR = TRADER_CONFIG.TP2_RR;
      if (!tp1RR || !isFinite(tp1RR) || tp1RR <= 0) { tp1RR = SAFE_DEFAULT_RR; }
      if (!tp2RR || !isFinite(tp2RR) || tp2RR <= 0) { tp2RR = SAFE_DEFAULT_RR * 2; }
      const appliedTpStr = TRADER_CONFIG.TP1_ONLY ? `${tp1RR}% (100%)` : `${tp1RR}% & ${tp2RR}% (50/50)`;

      console.log(`[TP_DEBUG:ROUTE] ${symbol} | tpEnabled=${TRADER_CONFIG.TP_ENABLED} | tp1Only=${TRADER_CONFIG.TP1_ONLY} | tp1Pct=${tp1RR}% | tp2Pct=${tp2RR}% | appliedRatios=${appliedTpStr}`);
      tradeLogs.unshift(`[TP_DEBUG] ${symbol} tpEnabled=true tp1Only=${TRADER_CONFIG.TP1_ONLY} tp1Pct=${tp1RR}% tp2Pct=${tp2RR}% appliedRatios=${appliedTpStr}`);

      let actualEntryPrice = parseFloat(entryOrder.avgPrice);
      if (!actualEntryPrice || isNaN(actualEntryPrice) || actualEntryPrice <= 0) {
        actualEntryPrice = entryPrice;
      }
      
      const tp1Pct = tp1RR / 100;
      const calcTp1 = isLong ? actualEntryPrice * (1 + tp1Pct) : actualEntryPrice * (1 - tp1Pct);

      if (TRADER_CONFIG.TP1_ONLY) {
        tp1Order = await binanceRequest('POST', '/fapi/v1/order', {
          symbol, side: closeSide, type: 'TAKE_PROFIT_MARKET',
          stopPrice: roundTo(calcTp1, pricePrec), closePosition: 'true', timeInForce: 'GTE_GTC'
        }, baseUrl);
        console.log('[Trade:open] TP1 Full order response:', JSON.stringify(tp1Order));
      } else {
        const tp2Pct = tp2RR / 100;
        const calcTp2 = isLong ? actualEntryPrice * (1 + tp2Pct) : actualEntryPrice * (1 - tp2Pct);
        const halfQty = roundTo(qty * 0.5, qtyPrec);

        tp1Order = await binanceRequest('POST', '/fapi/v1/order', {
          symbol, side: closeSide, type: 'TAKE_PROFIT_MARKET',
          stopPrice: roundTo(calcTp1, pricePrec), quantity: halfQty, reduceOnly: 'true', timeInForce: 'GTE_GTC'
        }, baseUrl);

        tp2Order = await binanceRequest('POST', '/fapi/v1/order', {
          symbol, side: closeSide, type: 'TAKE_PROFIT_MARKET',
          stopPrice: roundTo(calcTp2, pricePrec), quantity: halfQty, reduceOnly: 'true', timeInForce: 'GTE_GTC'
        }, baseUrl);
      }
    }

    tradeLogs.unshift(`[${new Date().toISOString()}] [LIVE] ✅ SUBMITTED: ${symbol} ${side} orderId=${entryOrder.orderId}`);

    return res.json({
      success: true, mode: 'LIVE', baseUrl,
      orderId: entryOrder.orderId, clientOrderId: entryOrder.clientOrderId,
      orders: { entry: entryOrder, stopLoss: stopOrder, takeProfit: tp1Order, takeProfit2: tp2Order },
      submittedPayload: auditPayload
    });

  } catch (e: any) {
    const errMsg = e?.message ?? 'Unknown error';
    tradeLogs.unshift(`[${new Date().toISOString()}] [LIVE] ❌ FAILED: ${symbol} — ${errMsg}`);
    console.error('[Trade:open] Error:', errMsg);
    return res.status(500).json({
      error: errMsg, mode: 'LIVE', baseUrl, symbol,
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
