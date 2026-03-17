// SystemStatus component
import React, { useEffect, useState } from 'react';
import { useTradingStore } from '../store/tradingStore';
import { Shield, Zap, Flame } from 'lucide-react';
import { api } from '../services/api';

export default function SystemStatus() {
  const { 
    activeMode, setMode, activeTrades, symbols, 
    isScannerActive, setScannerActive 
  } = useTradingStore();

  const [config, setConfig] = useState({
    riskPct: 0.04,
    maxTrades: 4,
    leverage: 5,
    slEnabled: false,
    tpEnabled: true,
    tp1Only: false,
    tp1RR: 0.35,
    tp2RR: 0.50,
    minScore: 13,
    btcGate: true,
  });
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    // Keep it synced with backend
    api.getAutoTradeConfig()
      .then(res => {
        const newCfg = {
          riskPct: res.riskPerTrade ?? 0.04,
          maxTrades: res.maxConcurrent ?? 4,
          leverage: res.leverage ?? 5,
          slEnabled: res.slEnabled ?? false,
          tpEnabled: res.tpEnabled ?? true,
          tp1Only: res.tp1Only ?? false,
          tp1RR: res.tp1RR ?? 0.35,
          tp2RR: res.tp2RR ?? 0.50,
          minScore: res.minScore ?? 13,
          btcGate: res.btcGateEnabled ?? true,
        };
        setConfig(newCfg);
        setIsLoaded(true);
      })
      .catch(console.error);
  }, []);

  // saveConfig was historically used here but is now rolled into handleConfigChange

  const handleConfigChange = (key: keyof typeof config, value: any) => {
    const val = typeof value === 'boolean' ? value : Number(value);
    const newConf = { ...config, [key]: val };
    setConfig(newConf);
    
    // Save to the backend immediately 
    // This prevents the "onBlur" bug where hitting Enter or not clicking away fails to save changes.
    api.updateAutoTradeConfig({
      riskPerTrade: newConf.riskPct,
      maxConcurrent: newConf.maxTrades,
      leverage: newConf.leverage,
      slEnabled: newConf.slEnabled,
      tpEnabled: newConf.tpEnabled,
      tp1Only: newConf.tp1Only,
      tp1RR: newConf.tp1RR,
      tp2RR: newConf.tp2RR,
      minScore: newConf.minScore,
      btcGateEnabled: newConf.btcGate,
    }).catch(console.error);
  };

  const capacity = activeTrades.length / config.maxTrades;
  const capacityPct = Math.min(100, Math.round((isNaN(capacity) ? 0 : capacity) * 100));

  const modes = [
    { key: 'CONSERVATIVE', icon: <Shield size={14} />, label: 'CONSERVATIVE' },
    { key: 'BALANCED', icon: <Zap size={14} />, label: 'BALANCED' },
    { key: 'AGGRESSIVE', icon: <Flame size={14} />, label: 'AGGRESSIVE' },
  ];

  return (
    <section style={{
      padding: '28px 36px',
      borderRadius: 'var(--radius-xl)',
      background: 'var(--bg-panel)',
      border: '1px solid var(--border-gold)',
      backdropFilter: 'blur(40px)',
      boxShadow: '0 30px 80px -20px rgba(0,0,0,1)',
      opacity: isLoaded ? 1 : 0.5,
      pointerEvents: isLoaded ? 'auto' : 'none',
      transition: 'opacity 0.3s'
    }}>
      {/* Top row */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 16, marginBottom: 20
      }}>
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.35em', fontWeight: 900, marginBottom: 4 }}>
            {!isLoaded ? 'SYNCING WITH CLOUD...' : 'SYSTEM STATUS'}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600 }}>
            {symbols.length} Pairs Monitored · {activeTrades.length}/{config.maxTrades} Positions Open
          </div>
        </div>

        {/* Mode switches */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            onClick={() => {
              const newState = !isScannerActive;
              setScannerActive(newState);
              // Removed api.toggleAutoTrade so they are separate
            }}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '12px 24px',
              borderRadius: 'var(--radius-full)',
              fontSize: 11, fontWeight: 900,
              border: `1px solid ${isScannerActive ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)'}`,
              background: isScannerActive ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)',
              color: isScannerActive ? 'var(--red)' : 'var(--green)',
              letterSpacing: '0.2em', cursor: 'pointer', transition: 'all 0.2s',
              marginRight: 12
            }}
          >
            {isScannerActive ? <Flame size={14} /> : <Zap size={14} />}
            {isScannerActive ? 'STOP ENGINE' : 'START ENGINE'}
          </button>

          {modes.map(m => (
            <button
              key={m.key}
              className={`mode-btn ${activeMode.key === m.key ? 'active' : ''}`}
              onClick={() => {
                setMode(m.key);
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {m.icon}
                {m.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Bottom row */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 20
      }}>
        {/* Capacity bar */}
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between', marginBottom: 6,
            fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.2em', fontWeight: 800
          }}>
            <span>OPS CAPACITY</span>
            <span>{capacityPct}%</span>
          </div>
          <div className="capacity-bar-track">
            <div
              className={`capacity-bar-fill ${capacityPct >= 100 ? 'full' : ''}`}
              style={{ width: `${capacityPct}%` }}
            />
          </div>
        </div>

        {/* Editable Stats */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          
          <div style={inputContainerStyle}>
            <div style={labelStyle}>RISK %</div>
            <input 
              type="number" step="0.01"
              style={inputStyle}
              value={(config.riskPct * 100).toFixed(2)}
              onChange={e => handleConfigChange('riskPct', String(Number(e.target.value) / 100))}
            />
          </div>

          <div style={inputContainerStyle}>
            <div style={labelStyle}>MAX TRADES</div>
            <input 
              type="number" step="1"
              style={inputStyle}
              value={config.maxTrades}
              onChange={e => handleConfigChange('maxTrades', e.target.value)}
            />
          </div>

          <div style={inputContainerStyle}>
            <div style={labelStyle}>LEVERAGE</div>
            <input 
              type="number" step="1"
              style={inputStyle}
              value={config.leverage}
              onChange={e => handleConfigChange('leverage', e.target.value)}
            />
          </div>

          <div style={inputContainerStyle}>
            <div style={labelStyle}>MIN SCORE</div>
            <input 
              type="number" step="1"
              style={{ ...inputStyle, color: 'var(--green)' }}
              value={config.minScore}
              onChange={e => handleConfigChange('minScore', e.target.value)}
            />
          </div>

          {/* SL TOGGLE */}
          <div style={inputContainerStyle}>
            <div style={labelStyle}>SL</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
              <input 
                type="checkbox"
                checked={config.slEnabled}
                onChange={e => handleConfigChange('slEnabled', e.target.checked)}
                style={{ cursor: 'pointer' }}
              />
              <span style={{ fontSize: 10, fontWeight: 900, color: config.slEnabled ? 'var(--green)' : 'var(--red)' }}>
                {config.slEnabled ? 'ON' : 'OFF'}
              </span>
            </div>
          </div>

          {/* BTC GATE TOGGLE */}
          <div style={inputContainerStyle}>
            <div style={{ ...labelStyle, color: config.btcGate ? 'var(--text-muted)' : 'var(--gold)' }}>BTC GATE</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
              <input
                type="checkbox"
                checked={config.btcGate}
                onChange={e => handleConfigChange('btcGate', e.target.checked)}
                style={{ cursor: 'pointer', accentColor: 'var(--gold)' }}
              />
              <span style={{ fontSize: 10, fontWeight: 900, color: config.btcGate ? 'var(--green)' : 'var(--gold)' }}>
                {config.btcGate ? 'ON' : 'OFF'}
              </span>
            </div>
          </div>

          {/* TP TOGGLE, TP1-ONLY & MULTIPLIERS */}
          <div style={{ ...inputContainerStyle, flexDirection: 'row', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={labelStyle}>TP</div>
              <input 
                type="checkbox"
                checked={config.tpEnabled}
                onChange={e => handleConfigChange('tpEnabled', e.target.checked)}
                style={{ cursor: 'pointer', marginTop: 4 }}
              />
            </div>

            {config.tpEnabled && (
              <>
                <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.1)', margin: '0 4px' }} />
                {/* TP1-ONLY toggle */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div style={{ ...labelStyle, color: config.tp1Only ? 'var(--gold)' : 'var(--text-muted)' }}>TP1 ONLY</div>
                  <input
                    type="checkbox"
                    checked={config.tp1Only}
                    onChange={e => handleConfigChange('tp1Only', e.target.checked)}
                    style={{ cursor: 'pointer', marginTop: 4, accentColor: 'var(--gold)' }}
                  />
                </div>
                <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.1)', margin: '0 4px' }} />
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', opacity: config.tp1Only ? 0.35 : 1 }}>
                  <div style={labelStyle}>TP1 (R)</div>
                  <input 
                    type="number" step="0.1"
                    style={{ ...inputStyle, width: '45px', fontSize: 13 }}
                    value={config.tp1RR}
                    onChange={e => handleConfigChange('tp1RR', e.target.value)}
                  />
                </div>
                {!config.tp1Only && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div style={labelStyle}>TP2 (R)</div>
                    <input 
                      type="number" step="0.1"
                      style={{ ...inputStyle, width: '45px', fontSize: 13 }}
                      value={config.tp2RR}
                      onChange={e => handleConfigChange('tp2RR', e.target.value)}
                    />
                  </div>
                )}
              </>
            )}
          </div>

        </div>
      </div>
    </section>
  );
}

const inputContainerStyle: React.CSSProperties = {
  padding: '6px 14px',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border-subtle)',
  background: 'rgba(0,0,0,0.3)',
  textAlign: 'center',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center'
};

const labelStyle: React.CSSProperties = {
  fontSize: 9, 
  color: 'var(--text-muted)', 
  letterSpacing: '0.2em', 
  fontWeight: 800, 
  marginBottom: 4
};

const inputStyle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 900,
  color: 'var(--gold-light)',
  fontStyle: 'italic',
  background: 'transparent',
  border: 'none',
  textAlign: 'center',
  outline: 'none',
  width: '60px',
  fontFamily: 'monospace'
};

