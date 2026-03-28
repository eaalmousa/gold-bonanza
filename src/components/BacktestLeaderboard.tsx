// ============================================
// Backtest Leaderboard — Gold Bonanza
//
// Additive layer for ranking saved snapshots,
// surfacing best performers with automatic badges,
// and providing sortable metrics.
// ============================================

import { useState, useMemo } from 'react';
import type { BacktestSnapshot } from '../store/backtestStore';
import { CheckSquare, Square, Trash2, Trophy, Shield, Zap, ArrowUpDown } from 'lucide-react';

interface Props {
  snapshots: BacktestSnapshot[];
  selectedSnaps: string[];
  toggleSnapSelect: (id: string) => void;
  deleteSnapshot: (id: string) => void;
}

type SortCol = 'date' | 'pnl' | 'winrate' | 'pf' | 'dd' | 'trades' | 'sharpe';

export default function BacktestLeaderboard({ snapshots, selectedSnaps, toggleSnapSelect, deleteSnapshot }: Props) {
  const [sortCol, setSortCol] = useState<SortCol>('date');
  const [sortAsc, setSortAsc] = useState<boolean>(false);

  // 1. Compute Badges (Recommendations)
  const recommendations = useMemo(() => {
    const profitable = snapshots.filter(s => s.result.stats.netPnl > 0);
    if (profitable.length === 0) return { bestOverall: null, mostStable: null, highestUpside: null };

    // Best Overall: Highest Sharpe Ratio
    const bestOverall = [...profitable].sort((a, b) => b.result.stats.sharpeApprox - a.result.stats.sharpeApprox)[0];
    
    // Most Stable: Lowest Max DD%
    const mostStable = [...profitable].sort((a, b) => {
      if (a.result.stats.maxDrawdownPct === b.result.stats.maxDrawdownPct) {
        return b.result.stats.netPnl - a.result.stats.netPnl; // tiebreaker
      }
      return a.result.stats.maxDrawdownPct - b.result.stats.maxDrawdownPct;
    })[0];
    
    // Highest Upside: Highest Net PnL
    const highestUpside = [...profitable].sort((a, b) => b.result.stats.netPnl - a.result.stats.netPnl)[0];

    return { 
      bestOverall: bestOverall?.id, 
      mostStable: mostStable?.id, 
      highestUpside: highestUpside?.id 
    };
  }, [snapshots]);

  // 2. Sort Logic
  const sortedSnaps = useMemo(() => {
    return [...snapshots].sort((a, b) => {
      let valA, valB;
      switch (sortCol) {
        case 'pnl':
          valA = a.result.stats.netPnl; valB = b.result.stats.netPnl; break;
        case 'winrate':
          valA = a.result.stats.winRate; valB = b.result.stats.winRate; break;
        case 'pf':
          valA = a.result.stats.profitFactor; valB = b.result.stats.profitFactor; break;
        case 'dd':
          valA = a.result.stats.maxDrawdownPct; valB = b.result.stats.maxDrawdownPct; break;
        case 'trades':
          valA = a.result.stats.totalTrades; valB = b.result.stats.totalTrades; break;
        case 'sharpe':
          valA = a.result.stats.sharpeApprox; valB = b.result.stats.sharpeApprox; break;
        case 'date':
        default:
          valA = a.timestamp; valB = b.timestamp; break;
      }
      return sortAsc ? valA - valB : valB - valA;
    });
  }, [snapshots, sortCol, sortAsc]);

  const handleSort = (col: SortCol) => {
    if (sortCol === col) setSortAsc(!sortAsc);
    else {
      setSortCol(col);
      // default: descending for most things, but ascending for DD makes sense, but we'll stick to a simple rule
      setSortAsc(col === 'dd'); 
    }
  };

  if (snapshots.length === 0) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 10 }}>
        No saved snapshots found. Run a backtest and click "Save Snapshot".
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Table Header Row */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'auto 3fr 1fr 1fr 1fr 1fr 1fr 1fr auto',
        padding: '8px 16px', fontSize: 8, fontWeight: 800, color: 'var(--text-muted)',
        letterSpacing: '0.1em', gap: 8, alignItems: 'center'
      }}>
        <div style={{ width: 16 }}></div> {/* Checkbox padding */}
        <div style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }} onClick={() => handleSort('date')}>
          SNAPSHOT <ArrowUpDown size={8} />
        </div>
        <SortableHeader label="TRADES" col="trades" current={sortCol} align="right" onClick={handleSort} />
        <SortableHeader label="WIN RATE" col="winrate" current={sortCol} align="right" onClick={handleSort} />
        <SortableHeader label="P.FACTOR" col="pf" current={sortCol} align="right" onClick={handleSort} />
        <SortableHeader label="SHARPE" col="sharpe" current={sortCol} align="right" onClick={handleSort} />
        <SortableHeader label="MAX DD" col="dd" current={sortCol} align="right" onClick={handleSort} />
        <SortableHeader label="NET P&L" col="pnl" current={sortCol} align="right" onClick={handleSort} />
        <div style={{ width: 14 }}></div> {/* Trash padding */}
      </div>

      {sortedSnaps.map(snap => {
        const sStats = snap.result.stats;
        const isSelected = selectedSnaps.includes(snap.id);
        const disabledForSelect = !isSelected && selectedSnaps.length >= 2;
        
        const isBestOverall = recommendations.bestOverall === snap.id;
        const isMostStable = recommendations.mostStable === snap.id;
        const isHighestUpside = recommendations.highestUpside === snap.id;

        return (
          <div key={snap.id} style={{
            display: 'grid', gridTemplateColumns: 'auto 3fr 1fr 1fr 1fr 1fr 1fr 1fr auto',
            padding: '12px 16px', borderRadius: 'var(--radius-md)', gap: 8,
            background: isSelected ? 'rgba(201,176,119,0.03)' : 'rgba(255,255,255,0.02)',
            border: `1px solid ${isSelected ? 'rgba(201,176,119,0.2)' : 'rgba(255,255,255,0.04)'}`,
            transition: 'all 0.2s', alignItems: 'center'
          }}>
            <button
              onClick={() => toggleSnapSelect(snap.id)}
              disabled={disabledForSelect}
              style={{
                background: 'transparent', border: 'none', cursor: disabledForSelect ? 'not-allowed' : 'pointer',
                color: isSelected ? 'var(--gold)' : disabledForSelect ? 'rgba(255,255,255,0.1)' : 'var(--text-muted)',
                display: 'flex', alignItems: 'center', padding: 0
              }}
            >
              {isSelected ? <CheckSquare size={16} /> : <Square size={16} />}
            </button>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)' }}>{snap.name}</span>
                {/* Badges */}
                {isBestOverall && <Badge icon={<Trophy size={8}/>} label="Best Overall" color="#fbbf24" bg="rgba(251,191,36,0.1)" />}
                {isMostStable && <Badge icon={<Shield size={8}/>} label="Most Stable" color="#60a5fa" bg="rgba(96,165,250,0.1)" />}
                {isHighestUpside && <Badge icon={<Zap size={8}/>} label="Highest Upside" color="#c084fc" bg="rgba(192,132,252,0.1)" />}
              </div>
              <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>
                {new Date(snap.timestamp).toLocaleString()} • {snap.result.config.symbolPreset} • {snap.result.config.entryModel} • {snap.result.config.exitMode}
              </div>
            </div>

            <div style={{ textAlign: 'right', fontSize: 10, fontWeight: 600, color: 'var(--text-secondary)' }}>
              {sStats.totalTrades}
            </div>
            
            <div style={{ textAlign: 'right', fontSize: 10, fontWeight: 800, color: sStats.winRate >= 50 ? '#34d399' : '#f59e0b' }}>
              {sStats.winRate.toFixed(1)}%
            </div>
            
            <div style={{ textAlign: 'right', fontSize: 10, fontWeight: 600, color: sStats.profitFactor >= 1.5 ? '#34d399' : sStats.profitFactor >= 1 ? '#f59e0b' : '#f43f5e' }}>
              {sStats.profitFactor === Infinity ? '∞' : sStats.profitFactor.toFixed(2)}
            </div>

            <div style={{ textAlign: 'right', fontSize: 10, fontWeight: 600, color: 'var(--text-muted)' }}>
              {sStats.sharpeApprox.toFixed(2)}
            </div>

            <div style={{ textAlign: 'right', fontSize: 10, fontWeight: 800, color: sStats.maxDrawdownPct > 15 ? '#f43f5e' : sStats.maxDrawdownPct > 5 ? '#f59e0b' : '#34d399' }}>
              {sStats.maxDrawdownPct.toFixed(1)}%
            </div>

            <div style={{ textAlign: 'right', fontSize: 11, fontWeight: 800, color: sStats.netPnl >= 0 ? '#34d399' : '#f43f5e' }}>
              ${sStats.netPnl.toFixed(2)}
            </div>

            <button
              onClick={() => {
                deleteSnapshot(snap.id);
                if (isSelected) toggleSnapSelect(snap.id);
              }}
              style={{
                background: 'transparent', border: 'none', color: '#f43f5e', cursor: 'pointer',
                display: 'flex', alignItems: 'center', opacity: 0.7, padding: 0
              }}
              onMouseOver={e => e.currentTarget.style.opacity = '1'}
              onMouseOut={e => e.currentTarget.style.opacity = '0.7'}
              title="Delete Snapshot"
            >
              <Trash2 size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function SortableHeader({ label, col, current, align, onClick }: { label: string; col: SortCol; current: SortCol; align: 'left' | 'right'; onClick: (col: SortCol) => void }) {
  const isSorted = col === current;
  return (
    <div 
      onClick={() => onClick(col)}
      style={{ 
        cursor: 'pointer', display: 'flex', alignItems: 'center', 
        justifyContent: align === 'right' ? 'flex-end' : 'flex-start', gap: 4,
        color: isSorted ? 'var(--gold)' : 'inherit'
      }}
    >
      {label}
      <ArrowUpDown size={8} style={{ opacity: isSorted ? 1 : 0.3 }} />
    </div>
  );
}

function Badge({ icon, label, color, bg }: { icon: React.ReactNode; label: string; color: string; bg: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      padding: '2px 6px', borderRadius: 'var(--radius-full)',
      fontSize: 7, fontWeight: 800, letterSpacing: '0.05em',
      color, background: bg, border: `1px solid ${color.replace('rgb', 'rgba').replace(')', ', 0.3)')}` // rough approximation
    }}>
      {icon} {label}
    </span>
  );
}
