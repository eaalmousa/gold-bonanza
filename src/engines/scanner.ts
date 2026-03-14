// ============================================
// Scanner v2 — Main Scan Loop
// Now passes regime + order flow to engines.
// ============================================

import { fetchKlines } from '../services/binanceApi';
import { evaluateSniperSignal } from './sniperEngine';
import { evaluateBreakoutSignal } from './breakoutEngine';
import { detectMarketRegime } from './regimeFilter';
import type { ModeConfig, SignalRow, MarketRow, MarketRegime, OrderFlowSnapshot } from '../types/trading';
import { SPOT_API, FUTURES_API } from '../types/trading';

const BATCH_SIZE = 8;
const BATCH_DELAY = 400; // ms between batches
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function runBonanzaCore(
  symbols: string[],
  activeMode: ModeConfig,
  balance: number,
  onProgress?: (pct: number) => void,
  orderFlowSnapshots?: Record<string, OrderFlowSnapshot>,
  onRegimeUpdate?: (regime: MarketRegime, reason: string) => void
): Promise<{
  sniperSignals: SignalRow[];
  breakoutSignals: SignalRow[];
  marketRows: MarketRow[];
}> {
  const sniperSignals: SignalRow[] = [];
  const breakoutSignals: SignalRow[] = [];
  const marketRows: MarketRow[] = [];
  let processed = 0;

  // ─── STEP 1: Detect Market Regime using BTC ────
  let regime: MarketRegime = 'RANGING';
  let regimeScoreBonus = 0;
  let btc4hTrend: 'UP' | 'DOWN' | 'RANGING' = 'RANGING';
  try {
    const [btc1h, btc4h] = await Promise.all([
      fetchKlines('BTCUSDT', '1h', 220),
      fetchKlines('BTCUSDT', '4h', 100)
    ]);
    const detection = detectMarketRegime(btc1h, btc4h);
    regime = detection.regime;
    btc4hTrend = detection.btc4hTrend;
    regimeScoreBonus = detection.scoreBonus;
    onRegimeUpdate?.(regime, detection.reason);
    console.log(`[Scanner] Market regime: ${regime} (${detection.reason}), BTC 4H Trend: ${btc4hTrend}, score bonus: ${regimeScoreBonus}`);
  } catch (e: any) {
    console.warn('[Scanner] Regime detection failed, defaulting to RANGING:', e?.message);
  }

  // ─── STEP 2: Fetch 24h tickers for change% ────
  let tickers: Record<string, number> = {};
  
  const fetchWithTimeout = async (url: string, ms = 5000) => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), ms);
    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(id);
      return response;
    } catch (err) {
      clearTimeout(id);
      throw err;
    }
  };

  try {
    const res = await fetchWithTimeout(`${SPOT_API}/api/v3/ticker/24hr`, 5000);
    if (res.ok) {
      const data = await res.json();
      for (const t of data) {
        tickers[t.symbol] = parseFloat(t.priceChangePercent) || 0;
      }
    }
  } catch {
    // Fall back to futures tickers
    try {
      const res = await fetchWithTimeout(`${FUTURES_API}/fapi/v1/ticker/24hr`, 5000);
      if (res.ok) {
        const data = await res.json();
        for (const t of data) {
          tickers[t.symbol] = parseFloat(t.priceChangePercent) || 0;
        }
      }
    } catch { /* continue anyway */ }
  }

  // ─── REGIME GATE ────────────────────────────────
  if (regime === 'CRASH' && activeMode.key !== 'AGGRESSIVE') {
    console.log(`[Scanner] Skipping scan due to CRASH regime and non-AGGRESSIVE mode (${activeMode.key}).`);
    return { sniperSignals: [], breakoutSignals: [], marketRows: [] };
  }

  // ─── STEP 3: Scan all symbols in batches ───────
  for (let batch = 0; batch < symbols.length; batch += BATCH_SIZE) {
    const chunk = symbols.slice(batch, batch + BATCH_SIZE);

    await Promise.allSettled(
      chunk.map(async (symbol) => {
        try {
          const [tf1h, tf15m] = await Promise.all([
            fetchKlines(symbol, '1h', 220),
            fetchKlines(symbol, '15m', 110)
          ]);

          const lastClose = tf15m?.length ? tf15m[tf15m.length - 1].close : 0;
          const change24h = tickers[symbol] ?? 0;

          if (lastClose > 0) {
            marketRows.push({
              symbol,
              lastPrice: lastClose,
              changePct: change24h
            });
          }

          // Get order flow for this symbol (if available)
          const symbolFlow = orderFlowSnapshots?.[symbol];

          // Evaluate sniper (pullback)
          const sniper = evaluateSniperSignal(
            tf1h, tf15m, activeMode, balance,
            regime, regimeScoreBonus, symbolFlow, btc4hTrend
          );
          if (sniper) {
            sniperSignals.push({ symbol, signal: sniper, price: lastClose, change24h, timestamp: Date.now() });
          }

          // Evaluate breakout (super sniper)
          const breakout = evaluateBreakoutSignal(
            tf1h, tf15m, activeMode, balance,
            regime, regimeScoreBonus, symbolFlow, btc4hTrend
          );
          if (breakout) {
            breakoutSignals.push({ symbol, signal: breakout, price: lastClose, change24h, timestamp: Date.now() });
          }
        } catch (e) {
          // Skip symbols that fail
        }
      })
    );

    processed += chunk.length;
    onProgress?.(Math.round((processed / symbols.length) * 100));
    
    console.log(`[Scanner] Batch processed. Total processed: ${processed}/${symbols.length}. Sniper total: ${sniperSignals.length}. Breakout total: ${breakoutSignals.length}`);

    if (batch + BATCH_SIZE < symbols.length) {
      await sleep(BATCH_DELAY);
    }
  }

  // Sort market rows by absolute change
  marketRows.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));

  // Sort signals by score
  sniperSignals.sort((a, b) => b.signal.score - a.signal.score);
  breakoutSignals.sort((a, b) => b.signal.score - a.signal.score);

  return { sniperSignals, breakoutSignals, marketRows };
}
