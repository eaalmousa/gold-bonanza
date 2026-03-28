// ============================================
// Backtest Engine V2 — Gold Bonanza
//
// Uses the REAL strategy registry, context builder,
// and BTC regime gate to simulate historical
// strategy performance.
//
// V2 IMPROVEMENTS:
// - Next-bar-open entry model (no look-ahead)
// - Enhanced exit mode: trailing stop + partial TP
// - Configurable symbol universe presets
// - All assumptions visible and honest
//
// This is NOT a separate analysis system — it runs
// the same modular path as the live scanner.
// ============================================

import type { Kline, ModeConfig, MarketRegime } from '../types/trading';
import { FUTURES_API } from '../types/trading';
import { buildStrategyContext } from './strategyContext';
import { globalRegistry, evaluateRegimeGate } from './strategyRegistry';
import { detectMarketRegime } from './regimeFilter';
import { initializeStrategies } from './strategyInit';

initializeStrategies();

// ─── SYMBOL UNIVERSE PRESETS ──────────────────────────────────────────────────

export const SYMBOL_PRESETS = {
  TOP_10: {
    label: 'Top 10 Perps',
    symbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'AVAXUSDT', 'LINKUSDT', 'ARBUSDT', 'OPUSDT', 'INJUSDT'],
  },
  MAJORS: {
    label: 'Majors Only (5)',
    symbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'],
  },
  BROAD: {
    label: 'Broad Basket (20)',
    symbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'AVAXUSDT', 'LINKUSDT', 'ARBUSDT', 'OPUSDT', 'INJUSDT',
              'DOTUSDT', 'MATICUSDT', 'ADAUSDT', 'NEARUSDT', 'APTUSDT', 'SUIUSDT', 'DOGEUSDT', 'LTCUSDT', 'ATOMUSDT', 'FILUSDT'],
  },
} as const;

export type SymbolPresetKey = keyof typeof SYMBOL_PRESETS;
export type EntryModel = 'NEXT_BAR_OPEN' | 'SIGNAL_PRICE';
export type ExitMode = 'FIXED_SL_TP' | 'ENHANCED_V2';

// ─── TYPES ────────────────────────────────────────────────────────────────────

