// ============================================
// Trading Store — Zustand State Management
// ============================================

import { create } from 'zustand';
import type {
  ModeConfig, ActiveTrade, ClosedTrade, PaperSession,
  ExecutionMode, ExecutionResult, MarketRow,
  SignalRow, PriceData, SignalHistoryEntry, UnifiedTrace,
  MicrostructureRow, LiquidityLayer, TriggerLevel, BlockedSignal, PipelineHealth,
  MarketRegime, OrderFlowSnapshot
} from '../types/trading';
import { MODES } from '../types/trading';
import { executeOrder, toExecutionPayload } from '../services/executionAdapter';

interface TradingState {
  // Core
  balance: number;
  activeMode: ModeConfig;
  symbols: string[];
  isDataLive: boolean;
  scannerRunning: boolean;
  isScannerActive: boolean;
  isAutoTradeActive: boolean;
  binanceStatus: 'INIT' | 'CONNECTED' | 'ERROR';

  // Prices / Market
  currentPrices: Record<string, PriceData>;
  marketRows: MarketRow[];

  // Signals
  pipelineSignals: SignalRow[];
  pipelineTraces: UnifiedTrace[];
  signalHistory: SignalHistoryEntry[];

  // Active trades
  activeTrades: ActiveTrade[];
  binancePositions: any[];

  // Paper trading
  paperMode: boolean;
  paperSession: PaperSession;

  // Execution adapter
  executionMode: ExecutionMode;
  executionResults: ExecutionResult[];

  // Deal status
  dealStatus: Record<string, string>;

  // Feed State
  microstructureRows: MicrostructureRow[];
  liquidityLayers: LiquidityLayer[];
  triggerLevels: TriggerLevel[];
  blockedSignals: BlockedSignal[];
  pipelineHealth: PipelineHealth[];

  // Market context
  marketRegime: MarketRegime;
  orderFlowSnapshots: Record<string, OrderFlowSnapshot>;

  // Actions
  setBalance: (balance: number) => void;
  setMode: (key: string) => void;
  setSymbols: (symbols: string[]) => void;
  setDataLive: (live: boolean) => void;
  setScannerRunning: (running: boolean) => void;
  setScannerActive: (active: boolean) => void;
  setAutoTradeActive: (active: boolean) => void;
  setBinanceStatus: (status: 'CONNECTED' | 'ERROR') => void;
  updatePrices: (prices: Record<string, PriceData>) => void;
  setMarketRows: (rows: MarketRow[]) => void;
  setPipelineSignals: (signals: SignalRow[]) => void;
  addPipelineTraces: (traces: UnifiedTrace[]) => void;
  setBinancePositions: (positions: any[]) => void;
  addSignalToHistory: (entry: SignalHistoryEntry) => void;
  addActiveTrade: (trade: ActiveTrade) => void;
  removeActiveTrade: (idx: number) => void;
  setDealStatus: (key: string, status: string) => void;
  getDealStatus: (symbol: string, kind: string) => string;

  // Feed Actions
  setMicrostructureRows: (rows: MicrostructureRow[]) => void;
  setLiquidityLayers: (layers: LiquidityLayer[]) => void;
  setTriggerLevels: (levels: TriggerLevel[]) => void;
  setBlockedSignals: (signals: BlockedSignal[]) => void;
  setPipelineHealth: (health: PipelineHealth[]) => void;

  // Market context actions
  setMarketRegime: (regime: MarketRegime) => void;
  setOrderFlowSnapshot: (symbol: string, snapshot: OrderFlowSnapshot) => void;
  queueSignal: (id: string) => void;
  deploySignal: (signal: any, symbol: string) => void;
  setExecutionMode: (mode: ExecutionMode) => void;
  addExecutionResult: (result: ExecutionResult) => void;
  updateTradeLivePrice: (symbol: string, livePrice: number) => void;
  updateTradeStatus: (symbol: string, status: string, price?: number, note?: string) => void;
  // Paper trading actions
  setPaperMode: (enabled: boolean) => void;
  resetPaperSession: (startBalance?: number) => void;
  closePaperTrade: (symbol: string, closePrice: number) => void;
}

