// ============================================
// Backtest Comparison — Gold Bonanza
//
// Additive layer to compare two saved backtest
// snapshots side-by-side without altering core.
// ============================================

import type { BacktestSnapshot } from '../store/backtestStore';
import { ArrowLeftRight, Check, X } from 'lucide-react';

interface Props {
  snapA: BacktestSnapshot;
  snapB: BacktestSnapshot;
  onClose: () => void;
}

export default function BacktestComparison({ snapA, snapB, onClose }: Props) {
  const diffPnl = snapB.result.stats.netPnl - snapA.result.stats.netPnl;
  const diffWR = snapB.result.stats.winRate - snapA.result.stats.winRate;
  const diffPF = snapB.result.stats.profitFactor - snapA.result.stats.profitFactor;
  const diffDD = snapA.result.stats.maxDrawdownPct - snapB.result.stats.maxDrawdownPct; // less DD is better

  return (
    <div style={{
      marginTop: 24,
      borderRadius: 'var(--radius-lg)',
      background: 'rgba(13,17,23,0.96)',
      border: '1px solid rgba(201,176,119,0.2)',
      overflow: 'hidden'
    }}>
      {/* Header */}
      <div style={{
        padding: '16px 24px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        background: 'rgba(201,176,119,0.03)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <ArrowLeftRight size={16} color="var(--gold)" />
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.2em', color: 'var(--gold)' }}>
            BACKTEST COMPARISON
          </span>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'transparent', border: 'none', color: 'var(--text-muted)',
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
            fontSize: 9, fontWeight: 800, letterSpacing: '0.1em'
          }}
        >
          <X size={14} /> CLOSE
        </button>
      </div>

      <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Snapshots Header */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
          <div /> {/* spacing */}
          <SnapshotHead snap={snapA} label="A" />
          <SnapshotHead snap={snapB} label="B" />
        </div>

        {/* Configuration Section */}
        <div style={{
          border: '1px solid rgba(255,255,255,0.05)',
          borderRadius: 'var(--radius-md)', padding: '16px'
        }}>
          <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.15em', marginBottom: 12 }}>
            CONFIGURATION & MODELS
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <MetricRow label="Strategies Evaluated"
              valA={snapA.result.config.strategyIds.length === 0 ? 'ALL' : snapA.result.config.strategyIds.length.toString()}
              valB={snapB.result.config.strategyIds.length === 0 ? 'ALL' : snapB.result.config.strategyIds.length.toString()} />
            <MetricRow label="Symbol Preset"
              valA={snapA.result.config.symbolPreset}
              valB={snapB.result.config.symbolPreset} />
            <MetricRow label="Entry Model"
              valA={snapA.result.config.entryModel}
              valB={snapB.result.config.entryModel} />
            <MetricRow label="Exit Mode"
              valA={snapA.result.config.exitMode}
              valB={snapB.result.config.exitMode} />
            <MetricRow label="Regime Filter"
              valA={snapA.result.config.btcRegimeEnabled ? 'ENABLED' : 'DISABLED'}
              valB={snapB.result.config.btcRegimeEnabled ? 'ENABLED' : 'DISABLED'} />
          </div>
        </div>

        {/* Performance Stats Section */}
        <div style={{
          border: '1px solid rgba(255,255,255,0.05)',
          borderRadius: 'var(--radius-md)', padding: '16px'
        }}>
          <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.15em', marginBottom: 12 }}>
            PERFORMANCE METRICS
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <MetricRow label="Net P&L"
              valA={`$${snapA.result.stats.netPnl.toFixed(2)}`} valB={`$${snapB.result.stats.netPnl.toFixed(2)}`}
              diff={diffPnl} diffFmt={`+$${diffPnl.toFixed(2)}`} diffColor={diffPnl > 0 ? '#34d399' : '#f43f5e'} />
            
            <MetricRow label="Win Rate"
              valA={`${snapA.result.stats.winRate.toFixed(1)}%`} valB={`${snapB.result.stats.winRate.toFixed(1)}%`}
              diff={diffWR} diffFmt={`+${diffWR.toFixed(1)}%`} diffColor={diffWR > 0 ? '#34d399' : '#f43f5e'} />
            
            <MetricRow label="Profit Factor"
              valA={snapA.result.stats.profitFactor === Infinity ? '∞' : snapA.result.stats.profitFactor.toFixed(2)}
              valB={snapB.result.stats.profitFactor === Infinity ? '∞' : snapB.result.stats.profitFactor.toFixed(2)}
              diff={diffPF} diffFmt={`+${diffPF.toFixed(2)}`} diffColor={diffPF > 0 ? '#34d399' : '#f43f5e'} />
            
            <MetricRow label="Max Drawdown"
              valA={`${snapA.result.stats.maxDrawdownPct.toFixed(1)}%`} valB={`${snapB.result.stats.maxDrawdownPct.toFixed(1)}%`}
              diff={diffDD} diffFmt={`${diffDD > 0 ? 'Better (-' : 'Worse (+'}${Math.abs(diffDD).toFixed(1)}%)`} 
              diffColor={diffDD > 0 ? '#34d399' : '#f43f5e'} />
            
            <MetricRow label="Total Trades Taken"
              valA={snapA.result.stats.totalTrades.toString()} valB={snapB.result.stats.totalTrades.toString()} />
            
            <MetricRow label="Winning Trades"
              valA={snapA.result.stats.winningTrades.toString()} valB={snapB.result.stats.winningTrades.toString()} />
            
            <MetricRow label="Losing Trades"
              valA={snapA.result.stats.losingTrades.toString()} valB={snapB.result.stats.losingTrades.toString()} />
          </div>
        </div>

        {/* Highlight Assumptions Diff if any relevant */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <AssumptionsList snap={snapA} label="A" />
          <AssumptionsList snap={snapB} label="B" />
        </div>

      </div>
    </div>
  );
}

function SnapshotHead({ snap, label }: { snap: BacktestSnapshot, label: string }) {
  const dateStr = new Date(snap.timestamp).toLocaleString();
  return (
    <div style={{ textAlign: 'center', padding: '12px', background: 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius-md)' }}>
      <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.15em', marginBottom: 8 }}>
        SNAPSHOT {label}
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
        {snap.name}
      </div>
      <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>
        {dateStr}
      </div>
    </div>
  );
}

function MetricRow({ label, valA, valB, diff, diffFmt, diffColor }: {
  label: string; valA: string; valB: string;
  diff?: number; diffFmt?: string; diffColor?: string;
}) {
  const isEqual = valA === valB;
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
      padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.03)',
      alignItems: 'center', fontSize: 11
    }}>
      <div style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{label}</div>
      <div style={{ textAlign: 'center', fontWeight: 700, color: isEqual ? 'var(--text-primary)' : 'var(--text-primary)' }}>
        {valA}
      </div>
      <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
        <span style={{ fontWeight: 700, color: isEqual ? 'var(--text-primary)' : 'var(--gold)' }}>
          {valB}
        </span>
        {diff !== undefined && diff !== 0 && !isNaN(diff) && (
          <span style={{ fontSize: 9, fontWeight: 800, color: diffColor }}>
            {diff < 0 && !diffFmt?.startsWith('+') && !diffFmt?.startsWith('Better') && !diffFmt?.startsWith('Worse') ? '' : ''}{diffFmt}
          </span>
        )}
      </div>
    </div>
  );
}

function AssumptionsList({ snap, label }: { snap: BacktestSnapshot, label: string }) {
  // Only show the top 8 unique identifying assumptions to save space
  const highlights = snap.result.assumptions.filter(a => 
    a.includes('Entry model') || a.includes('Exit model') || a.includes('Symbols:') || a.includes('Trailing stop')
  );

  return (
    <div style={{ background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.03)', borderRadius: 'var(--radius-md)', padding: '14px' }}>
      <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.15em', marginBottom: 12 }}>
        KEY ASSUMPTIONS {label}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {highlights.map((a, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
            <Check size={10} color="var(--gold)" style={{ marginTop: 2, flexShrink: 0 }} />
            <span style={{ fontSize: 9, color: 'var(--text-muted)', lineHeight: 1.4 }}>{a}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
