// ============================================
// Scanner v4 — Strategy Registry Integration
// - Routes ALL strategy evaluation through the
//   StrategyRegistry instead of calling engines
//   directly.
// - BTC regime gating enforced via evaluateRegimeGate()
// - Breakout override logic enforced via registry
// - Strategy selection state controls which
//   strategies are evaluated
// - Normalized StrategySignals are converted to
//   existing Signal type via toCompatibleSignal()
//
// PRESERVED: portfolio risk, correlation limits,
// batching, trace generation, pipeline shape.
// ============================================

import { fetchKlines } from '../services/binanceApi';
import { detectMarketRegime, getCorrelationPositionLimit } from './regimeFilter';
import { checkPortfolioExposure, type PortfolioSnapshot } from './portfolioRisk';
import { buildStrategyContext } from './strategyContext';
import { globalRegistry, evaluateRegimeGate, toCompatibleSignal } from './strategyRegistry';
import type { StrategySignal } from './strategyRegistry';
import { initializeStrategies } from './strategyInit';
import type { ModeConfig, SignalRow, MarketRow, MarketRegime, OrderFlowSnapshot, UnifiedTrace } from '../types/trading';
import { SPOT_API, FUTURES_API } from '../types/trading';

// Ensure strategies are registered (idempotent)
initializeStrategies();

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
  portfolio?: PortfolioSnapshot,
  enabledStrategies?: string[]              // NEW: strategy selection from store
): Promise<{
  pipelineSignals: SignalRow[];
  pipelineTraces: UnifiedTrace[];
  marketRows: MarketRow[];
  regimeLabel: string;
}> {
  const pipelineSignals: SignalRow[]   = [];
  const pipelineTraces: UnifiedTrace[] = [];
  const marketRows: MarketRow[]      = [];
  const signalsThisCycle = new Set<string>();
  let processed = 0;
  let newSignalsThisScan = 0;

  // Resolve which strategies are active
  const activeStrategyIds = enabledStrategies ?? []; // empty = ALL

  // ─── STEP 1: Detect Market Regime using BTC ──────────────────
  let regime: MarketRegime = 'RANGING';
  let regimeScoreBonusLong  = 0;
  let regimeScoreBonusShort = 0;
  let btc4hTrend: 'UP' | 'DOWN' | 'RANGING' = 'RANGING';
  let regimeLabel          = 'RANGING';
  let btcRsi: number | undefined;

  try {
    const [btc1h, btc4h] = await Promise.all([
      fetchKlines('BTCUSDT', '1h', 220),
      fetchKlines('BTCUSDT', '4h', 100)
    ]);
    const detection   = detectMarketRegime(btc1h, btc4h);
    regime            = detection.regime;
    btc4hTrend        = detection.btc4hTrend;
    regimeScoreBonusLong  = detection.scoreBonusLong;
    regimeScoreBonusShort = detection.scoreBonusShort;
    regimeLabel       = `${detection.regime} (${detection.reason})`;
    btcRsi            = detection.btcRsi;
    onRegimeUpdate?.(regime, detection.reason);
    console.log(`[Scanner] Regime: ${regime} | BTC4H: ${btc4hTrend} | Bonus(L/S): ${regimeScoreBonusLong}/${regimeScoreBonusShort} | ${detection.reason}`);
  } catch (e: any) {
    console.warn('[Scanner] Regime detection failed:', e?.message);
  }

  // ─── STEP 2: BTC Regime Gate (global directional permission) ──
  const regimeGate = evaluateRegimeGate(regime, btc4hTrend, btcRsi, activeMode.key);
  console.log(`[Scanner:RegimeGate] ${regimeGate.reason} | Sides: [${regimeGate.allowedSides.join(',')}] | Strictness: ${regimeGate.strictness} | Override: ${regimeGate.overrideAllowed ? `yes (≥${regimeGate.overrideMinScore})` : 'no'}`);

  const openCount = currentOpenPositionCount ?? 0;
  const corrLimit = getCorrelationPositionLimit(regime, btc4hTrend, openCount, activeMode.key);
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
    } catch {
      console.warn('[Scanner] Failed to fetch 24h tickers');
    }
  }

  if (Object.keys(tickers).length === 0) {
    console.log('[Scanner] No tickers loaded, returning empty pipeline signals');
    return { pipelineSignals: [], pipelineTraces: [], marketRows: [], regimeLabel };
  }

  for (const sym of symbols) {
    if (tickers[sym] !== undefined) {
      marketRows.push({ symbol: sym, lastPrice: 0, changePct: tickers[sym] }); 
    }
  }

  if (regime === 'CRASH' && activeMode.key !== 'AGGRESSIVE') {
    console.log('[Scanner] CRASH regime — scan blocked (non-aggressive mode)');
    return { pipelineSignals: [], pipelineTraces: [], marketRows, regimeLabel };
  }

  const defaultPortfolio: PortfolioSnapshot = portfolio ?? {
    openPositions: [],
    currentScanCycleStart: Date.now()
  };

  // Log which strategies are active this scan
  const activeEngines = globalRegistry.getEnabled(activeStrategyIds);
  console.log(`[Scanner] Active strategies: [${activeEngines.map(e => e.id).join(', ')}] (${activeEngines.length}/${globalRegistry.getAll().length})`);

  // ─── STEP 4: Scan symbols in batches via Strategy Registry ───
  for (let batch = 0; batch < symbols.length; batch += BATCH_SIZE) {
    if (newSignalsThisScan >= corrLimit.maxNewPositions) {
      console.log(`[Scanner] Correlation cap reached (${corrLimit.maxNewPositions}) — stopping early`);
      break;
    }

    const chunk = symbols.slice(batch, batch + BATCH_SIZE);

    const candidateResults = await Promise.allSettled(
      chunk.map(async (symbol) => {
        const now = Date.now();
        try {
          const [tf1h, tf15m] = await Promise.all([
            fetchKlines(symbol, '1h', 220),
            fetchKlines(symbol, '15m', 110)
          ]);
          const lastClose = tf15m?.length ? tf15m[tf15m.length - 1].close : 0;
          const change24h = tickers[symbol] ?? 0;
          
          const rowIdx = marketRows.findIndex(r => r.symbol === symbol);
          if (rowIdx >= 0 && lastClose > 0) marketRows[rowIdx].lastPrice = lastClose;

          const symbolFlow = orderFlowSnapshots?.[symbol];

          // ── Build shared context ONCE for this symbol ──
          const ctx = buildStrategyContext(
            symbol, tf15m, tf1h, activeMode, balance,
            regime, btc4hTrend,
            regimeScoreBonusLong, regimeScoreBonusShort,
            regimeLabel, change24h, symbolFlow, btcRsi
          );

          if (!ctx) {
            return {
              symbol,
              traces: [{
                id: `${symbol}-CTX-FAIL-${now}`, symbol,
                engine: 'SNIPER' as const, status: 'INVALIDATED' as const,
                lastRejectReason: 'Insufficient data for context',
                timestamp: now
              }] as UnifiedTrace[],
              signals: [] as StrategySignal[]
            };
          }

          // ── Run ALL enabled strategies via registry ──
          const strategySignals = globalRegistry.evaluateAll(ctx, activeStrategyIds, regimeGate);

          // ── Build traces for every strategy that ran ──
          const traces: UnifiedTrace[] = [];
          for (const engine of activeEngines) {
            const matched = strategySignals.find(s => s.strategyId === engine.id);
            traces.push({
              id: `${symbol}-${engine.id}-${now}`,
              symbol,
              engine: matched?.kind || (engine.category === 'BREAKOUT' ? 'SUPER_SNIPER' : 'SNIPER') as UnifiedTrace['engine'],
              status: matched ? 'ACCEPTED' : 'REJECTED',
              score: matched?.score,
              entryType: matched?.entryType,
              entryTiming: matched?.entryTiming,
              lastRejectReason: !matched 
                ? (strategySignals.length === 0 ? 'No setup detected' : undefined) 
                : undefined,
              usedBreakingDownBypass: matched?.debugLog?.some(l => l.includes('BREAKING_DOWN')) || false,
              usedBtcBypass: matched?.regimeAlignment === 'COUNTER_REGIME_OVERRIDE',
              usedLateException: matched?.debugLog?.some(l => l.includes('late-entry')) || false,
              timestamp: now
            });
          }

          return { symbol, traces, signals: strategySignals };

        } catch (e: any) {
          return {
            symbol,
            traces: [{
              id: `${symbol}-FAIL-${now}`, symbol,
              engine: 'SNIPER' as const, status: 'INVALIDATED' as const,
              lastRejectReason: `KLINE_FETCH_FAILED: ${e.message}`,
              timestamp: now
            }] as UnifiedTrace[],
            signals: [] as StrategySignal[]
          };
        }
      })
    );

    for (const result of candidateResults) {
      if (result.status !== 'fulfilled') continue;
      const { symbol, traces, signals } = result.value;

      // Push all traces
      for (const trace of traces) {
        pipelineTraces.push(trace);
      }

      // Process accepted signals through the existing pipeline
      for (const stratSig of signals) {
        if (newSignalsThisScan >= corrLimit.maxNewPositions) break;

        // ── Regime gate enforcement ──
        // WATCHLIST signals (blocked by regime, can't override) are still emitted
        // but marked as non-executable so the UI can show them
        const isExecutable = stratSig.executionClass !== 'WATCHLIST';

        // For breakout-type signals, require RETEST_CONFIRMED for immediate execution
        // (preserving original breakout retest logic)
        const isBreakoutPending = stratSig.kind === 'SUPER_SNIPER' && 
          (stratSig.entryType === 'PENDING_BREAKOUT' || 
           stratSig.entryType === 'INVALIDATED' || 
           stratSig.entryType === 'EXPIRED_NO_RETEST');

        if (isBreakoutPending) {
          // Emit as pending/invalidated/expired (non-actionable)
          const traceId = `${symbol}-${stratSig.strategyId}-${Date.now()}`;
          const compatSignal = toCompatibleSignal(stratSig);
          pipelineSignals.push({
            symbol, signal: compatSignal,
            price: stratSig.entryPrice,
            change24h: stratSig.debugLog ? 0 : 0,
            timestamp: Date.now(),
            id: traceId,
            status: stratSig.entryType === 'PENDING_BREAKOUT' ? 'PENDING' :
                    stratSig.entryType === 'INVALIDATED' ? 'INVALIDATED' : 'EXPIRED'
          });
          continue;
        }

        if (!isExecutable) {
          // Still push as trace for visibility, but don't count toward signals
          continue;
        }

        // ── Portfolio exposure check (preserved from original) ──
        const check = checkPortfolioExposure(
          symbol, stratSig.side, regime as any, btc4hTrend,
          defaultPortfolio, signalsThisCycle
        );

        if (check.allowed) {
          const compatSignal = toCompatibleSignal(stratSig);
          const traceId = traces.find(t => t.symbol === symbol && t.status === 'ACCEPTED')?.id 
                          || `${symbol}-${stratSig.strategyId}-${Date.now()}`;

          pipelineSignals.push({
            symbol, signal: compatSignal,
            price: stratSig.entryPrice,
            change24h: tickers[symbol] ?? 0,
            timestamp: Date.now(),
            id: traceId,
            status: 'ACCEPTED'
          });
          signalsThisCycle.add(symbol);
          newSignalsThisScan++;
        }
      }
    }

    processed += chunk.length;
    onProgress?.(Math.round((processed / symbols.length) * 100));
    if (batch + BATCH_SIZE < symbols.length) await sleep(BATCH_DELAY);
  }

  pipelineSignals.sort((a, b) => b.signal.score - a.signal.score);
  marketRows.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
  console.log(`[Scanner] Complete — Traces: ${pipelineTraces.length} | Tradeable: ${pipelineSignals.length} | Regime: ${regime} | Strategies: ${activeEngines.length}`);
  
  return { pipelineSignals, pipelineTraces, marketRows, regimeLabel };
}
