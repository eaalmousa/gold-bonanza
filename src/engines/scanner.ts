// ============================================
// Scanner v3 — Main Scan Loop
// - Passes btcRegimeLabel + symbol to engines
// - Market correlation limiter via getCorrelationPositionLimit()
// - Portfolio risk / same-wave filter via portfolioRisk
// - CHOP regime exits early
// ============================================

import { fetchKlines } from '../services/binanceApi';
import { evaluateSniperSignal } from './sniperEngine';
import { evaluateBreakoutSignal } from './breakoutEngine';
import { detectMarketRegime, getCorrelationPositionLimit } from './regimeFilter';
import { checkPortfolioExposure, type PortfolioSnapshot } from './portfolioRisk';
import type { ModeConfig, SignalRow, MarketRow, MarketRegime, OrderFlowSnapshot } from '../types/trading';
import { SPOT_API, FUTURES_API } from '../types/trading';

const BATCH_SIZE = 8;
const BATCH_DELAY = 400;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function runBonanzaCore(
  symbols: string[],
  activeMode: ModeConfig,
  balance: number,
  onProgress?: (pct: number) => void,
  orderFlowSnapshots?: Record<string, OrderFlowSnapshot>,
  onRegimeUpdate?: (regime: MarketRegime, reason: string) => void,
  currentOpenPositionCount?: number,
  portfolio?: PortfolioSnapshot        // For portfolio risk checks
): Promise<{
  sniperSignals: SignalRow[];
  breakoutSignals: SignalRow[];
  marketRows: MarketRow[];
  regimeLabel: string;
}> {
  const sniperSignals: SignalRow[]   = [];
  const breakoutSignals: SignalRow[] = [];
  const marketRows: MarketRow[]      = [];
  let processed = 0;

  // ─── STEP 1: Detect Market Regime using BTC ──────────────────
  let regime: MarketRegime = 'RANGING';
  let regimeScoreBonus     = 0;
  let btc4hTrend: 'UP' | 'DOWN' | 'RANGING' = 'RANGING';
  let regimeLabel          = 'RANGING';

  try {
    const [btc1h, btc4h] = await Promise.all([
      fetchKlines('BTCUSDT', '1h', 220),
      fetchKlines('BTCUSDT', '4h', 100)
    ]);
    const detection   = detectMarketRegime(btc1h, btc4h);
    regime            = detection.regime;
    btc4hTrend        = detection.btc4hTrend;
    regimeScoreBonus  = detection.scoreBonus;
    regimeLabel       = `${detection.regime} (${detection.reason})`;
    onRegimeUpdate?.(regime, detection.reason);
    console.log(`[Scanner] Regime: ${regime} | BTC4H: ${btc4hTrend} | Bonus: ${regimeScoreBonus} | ${detection.reason}`);
  } catch (e: any) {
    console.warn('[Scanner] Regime detection failed:', e?.message);
  }

  // ─── STEP 2: Market-Correlation Limiter (User Request 3) ─────
  const openCount = currentOpenPositionCount ?? 0;
  const corrLimit = getCorrelationPositionLimit(regime, btc4hTrend, openCount);
  if (!corrLimit.allowNew) {
    console.log(`[Correlation Limiter] ${corrLimit.reason} — scan skipped`);
    return { sniperSignals: [], breakoutSignals: [], marketRows: [], regimeLabel };
  }
  console.log(`[Correlation Limiter] ${corrLimit.reason} | Max new: ${corrLimit.maxNewPositions}`);

  // ─── STEP 3: Fetch 24h tickers ───────────────────────────────
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
      for (const t of data) tickers[t.symbol] = parseFloat(t.priceChangePercent) || 0;
    }
  } catch {
    try {
      const res = await fetchWithTimeout(`${FUTURES_API}/fapi/v1/ticker/24hr`, 5000);
      if (res.ok) {
        const data = await res.json();
        for (const t of data) tickers[t.symbol] = parseFloat(t.priceChangePercent) || 0;
      }
    } catch { /* continue */ }
  }

  // ─── REGIME GATE ─────────────────────────────────────────────
  if (regime === 'CRASH' && activeMode.key !== 'AGGRESSIVE') {
    console.log('[Scanner] CRASH regime — scan blocked (non-aggressive mode)');
    return { sniperSignals: [], breakoutSignals: [], marketRows: [], regimeLabel };
  }

  // ─── STEP 4: Scan symbols in batches ─────────────────────────
  // IMPORTANT: Promise.allSettled runs all batch items in parallel.
  // signalsThisCycle and newSignalsThisScan CANNOT be checked reliably
  // inside the parallel callbacks — doing so creates a race condition where
  // multiple signals pass before any counter is updated.
  //
  // FIX: Each batch callback collects a "candidate" result. After the batch
  // settles, we evaluate candidates sequentially to enforce caps correctly.
  let newSignalsThisScan = 0;
  const signalsThisCycle = new Set<string>();
  const defaultPortfolio: PortfolioSnapshot = portfolio ?? {
    openPositions: [],
    currentScanCycleStart: Date.now()
  };

  type BatchCandidate = {
    symbol: string;
    sniper?: { signal: ReturnType<typeof evaluateSniperSignal>; price: number; change24h: number };
    breakout?: { signal: ReturnType<typeof evaluateBreakoutSignal>; price: number; change24h: number };
  };

  for (let batch = 0; batch < symbols.length; batch += BATCH_SIZE) {
    // Check cap BEFORE starting each batch
    if (newSignalsThisScan >= corrLimit.maxNewPositions) {
      console.log(`[Scanner] Correlation cap reached (${corrLimit.maxNewPositions}) — stopping early`);
      break;
    }

    const chunk = symbols.slice(batch, batch + BATCH_SIZE);

    // ── Collect candidates in parallel (no counters touched here) ──
    const candidateResults = await Promise.allSettled(
      chunk.map(async (symbol): Promise<BatchCandidate> => {
        const [tf1h, tf15m] = await Promise.all([
          fetchKlines(symbol, '1h', 220),
          fetchKlines(symbol, '15m', 110)
        ]);
        const lastClose = tf15m?.length ? tf15m[tf15m.length - 1].close : 0;
        const change24h = tickers[symbol] ?? 0;
        if (lastClose > 0) marketRows.push({ symbol, lastPrice: lastClose, changePct: change24h });
        const symbolFlow = orderFlowSnapshots?.[symbol];
        const sniper  = evaluateSniperSignal(tf1h, tf15m, activeMode, balance, regime, regimeScoreBonus, symbolFlow, btc4hTrend, regimeLabel, symbol);
        const breakout = evaluateBreakoutSignal(tf1h, tf15m, activeMode, balance, regime, regimeScoreBonus, symbolFlow, btc4hTrend, regimeLabel, symbol);
        return {
          symbol,
          sniper:  sniper  ? { signal: sniper,  price: lastClose, change24h } : undefined,
          breakout: breakout ? { signal: breakout, price: lastClose, change24h } : undefined
        };
      })
    );

    // ── Evaluate candidates SEQUENTIALLY to enforce caps accurately ──
    for (const result of candidateResults) {
      if (result.status !== 'fulfilled') continue;
      const { symbol, sniper, breakout } = result.value;

      if (sniper?.signal && newSignalsThisScan < corrLimit.maxNewPositions) {
        const check = checkPortfolioExposure(symbol, sniper.signal.side, regime as any, btc4hTrend, defaultPortfolio, signalsThisCycle);
        if (check.allowed) {
          const now = Date.now();
          // Window ID to 10 minutes to maintain stability during a trend move
          const windowId = Math.floor(now / 600000); 
          const id = `${symbol}-SNIPER-${windowId}`;
          sniperSignals.push({ 
            symbol, signal: sniper.signal, price: sniper.price, 
            change24h: sniper.change24h, timestamp: now,
            id, status: 'DETECTED'
          });
          signalsThisCycle.add(symbol);
          newSignalsThisScan++;
          if (sniper.signal.debugLog?.length) {
            console.log(`[Sniper✅] ${symbol} | ${sniper.signal.entryType} | ${sniper.signal.entryTiming} | score=${sniper.signal.score} | id=${id}`);
          }
        } else {
          console.log(`[Portfolio🚫] ${symbol} sniper: ${check.reason}`);
        }
      }

      if (breakout?.signal && newSignalsThisScan < corrLimit.maxNewPositions) {
        if (breakout.signal.entryType === 'RETEST_CONFIRMED') {
          const check = checkPortfolioExposure(symbol, breakout.signal.side, regime as any, btc4hTrend, defaultPortfolio, signalsThisCycle);
          if (check.allowed) {
            const now = Date.now();
            const windowId = Math.floor(now / 600000);
            const id = `${symbol}-BREAKOUT-${windowId}`;
            breakoutSignals.push({ 
              symbol, signal: breakout.signal, price: breakout.price, 
              change24h: breakout.change24h, timestamp: now,
              id, status: 'DETECTED'
            });
            signalsThisCycle.add(symbol);
            newSignalsThisScan++;
            console.log(`[Breakout✅] ${symbol} | RETEST CONFIRMED | score=${breakout.signal.score} | id=${id}`);
          } else {
            console.log(`[Portfolio🚫] ${symbol} breakout: ${check.reason}`);
          }
        } else {
          // It's just a PENDING or INVALIDATED state from the retest engine, log it dynamically
          if (breakout.signal.entryType === 'PENDING_BREAKOUT') {
            console.log(`[Breakout⏳] ${symbol} Pending Breakout detected. Waiting for retest.`);
          }
        }
      }
    }



    processed += chunk.length;
    onProgress?.(Math.round((processed / symbols.length) * 100));

    if (batch + BATCH_SIZE < symbols.length) await sleep(BATCH_DELAY);
  }

  // Sort by score
  sniperSignals.sort((a, b) => b.signal.score - a.signal.score);
  breakoutSignals.sort((a, b) => b.signal.score - a.signal.score);
  marketRows.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));

  console.log(`[Scanner] Complete — Snipers: ${sniperSignals.length} | Breakouts: ${breakoutSignals.length} | Regime: ${regime}`);
  return { sniperSignals, breakoutSignals, marketRows, regimeLabel };
}
