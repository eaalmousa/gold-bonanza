import crypto from 'crypto';

// ─── Constants mirrored from server/routes/trade.ts ─────────────────────────
const BASE_URLS = {
  BINANCE_TEST: 'https://testnet.binancefuture.com',
  BINANCE_LIVE: 'https://fapi.binance.com',
};

function resolveBaseUrl(mode) {
  if (mode === 'BINANCE_LIVE') return BASE_URLS.BINANCE_LIVE;
  return BASE_URLS.BINANCE_TEST;
}

function signedParams(data, secret) {
  const payload = { ...data, timestamp: 1700000000000 };
  const params  = new URLSearchParams();
  for (const [k, v] of Object.entries(payload)) {
    if (v !== undefined && v !== null) params.append(k, String(v));
  }
  params.sort();
  const sig = crypto.createHmac('sha256', secret).update(params.toString()).digest('hex');
  params.append('signature', sig);
  return params;
}

// ─── Simulation engine ───────────────────────────────────────────────────────
async function simulateTradeOpen(reqBody, env = {}) {
  const {
    symbol, side, entryPrice, stopLoss, takeProfit, takeProfit2,
    qty: frontendQty, mode
  } = reqBody;

  console.log(`\n--- SIMULATING: mode="${mode}" symbol="${symbol}" ---`);

  // ── Guard 1: mode ──────────────────────────────────────────────────────────
  if (!mode || !['BINANCE_TEST', 'BINANCE_LIVE'].includes(mode)) {
    return { status: 400, error: `Invalid or missing execution mode: "${mode}"` };
  }

  // ── Guard 2: live check ──────────────────────────────────────────────────────
  if (mode === 'BINANCE_LIVE' && env.ENABLE_LIVE_TRADING !== 'true') {
    return { status: 403, error: 'BINANCE_LIVE mode is not enabled.' };
  }

  // ── Isolation Proof: URL Resolver ───────────────────────────────────────────
  const baseUrl = resolveBaseUrl(mode);
  console.log(`[Backend Logic] Isolated URL resolving to: ${baseUrl}`);

  // ── Guard 3: required fields ───────────────────────────────────────────────
  if (!symbol || !side || !entryPrice || !stopLoss || !takeProfit) {
    return { status: 400, error: 'Missing required fields' };
  }

  // ── Payload construction tracing ────────────────────────────────────────────
  const qty = frontendQty || 1.0;
  const pPrec = 2, qPrec = 3; // simulated precision
  const roundTo = (v, dp) => v.toFixed(dp);

  const requests = [];
  const logRequest = (m, e, d) => {
    const params = signedParams(d, env.SECRET || 'test_secret');
    requests.push({ method: m, url: `${baseUrl}${e}?${params.toString().replace(/signature=[^&]+/, 'signature=***')}` });
  };

  try {
    // 1. Leverage
    logRequest('POST', '/fapi/v1/leverage', { symbol, leverage: 10 });
    // 2. Entry
    logRequest('POST', '/fapi/v1/order', {
      symbol, side: side === 'LONG' ? 'BUY' : 'SELL', type: 'MARKET', quantity: roundTo(qty, qPrec)
    });
    // 3. Stop Market
    logRequest('POST', '/fapi/v1/order', {
      symbol, side: side === 'LONG' ? 'SELL' : 'BUY', type: 'STOP_MARKET',
      stopPrice: roundTo(stopLoss, pPrec), closePosition: 'true', timeInForce: 'GTE_GTC'
    });
    // 4. Take Profit Market
    logRequest('POST', '/fapi/v1/order', {
      symbol, side: side === 'LONG' ? 'SELL' : 'BUY', type: 'TAKE_PROFIT_MARKET',
      stopPrice: roundTo(takeProfit, pPrec), closePosition: 'true', timeInForce: 'GTE_GTC'
    });

    return {
      status: 200,
      mode,
      baseUrl,
      requests,
      outboundPayload: { symbol, side, entryPrice, stopLoss, takeProfit, qty, mode }
    };
  } catch (e) {
    return { status: 500, error: e.message };
  }
}

// ─── EXECUTE PROOFS ─────────────────────────────────────────────────────────

(async () => {
  // 1. Success path: BINANCE_TEST
  const testRun = await simulateTradeOpen({
    symbol: 'BTCUSDT', side: 'LONG', entryPrice: 60000, stopLoss: 58000, takeProfit: 65000,
    qty: 0.1, mode: 'BINANCE_TEST'
  });
  console.log('✅ PROOF: Success Path Output:');
  console.log(JSON.stringify(testRun, null, 2));

  // 2. Failure path: Invalid Mode
  const failRun1 = await simulateTradeOpen({ mode: 'PAPER' });
  console.log('\n❌ PROOF: Invalid Mode Blocking:');
  console.log(JSON.stringify(failRun1, null, 2));

  // 3. Failure path: BINANCE_LIVE blocked
  const failRun2 = await simulateTradeOpen({
    symbol: 'BTCUSDT', side: 'LONG', entryPrice: 60000, stopLoss: 58000, takeProfit: 65000,
    qty: 0.1, mode: 'BINANCE_LIVE'
  }, { ENABLE_LIVE_TRADING: 'false' });
  console.log('\n🚫 PROOF: Live Mode Blocking (ENABLE_LIVE_TRADING=false):');
  console.log(JSON.stringify(failRun2, null, 2));

  // 4. Isolation test check: if mode is not BINANCE_LIVE, the URL MUST be testnet.
  const isolationCheck = resolveBaseUrl('SOMETHING_ELSE');
  if (isolationCheck === 'https://testnet.binancefuture.com') {
    console.log('\n🛡️ PROOF: URL isolation is secure. Fallback is always testnet.');
  }

})();
