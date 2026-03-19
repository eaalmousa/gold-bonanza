import { useEffect, useState, useRef } from 'react';
import { Terminal, Power, ChevronRight, XCircle, CheckCircle } from 'lucide-react';
import { api } from '../services/api';
import { useTradingStore } from '../store/tradingStore';

interface AutoTraderStatus {
  enabled: boolean;
  logs: string[];
}

export default function AutoTraderConsole() {
  const [status, setStatus] = useState<AutoTraderStatus>({ enabled: false, logs: [] });
  const { setAutoTradeActive, isAutoTradeActive } = useTradingStore();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await api.getAutoTradeStatus();
        // FIXED: /trade/status now returns { enabled, autoTrading, logs, config }
        // We read 'enabled' (added in fix) with fallback to 'autoTrading' for backwards compatibility.
        const resolvedEnabled = res?.enabled ?? res?.autoTrading ?? false;
        const resolvedLogs = Array.isArray(res?.logs) ? res.logs : [];
        const safeRes: AutoTraderStatus = { enabled: resolvedEnabled, logs: resolvedLogs };
        setStatus(safeRes);
        if (safeRes.enabled !== isAutoTradeActive) {
          setAutoTradeActive(safeRes.enabled);
        }
      } catch (e) {
        console.warn('Failed to fetch auto-trader status:', e);
      }
    };

    fetchStatus();
    const intervalId = setInterval(fetchStatus, 3000);
    return () => clearInterval(intervalId);
  }, [isAutoTradeActive, setAutoTradeActive]);

  useEffect(() => {
    // Auto-scroll to bottom of logs within the container only
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [status.logs]);

  const toggleAutoTrader = async () => {
    try {
      const newState = !status.enabled;
      await api.toggleAutoTrade(newState);
      setStatus((prev) => ({ ...prev, enabled: newState }));
      setAutoTradeActive(newState);
    } catch (e) {
      console.error('Failed to toggle auto-trader', e);
    }
  };

  const parseLogLine = (log: string) => {
    // Extract timestamp and message
    const match = log.match(/^\[(.*?)\] (.*)$/);
    if (!match) return { time: '', msg: log, type: 'info' };
    
    const [, timeStr, msgRaw] = match;
    const time = new Date(timeStr).toLocaleTimeString();
    let msg = msgRaw.replace('[AutoTrader] ', '');

    let type = 'info';
    let icon = <ChevronRight size={12} color="var(--text-muted)" />;
    let color = 'var(--text-secondary)';

    if (msg.includes('Blocked') || msg.includes('Skipping') || msg.includes('REJECT') || msg.includes('❌')) {
      type = 'blocked';
      icon = <XCircle size={12} color="var(--red)" />;
      color = 'var(--text-muted)'; // Keep it subtle so it doesn't overwhelm
      if (msg.includes('Circuit Breaker') || msg.includes('deep red')) {
        color = 'var(--red)';
      }
    } else if (msg.includes('Deployed') || msg.includes('🚀') || msg.includes('✅') || msg.includes('ACCEPT') || msg.includes('EXECUTING')) {
      type = 'success';
      icon = <CheckCircle size={12} color="var(--green)" />;
      color = 'var(--green)';
    } else if (msg.includes('ON') || msg.includes('OFF') || msg.includes('Updated') || msg.includes('Config') || msg.includes('Scanning') || msg.includes('Loaded')) {
      type = 'system';
      icon = <ChevronRight size={12} color="var(--gold)" />;
      color = 'var(--gold)';
    }

    return { time, msg, type, color, icon };
  };

  return (
    <section>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 16
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Terminal size={18} color="var(--gold)" />
          <div>
            <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: '0.25em', color: 'var(--gold-light)' }}>
              AUTO-TRADER DEPLOYMENT CONSOLE
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.05em', marginTop: 4 }}>
              Live execution logs, circuit breaker events, and block reasons
            </div>
          </div>
        </div>

        <button
          onClick={toggleAutoTrader}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 16px', borderRadius: 8,
            fontSize: 10, fontWeight: 900, letterSpacing: '0.15em',
            background: status.enabled ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
            border: `1px solid ${status.enabled ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
            color: status.enabled ? 'var(--green)' : 'var(--red)',
            cursor: 'pointer', transition: 'all 0.2s',
          }}
        >
          <Power size={13} />
          {status.enabled ? 'LIVE-TRADING: ON' : 'LIVE-TRADING: OFF'}
        </button>
      </div>

      <div style={{
        background: 'rgba(0,0,0,0.6)',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid rgba(255,255,255,0.05)',
        height: 250,
        overflowY: 'auto',
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace", // Using inline mono font
      }} ref={containerRef}>
        {status.logs.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 11, textAlign: 'center', marginTop: 100 }}>
            {status.enabled
              ? 'Auto-Trader is ON. Monitoring signals... waiting for deployment events.'
              : 'Auto-Trader is OFF. Toggle ON to begin scanning and deployment.'}
          </div>
        ) : (
          [...status.logs].reverse().map((log, i) => {
            const parsed = parseLogLine(log);
            return (
              <div key={i} style={{
                display: 'flex', gap: 12, fontSize: 11, lineHeight: 1.5,
                background: parsed.type === 'blocked' ? 'transparent' : 'rgba(255,255,255,0.01)',
                padding: '4px 8px', borderRadius: 4,
                borderLeft: parsed.type === 'success' ? '2px solid var(--green)' 
                          : parsed.type === 'system' ? '2px solid var(--gold)'
                          : '2px solid transparent',
                alignItems: 'flex-start'
              }}>
                <div style={{ color: 'rgba(255,255,255,0.2)', flexShrink: 0, width: 60, marginTop: 2 }}>
                  {parsed.time}
                </div>
                <div style={{ marginTop: 2, flexShrink: 0 }}>
                  {parsed.icon}
                </div>
                <div style={{ color: parsed.color, wordBreak: 'break-word', flex: 1 }}>
                  {parsed.msg}
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
