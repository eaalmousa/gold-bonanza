import crypto from 'crypto';

const getApiKey = (url?: string) => {
  const isTest = url?.includes('testnet') || process.env.BINANCE_BASE_URL?.includes('testnet');
  if (isTest) {
    if (process.env.BINANCE_TEST_API_KEY) return process.env.BINANCE_TEST_API_KEY;
    console.warn('[Binance] WARNING: Mode is TESTNET but BINANCE_TEST_API_KEY is missing. Falling back to BINANCE_API_KEY (this will cause a 401 if it stays a Live Key)');
  }
  return process.env.BINANCE_API_KEY || '';
};

const getApiSecret = (url?: string) => {
  const isTest = url?.includes('testnet') || process.env.BINANCE_BASE_URL?.includes('testnet');
  if (isTest && process.env.BINANCE_TEST_API_SECRET) return process.env.BINANCE_TEST_API_SECRET;
  return process.env.BINANCE_API_SECRET || '';
};

const getBaseUrl = () => process.env.BINANCE_BASE_URL || 'https://testnet.binancefuture.com';

function sign(queryString: string, url?: string): string {
  const secret = getApiSecret(url);
  if (!secret) throw new Error('BINANCE_API_SECRET is not set');
  return crypto.createHmac('sha256', secret).update(queryString).digest('hex');
}

export async function binanceRequest(method: string, endpoint: string, data: Record<string, any> = {}, overrideBaseUrl?: string) {
  const targetBaseUrl = overrideBaseUrl || getBaseUrl();
  const key = getApiKey(targetBaseUrl);
  if (!key) throw new Error('BINANCE_API_KEY is not set');

  const payload = { ...data, timestamp: Date.now() };
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(payload)) {
    if (v !== undefined && v !== null) params.append(k, String(v));
  }
  
  params.sort(); // Binance requires sorted params in some endpoints
  const queryString = params.toString();
  const signature = sign(queryString, targetBaseUrl);
  
  const url = `${targetBaseUrl}${endpoint}?${queryString}&signature=${signature}`;
  
  const censoredKey = key.substring(0, 6) + '...' + key.substring(key.length - 4);
  console.log(`[Binance:${method}] ${endpoint} via ${targetBaseUrl} (Key: ${censoredKey})`);

  const res = await fetch(url, {
    method,
    headers: {
      'X-MBX-APIKEY': key,
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  });

  const json = await res.json() as any;
  if (!res.ok) {
    throw new Error(`Binance API ${res.status}: ${json.msg || JSON.stringify(json)}`);
  }
  
  return json;
}

// Deprecated local request() - mapping to exported binanceRequest
async function request(m: string, e: string, d: Record<string, any> = {}) {
  return binanceRequest(m, e, d);
}

export async function getBalance(overrideBaseUrl?: string): Promise<number> {
  const res = await binanceRequest('GET', '/fapi/v2/balance', {}, overrideBaseUrl);
  const usdtAsset = (res as any[]).find(a => a.asset === 'USDT');
  return usdtAsset ? parseFloat(usdtAsset.balance) : 0;
}

export interface Position {
  symbol: string;
  positionAmt: string;
  entryPrice: string;
  unRealizedProfit: string;
  leverage: string;
  positionSide: string;
}

export async function getPositions(overrideBaseUrl?: string): Promise<Position[]> {
  const res = await binanceRequest('GET', '/fapi/v2/positionRisk', {}, overrideBaseUrl);
  // Only return open positions
  return (res as Position[]).filter(p => parseFloat(p.positionAmt) !== 0);
}

export async function setLeverage(symbol: string, leverage: number, overrideBaseUrl?: string) {
  return binanceRequest('POST', '/fapi/v1/leverage', { symbol, leverage }, overrideBaseUrl);
}

let cachedExchangeInfo: any = null;

export async function getExchangeInfo(overrideBaseUrl?: string) {
  if (cachedExchangeInfo) return cachedExchangeInfo;
  try {
    const base = overrideBaseUrl || getBaseUrl();
    const res = await fetch(`${base}/fapi/v1/exchangeInfo`);
    cachedExchangeInfo = await res.json();
    return cachedExchangeInfo;
  } catch (e) {
    console.error('Failed to fetch ExchangeInfo:', e);
    return null;
  }
}

function roundTo(value: number, precision: number): string {
  if (precision === 0) return Math.round(value).toString();
  return value.toFixed(precision);
}

// Helper to find symbol rules
async function getSymbolPrecision(symbol: string, overrideBaseUrl?: string) {
  const info = await getExchangeInfo(overrideBaseUrl);
  if (!info || !info.symbols) return { price: 2, qty: 3 };
  const s = info.symbols.find((x: any) => x.symbol === symbol);
  if (!s) return { price: 2, qty: 3 };
  return {
    price: s.pricePrecision,
    qty: s.quantityPrecision
  };
}

export async function placeMarketOrder(symbol: string, side: 'BUY' | 'SELL', qty: number, overrideBaseUrl?: string) {
  const { qty: qPrec } = await getSymbolPrecision(symbol, overrideBaseUrl);
  
  return binanceRequest('POST', '/fapi/v1/order', {
    symbol,
    side,
    type: 'MARKET',
    quantity: roundTo(qty, qPrec)
  }, overrideBaseUrl);
}

export async function placeStopMarket(symbol: string, side: 'BUY' | 'SELL', stopPrice: number, overrideBaseUrl?: string) {
  const { price: pPrec } = await getSymbolPrecision(symbol, overrideBaseUrl);
  
  return binanceRequest('POST', '/fapi/v1/algoOrder', {
    algoType: 'CONDITIONAL',
    symbol,
    side,
    type: 'STOP_MARKET',
    triggerPrice: roundTo(stopPrice, pPrec),
    closePosition: 'true'
  }, overrideBaseUrl);
}

export async function placeTakeProfitMarket(symbol: string, side: 'BUY' | 'SELL', stopPrice: number, qty?: number, overrideBaseUrl?: string) {
  const { price: pPrec, qty: qPrec } = await getSymbolPrecision(symbol, overrideBaseUrl);
  
  const params: any = {
    symbol,
    side,
    type: 'TAKE_PROFIT_MARKET',
    triggerPrice: roundTo(stopPrice, pPrec),
    algoType: 'CONDITIONAL'
  };

  if (qty) {
    params.quantity = roundTo(qty, qPrec);
    params.reduceOnly = 'true';
  } else {
    params.closePosition = 'true';
  }

  return binanceRequest('POST', '/fapi/v1/algoOrder', params, overrideBaseUrl);
}

export async function placeTrailingStopMarket(symbol: string, side: 'BUY' | 'SELL', callbackRatePct: number, activationPrice?: number, qty?: number, overrideBaseUrl?: string) {
  const { price: pPrec, qty: qPrec } = await getSymbolPrecision(symbol, overrideBaseUrl);
  
  const params: any = {
    symbol,
    side,
    type: 'TRAILING_STOP_MARKET',
    callbackRate: callbackRatePct.toString()
  };

  if (activationPrice) {
    params.activationPrice = roundTo(activationPrice, pPrec);
  }

  if (qty) {
    params.quantity = roundTo(qty, qPrec);
    params.reduceOnly = 'true';
  } else {
    params.closePosition = 'true';
  }

  return binanceRequest('POST', '/fapi/v1/order', params, overrideBaseUrl);
}
