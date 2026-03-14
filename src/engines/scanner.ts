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
  let newSignalsThisScan = 0;
  const signalsThisCycle = new Set<string>();
  const defaultPortfolio: PortfolioSnapshot = portfolio ?? {
    openPositions: [],
    currentScanCycleStart: Date.now()
  };

  for (let batch = 0; batch < symbols.length; batch += BATCH_SIZE) {
    // Respect correlation limit — stop adding signals once we've hit the ceiling
    if (newSignalsThisScan >= corrLimit.maxNewPositions) {
      console.log(`[Scanner] Correlation cap reached (${corrLimit.maxNewPositions}) — stopping early`);
      break;
    }

    const chunk = symbols.slice(batch, batch + BATCH_SIZE);

    await Promise.allSettled(
      chunk.map(async (symbol) => {
        try {
          const [tf1h, tf15m] = await Promise.all([
            fetchKlines(symbol, '1h', 220),
            fetchKlines(symbol, '15m', 110)
          ]);

          const lastClose  = tf15m?.length ? tf15m[tf15m.length - 1].close : 0;
          const change24h  = tickers[symbol] ?? 0;

          if (lastClose > 0) {
            marketRows.push({ symbol, lastPrice: lastClose, changePct: change24h });
          }

          const symbolFlow = orderFlowSnapshots?.[symbol];

          // ─── Sniper (pullback) ──────────────────────────
          const sniper = evaluateSniperSignal(
            tf1h, tf15m, activeMode, balance,
            regime, regimeScoreBonus, symbolFlow, btc4hTrend,
            regimeLabel, symbol
          );
          if (sniper) {
            // Portfolio exposure check
            const exposureCheck = checkPortfolioExposure(
              symbol, sniper.side, regime as any, btc4hTrend,
              defaultPortfolio, signalsThisCycle
            );
            if (!exposureCheck.allowed) {
              console.log(`[Portfolio] ${symbol} SNIPER blocked: ${exposureCheck.reason}`);
            } else {
              sniperSignals.push({ symbol, signal: sniper, price: lastClose, change24h, timestamp: Date.now() });
              signalsThisCycle.add(symbol);
              if (sniper.debugLog?.length) {
                console.log(`[Sniper ACCEPT] ${symbol} | ${sniper.entryType} | ${sniper.entryTiming} | score=${sniper.score} | zone dist=${sniper.zoneDistancePct}%`);
              }
              newSignalsThisScan++;
            }
          }

          // ─── Breakout (super sniper) ────────────────────
          const breakout = evaluateBreakoutSignal(
            tf1h, tf15m, activeMode, balance,
            regime, regimeScoreBonus, symbolFlow, btc4hTrend,
            regimeLabel, symbol
          );
          if (breakout) {
            const beCheck = checkPortfolioExposure(
              symbol, breakout.side, regime as any, btc4hTrend,
              defaultPortfolio, signalsThisCycle
            );
            if (!beCheck.allowed) {
              console.log(`[Portfolio] ${symbol} BREAKOUT blocked: ${beCheck.reason}`);
            } else {
              breakoutSignals.push({ symbol, signal: breakout, price: lastClose, change24h, timestamp: Date.now() });
              signalsThisCycle.add(symbol);
              console.log(`[Breakout ACCEPT] ${symbol} | ${breakout.entryTiming} | score=${breakout.score}`);
              newSignalsThisScan++;
            }
          }

        } catch (e) {
          // Skip failing symbols silently
        }
      })
    );

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
