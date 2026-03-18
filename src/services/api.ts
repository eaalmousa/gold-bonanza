let token = localStorage.getItem('gb_token') || '';

export const API_URL = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL)
  || 'http://localhost:3001/api';

export function setToken(t: string) {
  token = t;
  localStorage.setItem('gb_token', t);
}

export function getToken() {
  return token;
}

export async function apiRequest(endpoint: string, options: RequestInit = {}) {
  // Clean up potential double slashes and ensure /api prefix
  let baseUrl = API_URL.endsWith('/') ? API_URL.slice(0, -1) : API_URL;
  
  // If the user forgot to add /api to the environment variable, add it automatically
  if (!baseUrl.endsWith('/api') && !endpoint.startsWith('/api')) {
    baseUrl += '/api';
  }

  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const fullUrl = `${baseUrl}${cleanEndpoint}`;

  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...options.headers,
  } as any;

  try {
    const res = await fetch(fullUrl, {
      ...options,
      headers,
    });

    const data = await res.json();
    if (!res.ok) {
      if (res.status === 401) {
        token = '';
        localStorage.removeItem('gb_token');
      }
      throw new Error(data.error || 'API Request failed');
    }
    return data;
  } catch (err: any) {
    if (err.name === 'TypeError' && err.message === 'Failed to fetch') {
      throw new Error(`Connection Error: Cannot reach ${baseUrl}. Check your Vercel Environment Variables.`);
    }
    throw err;
  }
}

export const api = {
  login: (password: string) => apiRequest('/auth/login', { method: 'POST', body: JSON.stringify({ password }) }),
  openTrade: (symbol: string, side: string, entryPrice: number, stopLoss: number, takeProfit: number) => 
    apiRequest('/trade/open', { method: 'POST', body: JSON.stringify({ symbol, side, entryPrice, stopLoss, takeProfit }) }),
  getPositions: () => apiRequest('/trade/positions'),
  getBalance: () => apiRequest('/trade/balance'),
  closeTrade: (symbol: string, side: string, qty: number) => apiRequest('/trade/close', { method: 'POST', body: JSON.stringify({ symbol, side, qty }) }),
  toggleAutoTrade: (enabled: boolean) => apiRequest('/trade/autotrade/toggle', { method: 'POST', body: JSON.stringify({ enabled }) }),
  getAutoTradeStatus: () => apiRequest('/trade/autotrade/status'),
  getAutoTradeConfig: () => apiRequest('/trade/autotrade/config'),
  updateAutoTradeConfig: (config: { riskPerTrade?: number; maxConcurrent?: number; leverage?: number; slEnabled?: boolean; tpEnabled?: boolean; tp1Only?: boolean; tp1RR?: number; tp2RR?: number; minScore?: number; btcGateEnabled?: boolean; trailTpEnabled?: boolean }) => 
    apiRequest('/trade/autotrade/config', { method: 'POST', body: JSON.stringify(config) }),
};
