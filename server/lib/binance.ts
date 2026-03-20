import crypto from 'crypto';

// ─── Rate Limit Tracking ──────────────────────────────────────────────────────
let usedWeight1m     = 0;
let cooldownUntil   = 0;
let isBanned         = false;

export function getRateLimitStatus() {
  const now = Date.now();
  return {
    usedWeight1m,
    cooldownUntil,
    isBanned: isBanned && now < cooldownUntil,
    active: now > cooldownUntil && (!isBanned || now > cooldownUntil)
  };
}

const getApiKey = (url?: string) => {
  const isTest = url?.includes('testnet') || url?.includes('demo-fapi') || process.env.BINANCE_BASE_URL?.includes('testnet');
  if (isTest) return process.env.BINANCE_TEST_API_KEY;
  return process.env.BINANCE_API_KEY;
};

const getApiSecret = (url?: string) => {
  const isTest = url?.includes('testnet') || url?.includes('demo-fapi') || process.env.BINANCE_BASE_URL?.includes('testnet');
  if (isTest) return process.env.BINANCE_TEST_API_SECRET;
  return process.env.BINANCE_API_SECRET;
};

const getBaseUrl = () => process.env.BINANCE_BASE_URL || 'https://fapi.binance.com';

function sign(queryString: string, url?: string): string {
  const secret = getApiSecret(url);
  if (!secret) return '';
  return crypto.createHmac('sha256', secret).update(queryString).digest('hex');
}

// ─── Request Gatekeeper ────────────────────────────────────────────────────────
export async function binanceRequest(method: string, endpoint: string, data: Record<string, any> = {}, overrideBaseUrl?: string) {
  const now = Date.now();
  if (now < cooldownUntil) {
    const minLeft = Math.ceil((cooldownUntil - now) / 60000);
    const reason = isBanned ? 'IP BAN' : 'Rate Limit (429)';
    throw new Error(`[Binance] Request blocked - ${reason}. Retry after ${minLeft} minutes.`);
  }

  const targetBaseUrl = overrideBaseUrl || getBaseUrl();
  const key = getApiKey(targetBaseUrl);
  if (!key) throw new Error('BINANCE_API_KEY is not set');

  // Algorithm for signed requests
  const payload = { ...data, timestamp: Date.now() };
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(payload)) {
    if (v !== undefined && v !== null) params.append(k, String(v));
  }
  params.sort();
  const queryString = params.toString();
  const signature = sign(queryString, targetBaseUrl);
  const url = `${targetBaseUrl}${endpoint}?${queryString}${signature ? `&signature=${signature}` : ''}`;

  try {
    const res = await fetch(url, {
      method,
      headers: {
        'X-MBX-APIKEY': key,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    // Update weight metrics
    const weightHeader = res.headers.get('x-mbx-used-weight-1m');
    if (weightHeader) usedWeight1m = parseInt(weightHeader, 10);

    const json = await res.json() as any;

    if (!res.ok) {
      if (res.status === 429) {
        // Backoff for 2 minutes on 429
        cooldownUntil = Date.now() + (120 * 1000);
        isBanned = false;
        console.warn(`[Binance] ⚠️ 429 Rate Limit hit. Weight=${usedWeight1m}. Pausing requests for 2 mins.`);
      }
      if (res.status === 418) {
        // Backoff for 15 minutes on 418 (Teapot / Ban)
        cooldownUntil = Date.now() + (900 * 1000);
        isBanned = true;
        console.error(`[Binance] 🚫 418 IP BANNED. Pausing all network activity for 15 mins.`);
      }
      throw new Error(`Binance API ${res.status}: ${json.msg || JSON.stringify(json)}`);
    }

    return json;
  } catch (err: any) {
    throw err;
  }
}

// ─── Core Actions ──────────────────────────────────────────────────────────────
export async function getBalance(): Promise<number> {
  try {
    const res = await binanceRequest('GET', '/fapi/v2/balance');
    const usdtAsset = (res as any[]).find(a => a.asset === 'USDT');
    return usdtAsset ? parseFloat(usdtAsset.balance) : 0;
  } catch { return 0; }
}

export async function getPositions(): Promise<any[]> {
  try {
    const res = await binanceRequest('GET', '/fapi/v2/positionRisk');
    return (res as any[]).filter(p => parseFloat(p.positionAmt) !== 0);
  } catch { return []; }
}

let cachedExchangeInfo: any = null;
let lastExchangeInfoFetch = 0;

export async function getExchangeInfo() {
  if (cachedExchangeInfo && (Date.now() - lastExchangeInfoFetch < 3600000)) return cachedExchangeInfo;
  try {
    const res = await fetch(`${getBaseUrl()}/fapi/v1/exchangeInfo`);
    cachedExchangeInfo = await res.json();
    lastExchangeInfoFetch = Date.now();
    return cachedExchangeInfo;
  } catch { return cachedExchangeInfo; }
}

async function getSymbolPrecision(symbol: string) {
  const info = await getExchangeInfo();
  if (!info || !info.symbols) return { price: 2, qty: 3 };
  const s = info.symbols.find((x: any) => x.symbol === symbol);
  if (!s) return { price: 2, qty: 3 };
  return { price: s.pricePrecision, qty: s.quantityPrecision };
}

function roundTo(v: number, p: number) { 
  return p === 0 ? Math.round(v).toString() : v.toFixed(p); 
}

export async function setLeverage(symbol: string, leverage: number) {
  return binanceRequest('POST', '/fapi/v1/leverage', { symbol, leverage });
}

export async function placeMarketOrder(symbol: string, side: 'BUY' | 'SELL', qty: number) {
  const { qty: qPrec } = await getSymbolPrecision(symbol);
  return binanceRequest('POST', '/fapi/v1/order', {
    symbol, side, type: 'MARKET', quantity: roundTo(qty, qPrec)
  });
}

export async function placeStopMarket(symbol: string, side: 'BUY' | 'SELL', stopPrice: number) {
  const { price: pPrec } = await getSymbolPrecision(symbol);
  return binanceRequest('POST', '/fapi/v1/algoOrder', {
    algoType: 'CONDITIONAL', symbol, side, type: 'STOP_MARKET',
    triggerPrice: roundTo(stopPrice, pPrec), closePosition: 'true'
  });
}

export async function placeTakeProfitMarket(symbol: string, side: 'BUY' | 'SELL', stopPrice: number, qty?: number) {
  const { price: pPrec, qty: qPrec } = await getSymbolPrecision(symbol);
  const params: any = {
    symbol, side, type: 'TAKE_PROFIT_MARKET', triggerPrice: roundTo(stopPrice, pPrec), algoType: 'CONDITIONAL'
  };
  if (qty) { params.quantity = roundTo(qty, qPrec); params.reduceOnly = 'true'; } 
  else { params.closePosition = 'true'; }
  return binanceRequest('POST', '/fapi/v1/algoOrder', params);
}

export async function placeTrailingStopMarket(symbol: string, side: 'BUY' | 'SELL', callbackRatePct: number, activationPrice?: number, qty?: number) {
  const { price: pPrec, qty: qPrec } = await getSymbolPrecision(symbol);
  const params: any = { symbol, side, type: 'TRAILING_STOP_MARKET', callbackRate: callbackRatePct.toString() };
  if (activationPrice) params.activationPrice = roundTo(activationPrice, pPrec);
  if (qty) { params.quantity = roundTo(qty, qPrec); params.reduceOnly = 'true'; } 
  else { params.closePosition = 'true'; }
  return binanceRequest('POST', '/fapi/v1/order', params);
}
