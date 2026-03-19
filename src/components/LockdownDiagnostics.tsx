import { Activity, ShieldAlert, ZapOff } from 'lucide-react';
import { useTradingStore } from '../store/tradingStore';

export default function LockdownDiagnostics() {
  const { scannerRunning, isDataLive, pipelineHealth: rawHealth, blockedSignals: rawBlocked } = useTradingStore();
  const pipelineHealth = Array.isArray(rawHealth) ? rawHealth : [];
  const blockedSignals = Array.isArray(rawBlocked) ? rawBlocked : [];

  return (
    <div className="sections-stack">
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        paddingBottom: 16, borderBottom: '1px solid var(--border-subtle)'
      }}>
        <ShieldAlert className="gold-brand" size={24} />
        <div>
          <h2 className="font-cinzel" style={{ fontSize: 18, fontWeight: 900, letterSpacing: '0.1em' }}>
            LOCKDOWN DIAGNOSTICS & HEALTH
          </h2>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.2em', marginTop: 4 }}>
            SYSTEM PIPELINE HEALTH & PROTOCOL GUARD BLOCKS
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 24 }}>
        {/* Pipeline Health */}
        <div style={{
          padding: 24, background: 'rgba(0,0,0,0.3)',
          border: '1px solid var(--border-subtle)', borderRadius: 12,
          display: 'flex', flexDirection: 'column', gap: 16
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 13, fontWeight: 800, color: 'var(--text-secondary)' }}>
            <Activity size={18} color="var(--gold)" />
            PIPELINE HEALTH SCORES
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {pipelineHealth.map((feed, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 11, fontWeight: 800, fontFamily: '"JetBrains Mono", monospace' }}>
                  {feed.label}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ 
                    fontSize: 12, fontWeight: 900, fontFamily: '"JetBrains Mono", monospace',
                    color: feed.status === 'ok' ? 'var(--green)' : 'var(--gold)'
                  }}>
                    {feed.value}%
                  </span>
                  <div style={{ 
                    width: 8, height: 8, borderRadius: '50%',
                    background: feed.status === 'ok' ? 'var(--green)' : 'var(--gold)',
                    boxShadow: feed.status === 'ok' ? '0 0 10px var(--green)' : '0 0 10px var(--gold)'
                  }} />
                </div>
              </div>
            ))}
          </div>

          <div style={{
            marginTop: 8, padding: 12, borderRadius: 8,
            background: !isDataLive
              ? 'rgba(244,63,94,0.08)'
              : scannerRunning
                ? 'rgba(212,175,55,0.08)'
                : 'rgba(16,185,129,0.08)',
            border: `1px solid ${
              !isDataLive
                ? 'rgba(244,63,94,0.2)'
                : scannerRunning
                  ? 'rgba(212,175,55,0.2)'
                  : 'rgba(16,185,129,0.2)'
            }`,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between'
          }}>
            <span style={{
              fontSize: 11, fontWeight: 900, letterSpacing: '0.1em',
              color: !isDataLive ? 'var(--red)' : scannerRunning ? 'var(--gold)' : 'var(--green)',
            }}>
              SYSTEM STATUS
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                width: 7, height: 7, borderRadius: '50%',
                background: !isDataLive ? 'var(--red)' : scannerRunning ? 'var(--gold)' : 'var(--green)',
                boxShadow: !isDataLive
                  ? '0 0 8px var(--red)'
                  : scannerRunning
                    ? '0 0 8px var(--gold)'
                    : '0 0 8px var(--green)',
                animation: scannerRunning ? 'diag-blink 0.8s ease-in-out infinite' : 'none',
              }} />
              <span style={{
                fontSize: 11, fontWeight: 900, fontFamily: '"JetBrains Mono", monospace',
                color: !isDataLive ? 'var(--red)' : scannerRunning ? 'var(--gold)' : 'var(--green)',
              }}>
                {!isDataLive ? 'OFFLINE' : scannerRunning ? 'SCANNING' : 'ONLINE · STANDBY'}
              </span>
            </div>
          </div>
        </div>

        {/* Protocol Guard Blocks */}
        <div style={{
          padding: 24, background: 'rgba(0,0,0,0.3)',
          border: '1px solid var(--border-subtle)', borderRadius: 12,
          display: 'flex', flexDirection: 'column', gap: 16
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 13, fontWeight: 800, color: 'var(--text-secondary)' }}>
            <ZapOff size={18} color="var(--red)" />
            PROTOCOL GUARD BLOCKS
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, overflowY: 'auto' }} className="custom-scrollbar">
            {blockedSignals.map((block, i) => (
              <div key={i} style={{
                padding: '10px 14px', background: 'var(--red-soft)',
                borderLeft: '3px solid var(--red)', borderRadius: 6,
                display: 'flex', flexDirection: 'column', gap: 4
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 12, fontWeight: 900, fontFamily: '"JetBrains Mono", monospace', color: 'var(--text-primary)' }}>
                    {block.symbol}
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: '"JetBrains Mono", monospace' }}>
                    {block.time}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 10, color: 'var(--red)', fontWeight: 800, letterSpacing: '0.05em' }}>
                    {block.reason}
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                    Score: {block.score}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
