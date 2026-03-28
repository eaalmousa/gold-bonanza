// ============================================
// Strategy Description Panel — Gold Bonanza
//
// Professional metadata-driven strategy info.
// Entirely auto-generated from StrategyMetadata
// in the registry — no hardcoded UI text.
// ============================================

import type { StrategyMetadata } from '../engines/strategyRegistry';
import {
  BookOpen, Crosshair, ShieldCheck, Target,
  Activity, AlertTriangle
} from 'lucide-react';

const STYLE_COLORS: Record<string, string> = {
  TREND_FOLLOWING: '#34d399',
  BREAKOUT: '#f59e0b',
  REVERSAL: '#22d3ee',
  SMART_MONEY: '#a78bfa',
};

const STYLE_LABELS: Record<string, string> = {
  TREND_FOLLOWING: 'Trend Following',
  BREAKOUT: 'Breakout',
  REVERSAL: 'Reversal',
  SMART_MONEY: 'Smart Money',
};

interface Props {
  name: string;
  category: string;
  description: string;
  canOverrideBtcRegime: boolean;
  metadata: StrategyMetadata;
  onClose: () => void;
}

export default function StrategyDescription({ name, canOverrideBtcRegime, metadata, onClose }: Props) {
  const styleColor = STYLE_COLORS[metadata.style] || '#94a3b8';
  const styleLabel = STYLE_LABELS[metadata.style] || metadata.style;

  return (
    <div style={{
      padding: '16px 20px',
      background: 'rgba(13,17,23,0.65)',
      borderTop: '1px solid rgba(255,255,255,0.04)',
      animation: 'fadeIn 0.2s ease'
    }}>
      {/* Title & Close */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <BookOpen size={14} color="var(--gold)" />
          <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-primary)' }}>{name}</span>
          <span style={{
            fontSize: 8, fontWeight: 700, padding: '2px 8px',
            borderRadius: 'var(--radius-full)',
            background: styleColor + '15', color: styleColor,
            letterSpacing: '0.1em'
          }}>{styleLabel}</span>
        </div>
        <button
          onClick={onClose}
          style={{
            fontSize: 9, fontWeight: 700, color: 'var(--text-muted)',
            background: 'transparent', border: 'none', cursor: 'pointer',
            padding: '4px 8px'
          }}
        >✕</button>
      </div>

      {/* Overview */}
      <div style={{ fontSize: 10, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 14 }}>
        {metadata.howItWorks}
      </div>

      {/* Indicators */}
      <div style={{ marginBottom: 14 }}>
        <SectionLabel icon={<Activity size={11} />}>INDICATORS</SectionLabel>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 6 }}>
          {metadata.indicators.map(ind => (
            <span key={ind} style={{
              fontSize: 8, fontWeight: 700, padding: '3px 8px',
              borderRadius: 'var(--radius-full)',
              background: 'rgba(201,176,119,0.06)',
              color: 'var(--gold)',
              border: '1px solid rgba(201,176,119,0.1)',
              letterSpacing: '0.05em'
            }}>{ind}</span>
          ))}
        </div>
      </div>

      {/* Logic sections — 2-column grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
        <LogicBlock icon={<Crosshair size={11} />} label="ENTRY LOGIC" text={metadata.entryLogic} />
        <LogicBlock icon={<ShieldCheck size={11} />} label="CONFIRMATION" text={metadata.confirmationLogic} />
        <LogicBlock icon={<AlertTriangle size={11} />} label="STOP-LOSS" text={metadata.stopLossLogic} />
        <LogicBlock icon={<Target size={11} />} label="TAKE-PROFIT" text={metadata.takeProfitLogic} />
      </div>

      {/* Bottom info row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        <InfoBlock label="Best Conditions" text={metadata.bestConditions} />
        <InfoBlock label="BTC Regime"
          text={canOverrideBtcRegime ? metadata.regimeBehavior : metadata.regimeBehavior}
          highlight={canOverrideBtcRegime}
        />
        <InfoBlock label="Signal Class" text={metadata.signalClass} />
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionLabel({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 8, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.15em' }}>
      {icon} {children}
    </div>
  );
}

function LogicBlock({ icon, label, text }: { icon: React.ReactNode; label: string; text: string }) {
  return (
    <div style={{
      padding: '10px 12px',
      borderRadius: 'var(--radius-md)',
      background: 'rgba(255,255,255,0.015)',
      border: '1px solid rgba(255,255,255,0.03)'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6, fontSize: 8, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.12em' }}>
        {icon} {label}
      </div>
      <div style={{ fontSize: 9, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{text}</div>
    </div>
  );
}

function InfoBlock({ label, text, highlight }: { label: string; text: string; highlight?: boolean }) {
  return (
    <div style={{
      padding: '8px 10px',
      borderRadius: 'var(--radius-sm)',
      background: highlight ? 'rgba(245,158,11,0.04)' : 'rgba(255,255,255,0.01)',
      border: `1px solid ${highlight ? 'rgba(245,158,11,0.1)' : 'rgba(255,255,255,0.03)'}`
    }}>
      <div style={{ fontSize: 7, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.15em', marginBottom: 4 }}>{label.toUpperCase()}</div>
      <div style={{ fontSize: 8, color: highlight ? '#f59e0b' : 'var(--text-secondary)', lineHeight: 1.4 }}>{text}</div>
    </div>
  );
}
