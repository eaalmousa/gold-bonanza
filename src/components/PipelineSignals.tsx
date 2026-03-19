import { useEffect, useState } from 'react';
import type { SignalRow } from '../types/trading';
import { AlertTriangle, XCircle, ShieldCheck, Crosshair, Zap, BarChart2, TrendingUp, Clock, ShieldAlert } from 'lucide-react';
import ChartModal from './ChartModal';
import { useTradingStore } from '../store/tradingStore';

interface Props {
  signals: SignalRow[];
  onDeploy?: (signal: SignalRow) => void;
}

export default function PipelineSignals({ signals, onDeploy }: Props) {
  const { backendSignals, executionMode } = useTradingStore();
  
  // DRIVER: Calculate Cycle Summary based on backend state
  const backendListAll = Object.values(backendSignals);
  const deployedCount = backendListAll.filter(s => s.backendDecision === 'DEPLOYED_BACKEND').length;
  const blockedCount = backendListAll.filter(s => s.backendDecision === 'BLOCKED_BACKEND').length;
  const foundCount = backendListAll.length;

  const signalList = Array.isArray(signals) ? signals : [];


  // Filter signals to keep only active/relevant ones
  const filtered = signalList.filter(s => 
    s.status === 'ACCEPTED' || 
    s.status === 'PENDING' || 
    s.status === 'INVALIDATED' || 
    s.status === 'EXPIRED'
  );

  const backendList = filtered.filter(s => !!backendSignals[s.id]);
  const frontendList = filtered.filter(s => !backendSignals[s.id]);

  if (!filtered.length) {
    return (
      <section>
        <SectionHeader count={0} label="PIPELINE STATUS" />
        <EmptyState label="No active signals detected. Scanner is actively monitoring..." />
      </section>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 40 }}>
      {/* CYCLE SUMMARY HEADER */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 24, padding: '16px 24px',
        background: 'rgba(0,0,0,0.2)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)',
        marginBottom: -10
      }}>
        <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: '0.1em', color: 'var(--text-muted)' }}>CYCLE SUMMARY:</div>
        <div style={{ display: 'flex', gap: 16 }}>
          <SummaryBadge label="SEEN" count={foundCount} color="var(--blue)" />
          <SummaryBadge label="BLOCKED" count={blockedCount} color="var(--red)" />
          <SummaryBadge label="DEPLOYED" count={deployedCount} color="var(--green)" />
        </div>
      </div>

      {/* SECTION A: BACKEND EXECUTION TRUTH */}
      {backendList.length > 0 && (
        <section>
          <SectionHeader 
            count={backendList.length} 
            label="BACKEND EXECUTION TRUTH" 
            sub={`Authenticated server decisions [${executionMode}]`}
            color="var(--gold)"
          />
          <div className="signal-grid">
            {backendList.map((s, i) => (
              <SignalCard key={s.id} row={s} onDeploy={onDeploy} index={i} isTruth={true} />
            ))}
          </div>
        </section>
      )}

      {/* SECTION B: LOCAL SCANNER TELEMETRY */}
      {frontendList.length > 0 && (
        <section>
          <SectionHeader 
            count={frontendList.length} 
            label="LOCAL SCANNER TELEMETRY" 
            sub="Client-side only. Not yet verified by backend."
            color="var(--blue)"
          />
          <div className="signal-grid" style={{ opacity: 0.8 }}>
            {frontendList.map((s, i) => (
              <SignalCard key={s.id} row={s} onDeploy={onDeploy} index={i} isTruth={false} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function SummaryBadge({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-secondary)' }}>{label}</div>
      <div style={{
        padding: '2px 8px', borderRadius: 4, background: 'rgba(255,255,255,0.03)',
        border: `1px solid ${color}`, color: color, fontSize: 11, fontWeight: 900
      }}>
        {count}
      </div>
    </div>
  );
}

function SectionHeader({ count, label, sub, color }: { count: number; label: string; sub?: string; color?: string }) {
  return (
    <div style={{ marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderBottom: '1px solid var(--border-subtle)', paddingBottom: 12 }}>
      <div>
        <h2 style={{ fontSize: 13, fontWeight: 900, color: color || 'var(--text-primary)', letterSpacing: '0.15em', display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          {label} <span style={{ opacity: 0.5 }}>[{count}]</span>
        </h2>
        {sub && <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600 }}>{sub.toUpperCase()}</div>}
      </div>
    </div>
  );
}

function SignalCard({ row, onDeploy, index, isTruth }: { row: SignalRow; onDeploy?: (r: SignalRow) => void; index: number; isTruth: boolean }) {
  const sig = row.signal;
  const sym = row.symbol.replace('USDT', '');
  const changePct = row.change24h ?? 0;
  const [chartOpen, setChartOpen] = useState(false);

  const isSniper = sig.kind === 'SNIPER' || sig.kind === 'SUPER_SNIPER';
  const glowClass = isSniper ? 'sniper-glow' : 'breakout-glow';
  
  const { backendSignals } = useTradingStore();
  const backendState = backendSignals[row.id];
  const finalStatus = backendState?.backendDecision || row.status;

  const StatusIcon = 
    finalStatus === 'DEPLOYED_BACKEND' ? <ShieldCheck size={16} /> :
    finalStatus === 'BLOCKED_BACKEND' ? <ShieldAlert size={16} /> :
    finalStatus === 'ACCEPTED' ? <TrendingUp size={16} /> :
    finalStatus === 'PENDING' ? <Clock size={16} /> :
    finalStatus === 'INVALIDATED' ? <AlertTriangle size={16} /> :
    <XCircle size={16} />;

  const statusColors: any = {
    ACCEPTED: 'rgba(34, 197, 94, 0.1)',
    ACCEPTED_BACKEND: 'rgba(34, 197, 94, 0.15)',
    PENDING: 'rgba(245, 158, 11, 0.1)',
    INVALIDATED: 'rgba(239, 68, 68, 0.1)',
    EXPIRED: 'rgba(100, 116, 139, 0.1)',
    BLOCKED_BACKEND: 'rgba(239, 68, 68, 0.15)',
    DEPLOYED_BACKEND: 'rgba(34, 197, 94, 0.2)',
    UI_ONLY: 'rgba(59, 130, 246, 0.1)'
  };
  const statusBorder: any = {
    ACCEPTED: 'rgba(34, 197, 94, 0.3)',
    ACCEPTED_BACKEND: 'rgba(34, 197, 94, 0.5)',
    PENDING: 'rgba(245, 158, 11, 0.3)',
    INVALIDATED: 'rgba(239, 68, 68, 0.3)',
    EXPIRED: 'rgba(100, 116, 139, 0.3)',
    BLOCKED_BACKEND: 'rgba(239, 68, 68, 0.5)',
    DEPLOYED_BACKEND: 'rgba(34, 197, 94, 0.6)',
    UI_ONLY: 'rgba(59, 130, 246, 0.3)'
  };
  const statusText: any = {
    ACCEPTED: 'var(--green)',
    ACCEPTED_BACKEND: 'var(--green)',
    PENDING: 'var(--amber)',
    INVALIDATED: 'var(--red)',
    EXPIRED: 'var(--text-muted)',
    BLOCKED_BACKEND: 'var(--red)',
    DEPLOYED_BACKEND: 'var(--green)',
    UI_ONLY: 'var(--blue)'
  };

  useEffect(() => {
    // Play on first mount — only if the card was freshly discovered (not a page-load restore)
    const isNew = !row.timestamp || (Date.now() - row.timestamp < 60000);
    if (isNew && row.status === 'ACCEPTED') {
      if (sig.kind === 'SUPER_SNIPER') {
        new Audio('/super_sniper_alert.mp3').play().catch((e) => console.warn('Audio play failed', e));
      } else {
        new Audio('/sniper_alert.mp3').play().catch((e) => console.warn('Audio play failed', e));
      }
    }
  }, [row.timestamp, row.status, sig.kind]);

  return (
    <div
      className={`opportunity-card ${finalStatus === 'ACCEPTED' || finalStatus === 'DEPLOYED_BACKEND' ? glowClass : ''} card-entry`}
      style={{ padding: '24px 22px', animationDelay: `${index * 0.08}s`, opacity: (finalStatus !== 'ACCEPTED' && finalStatus !== 'DEPLOYED_BACKEND' && finalStatus !== 'PENDING') ? 0.6 : 1 }}
    >
      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 'var(--radius-sm)',
            background: isSniper ? 'rgba(212,175,55,0.1)' : 'rgba(59,130,246,0.1)',
            border: `1px solid ${isSniper ? 'rgba(212,175,55,0.2)' : 'rgba(59,130,246,0.2)'}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
          }}>
            {isSniper ? <Crosshair size={16} color="var(--gold)" /> : <Zap size={16} color="var(--blue)" />}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div className="font-mono" style={{ fontWeight: 900, fontSize: 16, fontStyle: 'italic', lineHeight: 1 }}>
                {sym}<span style={{ color: 'var(--text-muted)', fontSize: 11, fontWeight: 600 }}>USDT</span>
              </div>
              <div style={{
                fontSize: 9, fontWeight: 900, padding: '2px 6px', borderRadius: 4, letterSpacing: '0.1em',
                background: sig.side === 'LONG' ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                color: sig.side === 'LONG' ? 'var(--green)' : 'var(--red)',
                border: `1px solid ${sig.side === 'LONG' ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`
              }}>
                {sig.side}
              </div>
            </div>
            <div style={{ fontSize: 10, color: changePct >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
              {changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%
            </div>
          </div>
        </div>
        
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
          <div style={{
            padding: '4px 10px', borderRadius: '4px',
            background: statusColors[finalStatus] || 'rgba(255,255,255,0.1)',
            border: `1px solid ${statusBorder[finalStatus] || 'rgba(255,255,255,0.2)'}`,
            fontSize: 10, fontWeight: 900, color: statusText[finalStatus] || '#fff', letterSpacing: '0.1em',
            display: 'flex', alignItems: 'center', gap: 4
          }}>
            {StatusIcon}
            {isTruth ? finalStatus.replace('_BACKEND', '') : 'UI_TELEMETRY'}
          </div>

          {backendState?.blockerReason && (
            <div style={{ fontSize: 9, color: 'var(--red)', fontWeight: 800, maxWidth: 120, textAlign: 'right', lineHeight: 1.2 }}>
              {backendState.blockerReason}
            </div>
          )}
          
          {backendState?.deployedOrderId && (
            <div style={{ fontSize: 9, color: 'var(--green)', fontWeight: 800, maxWidth: 120, textAlign: 'right', lineHeight: 1.2 }}>
              ORDER: {backendState.deployedOrderId}
            </div>
          )}

          <div style={{
            fontSize: 10, fontWeight: 900, color: isSniper ? 'var(--gold-light)' : 'var(--blue)', letterSpacing: '0.1em',
          }}>
            SCORE {sig.score || '--'}
          </div>
        </div>
      </div>

      {/* Pipeline Types */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16,
        fontSize: 11, fontWeight: 800, color: 'var(--text-secondary)'
      }}>
        <div style={{ padding: '4px 8px', background: 'rgba(255,255,255,0.03)', borderRadius: 4, border: '1px solid rgba(255,255,255,0.05)' }}>
          MODE: {sig.kind}
        </div>
        <div style={{ padding: '4px 8px', background: 'rgba(255,255,255,0.03)', borderRadius: 4, border: '1px solid rgba(255,255,255,0.05)' }}>
          TYPE: {sig.entryType || 'UNKNOWN'}
        </div>
        <div style={{ padding: '4px 8px', background: 'rgba(255,255,255,0.03)', borderRadius: 4, border: '1px solid rgba(255,255,255,0.05)',
          color: sig.entryTiming === 'OPTIMAL' ? 'var(--green)' : sig.entryTiming === 'LATE' ? 'var(--red)' : 'var(--amber)'
        }}>
          TIMING: {sig.entryTiming || '--'}
        </div>
      </div>

      {/* Reasons (Only show top 2 to save space) */}
      <div style={{ marginBottom: 16 }}>
        {sig.reasons && sig.reasons.length > 0 ? sig.reasons.slice(0, 2).map((r, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 5 }}>
            <ShieldCheck size={11} color="var(--text-muted)" style={{ marginTop: 2, flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{r}</span>
          </div>
        )) : (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>No reason data available.</div>
        )}
      </div>

      {/* Metrics */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 6, marginBottom: 20,
        padding: '14px 10px', borderRadius: 'var(--radius-sm)',
        background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border-subtle)'
      }}>
        {[
          { label: 'ENTRY', value: fmtPrice(sig.entryPrice) },
          { label: 'SL', value: fmtPrice(sig.stopLoss) },
          { label: 'TP 1', value: fmtPrice(sig.takeProfit) },
          { label: 'TP 2', value: sig.takeProfit2 ? fmtPrice(sig.takeProfit2) : '--' },
        ].map(m => (
          <div key={m.label} style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.15em', fontWeight: 800, marginBottom: 3 }}>
              {m.label}
            </div>
            <div className="font-mono" style={{ fontSize: 11, fontWeight: 900, fontStyle: 'italic' }}>
              {m.value}
            </div>
          </div>
        ))}
      </div>

      {/* Size and deploy */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          <span style={{ fontWeight: 700 }}>SIZE:</span>{' '}
          <span className="font-mono" style={{ fontWeight: 900, color: 'var(--text-primary)' }}>
            ${(sig.sizeUSDT || 0).toFixed(2)}
          </span>
        </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              style={{
                padding: '10px 14px', fontSize: 11, cursor: 'pointer',
                background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.3)',
                borderRadius: 'var(--radius-sm)', color: '#818cf8',
                display: 'flex', alignItems: 'center', gap: 5, fontWeight: 800,
                transition: 'all 0.2s',
              }}
              onClick={() => setChartOpen(true)}
            >
              <BarChart2 size={14} />
              CHART
            </button>
            
            {(isTruth && row.status === 'ACCEPTED') && (
              <button
                className="premium-btn"
                style={{ padding: '10px 22px', fontSize: 11 }}
                onClick={() => onDeploy?.(row)}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Zap size={14} />
                  DEPLOY
                </span>
              </button>
            )}

            {(!isTruth) && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', background: 'rgba(255,255,255,0.03)', padding: '0 12px', borderRadius: 4, border: '1px solid rgba(255,255,255,0.05)' }}>
                WAITING FOR BACKEND...
              </div>
            )}
          </div>
      </div>

      {chartOpen && (
        <ChartModal
          symbol={row.symbol}
          side={sig.side}
          score={sig.score}
          onClose={() => setChartOpen(false)}
        />
      )}
    </div>
  );
}





function EmptyState({ label }: { label: string }) {
  return (
    <div style={{
      padding: '40px 24px', borderRadius: 'var(--radius-lg)',
      border: '1px dashed rgba(255,255,255,0.06)',
      textAlign: 'center', color: 'var(--text-muted)', fontSize: 12
    }}>
      <TrendingUp size={24} style={{ opacity: 0.3, marginBottom: 8, margin: '0 auto' }} />
      <div>{label}</div>
    </div>
  );
}

function fmtPrice(n: number | undefined): string {
  if (n === undefined || !isFinite(n)) return '--';
  if (Math.abs(n) >= 1000) return n.toFixed(2);
  if (Math.abs(n) >= 100) return n.toFixed(2);
  if (Math.abs(n) >= 1) return n.toFixed(4);
  return n.toFixed(6);
}
