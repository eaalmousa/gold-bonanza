// ============================================
// Trading Store — Zustand State Management
// ============================================

import { create } from 'zustand';
import type {
  ModeConfig, ActiveTrade, MarketRow,
  SignalRow, PriceData, SignalHistoryEntry,
  MicrostructureRow, LiquidityLayer, TriggerLevel, BlockedSignal, PipelineHealth,
  MarketRegime, OrderFlowSnapshot
} from '../types/trading';
import { MODES } from '../types/trading';

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
  sniperSignals: SignalRow[];
  breakoutSignals: SignalRow[];
  signalHistory: SignalHistoryEntry[];

  // Active trades
  activeTrades: ActiveTrade[];

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
  setSniperSignals: (signals: SignalRow[]) => void;
  setBreakoutSignals: (signals: SignalRow[]) => void;
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
  queueSignal: (id: string, kind: 'SNIPER' | 'breakout') => void;
  deploySignal: (signal: any, symbol: string) => void;
}

export const useTradingStore = create<TradingState>((set, get) => ({
  balance: 300,
  activeMode: MODES.AGGRESSIVE,
  symbols: [],
  isDataLive: false,
  scannerRunning: false,
  isScannerActive: false,
  isAutoTradeActive: false,
  binanceStatus: 'INIT' as const,
  currentPrices: {},
  marketRows: [],
  sniperSignals: [],
  breakoutSignals: [],
  signalHistory: [],
  activeTrades: [],
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
  setScannerActive: (active) => set({ isScannerActive: active }),
  setAutoTradeActive: (active) => set({ isAutoTradeActive: active }),
  setScannerRunning: (scannerRunning) => set({ scannerRunning }),
  setBinanceStatus: (status) => set({ binanceStatus: status }),
  updatePrices: (newPrices) => set(state => ({
    currentPrices: { ...state.currentPrices, ...newPrices }
  })),

  setMarketRows: (marketRows) => set({ marketRows }),
  
  setSniperSignals: (signals) => {
    const state = get();
    // 1. Filter out symbols already in active trades (Hub/Live)
    const activeSymbols = new Set(state.activeTrades.map(t => t.symbol.toUpperCase()));
    
    // 2. Identify which stable IDs are currently QUEUED in the existing store
    const existingQueuedIds = new Set(
      state.sniperSignals.filter(s => s.status === 'QUEUED').map(s => s.id)
    );

    // 3. Filter new signals: must not be active AND must not be already queued by ID
    const filtered = signals.filter(s => 
      !activeSymbols.has(s.symbol.toUpperCase()) && 
      !existingQueuedIds.has(s.id)
    );

    // 4. Merge: Preserve existing QUEUED signals, add newly filtered DETECTED ones
    const merged = [
      ...state.sniperSignals.filter(s => s.status === 'QUEUED'),
      ...filtered
    ];

    set({ sniperSignals: merged });
  },

  setBreakoutSignals: (signals) => {
    const state = get();
    const activeSymbols = new Set(state.activeTrades.map(t => t.symbol.toUpperCase()));
    const existingQueuedIds = new Set(
      state.breakoutSignals.filter(s => s.status === 'QUEUED').map(s => s.id)
    );

    const filtered = signals.filter(s => 
      !activeSymbols.has(s.symbol.toUpperCase()) && 
      !existingQueuedIds.has(s.id)
    );

    const merged = [
      ...state.breakoutSignals.filter(s => s.status === 'QUEUED'),
      ...filtered
    ];

    set({ breakoutSignals: merged });
  },

  addSignalToHistory: (entry) => set(state => ({
    signalHistory: [
      { ...entry, ts: entry.ts || Date.now() },
      ...state.signalHistory
    ].slice(0, 60)
  })),

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

  queueSignal: (id, kind) => set(state => {
    if (kind === 'SNIPER') {
      return {
        sniperSignals: state.sniperSignals.map(s => 
          s.id === id ? { ...s, status: 'QUEUED' } : s
        )
      };
    } else {
      return {
        breakoutSignals: state.breakoutSignals.map(s => 
          s.id === id ? { ...s, status: 'QUEUED' } : s
        )
      };
    }
  }),

  deploySignal: (sig, symbol) => {
    const state = get();
    
    // Remove from scanner signal lists entirely
    set(s => ({
      breakoutSignals: s.breakoutSignals.filter(b => b.symbol !== symbol),
      sniperSignals: s.sniperSignals.filter(n => n.symbol !== symbol)
    }));

    state.addActiveTrade({
      symbol: symbol,
      kind: sig.kind || 'SNIPER',
      type: 'MANUAL',
      side: sig.side || 'LONG',
      entryPrice: sig.entryPrice || sig.triggerPrice,
      qty: sig.qty || 1,
      qtyBase: sig.qty || 1,
      sizeUSDT: sig.sizeUSDT || 100,
      t1: sig.takeProfit || sig.t1,
      t2: sig.takeProfit2 || sig.t2,
      sl: sig.stopLoss || sig.sl,
      stopPrice: sig.stopLoss || sig.sl,
      leverage: sig.leverage || 10,
      deployedAt: Date.now(),
      status: 'ACTIVE',
    });
  }
}));