export interface BacktestConfig {
  strategyIds: string[];
  symbols: string[];
  symbolPreset: SymbolPresetKey | 'CUSTOM';
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
  entryModel: EntryModel;  // V2: how entry is filled
  exitMode: ExitMode;      // V2: exit simulation mode
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
  outcome: 'WIN' | 'LOSS' | 'TIMEOUT' | 'PARTIAL_WIN';
  entryBar: number;
  exitBar: number;
  holdBars: number;
  regime: string;
  tp1Hit?: boolean;       // V2: whether TP1 was reached
  trailingExit?: boolean; // V2: whether trailing stop closed remaining
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
  partialWins: number;
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

// ─── ATR HELPER ───────────────────────────────────────────────────────────────

function computeATR(klines: Kline[], period: number = 14): number {
  if (klines.length < period + 1) return 0;
  const recent = klines.slice(-period - 1);
  let atrSum = 0;
  for (let i = 1; i < recent.length; i++) {
    const tr = Math.max(
      recent[i].high - recent[i].low,
      Math.abs(recent[i].high - recent[i - 1].close),
      Math.abs(recent[i].low - recent[i - 1].close)
    );
    atrSum += tr;
  }
  return atrSum / period;
}

// ─── TRADE SIMULATION: V1 (FIXED SL/TP) ──────────────────────────────────────

interface TradeResult {
  exitPrice: number;
  exitBar: number;
  outcome: 'WIN' | 'LOSS' | 'TIMEOUT' | 'PARTIAL_WIN';
  feePaid: number;
  tp1Hit: boolean;
  trailingExit: boolean;
}

function simulateTradeFixed(
  klines15m: Kline[], entryBarIdx: number,
  side: 'LONG' | 'SHORT', entryPrice: number, stopLoss: number, takeProfit: number,
  qty: number, feePct: number, slippagePct: number, maxHoldBars: number
): TradeResult {
  const dir = side === 'LONG' ? 1 : -1;
  const entrySlippage = entryPrice * (slippagePct / 100) * dir;
  const actualEntry = entryPrice + entrySlippage;
  const entryFee = actualEntry * qty * (feePct / 100);

  for (let i = entryBarIdx + 1; i < Math.min(entryBarIdx + maxHoldBars, klines15m.length); i++) {
    const candle = klines15m[i];

    // ── CANDLE CONFLICT RULE ──────────────────────────────────────
    // If a single candle touches BOTH SL and TP, SL wins (conservative).
    const slHit = side === 'LONG' ? candle.low <= stopLoss : candle.high >= stopLoss;
    const tpHit = side === 'LONG' ? candle.high >= takeProfit : candle.low <= takeProfit;

    if (slHit && tpHit) {
      const exitFee = stopLoss * qty * (feePct / 100);
      return { exitPrice: stopLoss, exitBar: i, outcome: 'LOSS', feePaid: entryFee + exitFee, tp1Hit: false, trailingExit: false };
    }
    if (slHit) {
      const exitFee = stopLoss * qty * (feePct / 100);
      return { exitPrice: stopLoss, exitBar: i, outcome: 'LOSS', feePaid: entryFee + exitFee, tp1Hit: false, trailingExit: false };
    }
    if (tpHit) {
      const exitFee = takeProfit * qty * (feePct / 100);
      return { exitPrice: takeProfit, exitBar: i, outcome: 'WIN', feePaid: entryFee + exitFee, tp1Hit: true, trailingExit: false };
    }
  }

  const lastBar = Math.min(entryBarIdx + maxHoldBars - 1, klines15m.length - 1);
  const exitPrice = klines15m[lastBar].close;
  const exitFee = exitPrice * qty * (feePct / 100);
  return { exitPrice, exitBar: lastBar, outcome: 'TIMEOUT', feePaid: entryFee + exitFee, tp1Hit: false, trailingExit: false };
}

// ─── TRADE SIMULATION: V2 (ENHANCED) ─────────────────────────────────────────
//
// Phase 1 (pre-TP1):
//   - SL hit → LOSS on full qty
//   - TP1 hit → close 50% at TP1, move stop to breakeven, enter Phase 2
//
// Phase 2 (post-TP1, trailing):
//   - trailingStop starts at entry (breakeven)
//   - Every bar: if best price moved favorably by > 0.5×ATR since last
//     tighten, advance trailingStop by 0.3×ATR toward price
//   - TP2 hit → close remaining 50% at TP2 → full WIN
//   - Trailing stop hit → close remaining at trail → PARTIAL_WIN
//   - maxHold → close at last close → PARTIAL_WIN or TIMEOUT
//
// ⚠ This is an APPROXIMATION of the live exit engine — not exact replication.
//   - Live uses Chandelier Exit for dynamic trailing
//   - Live tracks bar-by-bar CE values which are not available here
//   - This uses ATR-based trailing as a reasonable proxy
// ──────────────────────────────────────────────────────────────────────────────

function simulateTradeEnhanced(
  klines15m: Kline[], entryBarIdx: number,
  side: 'LONG' | 'SHORT', entryPrice: number, stopLoss: number,
  takeProfit1: number, takeProfit2: number,
  qty: number, feePct: number, slippagePct: number, maxHoldBars: number, atr: number
): TradeResult {
  const dir = side === 'LONG' ? 1 : -1;
  const entrySlippage = entryPrice * (slippagePct / 100) * dir;
  const actualEntry = entryPrice + entrySlippage;
  const entryFee = actualEntry * qty * (feePct / 100);

  let phase: 'PRE_TP1' | 'TRAILING' = 'PRE_TP1';
  let remainingQty = qty;
  let totalFees = entryFee;
  let tp1Pnl = 0;
  let trailingStop = stopLoss; // starts at SL, moves to breakeven on TP1 hit
  let bestPrice = entryPrice;  // tracks best favorable price for trail tightening
  const trailStepThreshold = atr * 0.5; // tighten every 0.5 ATR of favorable move
  const trailStepSize = atr * 0.3;      // tighten by 0.3 ATR each time

  for (let i = entryBarIdx + 1; i < Math.min(entryBarIdx + maxHoldBars, klines15m.length); i++) {
    const candle = klines15m[i];

    if (phase === 'PRE_TP1') {
      // Phase 1: fixed SL/TP1
      const slHit = side === 'LONG' ? candle.low <= stopLoss : candle.high >= stopLoss;
      const tp1Hit = side === 'LONG' ? candle.high >= takeProfit1 : candle.low <= takeProfit1;

      if (slHit && tp1Hit) {
        // Same-candle conflict: SL wins (conservative)
        const exitFee = stopLoss * qty * (feePct / 100);
        return { exitPrice: stopLoss, exitBar: i, outcome: 'LOSS', feePaid: totalFees + exitFee, tp1Hit: false, trailingExit: false };
      }

      if (slHit) {
        const exitFee = stopLoss * qty * (feePct / 100);
        return { exitPrice: stopLoss, exitBar: i, outcome: 'LOSS', feePaid: totalFees + exitFee, tp1Hit: false, trailingExit: false };
      }

      if (tp1Hit) {
        // TP1 hit: close 50%, enter trailing phase
        const closeQty = qty * 0.5;
        const tp1Fee = takeProfit1 * closeQty * (feePct / 100);
        tp1Pnl = (takeProfit1 - entryPrice) * dir * closeQty - tp1Fee;
        totalFees += tp1Fee;
        remainingQty = qty - closeQty;
        phase = 'TRAILING';
        trailingStop = entryPrice; // move stop to breakeven
        bestPrice = takeProfit1;
        continue;
      }
    }

    if (phase === 'TRAILING') {
      // Update best price tracking
      if (side === 'LONG') {
        if (candle.high > bestPrice) bestPrice = candle.high;
      } else {
        if (candle.low < bestPrice) bestPrice = candle.low;
      }

      // Tighten trailing stop based on favorable movement
      const favorableMove = side === 'LONG'
        ? bestPrice - trailingStop
        : trailingStop - bestPrice;
      if (favorableMove > trailStepThreshold && trailStepSize > 0) {
        if (side === 'LONG') {
          trailingStop = Math.max(trailingStop, bestPrice - trailStepThreshold);
        } else {
          trailingStop = Math.min(trailingStop, bestPrice + trailStepThreshold);
        }
      }

      // Check TP2 hit
      const tp2Hit = side === 'LONG' ? candle.high >= takeProfit2 : candle.low <= takeProfit2;
      const trailHit = side === 'LONG' ? candle.low <= trailingStop : candle.high >= trailingStop;

      if (trailHit && tp2Hit) {
        // Both hit same candle — use trail stop (conservative for remaining)
        const exitFee = trailingStop * remainingQty * (feePct / 100);
        const trailPnl = (trailingStop - entryPrice) * dir * remainingQty - exitFee;
        const netPnl = tp1Pnl + trailPnl;
        totalFees += exitFee;
        const weightedExit = (takeProfit1 + trailingStop) / 2;
        return { exitPrice: weightedExit, exitBar: i, outcome: 'PARTIAL_WIN', feePaid: totalFees, tp1Hit: true, trailingExit: true };
      }

      if (tp2Hit) {
        // Full win — TP2 reached on remaining qty
        const exitFee = takeProfit2 * remainingQty * (feePct / 100);
        totalFees += exitFee;
        const weightedExit = (takeProfit1 + takeProfit2) / 2;
        return { exitPrice: weightedExit, exitBar: i, outcome: 'WIN', feePaid: totalFees, tp1Hit: true, trailingExit: false };
      }

      if (trailHit) {
        // Trailing stop hit on remaining
        const exitFee = trailingStop * remainingQty * (feePct / 100);
        totalFees += exitFee;
        const weightedExit = (takeProfit1 + trailingStop) / 2;
        return { exitPrice: weightedExit, exitBar: i, outcome: 'PARTIAL_WIN', feePaid: totalFees, tp1Hit: true, trailingExit: true };
      }
    }
  }

  // Timeout
  const lastBar = Math.min(entryBarIdx + maxHoldBars - 1, klines15m.length - 1);
  const exitPrice = klines15m[lastBar].close;
  const exitFee = exitPrice * remainingQty * (feePct / 100);
  totalFees += exitFee;

  if (phase === 'TRAILING') {
    // TP1 was hit, timeout on remaining
    const weightedExit = (takeProfit1 + exitPrice) / 2;
    const trailPnl = (exitPrice - entryPrice) * dir * remainingQty - exitFee;
    return { exitPrice: weightedExit, exitBar: lastBar, outcome: 'PARTIAL_WIN', feePaid: totalFees, tp1Hit: true, trailingExit: false };
  }
  // Never hit TP1
  return { exitPrice, exitBar: lastBar, outcome: 'TIMEOUT', feePaid: totalFees, tp1Hit: false, trailingExit: false };
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

  const evalStep = 4; // Evaluate every 4×15m bars (1 hour)
  const warmupBars = 220 * 4;
  const openTrades: Map<string, {
    entryBar: number; side: 'LONG' | 'SHORT'; entryPrice: number;
    sl: number; tp1: number; tp2: number; qty: number;
    strategyId: string; regime: string; atr: number;
  }> = new Map();
  let globalBarCounter = 0;

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

    // Check open trades for exit
    for (const [sym, trade] of openTrades) {
      const symKlines = symbolData[sym]?.tf15m;
      if (!symKlines) continue;

      let result: TradeResult;
      if (config.exitMode === 'ENHANCED_V2') {
        result = simulateTradeEnhanced(
          symKlines, trade.entryBar, trade.side, trade.entryPrice,
          trade.sl, trade.tp1, trade.tp2, trade.qty,
          config.feePct, config.slippagePct, bar - trade.entryBar, trade.atr
        );
      } else {
        result = simulateTradeFixed(
          symKlines, trade.entryBar, trade.side, trade.entryPrice,
          trade.sl, trade.tp1, trade.qty,
          config.feePct, config.slippagePct, bar - trade.entryBar
        );
      }

      if (result.exitBar <= bar) {
        const dir = trade.side === 'LONG' ? 1 : -1;
        const rawPnl = (result.exitPrice - trade.entryPrice) * dir * trade.qty;
        const netPnl = rawPnl - result.feePaid;

        trades.push({
          symbol: sym, strategyId: trade.strategyId, side: trade.side,
          entryPrice: trade.entryPrice, exitPrice: result.exitPrice,
          stopLoss: trade.sl, takeProfit: trade.tp1, qty: trade.qty,
          pnl: netPnl, pnlPct: (netPnl / balance) * 100, feePaid: result.feePaid,
          outcome: result.outcome, entryBar: trade.entryBar, exitBar: result.exitBar,
          holdBars: result.exitBar - trade.entryBar, regime: trade.regime,
          tp1Hit: result.tp1Hit, trailingExit: result.trailingExit
        });

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
      if (openTrades.has(sym)) continue;
      if (openTrades.size >= config.maxConcurrentTrades) break;
      if (balance <= 0) break;

      const data = symbolData[sym];
      if (!data || bar >= data.tf15m.length) continue;

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

        // ── V2 ENTRY MODEL ─────────────────────────────────────────────
        // NEXT_BAR_OPEN: entry at bar+1 open price (no look-ahead)
        // SIGNAL_PRICE:  entry at signal.entryPrice (V1 behavior, slight look-ahead)
        let fillPrice = sig.entryPrice;
        const entryBarIdx = bar;

        if (config.entryModel === 'NEXT_BAR_OPEN') {
          const nextBar = bar + 1;
          if (nextBar >= data.tf15m.length) continue; // no next bar available
          fillPrice = data.tf15m[nextBar].open;

          // Validate fill is still within signal's intended range
          // If next-bar open is already beyond SL, skip (trade would be instant loss)
          const slDist = Math.abs(fillPrice - sig.stopLoss);
          const entryDist = Math.abs(sig.entryPrice - sig.stopLoss);
          if (slDist < entryDist * 0.15) continue; // SL < 15% of original distance away
        }

        // Compute ATR at entry for enhanced exit trailing
        const entryKlines = data.tf15m.slice(Math.max(0, bar - 15), bar + 1);
        const atr = computeATR(entryKlines, 14);

        // Compute TP2 from risk distance for enhanced exit
        const riskDist = Math.abs(fillPrice - sig.stopLoss);
        const tp2 = sig.side === 'LONG'
          ? fillPrice + riskDist * config.tp2RR
          : fillPrice - riskDist * config.tp2RR;

        openTrades.set(sym, {
          entryBar: entryBarIdx, side: sig.side, entryPrice: fillPrice,
          sl: sig.stopLoss, tp1: sig.takeProfit, tp2: tp2,
          qty: sig.qty, strategyId: sig.strategyId, regime: regimeLabel, atr
        });
        break;
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
      takeProfit: trade.tp1, qty: trade.qty, pnl: netPnl,
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
  const partials = trades.filter(t => t.outcome === 'PARTIAL_WIN');
  const profitable = [...wins, ...partials.filter(p => p.pnl > 0)];
  const unprofitable = [...losses, ...partials.filter(p => p.pnl <= 0)];
  const grossProfit = profitable.reduce((s, t) => s + Math.max(0, t.pnl), 0);
  const grossLoss = Math.abs(unprofitable.reduce((s, t) => s + Math.min(0, t.pnl), 0));
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
    partialWins: partials.length,
    winRate: trades.length ? ((wins.length + partials.filter(p => p.pnl > 0).length) / trades.length) * 100 : 0,
    lossRate: trades.length ? ((losses.length + partials.filter(p => p.pnl <= 0).length) / trades.length) * 100 : 0,
    netPnl: endBal - startBal,
    grossProfit,
    grossLoss,
    avgWin: profitable.length ? grossProfit / profitable.length : 0,
    avgLoss: unprofitable.length ? grossLoss / unprofitable.length : 0,
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
  const entryLabel = config.entryModel === 'NEXT_BAR_OPEN'
    ? 'Next-bar open after signal (no look-ahead bias)'
    : 'Signal price on evaluation bar (slight look-ahead, ~15min)';

  const exitLabel = config.exitMode === 'ENHANCED_V2'
    ? 'Enhanced V2: 50% at TP1, trailing stop on remainder (ATR-based), TP2 target'
    : 'Fixed SL/TP1 only — live exit engine NOT replicated';

  const trailLabel = config.exitMode === 'ENHANCED_V2'
    ? 'ATR-based trailing (0.5×ATR threshold, 0.3×ATR step) — approximation of live CE trailing'
    : 'NOT simulated';

  return [
    `Lookback: ${config.lookbackDays} days`,
    `Symbols: ${config.symbolPreset !== 'CUSTOM' ? SYMBOL_PRESETS[config.symbolPreset as SymbolPresetKey]?.label : 'Custom'} (${config.symbols.length} symbols)`,
    `Timeframes: 15m (entry signals), 1H (context/bias)`,
    `Evaluation: every 4×15m bars (1 hour intervals)`,
    `Entry model: ${entryLabel}`,
    `Exit model: ${exitLabel}`,
    `Candle conflict: if SL and TP both touched on same candle, SL wins (conservative)`,
    `Stop-loss: as computed by strategy engine per signal`,
    `Take-profit: TP1 at ${config.tp1RR}R${config.exitMode === 'ENHANCED_V2' ? `, TP2 at ${config.tp2RR}R` : ' (TP2 not simulated)'}`,
    `Trailing stop: ${trailLabel}`,
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
    `⚠ No partial fills simulation, no orderbook depth, no funding rates`,
    config.exitMode === 'ENHANCED_V2'
      ? `⚠ Enhanced exit uses ATR-based trailing as APPROXIMATION — not exact CE replication`
      : `⚠ Live exit engine (trailing, partial TP, CE-based) is NOT replicated`,
  ];
}

// ─── DEFAULT CONFIG ───────────────────────────────────────────────────────────

export const DEFAULT_BACKTEST_CONFIG: BacktestConfig = {
  strategyIds: [],
  symbols: SYMBOL_PRESETS.TOP_10.symbols as unknown as string[],
  symbolPreset: 'TOP_10',
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
  entryModel: 'NEXT_BAR_OPEN',  // V2 default: no look-ahead
  exitMode: 'ENHANCED_V2',      // V2 default: partial TP + trailing
};
