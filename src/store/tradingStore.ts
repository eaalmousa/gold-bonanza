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
  deploySignal: (signal: any, symbol: string) => void;
}

export const useTradingStore = create<TradingState>((set, get) => ({
  balance: 300,
  activeMode: MODES.AGGRESSIVE,
  symbols: [],
  isDataLive: false,
  scannerRunning: false,
  isScannerActive: false,
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
  setScannerRunning: (scannerRunning) => set({ scannerRunning }),
  setScannerActive: (active) => set({ isScannerActive: active }),
  setBinanceStatus: (status) => set({ binanceStatus: status }),
  updatePrices: (newPrices) => set(state => ({
    currentPrices: { ...state.currentPrices, ...newPrices }
  })),

  setMarketRows: (marketRows) => set({ marketRows }),
  setSniperSignals: (sniperSignals) => set({ sniperSignals }),
  setBreakoutSignals: (breakoutSignals) => set({ breakoutSignals }),

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

  deploySignal: (sig, symbol) => {
    const state = get();
    
    // Remove from scanner signal lists if it exists there
    if (sig.kind === 'SUPER_SNIPER') {
      state.setBreakoutSignals(state.breakoutSignals.filter(s => s.symbol !== symbol));
    } else if (sig.kind === 'SNIPER') {
      state.setSniperSignals(state.sniperSignals.filter(s => s.symbol !== symbol));
    }

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
