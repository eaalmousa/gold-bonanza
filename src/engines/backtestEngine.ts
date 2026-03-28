// ============================================
// Backtest Engine — Gold Bonanza
//
// Uses the REAL strategy registry, context builder,
// and BTC regime gate to simulate historical
// strategy performance.
//
// This is NOT a separate analysis system — it runs
// the same modular path as the live scanner.
//
// LIMITATIONS (V1):
// - Bar-by-bar simulation, not tick-by-tick
// - Entry assumed at signal.entryPrice
// - Fees/slippage deducted as flat percentages
// - No order book simulation
// - No partial fills
// ============================================

import type { Kline, ModeConfig, MarketRegime } from '../types/trading';
import { FUTURES_API } from '../types/trading';
import { buildStrategyContext } from './strategyContext';
import { globalRegistry, evaluateRegimeGate } from './strategyRegistry';
import { detectMarketRegime } from './regimeFilter';
import { initializeStrategies } from './strategyInit';

initializeStrategies();

// ─── TYPES ────────────────────────────────────────────────────────────────────

export interface BacktestConfig {
  strategyIds: string[];
  symbols: string[];
  lookbackDays: number;
  startingBalance: number;
  riskPct: number;
  leverage: number;
  feePct: number;          // per side (e.g. 0.04 = 0.04%)
  slippagePct: number;     // per side
  compounding: boolean;
  maxConcurrentTrades: number;
  modeKey: string;
  btcRegimeEnabled: boolean;
  breakoutOverrideEnabled: boolean;
  tp1RR: number;
  tp2RR: number;
  maxHoldBars: number;     // max candles before forced exit
}

export interface BacktestTrade {
  symbol: string;
  strategyId: string;
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  exitPrice: number;
  stopLoss: number;
  takeProfit: number;
  qty: number;
  pnl: number;
  pnlPct: number;
  feePaid: number;
  outcome: 'WIN' | 'LOSS' | 'TIMEOUT';
  entryBar: number;
  exitBar: number;
  holdBars: number;
  regime: string;
}

export interface BacktestResult {
  trades: BacktestTrade[];
  equity: { bar: number; balance: number; time: number }[];
  stats: BacktestStats;
  config: BacktestConfig;
  assumptions: string[];
}

export interface BacktestStats {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  timeoutTrades: number;
  winRate: number;
  lossRate: number;
  netPnl: number;
  grossProfit: number;
  grossLoss: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  startingBalance: number;
  endingBalance: number;
  returnPct: number;
  sharpeApprox: number;
}

// ─── DATA FETCHING ────────────────────────────────────────────────────────────

