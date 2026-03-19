import { useTradingStore } from '../store/tradingStore';
import { Crosshair, Power, Wifi, WifiOff } from 'lucide-react';
import { api } from '../services/api';
import { getCanonicalPositionCount } from '../utils/positionCount';

export default function Header() {
  const { isDataLive, activeMode, activeTrades, binancePositions, pipelineSignals, binanceStatus, isAutoTradeActive, setAutoTradeActive } = useTradingStore();

  const handleToggleAutoTrade = async () => {
    try {
      const res = await api.toggleAutoTrade(!isAutoTradeActive);
      setAutoTradeActive(res.isAutoTradingEnabled);
    } catch (e) {
      console.error(e);
    }
  };

  const signals   = Array.isArray(pipelineSignals)  ? pipelineSignals  : [];
  const trades    = Array.isArray(activeTrades)      ? activeTrades     : [];
  const positions = Array.isArray(binancePositions)  ? binancePositions : [];

  // CANONICAL count — same formula as SystemStatus.tsx and CommandSyncHub.tsx
  const { total: totalActiveCount } = getCanonicalPositionCount(positions, trades, signals);

  return (
    <header style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      flexWrap: 'wrap',
      gap: 20,
      padding: '28px 36px',
      borderRadius: 'var(--radius-xl)',
      background: 'var(--bg-panel)',
      border: '1px solid var(--border-gold)',
      backdropFilter: 'blur(40px)',
      boxShadow: '0 30px 80px -20px rgba(0,0,0,1)'
    }}>
      {/* Left: Brand */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        <div style={{
          width: 48, height: 48,
          borderRadius: 'var(--radius-md)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'linear-gradient(135deg, var(--gold), var(--gold-dark))',
          boxShadow: '0 8px 25px rgba(212,175,55,0.3)'
        }}>
          <Crosshair size={24} color="#000" strokeWidth={3} />
        </div>
        <div>
          <span className="gold-brand" style={{ fontSize: 22, fontWeight: 900, letterSpacing: '0.02em' }}>
            GOLD BONANZA
          </span>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.3em', marginTop: 2, fontWeight: 600 }}>
            INSTITUTIONAL MARKET MICROSTRUCTURE ENGINE
          </div>
        </div>
      </div>

      {/* Center: Status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div className={`status-badge ${binanceStatus === 'CONNECTED' ? 'online' : 'offline'}`}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {binanceStatus === 'CONNECTED' ? <Wifi size={14} color="var(--green)" /> : <WifiOff size={14} color="var(--red)" />}
            <span style={{ letterSpacing: '0.25em' }}>
              {binanceStatus === 'CONNECTED' ? 'BINANCE CONNECTED' : 'BINANCE DISCONNECTED'}
            </span>
          </span>
        </div>

        <div className={`status-badge ${isDataLive ? 'online' : 'offline'}`}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            background: isDataLive ? 'var(--green)' : 'var(--text-muted)',
            display: 'inline-block',
            animation: isDataLive ? 'pulse-green 1.5s ease-in-out infinite' : 'none'
          }} />
          <span style={{ letterSpacing: '0.35em' }}>
            {isDataLive ? 'DATA LIVE' : 'CONNECTING'}
          </span>
        </div>

        <div style={{
          padding: '10px 20px',
          borderRadius: 'var(--radius-full)',
          fontSize: 11, fontWeight: 900,
          border: '1px solid rgba(212,175,55,0.2)',
          background: 'rgba(212,175,55,0.05)',
          color: 'var(--gold-light)',
          letterSpacing: '0.35em'
        }}>
          {activeMode.key}
        </div>

        {totalActiveCount > 0 && (
          <div style={{
            padding: '10px 20px',
            borderRadius: 'var(--radius-full)',
            fontSize: 11, fontWeight: 900,
            border: '1px solid rgba(59,130,246,0.2)',
            background: 'rgba(59,130,246,0.05)',
            color: 'var(--blue)',
            letterSpacing: '0.2em'
          }}>
            {totalActiveCount} ACTIVE
          </div>
        )}

        {/* KILL SWITCH */}
        <button
          onClick={handleToggleAutoTrade}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '10px 20px',
            borderRadius: 'var(--radius-full)',
            fontSize: 11, fontWeight: 900,
            border: `1px solid ${isAutoTradeActive ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
            background: isAutoTradeActive ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
            color: isAutoTradeActive ? 'var(--green)' : 'var(--red)',
            letterSpacing: '0.2em', cursor: 'pointer', transition: 'all 0.2s'
          }}
        >
          <Power size={14} />
          AUTO-TRADE: {isAutoTradeActive ? 'ON' : 'OFF'}
        </button>
      </div>

    </header>
  );
}
