// PipelineObservability — Live Pipeline Trace Table
// Fixed: Removed all TailwindCSS classes (project uses vanilla CSS only).
//        All styling is now inline style objects compatible with the design system.
import React from 'react';
import { useTradingStore } from '../store/tradingStore';
import { Activity } from 'lucide-react';

export function PipelineObservability() {
  const rawTraces = useTradingStore(s => s.pipelineTraces);
  const traces = Array.isArray(rawTraces) ? rawTraces : [];

  const containerStyle: React.CSSProperties = {
    background: 'rgba(13,17,23,0.96)',
    border: '1px solid rgba(35,38,49,0.9)',
    borderRadius: 'var(--radius-xl)',
    padding: '20px 24px',
    marginBottom: 24,
    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
  };

  const headerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  };

  const titleRowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  };

  const badgeStyle: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 700,
    padding: '3px 10px',
    background: 'rgba(30,41,59,0.9)',
    color: 'rgba(148,163,184,0.9)',
    borderRadius: 6,
    border: '1px solid rgba(51,65,85,0.6)',
    letterSpacing: '0.05em',
  };

  const isScannerActive = useTradingStore(s => s.isScannerActive);
  const lastScanAt = useTradingStore(s => s.lastScanAt);

  if (traces.length === 0) {
    return (
      <div style={containerStyle}>
        <div style={headerStyle}>
          <div style={titleRowStyle}>
            <div style={{
              width: 10, height: 10, borderRadius: '50%',
              background: isScannerActive ? 'var(--green)' : 'rgba(51,65,85,0.9)',
              boxShadow: isScannerActive ? '0 0 10px var(--green)' : 'none',
              animation: (isScannerActive && !lastScanAt) ? 'pulse 2s infinite' : 'none'
            }} />
            <span style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: 13 }}>
              Pipeline Observability
            </span>
          </div>
          {isScannerActive && !lastScanAt && (
             <span style={{ fontSize: 10, color: 'var(--gold)', fontWeight: 800 }}>INITIALIZING SCOUT CYCLE...</span>
          )}
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 10 }}>
          {isScannerActive 
            ? "Background scout is active. Awaiting first market evaluation traces (90s cycle)..."
            : "Awaiting signal pipeline output... Start the Engine to trigger the background scout."}
        </p>
      </div>
    );
  }

  const statusStyle = (status: string): React.CSSProperties => {
    if (status === 'ACCEPTED') return {
      background: 'rgba(16,185,129,0.1)', color: '#34d399',
      border: '1px solid rgba(16,185,129,0.25)',
    };
    if (status === 'REJECTED') return {
      background: 'rgba(239,68,68,0.1)', color: '#f87171',
      border: '1px solid rgba(239,68,68,0.2)',
    };
    if (status === 'INVALIDATED') return {
      background: 'rgba(100,116,139,0.1)', color: '#94a3b8',
      border: '1px solid rgba(100,116,139,0.2)',
    };
    return {
      background: 'rgba(245,158,11,0.1)', color: '#fbbf24',
      border: '1px solid rgba(245,158,11,0.2)',
    };
  };

  const timingStyle = (timing?: string): React.CSSProperties => {
    if (timing === 'OPTIMAL') return { color: '#34d399' };
    if (timing === 'EARLY') return { color: '#fbbf24' };
    if (timing === 'LATE') return { color: '#f87171' };
    return { color: 'var(--text-muted)' };
  };

  const thStyle: React.CSSProperties = {
    padding: '10px 14px',
    fontWeight: 600,
    fontSize: 11,
    color: 'rgba(148,163,184,0.8)',
    letterSpacing: '0.05em',
    textAlign: 'left',
    background: 'rgba(24,26,36,0.95)',
    borderBottom: '1px solid rgba(35,38,49,0.8)',
    whiteSpace: 'nowrap',
  };

  const tdStyle: React.CSSProperties = {
    padding: '9px 14px',
    fontSize: 11,
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    color: 'rgba(148,163,184,0.9)',
    borderBottom: '1px solid rgba(35,38,49,0.4)',
    verticalAlign: 'middle',
  };

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <div style={titleRowStyle}>
          <Activity size={14} color="#34d399" style={{ animation: 'pulse 2s infinite' }} />
          <span style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: 13 }}>
            Live Pipeline Observability
          </span>
        </div>
        <span style={badgeStyle}>
          Last {traces.length} Traces
        </span>
      </div>

      <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid rgba(35,38,49,0.8)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 12 }}>
          <thead>
            <tr>
              <th style={thStyle}>Symbol</th>
              <th style={thStyle}>Engine</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Score</th>
              <th style={thStyle}>Type</th>
              <th style={thStyle}>Timing</th>
              <th style={{ ...thStyle, maxWidth: 240 }}>Last Reason</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>BREAKDOWN</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>BTC Skip</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>Late Cap</th>
            </tr>
          </thead>
          <tbody>
            {traces.slice(0, 50).map(t => (
              <tr key={t.id} style={{ transition: 'background 0.15s' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(24,26,36,0.7)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <td style={{ ...tdStyle, color: '#f8fafc', fontWeight: 700 }}>{t.symbol}</td>
                <td style={{ ...tdStyle, color: '#34d399' }}>{t.engine}</td>
                <td style={tdStyle}>
                  <span style={{
                    ...statusStyle(t.status),
                    padding: '2px 8px', borderRadius: 4,
                    fontSize: 10, fontWeight: 700, letterSpacing: '0.05em',
                    display: 'inline-block'
                  }}>
                    {t.status}
                  </span>
                </td>
                <td style={tdStyle}>
                  <span style={{ color: t.score != null && t.score >= 10 ? '#34d399' : 'var(--text-muted)' }}>
                    {t.score ?? '-'}
                  </span>
                </td>
                <td style={tdStyle}>{t.entryType || '-'}</td>
                <td style={{ ...tdStyle, ...timingStyle(t.entryTiming) }}>
                  {t.entryTiming || '-'}
                </td>
                <td style={{ ...tdStyle, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'rgba(203,213,225,0.8)' }}
                  title={t.lastRejectReason}>
                  {t.lastRejectReason || '-'}
                </td>
                <td style={{ ...tdStyle, textAlign: 'center' }}>
                  {t.usedBreakingDownBypass
                    ? <span style={{ color: '#f87171', fontWeight: 700 }}>✓</span>
                    : <span style={{ color: 'rgba(100,116,139,0.5)' }}>-</span>}
                </td>
                <td style={{ ...tdStyle, textAlign: 'center' }}>
                  {t.usedBtcBypass
                    ? <span style={{ color: '#60a5fa', fontWeight: 700 }}>✓</span>
                    : <span style={{ color: 'rgba(100,116,139,0.5)' }}>-</span>}
                </td>
                <td style={{ ...tdStyle, textAlign: 'center' }}>
                  {t.usedLateException
                    ? <span style={{ color: '#fbbf24', fontWeight: 700 }}>✓</span>
                    : <span style={{ color: 'rgba(100,116,139,0.5)' }}>-</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
