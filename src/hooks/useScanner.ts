import { useEffect, useRef, useCallback, useState } from 'react';
import { useTradingStore } from '../store/tradingStore';
import { api } from '../services/api';

const FETCH_INTERVAL_MS = 10_000; // Poll the backend every 10s for signal state

export function useScanner() {
  const {
    setPipelineSignals, addPipelineTraces,
    setMarketRows, setDataLive, setScannerRunning,
    setMarketRegime,
    isScannerActive,
    setBackendSignals
  } = useTradingStore();

  const [scanProgress, setScanProgress] = useState(0);
  const [lastScanAt, setLastScanAt] = useState<number | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchBackendState = useCallback(async () => {
    try {
      const state = await api.getAutoTradeStatus(); 
      // This endpoint now returns the unified backend scanner state
      
      if (state.signals) {
        setBackendSignals(state.signals);
      }
      
      // Update the UI with the backend latest results
      if (state.latestMarketState) {
        const ms = state.latestMarketState;
        setPipelineSignals(ms.pipelineSignals || []);
        setMarketRows(ms.marketRows || []);
        setMarketRegime(ms.regime || 'RANGING');
        setScanProgress(ms.scanProgress || 100);
        setLastScanAt(ms.lastScanAt || Date.now());
        setDataLive(ms.marketRows?.length > 0);
        setScannerRunning(ms.scanProgress < 100);
      }

    } catch (e: any) {
      console.warn('[Scanner:Poll] Failed to fetch backend state:', e.message);
    }
  }, [setPipelineSignals, setMarketRows, setMarketRegime, setDataLive, setScannerRunning, setBackendSignals]);

  useEffect(() => {
    // Only poll the backend if the engine is ON or we want latest results
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

  return { scanProgress, lastScanAt, scanError };
}
