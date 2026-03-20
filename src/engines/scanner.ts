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
import type { ModeConfig, SignalRow, MarketRow, MarketRegime, OrderFlowSnapshot, UnifiedTrace } from '../types/trading';
import { SPOT_API, FUTURES_API } from '../types/trading';
import { globalDebugLogs as sniperLogs } from './sniperEngine';

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
  pipelineSignals: SignalRow[];
  pipelineTraces: UnifiedTrace[];
  marketRows: MarketRow[];
  regimeLabel: string;
}> {
  const pipelineSignals: SignalRow[]   = [];
  const pipelineTraces: UnifiedTrace[] = [];
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
  // We do NOT return early here anymore because the UI needs the 24h tickers (Step 3) 
  // to populate `marketRows` and keep the WebSockets alive. We enforce the block inside the loop.
  // const corrLimit = getCorrelationPositionLimit(regime, btc4hTrend, openCount);
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

  // ─── REGIME GATE ─────────────────────────────────────────────
  // ─── STEP 3b: Populate Market Rows for UI Data Feed ─────────
  // We populate marketRows universally from tickers so the UI stays alive 
  // perfectly connecting websockets EVEN if signal generation gets blocked below.
  for (const sym of symbols) {
    if (tickers[sym] !== undefined) {
      marketRows.push({ symbol: sym, lastPrice: 0, changePct: tickers[sym] }); // WebSocket will update lastPrice immediately
    }
  }

  // ─── REGIME GATE ─────────────────────────────────────────────
  if (regime === 'CRASH' && activeMode.key !== 'AGGRESSIVE') {
    console.log('[Scanner] CRASH regime — scan blocked (non-aggressive mode)');
    return { pipelineSignals: [], pipelineTraces: [], marketRows, regimeLabel };
  }

  if (!corrLimit.allowNew) {
    console.log(`[Scanner] Correlation limiter (${corrLimit.reason}) — signal scanning bypassed, but UI feed active.`);
    return { pipelineSignals: [], pipelineTraces: [], marketRows, regimeLabel };
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

  function createTrace(symbol: string, engine: 'SNIPER'|'BREAKOUT', logs: string[], sig: any, now: number): UnifiedTrace {
    const logsStr = logs.join(' | ');
    let status: UnifiedTrace['status'] = 'REJECTED';
    let lastRejectReason = undefined;

    if (sig) {
      if (sig.entryType?.includes('PENDING') || sig.entryType?.includes('RETEST_FAILED')) status = 'PENDING';
      else status = 'ACCEPTED';
      
      if (sig.entryType === 'RETEST_FAILED' || sig.entryType === 'INVALIDATED') status = 'INVALIDATED';
      else if (sig.entryType === 'EXPIRED_NO_RETEST') status = 'EXPIRED';
    } else {
      for (let j = logs.length - 1; j >= 0; j--) {
        if (logs[j].includes('REJECT:')) {
          lastRejectReason = logs[j].split('REJECT:')[1].split('—')[0].split('-')[0].trim();
          break;
        }
      }
    }

    return {
      id: `${symbol}-${engine}-${now}`,
      symbol, engine, status,
      score: sig?.score,
      entryType: sig?.entryType,
      entryTiming: sig?.entryTiming,
      lastRejectReason,
      usedBreakingDownBypass: logsStr.includes('crash path') || logsStr.includes('BREAKING_DOWN'),
      usedBtcBypass: logsStr.includes('BTC uptrend gate bypassed'),
      usedLateException: logsStr.includes('crash-bypass late-entry exception'),
      timestamp: now
    };
  }

  type BatchCandidate = {
    symbol: string;
    sniperTrace: UnifiedTrace;
    breakoutTrace: UnifiedTrace;
    sniper?: { signal: any; price: number; change24h: number };
    breakout?: { signal: any; price: number; change24h: number };
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
        // marketRows is already populated pre-loop, just update the lastPrice if we have it
        const rowIdx = marketRows.findIndex(r => r.symbol === symbol);
        if (rowIdx >= 0 && lastClose > 0) marketRows[rowIdx].lastPrice = lastClose;
        const symbolFlow = orderFlowSnapshots?.[symbol];
        const sniperLogStart = sniperLogs.length;
        const sniper  = evaluateSniperSignal(tf1h, tf15m, activeMode, balance, regime, regimeScoreBonus, symbolFlow, btc4hTrend, regimeLabel, symbol);
        const currentSniperLogs = sniperLogs.slice(sniperLogStart).find(l => l[0]?.includes(symbol)) || (sniper?.debugLog || []);
        
        const breakout = evaluateBreakoutSignal(tf1h, tf15m, activeMode, balance, regime, regimeScoreBonus, symbolFlow, btc4hTrend, regimeLabel, symbol);
        const currentBreakoutLogs = breakout?.debugLog || []; // Only exports on accept unless we mod it.

        const now = Date.now();
        const sniperTrace = createTrace(symbol, 'SNIPER', currentSniperLogs, sniper, now);
        const breakoutTrace = createTrace(symbol, 'BREAKOUT', currentBreakoutLogs, breakout, now);

        return {
          symbol,
          sniperTrace,
          breakoutTrace,
          sniper:  sniper  ? { signal: sniper,  price: lastClose, change24h } : undefined,
          breakout: breakout ? { signal: breakout, price: lastClose, change24h } : undefined
        };
      })
    );

    // ── Evaluate candidates SEQUENTIALLY to enforce caps accurately ──
    for (const result of candidateResults) {
      if (result.status !== 'fulfilled') continue;
      const { symbol, sniper, breakout, sniperTrace, breakoutTrace } = result.value;

      pipelineTraces.push(sniperTrace);
      if (breakoutTrace.lastRejectReason || breakoutTrace.status !== 'REJECTED') {
         pipelineTraces.push(breakoutTrace);
      }

      if (sniper?.signal && newSignalsThisScan < corrLimit.maxNewPositions) {
        const check = checkPortfolioExposure(symbol, sniper.signal.side, regime as any, btc4hTrend, defaultPortfolio, signalsThisCycle);
        if (check.allowed) {
          const id = sniperTrace.id; // use unified ID
          pipelineSignals.push({ 
            symbol, signal: sniper.signal, price: sniper.price, 
            change24h: sniper.change24h, timestamp: sniperTrace.timestamp,
            id, status: 'ACCEPTED'
          });
          signalsThisCycle.add(symbol);
          newSignalsThisScan++;
        }
      }

      if (breakout?.signal && newSignalsThisScan < corrLimit.maxNewPositions) {
        const id = breakoutTrace.id;
        if (breakout.signal.entryType === 'RETEST_CONFIRMED') {
          const check = checkPortfolioExposure(symbol, breakout.signal.side, regime as any, btc4hTrend, defaultPortfolio, signalsThisCycle);
          if (check.allowed) {
             pipelineSignals.push({ 
              symbol, signal: breakout.signal, price: breakout.price, 
              change24h: breakout.change24h, timestamp: breakoutTrace.timestamp,
              id, status: 'ACCEPTED'
            });
            signalsThisCycle.add(symbol);
            newSignalsThisScan++;
          }
        } else if (breakout.signal.entryType === 'PENDING_BREAKOUT' || breakout.signal.entryType === 'INVALIDATED' || breakout.signal.entryType === 'EXPIRED_NO_RETEST') {
          // Push meaningful non-active states
          pipelineSignals.push({ 
            symbol, signal: breakout.signal, price: breakout.price, 
            change24h: breakout.change24h, timestamp: breakoutTrace.timestamp,
            id, status: breakoutTrace.status as any
          });
        }
      }
    }



    processed += chunk.length;
    onProgress?.(Math.round((processed / symbols.length) * 100));

    if (batch + BATCH_SIZE < symbols.length) await sleep(BATCH_DELAY);
  }

  pipelineSignals.sort((a, b) => b.signal.score - a.signal.score);
  marketRows.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));

  console.log(`[Scanner] Complete — Traces: ${pipelineTraces.length} | Tradeable: ${pipelineSignals.length} | Regime: ${regime}`);
  return { pipelineSignals, pipelineTraces, marketRows, regimeLabel };
}
