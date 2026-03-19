"use strict";
// ============================================
// Binance API Service
// ============================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchKlines = fetchKlines;
exports.fetchBinanceUSDTUniverse = fetchBinanceUSDTUniverse;
exports.fetchBinanceFuturesUSDTPerpUniverse = fetchBinanceFuturesUSDTPerpUniverse;
exports.initializeSymbolUniverse = initializeSymbolUniverse;
const trading_1 = require("../types/trading");
async function fetchKlines(symbol, interval, limit = 200) {
    const isMetal = trading_1.METAL_SYMBOLS.includes(symbol);
    const base = trading_1.FUTURES_API; // Use Futures API for all for better cloud consistency
    const path = isMetal ? '/fapi/v1/klines' : '/fapi/v1/klines';
    const url = `${base}${path}?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000); // 6 second timeout
    try {
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (!res.ok)
            throw new Error(`Klines fetch failed for ${symbol} [${interval}]`);
        const raw = await res.json();
        return raw.map((k) => ({
            openTime: k[0],
            open: parseFloat(k[1]),
            high: parseFloat(k[2]),
            low: parseFloat(k[3]),
            close: parseFloat(k[4]),
            volume: parseFloat(k[5]),
            closeTime: k[6]
        }));
    }
    catch (err) {
        clearTimeout(timeoutId);
        throw err;
    }
}
async function fetchBinanceUSDTUniverse() {
    const res = await fetch(`${trading_1.SPOT_API}/api/v3/exchangeInfo`);
    if (!res.ok)
        throw new Error('exchangeInfo fetch failed');
    const data = await res.json();
    const set = new Set();
    for (const s of (data.symbols || [])) {
        if (s.status !== 'TRADING')
            continue;
        if (s.quoteAsset !== 'USDT')
            continue;
        set.add(s.symbol);
    }
    return set;
}
async function fetchBinanceFuturesUSDTPerpUniverse() {
    try {
        const res = await fetch(`${trading_1.FUTURES_API}/fapi/v1/exchangeInfo`);
        if (!res.ok)
            throw new Error(`exchangeInfo ${res.status}`);
        const data = await res.json();
        const set = new Set((data.symbols || [])
            .filter((s) => s && s.status === 'TRADING' && s.quoteAsset === 'USDT' &&
            (s.contractType ? s.contractType === 'PERPETUAL' : true) &&
            typeof s.symbol === 'string' && s.symbol.endsWith('USDT'))
            .map((s) => s.symbol));
        return set;
    }
    catch (e) {
        console.warn('Futures exchangeInfo fetch failed:', e);
        return new Set();
    }
}
async function fetchCoinMarketCapTop200Tickers() {
    const url = 'https://api.coinmarketcap.com/data-api/v3/cryptocurrency/listing?start=1&limit=200&sort=market_cap&sort_dir=desc&convert=USD';
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok)
        throw new Error('CMC top-200 fetch failed');
    const data = await res.json();
    const list = data?.data?.cryptoCurrencyList || [];
    return list.map((x) => String(x.symbol || '').toUpperCase()).filter(Boolean);
}
async function fetchCoinGeckoTop200Tickers() {
    const url = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=200&page=1&sparkline=false';
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok)
        throw new Error('CoinGecko top-200 fetch failed');
    const data = await res.json();
    return (data || []).map((x) => String(x.symbol || '').toUpperCase()).filter(Boolean);
}
function buildSymbolListFromTickers(tickers, binanceSet) {
    const out = [];
    if (!tickers || !Array.isArray(tickers))
        return [];
    const seen = new Set();
    const banned = new Set(['USDT', 'USDC', 'DAI', 'TUSD', 'USDP', 'FDUSD', 'EUR', 'EURC']);
    for (const t of tickers) {
        if (!t || banned.has(t))
            continue;
        const sym = `${t}USDT`;
        if (!binanceSet.has(sym))
            continue;
        if (seen.has(sym))
            continue;
        seen.add(sym);
        out.push(sym);
        if (out.length >= 200)
            break;
    }
    for (const m of trading_1.METAL_SYMBOLS) {
        if (!seen.has(m))
            out.push(m);
    }
    if (out.length < 25)
        return [...trading_1.DEFAULT_SYMBOLS, ...trading_1.METAL_SYMBOLS];
    return out;
}
async function initializeSymbolUniverse() {
    try {
        const [spotSet, futuresSet] = await Promise.all([
            fetchBinanceUSDTUniverse(),
            fetchBinanceFuturesUSDTPerpUniverse()
        ]);
        let allowedSet = spotSet;
        if (futuresSet && futuresSet.size) {
            allowedSet = new Set([...spotSet].filter(s => futuresSet.has(s)));
            console.log('[Universe] Futures-perp symbols:', futuresSet.size, '| Allowed:', allowedSet.size);
        }
        let tickers = null;
        try {
            tickers = await fetchCoinMarketCapTop200Tickers();
            console.log('[Universe] Loaded Top-200 from CoinMarketCap:', tickers.length);
        }
        catch (e) {
            console.warn('[Universe] CMC failed; fallback CoinGecko:', e?.message);
            tickers = await fetchCoinGeckoTop200Tickers();
            console.log('[Universe] Loaded Top-200 from CoinGecko:', tickers.length);
        }
        const symbols = buildSymbolListFromTickers(tickers, allowedSet);
        console.log('[Universe] Final symbols:', symbols.length);
        return symbols;
    }
    catch (e) {
        console.warn('[Universe] Failed. Using defaults.', e?.message);
        return [...trading_1.DEFAULT_SYMBOLS, ...trading_1.METAL_SYMBOLS];
    }
}