export const useTradingStore = create<TradingState>((set, get) => ({
  balance: 300,
  activeMode: MODES.AGGRESSIVE,
  symbols: [],
  isDataLive: false,
  scannerRunning: false,
  isScannerActive: typeof window !== 'undefined' ? localStorage.getItem('gb_scanner_active') === 'true' : false,
  isAutoTradeActive: false,
  binanceStatus: 'INIT' as const,
  currentPrices: {},
  marketRows: [],
  pipelineSignals: [],
  pipelineTraces: [],
  signalHistory: [],
  activeTrades: [],
  binancePositions: [],
  dealStatus: {},
  microstructureRows: [],
  liquidityLayers: [],
  triggerLevels: [],
  blockedSignals: [],
  pipelineHealth: [
    { label: 'PYTHUSDT ORACLE', value: 99.9, status: 'ok' },
    { label: 'LIQUIDITY FEED', value: 98.5, status: 'ok' },
    { label: 'CVD AGGREGATOR', value: 85.0, status: 'warn' },
    { label: 'EXECUTION RELAY', value: 100.0, status: 'ok' },
  ],
  marketRegime: 'RANGING' as MarketRegime,
  orderFlowSnapshots: {},

  // Paper trading
  paperMode: false,
  paperSession: {
    startBalance: 10000,
    currentBalance: 10000,
    totalPnl: 0,
    openExposure: 0,
    winCount: 0,
    lossCount: 0,
    breakevenCount: 0,
    avgRMultiple: 0,
    closedTrades: []
  },

  // Execution adapter — default to PAPER (safe)
  executionMode: 'PAPER' as ExecutionMode,
  executionResults: [],

  setBalance: (balance) => set({ balance }),

  setMode: (key) => {
    const mode = MODES[key];
    if (!mode) return;
    const state = get();
    let trades = state.activeTrades;
    if (trades.length > mode.maxTrades) {
      trades = trades.slice(0, mode.maxTrades);
    }
    set({ activeMode: mode, activeTrades: trades });
  },

  setSymbols: (symbols) => set({ symbols }),
  setDataLive: (isDataLive) => set({ isDataLive }),
  setScannerActive: (active) => {
    if (typeof window !== 'undefined') localStorage.setItem('gb_scanner_active', String(active));
    set({ isScannerActive: active });
  },
  setAutoTradeActive: (active) => set({ isAutoTradeActive: active }),
  setScannerRunning: (scannerRunning) => set({ scannerRunning }),
  setBinanceStatus: (status) => set({ binanceStatus: status }),
  updatePrices: (newPrices) => set(state => ({
    currentPrices: { ...state.currentPrices, ...newPrices }
  })),

  setMarketRows: (marketRows) => set({ marketRows }),
  
  setPipelineSignals: (signals) => {
    const state = get();
    // 1. Symbols already occupying active trades (Binance / local hub)
    const activeSymbols = new Set(state.activeTrades.map(t => t.symbol.toUpperCase()));

    // 2. Symbols that are currently QUEUED or DEPLOYED — protected from any rescan overwrite
    //    We guard by symbol here (not just ID) so a new-ID duplicate from a fresh scan
    //    cannot slip in alongside an already-queued entry for the same asset.
    const protectedSymbols = new Set(
      state.pipelineSignals
        .filter(s => s.status === 'QUEUED' || s.status === 'DEPLOYED')
        .map(s => s.symbol.toUpperCase())
    );

    // 3. Let new scan signals through only if the symbol is neither active nor protected
    const filtered = signals.filter(s =>
      !activeSymbols.has(s.symbol.toUpperCase()) &&
      !protectedSymbols.has(s.symbol.toUpperCase())
    );

    // 4. Merge: keep all protected rows, append freshly scanned candidates
    const merged = [
      ...state.pipelineSignals.filter(s => s.status === 'QUEUED' || s.status === 'DEPLOYED'),
      ...filtered
    ];

    set({ pipelineSignals: merged });
  },


  addPipelineTraces: (traces) => set(state => ({
    pipelineTraces: [...traces, ...state.pipelineTraces].slice(0, 200)
  })),

  addSignalToHistory: (entry) => set(state => ({
    signalHistory: [
      { ...entry, ts: entry.ts || Date.now() },
      ...state.signalHistory
    ].slice(0, 60)
  })),

  setBinancePositions: (positions) => set({ binancePositions: positions }),

  addActiveTrade: (trade) => set(state => {
    const existingIdx = state.activeTrades.findIndex(
      tr => tr.symbol.toUpperCase() === trade.symbol.toUpperCase() &&
        (tr.kind || 'SNIPER').toUpperCase() === (trade.kind || 'SNIPER').toUpperCase()
    );
    const trades = [...state.activeTrades];
    if (existingIdx >= 0) {
      trades[existingIdx] = { ...trades[existingIdx], ...trade };
    } else {
      trades.unshift(trade);
    }
    return { activeTrades: trades };
  }),

  removeActiveTrade: (idx) => set(state => ({
    activeTrades: state.activeTrades.filter((_, i) => i !== idx)
  })),

  setDealStatus: (key, status) => set(state => ({
    dealStatus: { ...state.dealStatus, [key]: status }
  })),

  getDealStatus: (symbol, kind) => {
    const key = `${symbol.toUpperCase()}::${(kind || 'SNIPER').toUpperCase()}`;
    return get().dealStatus[key] || 'ACTIVE';
  },

  setMicrostructureRows: (rows) => set({ microstructureRows: rows }),
  setLiquidityLayers: (layers) => set({ liquidityLayers: layers }),
  setTriggerLevels: (levels) => set({ triggerLevels: levels }),
  setBlockedSignals: (signals) => set({ blockedSignals: signals }),
  setPipelineHealth: (health) => set({ pipelineHealth: health }),

  setMarketRegime: (regime) => set({ marketRegime: regime }),
  setOrderFlowSnapshot: (symbol, snapshot) => set(state => ({
    orderFlowSnapshots: { ...state.orderFlowSnapshots, [symbol]: snapshot }
  })),

  queueSignal: (id) => {
    const state = get();
    const target = state.pipelineSignals.find(s => s.id === id);
    if (!target) return;
    if (['PENDING', 'INVALIDATED', 'EXPIRED', 'CANCELLED', 'DEPLOYED'].includes(target.status)) {
      console.warn(`[Store Guard] Cannot queue signal with status: ${target.status}`);
      return;
    }
    set(s => ({
      pipelineSignals: s.pipelineSignals.map(signal => 
        signal.id === id ? { ...signal, status: 'QUEUED' } : signal
      )
    }));
  },

  deploySignal: (sig, symbol) => {
    const state = get();

    // ── Guard 1: signal must be QUEUED ───────────────────────────────────────
    const target = state.pipelineSignals.find(s => s.symbol === symbol);
    if (!target || target.status !== 'QUEUED') {
      console.warn(`[Store Guard] Cannot deploy — signal not QUEUED (status: ${target?.status ?? 'not found'})`);
      return;
    }

    // ── Guard 2: block duplicate active position for same symbol ─────────────
    const alreadyActive = state.activeTrades.find(
      t => t.symbol.toUpperCase() === symbol.toUpperCase()
    );
    if (alreadyActive) {
      console.warn(`[Store Guard] Cannot deploy — active trade for ${symbol} already exists (status: ${alreadyActive.status})`);
      return;
    }

    // ── Normalise to canonical payload ──────────────────────────────────────
    const payload = toExecutionPayload(sig, symbol);
    const mode    = state.executionMode;

    // ── Paper mode sync with executionMode ───────────────────────────────────
    // paperMode flag is kept in sync so lifecycle (TP/SL auto-close) works correctly
    const isPaper = mode === 'PAPER';

    // ── Mark pipeline as DEPLOYED before async work ──────────────────────────
    set(s => ({
      pipelineSignals: s.pipelineSignals.map(n =>
        n.symbol === symbol ? { ...n, status: 'DEPLOYED' } : n
      )
    }));

    // ── Optimistically create ActiveTrade ────────────────────────────────────
    state.addActiveTrade({
      symbol,
      kind:       payload.kind || 'SNIPER',
      type:       'MANUAL',
      side:       payload.side,
      entryPrice: payload.entryPrice,
      qty:        payload.qty,
      qtyBase:    payload.qty,
      sizeUSDT:   payload.sizeUSDT,
      t1:         payload.takeProfit,
      t2:         payload.takeProfit2,
      sl:         payload.stopLoss,
      stopPrice:  payload.stopLoss,
      leverage:   payload.leverage,
      deployedAt: Date.now(),
      status:     'ACTIVE',
      score:      payload.score,
      entryType:  payload.entryType,
      entryTiming:payload.entryTiming,
      reasons:    payload.reasons,
      isPaperTrade: isPaper,
      statusHistory: [{ status: 'ACTIVE' as const, ts: Date.now() }]
    });

    // ── Route through adapter asynchronously ─────────────────────────────────
    executeOrder(mode, payload).then(result => {
      get().addExecutionResult(result);
      if (result.status === 'FAILED') {
        // Roll back: remove the optimistically-created trade and unmark pipeline
        set(s => ({
          activeTrades: s.activeTrades.filter(t => t.symbol.toUpperCase() !== symbol.toUpperCase()),
          pipelineSignals: s.pipelineSignals.map(n =>
            n.symbol === symbol ? { ...n, status: 'QUEUED' } : n
          )
        }));
        console.error(`[ExecAdapter] Rolled back ${symbol} — reason: ${result.error}`);
      }
    });
  },

  setExecutionMode: (mode) => set(state => ({
    executionMode: mode,
    // Keep paperMode flag in sync so lifecycle hooks see consistent state
    paperMode: mode === 'PAPER' ? true : state.paperMode
  })),

  addExecutionResult: (result) => set(state => ({
    executionResults: [result, ...state.executionResults].slice(0, 100)
  })),

  updateTradeLivePrice: (symbol, livePrice) => set(state => {
    // TP1_HIT is intentionally NOT terminal here — it can still progress to TP2_HIT or SL_HIT
    const TERMINAL = ['TP2_HIT', 'SL_HIT', 'CLOSED', 'CANCELLED'];
    const now = Date.now();

    const updatedTrades = state.activeTrades.map(t => {
      if (t.symbol.toUpperCase() !== symbol.toUpperCase()) return t;

      // ── Skip terminal trades: they never get live price updates ─────────────
      if (TERMINAL.includes(t.status)) return t;

      const entry  = t.entryPrice;
      const sl     = t.dynamicSL ?? t.sl;
      const dir    = t.side === 'LONG' ? 1 : -1;
      const status = t.status;

      // ── Recompute live metrics ───────────────────────────────────────────────
      const priceDiff     = (livePrice - entry) * dir;
      const unrealizedPnl = priceDiff * t.qty;
      const riskPerUnit   = Math.abs(entry - sl);
      const rMultiple     = riskPerUnit > 0 ? (priceDiff / riskPerUnit) : undefined;
      const pct           = (target: number) => ((target - livePrice) / livePrice * 100 * dir);
      const distToTp1     = t.t1 ? pct(t.t1) : undefined;
      const distToTp2     = t.t2 ? pct(t.t2) : undefined;
      const distToSl      = sl   ? -pct(sl)   : undefined;

      // ── Level-hit detection (direction-aware) ────────────────────────────────
      // LONG: price >= target is a hit; SHORT: price <= target is a hit
      const crossed = (target: number) =>
        dir === 1 ? livePrice >= target : livePrice <= target;
      const slCrossed = (slLevel: number) =>
        dir === 1 ? livePrice <= slLevel : livePrice >= slLevel;

      let newStatus: string = status;
      let realizedPnl       = t.realizedPnl;
      let history           = t.statusHistory ?? [];

      // ── SL hit — highest priority, evaluated first ───────────────────────────
      // Allowed from ACTIVE or TP1_HIT (partial exit scenario)
      if ((status === 'ACTIVE' || status === 'TP1_HIT') && slCrossed(sl)) {
        const pnl = parseFloat(((livePrice - entry) * dir * t.qty).toFixed(2));
        newStatus   = 'SL_HIT';
        realizedPnl = pnl;
        history     = [...history, { status: 'SL_HIT' as const, ts: now, price: livePrice, note: 'Automatic stop hit' }];
        console.log(`[TradeMonitor] 🛑 SL HIT: ${symbol} @ ${livePrice} | PnL: ${pnl > 0 ? '+' : ''}${pnl} USDT`);

      // ── TP2 hit — from TP1_HIT only ─────────────────────────────────────────
      } else if (status === 'TP1_HIT' && t.t2 && crossed(t.t2)) {
        const pnl = parseFloat(((livePrice - entry) * dir * t.qty).toFixed(2));
        newStatus   = 'TP2_HIT';
        realizedPnl = pnl;
        history     = [...history, { status: 'TP2_HIT' as const, ts: now, price: livePrice, note: 'Full target reached' }];
        console.log(`[TradeMonitor] ✅✅ TP2 HIT: ${symbol} @ ${livePrice} | PnL: +${pnl} USDT`);

      // ── TP1 hit — from ACTIVE only ───────────────────────────────────────────
      } else if (status === 'ACTIVE' && t.t1 && crossed(t.t1)) {
        const pnl = parseFloat(((livePrice - entry) * dir * t.qty).toFixed(2));
        newStatus   = 'TP1_HIT';
        realizedPnl = pnl;  // snapshot partial PnL at TP1 (updated again at TP2)
        history     = [...history, { status: 'TP1_HIT' as const, ts: now, price: livePrice, note: 'First target reached' }];
        console.log(`[TradeMonitor] ✅ TP1 HIT: ${symbol} @ ${livePrice} | PnL so far: +${pnl} USDT`);
      }

      return {
        ...t,
        livePrice,
        unrealizedPnl:  parseFloat(unrealizedPnl.toFixed(2)),
        rMultiple:  rMultiple  !== undefined ? parseFloat(rMultiple.toFixed(3))  : undefined,
        distToTp1:  distToTp1 !== undefined ? parseFloat(distToTp1.toFixed(3)) : undefined,
        distToTp2:  distToTp2 !== undefined ? parseFloat(distToTp2.toFixed(3)) : undefined,
        distToSl:   distToSl  !== undefined ? parseFloat(distToSl.toFixed(3))  : undefined,
        priceUpdatedAt: now,
        // Status transition fields — only changed when a level was hit
        status:        newStatus,
        realizedPnl,
        statusHistory: history,
      };
    });

    const newState = {
      activeTrades: updatedTrades,
      currentPrices: {
        ...state.currentPrices,
        [symbol.toUpperCase()]: { last: livePrice, ts: now }
      }
    };

    // ── Auto-close paper trades that just hit a fully terminal status ─────────
    // TP1_HIT is NOT terminal (runners continue), only TP2_HIT / SL_HIT trigger this
    const PAPER_TERMINAL = ['TP2_HIT', 'SL_HIT', 'CLOSED', 'CANCELLED'];
    const justTerminated  = updatedTrades.find(
      t => t.symbol.toUpperCase() === symbol.toUpperCase() &&
           t.isPaperTrade &&
           PAPER_TERMINAL.includes(t.status) &&
           !PAPER_TERMINAL.includes(state.activeTrades.find(o => o.symbol === t.symbol)?.status ?? '')
    );
    if (justTerminated) {
      // Schedule micro-task so it runs after this set() resolves
      setTimeout(() => get().closePaperTrade(symbol, livePrice), 0);
    }

    return newState;
  }),



  updateTradeStatus: (symbol, newStatus, price, note) => set(state => ({
    activeTrades: state.activeTrades.map(t => {
      if (t.symbol.toUpperCase() !== symbol.toUpperCase()) return t;

      const event = { status: newStatus as any, ts: Date.now(), price, note };
      const history = [...(t.statusHistory ?? []), event];

      // On terminal statuses, compute realized PnL from exit price
      const TERMINAL = ['TP1_HIT', 'TP2_HIT', 'SL_HIT', 'CLOSED', 'CANCELLED'];
      let realizedPnl = t.realizedPnl;
      if (TERMINAL.includes(newStatus) && price) {
        const dir = t.side === 'LONG' ? 1 : -1;
        realizedPnl = parseFloat(((price - t.entryPrice) * dir * t.qty).toFixed(2));
      }

      return { ...t, status: newStatus, statusHistory: history, realizedPnl };
    })
  })),

  // ─── Paper Trading Actions ──────────────────────────────────────────────────

  setPaperMode: (enabled) => set({ paperMode: enabled }),

  resetPaperSession: (startBalance = 10000) => set({
    paperMode: true,
    paperSession: {
      startBalance,
      currentBalance: startBalance,
      totalPnl: 0,
      openExposure: 0,
      winCount: 0,
      lossCount: 0,
      breakevenCount: 0,
      avgRMultiple: 0,
      closedTrades: []
    }
  }),

  closePaperTrade: (symbol, closePrice) => {
    const state = get();
    const trade = state.activeTrades.find(
      t => t.symbol.toUpperCase() === symbol.toUpperCase() && t.isPaperTrade
    );
    if (!trade) return;

    const dir         = trade.side === 'LONG' ? 1 : -1;
    const realizedPnl = parseFloat(((closePrice - trade.entryPrice) * dir * trade.qty).toFixed(2));
    const outcome: ClosedTrade['outcome'] =
      realizedPnl > 0.01 ? 'WIN' : realizedPnl < -0.01 ? 'LOSS' : 'BREAKEVEN';

    const closedTrade: ClosedTrade = {
      ...trade,
      closePrice,
      closedAt: Date.now(),
      outcome,
      realizedPnl
    };

    const prev = state.paperSession;
    const allClosed = [...prev.closedTrades, closedTrade];
    const wins   = prev.winCount   + (outcome === 'WIN'       ? 1 : 0);
    const losses = prev.lossCount  + (outcome === 'LOSS'      ? 1 : 0);
    const bes    = prev.breakevenCount + (outcome === 'BREAKEVEN' ? 1 : 0);
    const allR   = allClosed.map(c => c.rMultiple ?? 0);
    const avgR   = allR.length ? parseFloat((allR.reduce((a, b) => a + b, 0) / allR.length).toFixed(3)) : 0;
    const newBalance   = parseFloat((prev.currentBalance + realizedPnl).toFixed(2));
    const totalPnl     = parseFloat((newBalance - prev.startBalance).toFixed(2));
    const openTrades   = state.activeTrades.filter(t => t.isPaperTrade && t.symbol !== symbol);
    const openExposure = openTrades.reduce((sum, t) => sum + (t.sizeUSDT ?? 0), 0);

    set(s => ({
      activeTrades: s.activeTrades.filter(
        t => !(t.symbol.toUpperCase() === symbol.toUpperCase() && t.isPaperTrade)
      ),
      paperSession: {
        ...prev, currentBalance: newBalance, totalPnl,
        openExposure: parseFloat(openExposure.toFixed(2)),
        winCount: wins, lossCount: losses, breakevenCount: bes,
        avgRMultiple: avgR,
        closedTrades: allClosed
      }
    }));

    console.log(`[Paper] 📋 ${symbol} CLOSED @ ${closePrice} | PnL: ${realizedPnl >= 0 ? '+' : ''}${realizedPnl} | Balance: $${newBalance} | ${outcome}`);
  }
}));

