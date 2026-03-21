import { useEffect, useRef, useCallback, useState } from 'react';
import { useTradingStore } from '../store/tradingStore';
import { api } from '../services/api';

const FETCH_INTERVAL_MS = 10_000; // Poll backend every 10s

export function useScanner() {
  const {
    setMarketRows, setDataLive, setScannerRunning,
    setMarketRegime, setLastScanAt,
    isScannerActive, lastScanAt,
    setBackendSignals, setAutoTradeActive, setBalance, setBinanceStatus,
    setPipelineSignals, setPipelineTraces
  } = useTradingStore();

  const [scanProgress, setScanProgress] = useState(0);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchBackendState = useCallback(async () => {
    try {
      const state = await api.getAutoTradeStatus(); 
      
      // Update Core Store Truth from Scout-Node
      if (state.enabled !== undefined) setAutoTradeActive(state.enabled);
      if (state.balance !== undefined) setBalance(state.balance);
      
      // Binance Connection Truth (derived from rateLimit availability)
      const isConnected = !!state.rateLimit && Object.keys(state.rateLimit).length > 0;
      setBinanceStatus(isConnected ? 'CONNECTED' : 'ERROR');

      // Update deployment signals
      if (state.signals) setBackendSignals(state.signals);
      
      // Update latest scan results
      if (state.latestMarketState) {
        const ms = state.latestMarketState;
        
        // 1. Update Market Metrics
        setMarketRows(ms.marketRows || []);
        
        // Truth-Alignment: Sync symbols universe
        if (ms.marketRows?.length > 0) {
            const syms = ms.marketRows.map((r: any) => r.symbol);
            useTradingStore.getState().setSymbols(syms);
        }

        setMarketRegime(ms.regime || 'RANGING');
        setScanProgress(ms.scanProgress || 100);
        setLastScanAt(ms.lastScanAt || Date.now());

        // Liveness: Heartbeat success + scanner config means we are LIVE
        setDataLive(true); 
        setScannerRunning(ms.scanProgress < 100);

        setPipelineTraces(ms.pipelineTraces || []);
        setPipelineSignals(ms.pipelineSignals || []);
      }

    } catch (e: any) {
      console.warn('[Scanner:Poll] Failed to fetch backend state:', e.message);
    }
  }, [
    setPipelineSignals, setPipelineTraces, setMarketRows, setMarketRegime, 
    setDataLive, setScannerRunning, setBackendSignals, setAutoTradeActive, 
    setBalance, setBinanceStatus, setLastScanAt
  ]);

  useEffect(() => {
    if (isScannerActive) {
      fetchBackendState();
      pollTimerRef.current = setInterval(fetchBackendState, FETCH_INTERVAL_MS);
    } else {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    }
    return () => {
       if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [isScannerActive, fetchBackendState]);

  return { scanProgress, lastScanAt, scanError: null };
}