async function fetchKlinesPaginated(
  symbol: string, interval: string, totalCandles: number
): Promise<Kline[]> {
  const allKlines: Kline[] = [];
  const limit = 1500;
  const intervalMs: Record<string, number> = {
    '15m': 15 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '4h': 4 * 60 * 60 * 1000,
  };
  const candleMs = intervalMs[interval] || 60 * 60 * 1000;
  let endTime = Date.now();

  while (allKlines.length < totalCandles) {
    const remaining = totalCandles - allKlines.length;
    const fetchLimit = Math.min(remaining, limit);
    const startTime = endTime - (fetchLimit * candleMs);

    const url = `${FUTURES_API}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&startTime=${startTime}&endTime=${endTime}&limit=${fetchLimit}`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status}`);
      const raw = await res.json();
      if (!raw.length) break;

      const klines: Kline[] = raw.map((k: any) => ({
        openTime: k[0], open: parseFloat(k[1]), high: parseFloat(k[2]),
        low: parseFloat(k[3]), close: parseFloat(k[4]), volume: parseFloat(k[5]),
        closeTime: k[6]
      }));

      allKlines.unshift(...klines);
      endTime = klines[0].openTime - 1;
    } catch (e) {
      console.warn(`[Backtest] Fetch failed for ${symbol} ${interval}: ${e}`);
      break;
    }
  }

  return allKlines;
}

// ─── TRADE SIMULATION ─────────────────────────────────────────────────────────

function simulateTrade(
  klines15m: Kline[], entryBarIdx: number,
  side: 'LONG' | 'SHORT', entryPrice: number, stopLoss: number, takeProfit: number,
  qty: number, feePct: number, slippagePct: number, maxHoldBars: number
): { exitPrice: number; exitBar: number; outcome: 'WIN' | 'LOSS' | 'TIMEOUT'; feePaid: number } {
  const dir = side === 'LONG' ? 1 : -1;
  const entrySlippage = entryPrice * (slippagePct / 100) * dir;
  const actualEntry = entryPrice + entrySlippage;
  const entryFee = actualEntry * qty * (feePct / 100);

  for (let i = entryBarIdx + 1; i < Math.min(entryBarIdx + maxHoldBars, klines15m.length); i++) {
    const candle = klines15m[i];

    // ── CANDLE CONFLICT RULE ──────────────────────────────────────
    // If a single candle touches BOTH SL and TP, we must choose one.
    // Rule: SL is assumed to be hit first (pessimistic/conservative).
    // Rationale: in real markets, adverse moves tend to happen faster
    // than favorable ones (gap risk, liquidation cascades). This
    // avoids overfitting to optimistic backtest outcomes.
    // ──────────────────────────────────────────────────────────────

    const slHit = side === 'LONG' ? candle.low <= stopLoss : candle.high >= stopLoss;
    const tpHit = side === 'LONG' ? candle.high >= takeProfit : candle.low <= takeProfit;

    if (slHit && tpHit) {
      // Both touched on same candle — SL wins (conservative)
      const exitFee = stopLoss * qty * (feePct / 100);
      return { exitPrice: stopLoss, exitBar: i, outcome: 'LOSS', feePaid: entryFee + exitFee };
    }

    if (slHit) {
      const exitFee = stopLoss * qty * (feePct / 100);
      return { exitPrice: stopLoss, exitBar: i, outcome: 'LOSS', feePaid: entryFee + exitFee };
    }

    if (tpHit) {
      const exitFee = takeProfit * qty * (feePct / 100);
      return { exitPrice: takeProfit, exitBar: i, outcome: 'WIN', feePaid: entryFee + exitFee };
    }
  }

  // Timeout — close at last available price
  const lastBar = Math.min(entryBarIdx + maxHoldBars - 1, klines15m.length - 1);
  const exitPrice = klines15m[lastBar].close;
  const exitFee = exitPrice * qty * (feePct / 100);
  return { exitPrice, exitBar: lastBar, outcome: 'TIMEOUT', feePaid: entryFee + exitFee };
}

// ─── MAIN BACKTEST ────────────────────────────────────────────────────────────

export async function runBacktest(
  config: BacktestConfig,
  onProgress?: (pct: number, message: string) => void
): Promise<BacktestResult> {
  const { MODES } = await import('../types/trading');
  const activeMode = MODES[config.modeKey as keyof typeof MODES] || MODES.BALANCED;
  const modeProxy: ModeConfig = {
    ...activeMode,
    riskPct: config.riskPct / 100,
    ...({ tp1RR: config.tp1RR, tp2RR: config.tp2RR } as any)
  };

  const trades: BacktestTrade[] = [];
  const equity: { bar: number; balance: number; time: number }[] = [];
  let balance = config.startingBalance;
  let peakBalance = balance;
  let maxDrawdown = 0;
  let maxDrawdownPct = 0;

  equity.push({ bar: 0, balance, time: Date.now() - config.lookbackDays * 86400000 });

  // ── Phase 1: Fetch all data ──
  onProgress?.(5, 'Fetching BTC regime data...');
  const candlesPer15mDay = 96;
  const totalCandles15m = config.lookbackDays * candlesPer15mDay;
  const totalCandles1h = config.lookbackDays * 24;

  const [btc1h, btc4h] = await Promise.all([
    fetchKlinesPaginated('BTCUSDT', '1h', Math.max(totalCandles1h, 220)),
    fetchKlinesPaginated('BTCUSDT', '4h', Math.max(config.lookbackDays * 6, 100))
  ]);

  onProgress?.(15, `Fetching data for ${config.symbols.length} symbols...`);

  const symbolData: Record<string, { tf15m: Kline[]; tf1h: Kline[] }> = {};
  for (let i = 0; i < config.symbols.length; i++) {
    const sym = config.symbols[i];
    try {
      const [tf15m, tf1h] = await Promise.all([
        fetchKlinesPaginated(sym, '15m', totalCandles15m),
        fetchKlinesPaginated(sym, '1h', Math.max(totalCandles1h, 220))
      ]);
      symbolData[sym] = { tf15m, tf1h };
    } catch (e) {
      console.warn(`[Backtest] Skipping ${sym}: data fetch failed`);
    }
    onProgress?.(15 + Math.round((i / config.symbols.length) * 30), `Loaded ${sym}`);
  }

  // ── Phase 2: Walk through time ──
  onProgress?.(50, 'Running strategy evaluation...');

  // Evaluate every 4 candles (1 hour) on 15m data
  const evalStep = 4;
  const warmupBars = 220 * 4; // Need ~220 1h equivalent for context builder
  const openTrades: Map<string, { entryBar: number; side: 'LONG' | 'SHORT'; entryPrice: number; sl: number; tp: number; qty: number; strategyId: string; regime: string }> = new Map();
  let globalBarCounter = 0;

  // Find common data range
  const symKeys = Object.keys(symbolData);
  if (symKeys.length === 0) {
    return { trades, equity, stats: computeStats(trades, config.startingBalance, balance, maxDrawdown, maxDrawdownPct), config, assumptions: buildAssumptions(config) };
  }

  const firstSym = symKeys[0];
  const totalBars = symbolData[firstSym].tf15m.length;

  for (let bar = warmupBars; bar < totalBars - config.maxHoldBars; bar += evalStep) {
    globalBarCounter++;

    // Build BTC regime at this point in time
    const btc1hSlice = btc1h.filter(k => k.openTime <= symbolData[firstSym].tf15m[bar].openTime);
    const btc4hSlice = btc4h.filter(k => k.openTime <= symbolData[firstSym].tf15m[bar].openTime);

    let regime: MarketRegime = 'RANGING';
    let btc4hTrend: 'UP' | 'DOWN' | 'RANGING' = 'RANGING';
    let regimeScoreBonusLong = 0, regimeScoreBonusShort = 0;
    let regimeLabel = 'RANGING';
    let btcRsi: number | undefined;

    if (btc1hSlice.length >= 210) {
      const det = detectMarketRegime(btc1hSlice.slice(-220), btc4hSlice.length >= 50 ? btc4hSlice.slice(-100) : undefined);
      regime = det.regime;
      btc4hTrend = det.btc4hTrend;
      regimeScoreBonusLong = det.scoreBonusLong;
      regimeScoreBonusShort = det.scoreBonusShort;
      regimeLabel = `${det.regime}`;
      btcRsi = det.btcRsi;
    }

    const regimeGate = config.btcRegimeEnabled
      ? evaluateRegimeGate(regime, btc4hTrend, btcRsi, config.modeKey)
      : { regime, btc4hTrend, allowedSides: ['LONG' as const, 'SHORT' as const], strictness: 'NORMAL' as const, overrideAllowed: config.breakoutOverrideEnabled, overrideMinScore: 14, reason: 'Regime gate disabled' };

    // Check open trades for SL/TP hit
    for (const [sym, trade] of openTrades) {
      const symKlines = symbolData[sym]?.tf15m;
      if (!symKlines) continue;

      const result = simulateTrade(
        symKlines, trade.entryBar, trade.side, trade.entryPrice,
        trade.sl, trade.tp, trade.qty, config.feePct, config.slippagePct, bar - trade.entryBar
      );

      if (result.exitBar <= bar) {
        const dir = trade.side === 'LONG' ? 1 : -1;
        const rawPnl = (result.exitPrice - trade.entryPrice) * dir * trade.qty;
        const netPnl = rawPnl - result.feePaid;

        trades.push({
          symbol: sym, strategyId: trade.strategyId, side: trade.side,
          entryPrice: trade.entryPrice, exitPrice: result.exitPrice,
          stopLoss: trade.sl, takeProfit: trade.tp, qty: trade.qty,
          pnl: netPnl, pnlPct: (netPnl / balance) * 100, feePaid: result.feePaid,
          outcome: result.outcome, entryBar: trade.entryBar, exitBar: result.exitBar,
          holdBars: result.exitBar - trade.entryBar, regime: trade.regime
        });

        // Balance always updates — compounding means next trade sizes from new balance
        // (which happens naturally since balance is passed to buildStrategyContext)
        balance += netPnl;

        if (balance > peakBalance) peakBalance = balance;
        const dd = peakBalance - balance;
        if (dd > maxDrawdown) {
          maxDrawdown = dd;
          maxDrawdownPct = (dd / peakBalance) * 100;
        }

        const barTime = symKlines[result.exitBar]?.openTime || 0;
        equity.push({ bar: result.exitBar, balance, time: barTime });
        openTrades.delete(sym);
      }
    }

    // Evaluate strategies on each symbol
    for (const sym of symKeys) {
      if (openTrades.has(sym)) continue; // Already in a trade
      if (openTrades.size >= config.maxConcurrentTrades) break;
      if (balance <= 0) break;

      const data = symbolData[sym];
      if (!data || bar >= data.tf15m.length) continue;

      // Build sliced data windows
      const tf15mSlice = data.tf15m.slice(Math.max(0, bar - 110), bar + 1);
      const barTime = data.tf15m[bar].openTime;
      const tf1hSlice = data.tf1h.filter(k => k.openTime <= barTime).slice(-220);

      if (tf15mSlice.length < 90 || tf1hSlice.length < 210) continue;

      const ctx = buildStrategyContext(
        sym, tf15mSlice, tf1hSlice, modeProxy, balance,
        regime, btc4hTrend, regimeScoreBonusLong, regimeScoreBonusShort,
        regimeLabel, 0, undefined, btcRsi
      );
      if (!ctx) continue;

      const signals = globalRegistry.evaluateAll(ctx, config.strategyIds, regimeGate);

      for (const sig of signals) {
        if (sig.executionClass === 'WATCHLIST') continue;
        if (!sig.qty || sig.qty <= 0 || !sig.sizeUSDT || sig.sizeUSDT < 5) continue;

        openTrades.set(sym, {
          entryBar: bar, side: sig.side, entryPrice: sig.entryPrice,
          sl: sig.stopLoss, tp: sig.takeProfit, qty: sig.qty,
          strategyId: sig.strategyId, regime: regimeLabel
        });
        break; // One signal per symbol per eval step
      }
    }

    if (globalBarCounter % 100 === 0) {
      const pct = 50 + Math.round(((bar - warmupBars) / (totalBars - warmupBars - config.maxHoldBars)) * 45);
      onProgress?.(Math.min(pct, 95), `Evaluated ${globalBarCounter} bars | ${trades.length} trades`);
    }
  }

  // Close any remaining open trades at last price
  for (const [sym, trade] of openTrades) {
    const symKlines = symbolData[sym]?.tf15m;
    if (!symKlines) continue;
    const lastBar = symKlines.length - 1;
    const exitPrice = symKlines[lastBar].close;
    const dir = trade.side === 'LONG' ? 1 : -1;
    const fee = (trade.entryPrice + exitPrice) * trade.qty * (config.feePct / 100);
    const rawPnl = (exitPrice - trade.entryPrice) * dir * trade.qty;
    const netPnl = rawPnl - fee;
    balance += netPnl;

    trades.push({
      symbol: sym, strategyId: trade.strategyId, side: trade.side,
      entryPrice: trade.entryPrice, exitPrice, stopLoss: trade.sl,
      takeProfit: trade.tp, qty: trade.qty, pnl: netPnl,
      pnlPct: (netPnl / balance) * 100, feePaid: fee,
      outcome: 'TIMEOUT', entryBar: trade.entryBar, exitBar: lastBar,
      holdBars: lastBar - trade.entryBar, regime: trade.regime
    });
    equity.push({ bar: lastBar, balance, time: symKlines[lastBar]?.openTime || 0 });
  }

  onProgress?.(100, 'Backtest complete');
  return {
    trades, equity,
    stats: computeStats(trades, config.startingBalance, balance, maxDrawdown, maxDrawdownPct),
    config,
    assumptions: buildAssumptions(config)
  };
}

// ─── STATS COMPUTATION ────────────────────────────────────────────────────────

function computeStats(
  trades: BacktestTrade[], startBal: number, endBal: number,
  maxDD: number, maxDDPct: number
): BacktestStats {
  const wins = trades.filter(t => t.outcome === 'WIN');
  const losses = trades.filter(t => t.outcome === 'LOSS');
  const timeouts = trades.filter(t => t.outcome === 'TIMEOUT');
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const allPnls = trades.map(t => t.pnl);
  const avgReturn = allPnls.length ? allPnls.reduce((a, b) => a + b, 0) / allPnls.length : 0;
  const stdDev = allPnls.length > 1
    ? Math.sqrt(allPnls.reduce((s, p) => s + (p - avgReturn) ** 2, 0) / (allPnls.length - 1))
    : 1;

  return {
    totalTrades: trades.length,
    winningTrades: wins.length,
    losingTrades: losses.length,
    timeoutTrades: timeouts.length,
    winRate: trades.length ? (wins.length / trades.length) * 100 : 0,
    lossRate: trades.length ? (losses.length / trades.length) * 100 : 0,
    netPnl: endBal - startBal,
    grossProfit,
    grossLoss,
    avgWin: wins.length ? grossProfit / wins.length : 0,
    avgLoss: losses.length ? grossLoss / losses.length : 0,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    maxDrawdown: maxDD,
    maxDrawdownPct: maxDDPct,
    startingBalance: startBal,
    endingBalance: endBal,
    returnPct: ((endBal - startBal) / startBal) * 100,
    sharpeApprox: stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(trades.length) : 0,
  };
}

function buildAssumptions(config: BacktestConfig): string[] {
  return [
    `Lookback: ${config.lookbackDays} days`,
    `Symbols tested: ${config.symbols.length} (${config.symbols.slice(0, 5).join(', ')}${config.symbols.length > 5 ? '...' : ''})`,
    `Timeframes: 15m (entry signals), 1H (context/bias)`,
    `Evaluation: every 4×15m bars (1 hour intervals)`,
    `Entry: at strategy signal price on evaluation bar (not next-bar open)`,
    `Exit: fixed TP1/SL only — live exit engine NOT replicated`,
    `Candle conflict: if SL and TP both touched on same candle, SL wins (conservative)`,
    `Stop-loss: as computed by strategy engine per signal`,
    `Take-profit: TP1 at ${config.tp1RR}R (TP2 not simulated)`,
    `Trailing stop: NOT simulated`,
    `Fee: ${config.feePct}% per side (${(config.feePct * 2).toFixed(2)}% round trip)`,
    `Slippage: ${config.slippagePct}% per side (flat model, not orderbook-based)`,
    `Leverage: ${config.leverage}x (config only — PnL = notional × price move, not margin ROE)`,
    `Sizing: qty = (balance × ${config.riskPct}%) / stopDistance — leverage not in qty formula`,
    `Compounding: ${config.compounding ? 'ON — next trade sizes from updated balance' : 'OFF — balance still drifts with PnL'}`,
    `Max concurrent trades: ${config.maxConcurrentTrades}`,
    `Max hold: ${config.maxHoldBars} bars (${(config.maxHoldBars * 15 / 60).toFixed(0)}h) before forced exit at last close`,
    `BTC regime filter: ${config.btcRegimeEnabled ? 'ENABLED (same evaluateRegimeGate as live)' : 'DISABLED'}`,
    `Breakout override: ${config.breakoutOverrideEnabled ? 'ENABLED (same canOverrideBtcRegime check as live)' : 'DISABLED'}`,
    `Risk per trade: ${config.riskPct}%`,
    `Mode: ${config.modeKey}`,
    `⚠ This is a SIMULATED historical backtest, NOT live execution history`,
    `⚠ No partial fills, no orderbook depth, no funding rates`,
    `⚠ Live exit engine (trailing, partial TP, CE-based) is NOT replicated`,
  ];
}

// ─── DEFAULT CONFIG ───────────────────────────────────────────────────────────

export const DEFAULT_BACKTEST_CONFIG: BacktestConfig = {
  strategyIds: [],
  symbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'AVAXUSDT', 'LINKUSDT', 'ARBUSDT', 'OPUSDT', 'INJUSDT'],
  lookbackDays: 100,
  startingBalance: 1000,
  riskPct: 1.0,
  leverage: 5,
  feePct: 0.04,
  slippagePct: 0.02,
  compounding: false,
  maxConcurrentTrades: 3,
  modeKey: 'BALANCED',
  btcRegimeEnabled: true,
  breakoutOverrideEnabled: true,
  tp1RR: 1.5,
  tp2RR: 2.5,
  maxHoldBars: 48,
};
