import { useEffect, useRef, useCallback, useState } from 'react';
import { useTradingStore } from '../store/tradingStore';
import { initializeSymbolUniverse } from '../services/binanceApi';
import { runBonanzaCore } from '../engines/scanner';
import { api } from '../services/api';

const SCAN_INTERVAL_MS = 90_000; // 90 seconds between full scans

export function useScanner() {
  const {
    symbols, setSymbols,
    activeMode, balance,
    setPipelineSignals, addPipelineTraces,
    setMarketRows, setDataLive, setScannerRunning,
    addSignalToHistory,
    setMarketRegime,
    isScannerActive,
    setBackendSignals
  } = useTradingStore();

  const [scanProgress, setScanProgress] = useState(0);
  const [lastScanAt, setLastScanAt] = useState<number | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const scanLock = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const doScan = useCallback(async (symbolList: string[]) => {
    // Check if user turned on scanner globally
    const currentActiveState = useTradingStore.getState().isScannerActive;
    if (!currentActiveState) return;

    if (scanLock.current) return;
    scanLock.current = true;
    setScannerRunning(true);
    setScanError(null);
    setScanProgress(0);

    try {
      // Get latest order flow snapshots from the store
      const latestFlowSnapshots = useTradingStore.getState().orderFlowSnapshots;

      const result = await runBonanzaCore(
        symbolList,
        activeMode,
        balance,
        (pct) => setScanProgress(pct),
        latestFlowSnapshots,
        (regime, reason) => {
          setMarketRegime(regime);
          console.log(`[Scanner] Regime updated: ${regime} — ${reason}`);
        }
      );

      setPipelineSignals(result.pipelineSignals);
      addPipelineTraces(result.pipelineTraces);
      setMarketRows(result.marketRows);
      setDataLive(result.marketRows.length > 0);
      setLastScanAt(Date.now());

      // Fetch unified backend decision truth for these signals
      try {
        const sigRes = await api.syncSignals(result.pipelineSignals);
        if (sigRes && sigRes.signals) {
          setBackendSignals(sigRes.signals);
          console.log(`[Scanner] Unified ${Object.keys(sigRes.signals).length} backend signal states via sync.`);
        }
      } catch (err) {
        console.warn(`[Scanner] Could not sync signals with backend:`, err);
      }

      console.log(
        `%c[SCAN DONE] Mode=${activeMode.key} | Tradeable=${result.pipelineSignals.length} | Traces=${result.pipelineTraces.length} | MarketRows=${result.marketRows.length}`,
        result.pipelineSignals.length > 0 ? 'color:lime;font-weight:bold' : 'color:orange;font-weight:bold'
      );

      // Add to history (only ACCEPTED status signals should go into the long-term historical graph record)
      result.pipelineSignals.filter(s => s.status === 'ACCEPTED').forEach(s => {
        addSignalToHistory({
          kind: s.signal.side === 'SHORT' ? 'SNIPER_SHORT' : 'SNIPER',
          symbol: s.symbol,
          price: s.price,
          change24h: s.change24h,
          score: s.signal.score,
          ts: Date.now()
        });
      });

      console.log(
        `[Scanner] Scan complete — ${result.pipelineSignals.length} tradeable, ${result.pipelineTraces.length} traces, ${result.marketRows.length} market rows`
      );
    } catch (e: any) {
      setScanError(e?.message || 'Scan failed');
      console.error('[Scanner] Error:', e);
    } finally {
      setScanProgress(100);
      scanLock.current = false;
      setScannerRunning(false);
    }
  }, [activeMode, balance, setPipelineSignals, addPipelineTraces, setMarketRows, setDataLive, setScannerRunning, addSignalToHistory, setMarketRegime]);

  // Initialize universe and start scanning
  useEffect(() => {
    let mounted = true;

    async function boot() {
      try {
        const symbolList = await initializeSymbolUniverse();
        if (!mounted) return;
        setSymbols(symbolList);
        console.log(`[Scanner] Universe loaded: ${symbolList.length} symbols`);

        // Only scan + start interval if scanner is currently ON
        const isActive = useTradingStore.getState().isScannerActive;
        if (!isActive) {
          console.log('[Scanner] Engine is OFF — universe pre-loaded, awaiting Start Engine.');
          return;
        }

        // First scan
        await doScan(symbolList);

        // Periodic scans — only while mounted
        if (mounted) {
          intervalRef.current = setInterval(() => {
            doScan(symbolList);
          }, SCAN_INTERVAL_MS);
        }
      } catch (e: any) {
        console.error('[Scanner] Boot failed:', e);
        setScanError(e?.message || 'Initialization failed');
      }
    }

    boot();

    return () => {
      mounted = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []); // Boot once

  // Re-scan when the engine is turned ON / OFF
  useEffect(() => {
    if (isScannerActive && symbols.length > 0) {
      // Clear out old signals to avoid confusion
      setPipelineSignals([]);
      setMarketRows([]);
      setScanProgress(0);

      // Clear any stale interval before starting fresh
      if (intervalRef.current) clearInterval(intervalRef.current);

      // Immediate first scan
      doScan(symbols);

      // Set up periodic scanning while engine is ON
      intervalRef.current = setInterval(() => {
        doScan(symbols);
      }, SCAN_INTERVAL_MS);
    } else if (!isScannerActive) {
      // User turned off the engine — clear interval and state immediately
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setPipelineSignals([]);
      setMarketRows([]);
      setScanProgress(0);
      setLastScanAt(null);
      setScannerRunning(false);
      scanLock.current = false;
    }
  }, [isScannerActive]); // Removed symbols from deps to avoid spamming on boot

  // Re-scan when mode changes
  useEffect(() => {
    // Always clear old signals on mode change so stale "AGGRESSIVE" signals don't persist in "CONSERVATIVE" view
    setPipelineSignals([]);
    setMarketRows([]);
    setLastScanAt(null);

    if (isScannerActive && symbols.length > 0) {
      doScan(symbols);
    }
  }, [activeMode.key]); // Depend ONLY on mode key so we don't trigger infinitely

  return { scanProgress, lastScanAt, scanError };
}
