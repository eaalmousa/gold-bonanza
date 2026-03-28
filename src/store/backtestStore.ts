// ============================================
// Backtest Store — Gold Bonanza
//
// Additive persistence layer for saving and
// comparing backtest snapshots in localStorage.
// ============================================

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { BacktestResult } from '../engines/backtestEngine';

export interface BacktestSnapshot {
  id: string;
  name: string;
  timestamp: number;
  result: BacktestResult;
}

interface BacktestStore {
  snapshots: BacktestSnapshot[];
  saveSnapshot: (name: string, result: BacktestResult) => void;
  deleteSnapshot: (id: string) => void;
  clearSnapshots: () => void;
}

export const useBacktestStore = create<BacktestStore>()(
  persist(
    (set) => ({
      snapshots: [],
      saveSnapshot: (name, result) => set((state) => ({
        snapshots: [
          { id: Date.now().toString() + Math.random().toString(36).substring(7), name, timestamp: Date.now(), result },
          ...state.snapshots
        ]
      })),
      deleteSnapshot: (id) => set((state) => ({
        snapshots: state.snapshots.filter((s) => s.id !== id)
      })),
      clearSnapshots: () => set({ snapshots: [] })
    }),
    { 
      name: 'gold-bonanza-backtest-snapshots',
      version: 1
    }
  )
);
