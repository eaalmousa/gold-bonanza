// BreakoutSignals component
import { useEffect, useState } from 'react';
import type { SignalRow } from '../types/trading';
import { Zap, TrendingUp, ShieldCheck, Rocket, BarChart2 } from 'lucide-react';
import ChartModal from './ChartModal';

interface Props {
  signals: SignalRow[];
  onDeploy?: (signal: SignalRow) => void;
}

export default function BreakoutSignals({ signals, onDeploy }: Props) {
  const detectedSignals = signals.filter(s => s.status === 'DETECTED');
  if (!detectedSignals.length) {
    return (
      <section>
        <SectionHeader count={0} />
        <EmptyState />
      </section>
    );
  }

  return (
    <section>
      <SectionHeader count={detectedSignals.length} />
      <div className="signal-grid">
        {detectedSignals.map((s, i) => (
          <BreakoutCard key={s.id || `${s.symbol}-${i}`} row={s} onDeploy={onDeploy} index={i} />
        ))}
      </div>
    </section>
  );
}

function BreakoutCard({ row, onDeploy, index }: { row: SignalRow; onDeploy?: (r: SignalRow) => void; index: number }) {
  const sig = row.signal;
  const sym = row.symbol.replace('USDT', '');
  const changePct = row.change24h ?? 0;
  const [chartOpen, setChartOpen] = useState(false);

  useEffect(() => {
    // Play on first mount — only if the card was freshly discovered (not a page-load restore)
    // Scan batches can take up to 45 seconds now, so increase window to 60,000ms
    const isNew = !row.timestamp || (Date.now() - row.timestamp < 60000);
    if (isNew) {
      new Audio('/sniper_alert.mp3').play().catch((e) => console.warn('Audio play failed', e));
    }
  }, []);

  return (
    <div
      className="opportunity-card breakout-glow card-entry"
      style={{ padding: '24px 22px', animationDelay: `${index * 0.08}s` }}
    >
      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 'var(--radius-sm)',
            background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.25)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
          }}>
            <Zap size={16} color="var(--blue)" />
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
        <div style={{
          padding: '6px 14px', borderRadius: 'var(--radius-full)',
          background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.3)',
          fontSize: 11, fontWeight: 900, color: 'var(--blue)', letterSpacing: '0.1em',
          whiteSpace: 'nowrap', flexShrink: 0
        }}>
          SCORE {sig.score}
        </div>
      </div>

      {/* Reasons */}
      <div style={{ marginBottom: 16 }}>
        {sig.reasons.slice(0, 3).map((r, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 5
          }}>
            <ShieldCheck size={11} color="var(--blue)" style={{ marginTop: 2, flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{r}</span>
          </div>
        ))}
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
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center'
      }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          <span style={{ fontWeight: 700 }}>SIZE:</span>{' '}
          <span className="font-mono" style={{ fontWeight: 900, color: 'var(--text-primary)' }}>
            ${sig.sizeUSDT.toFixed(2)}
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
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(99,102,241,0.2)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(99,102,241,0.1)')}
            onClick={() => setChartOpen(true)}
          >
            <BarChart2 size={14} />
            CHART
          </button>
          <button
            className="blue-btn"
            style={{ padding: '10px 22px', fontSize: 11 }}
            onClick={() => onDeploy?.(row)}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Rocket size={14} />
              SYNC TO HUB
            </span>
          </button>
        </div>
      </div>

      {/* TradingView Chart Modal */}
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

function SectionHeader({ count }: { count: number }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      marginBottom: 20, paddingBottom: 12,
      borderBottom: '1px solid rgba(59,130,246,0.1)'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Zap size={20} color="var(--blue)" />
        <div>
          <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: '0.2em', color: 'var(--blue)' }}>
            SUPER SNIPER BREAKOUTS
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
            Volatility compression breakout with volume surge
          </div>
        </div>
      </div>
      {count > 0 && (
        <div style={{
          padding: '8px 16px', borderRadius: 'var(--radius-full)',
          background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.3)',
          fontSize: 12, fontWeight: 900, color: 'var(--blue)',
          animation: 'pulse-gold 2s ease-in-out infinite'
        }}>
          {count} LIVE
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div style={{
      padding: '40px 24px',
      borderRadius: 'var(--radius-lg)',
      border: '1px dashed rgba(255,255,255,0.06)',
      textAlign: 'center',
      color: 'var(--text-muted)',
      fontSize: 12
    }}>
      <TrendingUp size={24} style={{ opacity: 0.3, marginBottom: 8 }} />
      <div>No breakout signals detected. Scanner is actively monitoring...</div>
    </div>
  );
}

function fmtPrice(n: number): string {
  if (!isFinite(n)) return '--';
  if (Math.abs(n) >= 1000) return n.toFixed(2);
  if (Math.abs(n) >= 100) return n.toFixed(2);
  if (Math.abs(n) >= 1) return n.toFixed(4);
  return n.toFixed(6);
}
