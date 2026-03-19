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
  backendSignals: Record<string, any>;

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
  setBackendSignals: (signals: Record<string, any>) => void;
  queueSignal: (id: string) => void;
  deploySignal: (signalId: string) => void; // Switched to ID-based deployment
  setExecutionMode: (mode: ExecutionMode) => void;
  addExecutionResult: (result: ExecutionResult) => void;
  updateTradeLivePrice: (symbol: string, livePrice: number) => void;
  updateTradeStatus: (idOrSymbol: string, status: string, price?: number, note?: string) => void;
  // Paper trading actions
  setPaperMode: (enabled: boolean) => void;
  resetPaperSession: (startBalance?: number) => void;
  closePaperTrade: (idOrSymbol: string, closePrice: number) => void;
  deployManualSignal: (signal: any, symbol: string) => void;
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
  backendSignals: {},

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

  setMarketRows: (marketRows) => set({ marketRows: Array.isArray(marketRows) ? marketRows : [] }),
  
  setPipelineSignals: (newSignals) => set(state => {
    const signals = Array.isArray(newSignals) ? newSignals : [];
    // 1. Identify signals already in a PROTECTED state (Queued/Deployed)
    //    We guard by ID here to allow new signals for the same symbol to enter
    //    as 'PENDING' or 'ACCEPTED' without overwriting the queued ones.
    const protectedIds = new Set(
      state.pipelineSignals
        .filter(s => s.status === 'QUEUED' || s.status === 'DEPLOYED')
        .map(s => s.id)
    );

    // 3. Keep protected signals exactly as they are
    const protectedSignals = state.pipelineSignals.filter(s => protectedIds.has(s.id));

    // 4. For new signals:
    //    - If an active trade exists for that symbol, we still allow the signal (for history),
    //      but we'll flag it in the UI as 'COLLISION' or similar if needed.
    //      For now, just merge.
    const merged = [
      ...protectedSignals,
      ...signals.filter(ns => !protectedIds.has(ns.id))
    ];

    // 5. Deduplicate by ID only (never by symbol)
    const uniqueById = Array.from(new Map(merged.map(s => [s.id, s])).values());
    
    return { pipelineSignals: uniqueById };
  }),


  addPipelineTraces: (traces) => set(state => {
    const validTraces = Array.isArray(traces) ? traces : [];
    return {
      pipelineTraces: [...validTraces, ...state.pipelineTraces].slice(0, 200)
    };
  }),

  addSignalToHistory: (entry) => set(state => ({
    signalHistory: [
      { ...entry, ts: entry.ts || Date.now() },
      ...state.signalHistory
    ].slice(0, 60)
  })),

  setBinancePositions: (positions) => set({ binancePositions: Array.isArray(positions) ? positions : [] }),

  addActiveTrade: (trade) => set(state => {
    // We NO LONGER overwrite by symbol. Every trade is a unique instance.
    // If trade has no ID, generate one based on its signalId or timestamp.
    const tradeId = trade.id || `trade_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const newTrade = { ...trade, id: tradeId };
    
    return {
      activeTrades: [newTrade, ...state.activeTrades]
    };
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

  setMicrostructureRows: (rows) => set({ microstructureRows: Array.isArray(rows) ? rows : [] }),
  setLiquidityLayers: (layers) => set({ liquidityLayers: Array.isArray(layers) ? layers : [] }),
  setTriggerLevels: (levels) => set({ triggerLevels: Array.isArray(levels) ? levels : [] }),
  setBlockedSignals: (signals) => set({ blockedSignals: Array.isArray(signals) ? signals : [] }),
  setPipelineHealth: (health) => set({ pipelineHealth: Array.isArray(health) ? health : [] }),

  setMarketRegime: (regime) => set({ marketRegime: regime }),
  setOrderFlowSnapshot: (symbol, snapshot) => set(state => ({
    orderFlowSnapshots: { ...state.orderFlowSnapshots, [symbol]: snapshot }
  })),
  setBackendSignals: (signals) => set({ backendSignals: signals }),

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

  deploySignal: (signalId) => {
    const state = get();

    // ── Find exact signal instance by ID ─────────────────────────────────────
    const target = state.pipelineSignals.find(s => s.id === signalId);
    if (!target) {
      console.warn(`[Store Guard] Cannot deploy — signal ID ${signalId} not found`);
      return;
    }

    if (target.status !== 'QUEUED') {
      console.warn(`[Store Guard] Cannot deploy — signal ${target.symbol} (ID: ${signalId}) not QUEUED (status: ${target.status})`);
      return;
    }

    // ── Guard 2: cross-check if this exact signal instance is already deployed ──
    const alreadyDeployedAsTrade = state.activeTrades.some(t => t.signalId === signalId);
    if (alreadyDeployedAsTrade) {
      console.warn(`[Store Guard] Signal ${signalId} is already active as a trade.`);
      return;
    }

    const symbol = target.symbol;
    const payload = toExecutionPayload(target.signal, symbol);
    payload.signalId = signalId; // Link payload back to original signal

    const mode    = state.executionMode;
    const isPaper = mode === 'PAPER';

    // ── Mark exact signal instance as DEPLOYED ───────────────────────────────
    set(s => ({
      pipelineSignals: s.pipelineSignals.map(n =>
        n.id === signalId ? { ...n, status: 'DEPLOYED' } : n
      )
    }));

    // ── Create ActiveTrade with mandatory ID and signalId ────────────────────
    const uniqueTradeId = `tr_${signalId}`; // Stable ID for consistent tracking
    
    state.addActiveTrade({
      id:         uniqueTradeId,
      signalId:   signalId,
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

    // ── Route through adapter ────────────────────────────────────────────────
    executeOrder(mode, payload).then(result => {
      get().addExecutionResult(result);
      if (result.status === 'FAILED') {
        // Roll back the specific trade by ID
        set(s => ({
          activeTrades: s.activeTrades.filter(t => t.id !== uniqueTradeId),
          pipelineSignals: s.pipelineSignals.map(n =>
            n.id === signalId ? { ...n, status: 'QUEUED' } : n
          )
        }));
        console.error(`[ExecAdapter] Rolled back ${symbol} (ID: ${signalId}) — reason: ${result.error}`);
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

    // Mapping over all active trades. If there are multiple (e.g. ZRO v1 and v2 both somehow active),
    // they each get their respective math based on their own entryPrice.
    const updatedTrades = state.activeTrades.map(t => {
      if (t.symbol.toUpperCase() !== symbol.toUpperCase()) return t;

      // ── Skip terminal trades ────────────────────────────────────────────────
      if (TERMINAL.includes(t.status)) return t;

      const entry  = t.entryPrice;
      const sl     = t.dynamicSL ?? t.sl;
      const dir    = t.side === 'LONG' ? 1 : -1;
      const status = t.status;

      // ── Recompute live metrics (using trade-specific entryPrice) ─────────────
      const priceDiff     = (livePrice - entry) * dir;
      const unrealizedPnl = priceDiff * t.qty;
      const riskPerUnit   = Math.abs(entry - sl);
      const rMultiple     = riskPerUnit > 0 ? (priceDiff / riskPerUnit) : undefined;
      const pct           = (target: number) => ((target - livePrice) / livePrice * 100 * dir);
      const distToTp1     = t.t1 ? pct(t.t1) : undefined;
      const distToTp2     = t.t2 ? pct(t.t2) : undefined;
      const distToSl      = sl   ? -pct(sl)   : undefined;

      // Hit detection...
      const crossed   = (target: number) => dir === 1 ? livePrice >= target : livePrice <= target;
      const slCrossed = (slLevel: number) => dir === 1 ? livePrice <= slLevel : livePrice >= slLevel;

      let newStatus: string = status;
      let realizedPnl       = t.realizedPnl;
      let history           = t.statusHistory ?? [];

      if ((status === 'ACTIVE' || status === 'TP1_HIT') && slCrossed(sl)) {
        const pnl = parseFloat(((livePrice - entry) * dir * t.qty).toFixed(2));
        newStatus = 'SL_HIT'; realizedPnl = pnl;
        history = [...history, { status: 'SL_HIT' as const, ts: now, price: livePrice, note: 'Automatic stop hit' }];
      } else if (status === 'TP1_HIT' && t.t2 && crossed(t.t2)) {
        const pnl = parseFloat(((livePrice - entry) * dir * t.qty).toFixed(2));
        newStatus = 'TP2_HIT'; realizedPnl = pnl;
        history = [...history, { status: 'TP2_HIT' as const, ts: now, price: livePrice, note: 'Full target reached' }];
      } else if (status === 'ACTIVE' && t.t1 && crossed(t.t1)) {
        const pnl = parseFloat(((livePrice - entry) * dir * t.qty).toFixed(2));
        newStatus = 'TP1_HIT'; realizedPnl = pnl;
        history = [...history, { status: 'TP1_HIT' as const, ts: now, price: livePrice, note: 'First target reached' }];
      }

      return {
        ...t, livePrice, status: newStatus, realizedPnl, statusHistory: history,
        unrealizedPnl: parseFloat(unrealizedPnl.toFixed(2)),
        rMultiple:     rMultiple  !== undefined ? parseFloat(rMultiple.toFixed(3))  : undefined,
        distToTp1:     distToTp1 !== undefined ? parseFloat(distToTp1.toFixed(3)) : undefined,
        distToTp2:     distToTp2 !== undefined ? parseFloat(distToTp2.toFixed(3)) : undefined,
        distToSl:      distToSl  !== undefined ? parseFloat(distToSl.toFixed(3))  : undefined,
        priceUpdatedAt: now,
      };
    });

    const newState = {
      activeTrades: updatedTrades,
      currentPrices: { ...state.currentPrices, [symbol.toUpperCase()]: { last: livePrice, ts: now } }
    };

    // Auto-close check by ID
    const PAPER_TERMINAL = ['TP2_HIT', 'SL_HIT', 'CLOSED', 'CANCELLED'];
    updatedTrades.forEach(t => {
      const wasNotTerminal = !PAPER_TERMINAL.includes(state.activeTrades.find(o => o.id === t.id)?.status ?? '');
      if (t.isPaperTrade && wasNotTerminal && PAPER_TERMINAL.includes(t.status)) {
        setTimeout(() => get().closePaperTrade(t.id, livePrice), 0);
      }
    });

    return newState;
  }),



  updateTradeStatus: (idOrSymbol, newStatus, price, note) => set(state => ({
    activeTrades: state.activeTrades.map(t => {
      const match = (t.id === idOrSymbol) || (t.symbol.toUpperCase() === idOrSymbol.toUpperCase());
      if (!match) return t;

      const event = { status: newStatus as any, ts: Date.now(), price, note };
      const history = [...(t.statusHistory ?? []), event];

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

  closePaperTrade: (idOrSymbol, closePrice) => {
    const state = get();
    const trade = state.activeTrades.find(
      t => t.isPaperTrade && (t.id === idOrSymbol || t.symbol.toUpperCase() === idOrSymbol.toUpperCase())
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
    const openTrades   = state.activeTrades.filter(t => t.isPaperTrade && t.id !== trade.id);
    const openExposure = openTrades.reduce((sum, t) => sum + (t.sizeUSDT ?? 0), 0);

    set(s => ({
      activeTrades: s.activeTrades.filter(t => t.id !== trade.id),
      paperSession: {
        ...prev, currentBalance: newBalance, totalPnl,
        openExposure: parseFloat(openExposure.toFixed(2)),
        winCount: wins, lossCount: losses, breakevenCount: bes,
        avgRMultiple: avgR,
        closedTrades: allClosed
      }
    }));

    console.log(`[Paper] 📋 ${trade.symbol} (ID: ${trade.id}) CLOSED @ ${closePrice} | PnL: ${realizedPnl >= 0 ? '+' : ''}${realizedPnl} | Balance: $${newBalance} | ${outcome}`);
  },

  deployManualSignal: (signal, symbol) => {
    const state = get();
    const payload = toExecutionPayload(signal, symbol);
    const mode    = state.executionMode;
    const isPaper = mode === 'PAPER';
    const fakeId  = `manual_${Date.now()}`;

    state.addActiveTrade({
      id:         `tr_${fakeId}`,
      signalId:   fakeId,
      symbol,
      kind:       payload.kind || 'MANUAL',
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
      isPaperTrade: isPaper,
      statusHistory: [{ status: 'ACTIVE' as const, ts: Date.now() }]
    });

    executeOrder(mode, payload).then(result => {
      get().addExecutionResult(result);
    });
  }
}));

