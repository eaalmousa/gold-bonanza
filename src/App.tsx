import { useEffect } from 'react';
import LoginGate from './components/LoginGate';
import Header from './components/Header';
import SystemStatus from './components/SystemStatus';
import SniperSignals from './components/SniperSignals';
import BreakoutSignals from './components/BreakoutSignals';
import MarketIntelligence from './components/MarketIntelligence';
import CommandSyncHub from './components/CommandSyncHub';
import InstitutionalLiquidityMap from './components/InstitutionalLiquidityMap';
import SniperRadar from './components/SniperRadar';
import LockdownDiagnostics from './components/LockdownDiagnostics';
import TriggerLayers from './components/TriggerLayers';
import MicrostructureTable from './components/MicrostructureTable';
import CurrencyAnalyzer from './components/CurrencyAnalyzer';
import { useScanner } from './hooks/useScanner';
import { useLiveFeeds } from './hooks/useLiveFeeds';
import { useTradingStore } from './store/tradingStore';
import { Activity, AlertTriangle, Loader2 } from 'lucide-react';
import { api } from './services/api';

function App() {
  const {
    sniperSignals, breakoutSignals, marketRows,
    scannerRunning, queueSignal, setBinanceStatus,
    setScannerActive
  } = useTradingStore();

  const { scanProgress, lastScanAt, scanError } = useScanner();
  
  // 1. Initial Sync with Cloud State
  useEffect(() => {
    const sync = async () => {
      try {
        const config = await api.getAutoTradeConfig();
        if (config.enabled !== undefined) {
          setScannerActive(config.enabled);
        }
      } catch (e) {
        console.warn('[Sync] Could not fetch initial state from cloud');
      }
    };
    sync();
  }, [setScannerActive]);

  // 2. Check binance connectivity
  useEffect(() => {
    const check = async () => {
      try {
        await api.getPositions();
        setBinanceStatus('CONNECTED');
      } catch (e) {
        setBinanceStatus('ERROR');
      }
    };
    check();
    const inv = setInterval(check, 10000);
    return () => clearInterval(inv);
  }, [setBinanceStatus]);

  // Mount the live websocket feeds
  useLiveFeeds();

  return (
    <LoginGate>
    <div className="sections-stack" style={{ maxWidth: 1600, margin: '0 auto' }}>
      <Header />
      <SystemStatus />

      <div className="terminal-panel" style={{ padding: '32px' }}>
        <LockdownDiagnostics />
      </div>

      {/* Scan progress bar */}
      {scannerRunning && (
        <div style={{
          padding: '16px 24px',
          borderRadius: 'var(--radius-lg)',
          background: 'rgba(13,17,23,0.96)',
          border: '1px solid var(--border-gold)',
          display: 'flex', alignItems: 'center', gap: 14
        }}>
          <Loader2 size={16} color="var(--gold)" style={{
            animation: 'spin 1s linear infinite'
          }} />
          <div style={{ flex: 1 }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.2em', fontWeight: 800, marginBottom: 6
            }}>
              <span>SCANNING MARKET UNIVERSE</span>
              <span>{scanProgress}%</span>
            </div>
            <div className="capacity-bar-track">
              <div className="capacity-bar-fill" style={{ width: `${scanProgress}%` }} />
            </div>
          </div>
        </div>
      )}

      {/* Error banner */}
      {scanError && (
        <div style={{
          padding: '14px 22px',
          borderRadius: 'var(--radius-lg)',
          background: 'var(--red-soft)',
          border: '1px solid rgba(244,63,94,0.2)',
          display: 'flex', alignItems: 'center', gap: 10,
          color: 'var(--red)', fontSize: 12, fontWeight: 600
        }}>
          <AlertTriangle size={16} />
          {scanError}
        </div>
      )}

      {/* Last scan info */}
      {lastScanAt && !scannerRunning && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
          gap: 8, fontSize: 10, color: 'var(--text-muted)', fontWeight: 600
        }}>
          <Activity size={12} />
          <span>Last scan: {new Date(lastScanAt).toLocaleTimeString()}</span>
          <span>· Next: ~{Math.round(90 - (Date.now() - lastScanAt) / 1000)}s</span>
        </div>
      )}

      {/* Microstructure & Liquidity Panels */}
      <div className="terminal-panel" style={{ padding: '32px' }}>
        <div className="sections-stack" style={{ gap: 36 }}>
          <InstitutionalLiquidityMap />
          <TriggerLayers />
        </div>
      </div>

      {/* Main Signal Panels */}
      <div className="terminal-panel" style={{ padding: '32px' }}>
        <div className="sections-stack" style={{ gap: 36 }}>
          <SniperRadar />
          <BreakoutSignals signals={breakoutSignals} onDeploy={(row) => queueSignal(row.id, 'breakout')} />
          <SniperSignals signals={sniperSignals} onDeploy={(row) => queueSignal(row.id, 'SNIPER')} />
        </div>
      </div>

      <div className="terminal-panel" style={{ padding: '32px' }}>
        <CommandSyncHub />
      </div>

      <div className="terminal-panel" style={{ padding: '32px' }}>
        <MarketIntelligence rows={marketRows} />
      </div>

      <div className="terminal-panel" style={{ padding: '32px' }}>
        <CurrencyAnalyzer />
      </div>

      <div className="terminal-panel" style={{ padding: '32px' }}>
        <MicrostructureTable />
      </div>

      {/* Footer */}
      <footer style={{
        textAlign: 'center',
        padding: '20px',
        fontSize: 10,
        color: 'var(--text-muted)',
        letterSpacing: '0.15em',
        fontWeight: 600
      }}>
        GOLD BONANZA v12 — INSTITUTIONAL MARKET MICROSTRUCTURE ENGINE — ANTIGRAVITY BUILD
      </footer>

      {/* Spin animation for loader */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
    </LoginGate>
  );
}

export default App;
