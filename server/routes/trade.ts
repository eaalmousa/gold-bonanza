import { Router } from 'express';
import { requireAuth } from './auth';
import {
  getPositions, getBalance, setLeverage, binanceRequest
} from '../lib/binance';
import {
  isAutoTradingEnabled, toggleAutoTrade, tradeLogs,
  RISK_PER_TRADE, MAX_CONCURRENT_TRADES, LEVERAGE, SL_ENABLED, TP_ENABLED,
  TP1_ONLY, TP1_RR, TP2_RR, MIN_SCORE, BTC_GATE_ENABLED, TRAIL_TP_ENABLED,
  updateTraderConfig
} from '../lib/autoTrader';

export const tradeRouter = Router();

// BASE_URLS mapping for mode resolution
const BASE_URLS: Record<string, string> = {
  BINANCE_TEST: 'https://testnet.binancefuture.com',
  BINANCE_LIVE: 'https://fapi.binance.com',
};

function resolveBaseUrl(mode?: string): string {
  if (mode === 'BINANCE_LIVE') return BASE_URLS.BINANCE_LIVE;
  return BASE_URLS.BINANCE_TEST;
}

tradeRouter.get('/status', requireAuth, (req: any, res: any) => {
  res.json({
    autoTrading: isAutoTradingEnabled,
    config: {
      riskPerTrade: RISK_PER_TRADE,
      maxConcurrent: MAX_CONCURRENT_TRADES,
      leverage: LEVERAGE,
      slEnabled: SL_ENABLED,
      tpEnabled: TP_ENABLED,
      tp1Only: TP1_ONLY,
      tp1Rr: TP1_RR,
      tp2Rr: TP2_RR,
      minScore: MIN_SCORE,
      btcGate: BTC_GATE_ENABLED,
      trailTp: TRAIL_TP_ENABLED
    }
  });
});

tradeRouter.get('/logs', requireAuth, (req: any, res: any) => {
  res.json({ logs: tradeLogs });
});

tradeRouter.post('/toggle', requireAuth, (req: any, res: any) => {
  toggleAutoTrade(!isAutoTradingEnabled);
  res.json({ enabled: isAutoTradingEnabled });
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
  // ── Read all fields from adapter ────────────────────────────────────────────
  const {
    symbol, side, entryPrice, stopLoss, takeProfit, takeProfit2,
    qty:         frontendQty,
    sizeUSDT:    frontendSize,
    leverage:    frontendLeverage,
    mode,         // 'BINANCE_TEST' | 'BINANCE_LIVE'
    // Provenance (stored in log, not sent to exchange)
    score, entryType, entryTiming, reasons
  } = req.body;

  // ── Guard: mode must be explicit ────────────────────────────────────────────
  if (!mode || !['BINANCE_TEST', 'BINANCE_LIVE'].includes(mode)) {
    return res.status(400).json({
      error: `Invalid or missing execution mode: "${mode}". Must be BINANCE_TEST or BINANCE_LIVE.`
    });
  }

  // ── Guard: block BINANCE_LIVE via env flag ───────────────────────────────────
  if (mode === 'BINANCE_LIVE' && process.env.ENABLE_LIVE_TRADING !== 'true') {
    return res.status(403).json({
      error: 'BINANCE_LIVE mode is not enabled. Set ENABLE_LIVE_TRADING=true in server .env to unlock.'
    });
  }

  // ── Resolve BASE_URL per mode (NEVER shares with live in TEST mode) ──────────
  const baseUrl = resolveBaseUrl(mode);
  console.log(`[Trade:open] mode=${mode} → baseUrl=${baseUrl}`);

  // ── Validate required fields ─────────────────────────────────────────────────
  if (!symbol || !side || !entryPrice || !stopLoss || !takeProfit) {
    return res.status(400).json({ error: 'Missing required fields: symbol, side, entryPrice, stopLoss, takeProfit' });
  }

  // ── Use frontend-supplied qty/leverage where present; fallback to env config ─
  const lev = frontendLeverage ?? parseInt(process.env.LEVERAGE || '10', 10);
  let   qty = frontendQty;
  if (!qty || qty <= 0) {
    // Recompute from risk profile if frontend didn't send a valid qty
    const bal    = await getBalance().catch(() => 0);
    const risk   = parseFloat(process.env.RISK_PER_TRADE || '0.04');
    qty          = Math.max(0.001, (bal * risk * lev) / entryPrice);
  }

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
    symbol, side, entryPrice, stopLoss, takeProfit, takeProfit2,
    qty: roundTo(qty, qtyPrec), leverage: lev, mode, baseUrl,
    score, entryType, entryTiming, reasons
  };
  console.log('[Trade:open] Outbound payload:', JSON.stringify(auditPayload, null, 2));
  tradeLogs.unshift(`[${new Date().toISOString()}] [${mode}] SUBMITTING: ${symbol} ${side}`);

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

    // 4. Take-profit 1
    const tp1Order = await binanceRequest('POST', '/fapi/v1/order', {
      symbol,
      side:          side === 'LONG' ? 'SELL' : 'BUY',
      type:          'TAKE_PROFIT_MARKET',
      stopPrice:     roundTo(takeProfit, pricePrec),
      closePosition: 'true',
      timeInForce:   'GTE_GTC'
    }, baseUrl);
    console.log('[Trade:open] TP1 order response:', JSON.stringify(tp1Order));

    // 5. Take-profit 2 (optional)
    let tp2Order = null;
    if (takeProfit2 && takeProfit2 > 0) {
      tp2Order = await binanceRequest('POST', '/fapi/v1/order', {
        symbol,
        side:          side === 'LONG' ? 'SELL' : 'BUY',
        type:          'TAKE_PROFIT_MARKET',
        stopPrice:     roundTo(takeProfit2, pricePrec),
        quantity:      roundTo(qty * 0.5, qtyPrec), // 50% of position at TP2
        reduceOnly:    'true',
        timeInForce:   'GTE_GTC'
      }, baseUrl);
      console.log('[Trade:open] TP2 order response:', JSON.stringify(tp2Order));
    }

    tradeLogs.unshift(`[${new Date().toISOString()}] [${mode}] ✅ SUBMITTED: ${symbol} ${side} orderId=${entryOrder.orderId}`);

    // ── Normalised success response ───────────────────────────────────────────
    return res.json({
      success:    true,
      mode,
      baseUrl,
      orderId:    entryOrder.orderId,
      clientOrderId: entryOrder.clientOrderId,
      orders: {
        entry:  entryOrder,
        stopLoss: stopOrder,
        takeProfit:  tp1Order,
        takeProfit2: tp2Order
      },
      submittedPayload: auditPayload
    });

  } catch (e: any) {
    const errMsg = e?.message ?? 'Unknown error';
    tradeLogs.unshift(`[${new Date().toISOString()}] [${mode}] ❌ FAILED: ${symbol} — ${errMsg}`);
    console.error('[Trade:open] Error:', errMsg);

    // ── Normalised error response ─────────────────────────────────────────────
    return res.status(500).json({
      error:           errMsg,
      mode,
      baseUrl,
      symbol,
      failedAt:        Date.now(),
      submittedPayload: auditPayload
    });
  }
});

tradeRouter.post('/close', requireAuth, async (req: any, res: any) => {
  const { symbol, side, qty, mode } = req.body;
  try {
    const baseUrl = resolveBaseUrl(mode);
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
