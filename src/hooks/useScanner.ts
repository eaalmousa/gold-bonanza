import { useEffect, useRef, useCallback, useState } from 'react';
import { useTradingStore } from '../store/tradingStore';
import { api } from '../services/api';

const FETCH_INTERVAL_MS = 10_000; // Poll backend every 10s

export function useScanner() {
  const {
    setPipelineSignals, setPipelineTraces,
    setMarketRows, setDataLive, setScannerRunning,
    setMarketRegime, setLastScanAt,
    isScannerActive, lastScanAt,
    setBackendSignals
  } = useTradingStore();

  const [scanProgress, setScanProgress] = useState(0);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchBackendState = useCallback(async () => {
    try {
      const state = await api.getAutoTradeStatus(); 
      
      // Update deployment truth
      if (state.signals) setBackendSignals(state.signals);
      
      // Update latest scan results
      if (state.latestMarketState) {
        const ms = state.latestMarketState;
        
        // 1. Update Market Metrics
        setMarketRows(ms.marketRows || []);
        setMarketRegime(ms.regime || 'RANGING');
        setScanProgress(ms.scanProgress || 100);
        setLastScanAt(ms.lastScanAt || Date.now());
        setDataLive(ms.marketRows?.length > 0);
        setScannerRunning(ms.scanProgress < 100);

        // 2. Update Signals
        setPipelineSignals(ms.pipelineSignals || []);

        // 3. Update Unified Traces (Forensics)
        // Diagnostic Log:
        const traceCount = ms.pipelineTraces?.length || 0;
        if (traceCount > 0) {
            console.log(`[useScanner] API handoff received ${traceCount} traces.`);
        }
        setPipelineTraces(ms.pipelineTraces || []);
      }

    } catch (e: any) {
      console.warn('[Scanner:Poll] Failed to fetch backend state:', e.message);
    }
  }, [setPipelineSignals, setPipelineTraces, setMarketRows, setMarketRegime, setDataLive, setScannerRunning, setBackendSignals]);

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
