// ============================================
// Backtest Analytics — Gold Bonanza
//
// Additive performance analytics layer
// visualising backtest trade distributions.
// Includes filtering and CSV export.
// ============================================

import { useMemo, useState } from 'react';
import type { BacktestTrade } from '../engines/backtestEngine';
import { AreaChart, Activity, Target, ArrowUpRight, Layers, Download, Filter } from 'lucide-react';

interface Props {
  trades: BacktestTrade[];
}

export default function BacktestAnalytics({ trades }: Props) {
  if (trades.length === 0) return null;

  const [filterStrategy, setFilterStrategy] = useState<string>('ALL');
  const [filterSymbol, setFilterSymbol] = useState<string>('ALL');
  const [filterSide, setFilterSide] = useState<string>('ALL');
  const [filterRegime, setFilterRegime] = useState<string>('ALL');

  const uniqueStrategies = useMemo(() => Array.from(new Set(trades.map(t => t.strategyId))).sort(), [trades]);
  const uniqueSymbols = useMemo(() => Array.from(new Set(trades.map(t => t.symbol))).sort(), [trades]);

  const { data, activeTrades } = useMemo(() => {
    // 1. Apply Filters
    let ft = [...trades];
    if (filterStrategy !== 'ALL') ft = ft.filter(t => t.strategyId === filterStrategy);
    if (filterSymbol !== 'ALL') ft = ft.filter(t => t.symbol === filterSymbol);
    if (filterSide !== 'ALL') ft = ft.filter(t => t.side === filterSide);
    if (filterRegime !== 'ALL') ft = ft.filter(t => t.regimeAlignment === filterRegime);

    // 2. Sort explicitly by chronological exit order for perfect streak integrity
    ft.sort((a, b) => a.exitBar - b.exitBar);

    // 3. Group by Strategy
    const byStrategy = groupBy(ft, t => t.strategyId);
    const strategyStats = Object.keys(byStrategy).map(id => ({
      id, ...summarize(byStrategy[id])
    })).sort((a, b) => b.netPnl - a.netPnl);

    // 4. Group by Symbol
    const bySymbol = groupBy(ft, t => t.symbol);
    const symbolStats = Object.keys(bySymbol).map(sym => ({
      sym, ...summarize(bySymbol[sym])
    })).sort((a, b) => b.netPnl - a.netPnl);

    // 5. Side and Regime
    const longs = ft.filter(t => t.side === 'LONG');
    const shorts = ft.filter(t => t.side === 'SHORT');
    const aligned = ft.filter(t => t.regimeAlignment === 'ALIGNED');
    const overrides = ft.filter(t => t.regimeAlignment === 'COUNTER_REGIME_OVERRIDE');

    const sideStats = {
      LONG: summarize(longs),
      SHORT: summarize(shorts)
    };

    const regimeStats = {
      ALIGNED: summarize(aligned),
      OVERRIDE: summarize(overrides)
    };

    // 6. Streaks (chronological order guaranteed)
    let maxWins = 0, currentWins = 0;
    let maxLoss = 0, currentLoss = 0;
    for (const t of ft) {
      if (t.pnl > 0) {
        currentWins++;
        if (currentLoss > 0) currentLoss = 0;
        if (currentWins > maxWins) maxWins = currentWins;
      } else if (t.pnl < 0) {
        currentLoss++;
        if (currentWins > 0) currentWins = 0;
        if (currentLoss > maxLoss) maxLoss = currentLoss;
      } else {
        // Break even resets both streaks
        currentWins = 0;
        currentLoss = 0;
      }
    }

    return { 
      activeTrades: ft,
      data: { strategyStats, symbolStats, sideStats, regimeStats, maxWins, maxLoss } 
    };
  }, [trades, filterStrategy, filterSymbol, filterSide, filterRegime]);

  // ─── CSV EXPORTS ───

  const exportTradesCSV = () => {
    if (activeTrades.length === 0) return;
    const headers = ['Symbol', 'Strategy', 'Side', 'EntryBar', 'ExitBar', 'HoldBars', 'EntryPrice', 'ExitPrice', 'StopLoss', 'TakeProfit', 'Qty', 'Outcome', 'Regime', 'RegimeAlignment', 'FeePaid', 'NetPnL', 'PnLPct'];
    const rows = activeTrades.map(t => [
      t.symbol, t.strategyId, t.side, t.entryBar, t.exitBar, t.holdBars,
      t.entryPrice, t.exitPrice, t.stopLoss, t.takeProfit, t.qty,
      t.outcome, t.regime, t.regimeAlignment, t.feePaid.toFixed(4), t.pnl.toFixed(4), t.pnlPct.toFixed(4)
    ]);
    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    downloadBlob(csvContent, 'backtest_trades.csv');
  };

  const exportSummaryCSV = () => {
    let csv = '=== STRATEGY SUMMARY ===\n';
    csv += 'Strategy,Trades,WinRate,ProfitFactor,AvgPnL,NetPnL\n';
    data.strategyStats.forEach(s => {
      csv += `${s.id},${s.count},${s.winRate.toFixed(1)}%,${s.profitFactor.toFixed(2)},${s.avgPnl.toFixed(2)},${s.netPnl.toFixed(2)}\n`;
    });
    
    csv += '\n=== SYMBOL SUMMARY ===\n';
    csv += 'Symbol,Trades,WinRate,ProfitFactor,AvgPnL,NetPnL\n';
    data.symbolStats.forEach(s => {
      csv += `${s.sym},${s.count},${s.winRate.toFixed(1)}%,${s.profitFactor.toFixed(2)},${s.avgPnl.toFixed(2)},${s.netPnl.toFixed(2)}\n`;
    });

    csv += '\n=== SYSTEM SPLITS ===\n';
    csv += 'Category,Segment,Trades,WinRate,NetPnL\n';
    csv += `Direction,LONG,${data.sideStats.LONG.count},${data.sideStats.LONG.winRate.toFixed(1)}%,${data.sideStats.LONG.netPnl.toFixed(2)}\n`;
    csv += `Direction,SHORT,${data.sideStats.SHORT.count},${data.sideStats.SHORT.winRate.toFixed(1)}%,${data.sideStats.SHORT.netPnl.toFixed(2)}\n`;
    csv += `Regime,ALIGNED,${data.regimeStats.ALIGNED.count},${data.regimeStats.ALIGNED.winRate.toFixed(1)}%,${data.regimeStats.ALIGNED.netPnl.toFixed(2)}\n`;
    csv += `Regime,OVERRIDE,${data.regimeStats.OVERRIDE.count},${data.regimeStats.OVERRIDE.winRate.toFixed(1)}%,${data.regimeStats.OVERRIDE.netPnl.toFixed(2)}\n`;
    
    downloadBlob(csv, 'backtest_summary.csv');
  };

  const downloadBlob = (content: string, filename: string) => {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div style={{
      marginTop: 24,
      borderRadius: 'var(--radius-lg)',
      background: 'rgba(13,17,23,0.65)',
      border: '1px solid rgba(255,255,255,0.06)',
      overflow: 'hidden'
    }}>
      {/* Header with Export Buttons */}
      <div style={{
        padding: '16px 24px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        background: 'rgba(255,255,255,0.02)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <AreaChart size={16} color="var(--text-muted)" />
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.2em', color: 'var(--text-secondary)' }}>
            PERFORMANCE ANALYTICS
          </span>
          <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>
            ({activeTrades.length} Trades)
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={exportSummaryCSV} style={btnStyle} title="Export Aggregated Summary">
            <Download size={12} />
            CSV SUMMARY
          </button>
          <button onClick={exportTradesCSV} style={btnStyle} title="Export Raw Trade Log">
            <Download size={12} />
            CSV TRADES
          </button>
        </div>
      </div>

      {/* Analytics Toolbar (Filters) */}
      <div style={{
        padding: '12px 24px', display: 'flex', gap: 16,
        background: 'rgba(255,255,255,0.01)', borderBottom: '1px solid rgba(255,255,255,0.03)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 9, fontWeight: 800, color: 'var(--text-muted)' }}>
          <Filter size={12} />
        </div>
        <SelectFilter label="Strategy" value={filterStrategy} onChange={setFilterStrategy} options={['ALL', ...uniqueStrategies]} />
        <SelectFilter label="Symbol" value={filterSymbol} onChange={setFilterSymbol} options={['ALL', ...uniqueSymbols]} />
        <SelectFilter label="Side" value={filterSide} onChange={setFilterSide} options={['ALL', 'LONG', 'SHORT']} />
        <SelectFilter label="Alignment" value={filterRegime} onChange={setFilterRegime} options={['ALL', 'ALIGNED', 'COUNTER_REGIME_OVERRIDE']} />
      </div>

      <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: 24 }}>
        
        {/* Top Breakdowns (Side & Regime & Streaks) */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {/* Side Performance */}
          <div style={{ background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.03)', borderRadius: 'var(--radius-md)', padding: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 9, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.15em' }}>
              <ArrowUpRight size={14} /> DIRECTIONAL SPLIT
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <MiniRow label="LONG" stats={data.sideStats.LONG} />
              <MiniRow label="SHORT" stats={data.sideStats.SHORT} />
            </div>
          </div>

          {/* Regime Performance */}
          <div style={{ background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.03)', borderRadius: 'var(--radius-md)', padding: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 9, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.15em' }}>
              <Layers size={14} /> REGIME ALIGNMENT
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <MiniRow label="ALIGNED" stats={data.regimeStats.ALIGNED} />
              <MiniRow label="OVERRIDE" stats={data.regimeStats.OVERRIDE} />
            </div>
          </div>

          {/* Streaks */}
          <div style={{ background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.03)', borderRadius: 'var(--radius-md)', padding: '14px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 9, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.15em' }}>
              <Activity size={14} /> STREAKS
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'center', marginTop: 8 }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 4 }}>MAX CONSECUTIVE WINS</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: '#34d399' }}>{data.maxWins}</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 4 }}>MAX CONSECUTIVE LOSSES</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: '#f43f5e' }}>{data.maxLoss}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Strategy Comparison Table */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 9, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.15em' }}>
            <Target size={14} /> STRATEGY COMPARISON
          </div>
          <div style={{ border: '1px solid rgba(255,255,255,0.05)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr', background: 'rgba(255,255,255,0.03)', padding: '8px 16px', fontSize: 8, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.1em' }}>
              <div>STRATEGY</div>
              <div style={{ textAlign: 'right' }}>TRADES</div>
              <div style={{ textAlign: 'right' }}>WIN RATE</div>
              <div style={{ textAlign: 'right' }}>PROFIT FACTOR</div>
              <div style={{ textAlign: 'right' }}>AVG P&L</div>
              <div style={{ textAlign: 'right' }}>NET P&L</div>
            </div>
            {data.strategyStats.length === 0 && <div style={{ padding: '20px', textAlign: 'center', fontSize: 10, color: 'var(--text-muted)' }}>No data for current filters</div>}
            {data.strategyStats.map((s, i) => (
              <TableRow key={s.id} label={s.id.replace(/_/g, ' ').toUpperCase()} stats={s} isLast={i === data.strategyStats.length - 1} highlight />
            ))}
          </div>
        </div>

        {/* Symbol Comparison Table */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 9, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.15em' }}>
            <Activity size={14} /> PER-SYMBOL CONTRIBUTION (TOP/BOTTOM)
          </div>
          <div style={{ border: '1px solid rgba(255,255,255,0.05)', borderRadius: 'var(--radius-md)', overflow: 'hidden', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1px', background: 'rgba(255,255,255,0.05)' }}>
            <div style={{ background: 'rgba(13,17,23,0.9)' }}>
              <div style={{ padding: '8px 16px', fontSize: 8, fontWeight: 800, color: '#34d399', letterSpacing: '0.1em', background: 'rgba(52,211,153,0.05)' }}>BEST PERFORMING</div>
              {data.symbolStats.filter(s => s.count > 0).slice(0, 5).map(s => (
                <div key={s.sym} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 16px', fontSize: 10, borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                  <span style={{ fontWeight: 700 }}>{s.sym}</span>
                  <div style={{ display: 'flex', gap: 16 }}>
                    <span style={{ color: 'var(--text-muted)' }}>{s.count}T</span>
                    <span style={{ color: s.netPnl >= 0 ? '#34d399' : '#f43f5e', fontWeight: 800, width: 60, textAlign: 'right' }}>
                      {s.netPnl >= 0 ? '+' : ''}${s.netPnl.toFixed(2)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ background: 'rgba(13,17,23,0.9)' }}>
              <div style={{ padding: '8px 16px', fontSize: 8, fontWeight: 800, color: '#f43f5e', letterSpacing: '0.1em', background: 'rgba(244,63,94,0.05)' }}>WORST PERFORMING</div>
              {data.symbolStats.filter(s => s.count > 0).slice(-5).reverse().map(s => (
                <div key={s.sym} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 16px', fontSize: 10, borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                  <span style={{ fontWeight: 700 }}>{s.sym}</span>
                  <div style={{ display: 'flex', gap: 16 }}>
                    <span style={{ color: 'var(--text-muted)' }}>{s.count}T</span>
                    <span style={{ color: s.netPnl >= 0 ? '#34d399' : '#f43f5e', fontWeight: 800, width: 60, textAlign: 'right' }}>
                      {s.netPnl >= 0 ? '+' : ''}${s.netPnl.toFixed(2)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

// ─── Helpers ───

function groupBy<T>(list: T[], keyGetter: (item: T) => string): Record<string, T[]> {
  const map: Record<string, T[]> = {};
  list.forEach(item => {
    const key = keyGetter(item);
    if (!map[key]) map[key] = [];
    map[key].push(item);
  });
  return map;
}

function summarize(list: BacktestTrade[]) {
  const count = list.length;
  if (count === 0) return { count: 0, winRate: 0, netPnl: 0, profitFactor: 0, avgPnl: 0 };
  
  const profitable = list.filter(t => t.pnl > 0);
  const unprofitable = list.filter(t => t.pnl <= 0);
  
  const winRate = (profitable.length / count) * 100;
  const netPnl = list.reduce((s, t) => s + t.pnl, 0);
  
  const grossProfit = profitable.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(unprofitable.reduce((s, t) => s + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0);
  const avgPnl = count > 0 ? netPnl / count : 0;

  return { count, winRate, netPnl, profitFactor, avgPnl };
}

// ─── Sub-components ───

const btnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6,
  padding: '6px 12px', borderRadius: 'var(--radius-full)',
  fontSize: 8, fontWeight: 800, letterSpacing: '0.1em',
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.08)',
  color: 'var(--text-muted)', cursor: 'pointer',
  transition: 'all 0.2s'
};

function SelectFilter({ label, value, onChange, options }: { label: string, value: string, onChange: (v: string) => void, options: string[] }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{label}:</span>
      <select 
        value={value} 
        onChange={e => onChange(e.target.value)}
        style={{
          background: 'rgba(13,17,23,0.8)', color: 'var(--text-primary)',
          border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px',
          padding: '2px 6px', fontSize: 9, outline: 'none', cursor: 'pointer'
        }}
      >
        {options.map(opt => (
          <option key={opt} value={opt}>{opt.replace(/_/g, ' ')}</option>
        ))}
      </select>
    </div>
  );
}

function MiniRow({ label, stats }: { label: string; stats: ReturnType<typeof summarize> }) {
  if (stats.count === 0) return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ color: 'var(--text-muted)' }}>-</span>
    </div>
  );

  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 10 }}>
      <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{label}</span>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <span style={{ color: 'var(--text-muted)', fontSize: 9 }}>{stats.count}T</span>
        <span style={{ color: stats.winRate >= 50 ? '#34d399' : '#f59e0b', fontSize: 9 }}>{stats.winRate.toFixed(1)}% WR</span>
        <span style={{ color: stats.netPnl >= 0 ? '#34d399' : '#f43f5e', fontWeight: 800, width: 60, textAlign: 'right' }}>
          {stats.netPnl >= 0 ? '+' : ''}${stats.netPnl.toFixed(2)}
        </span>
      </div>
    </div>
  );
}

function TableRow({ label, stats, isLast, highlight }: { label: string; stats: ReturnType<typeof summarize>, isLast: boolean, highlight?: boolean }) {
  return (
    <div style={{ 
      display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr', 
      padding: '10px 16px', fontSize: 10, 
      borderBottom: isLast ? 'none' : '1px solid rgba(255,255,255,0.03)',
      background: 'rgba(255,255,255,0.01)',
      alignItems: 'center'
    }}>
      <div style={{ fontWeight: 700, color: highlight ? 'var(--gold)' : 'var(--text-primary)' }}>{label}</div>
      <div style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{stats.count}</div>
      <div style={{ textAlign: 'right', color: stats.winRate >= 50 ? '#34d399' : '#f59e0b' }}>{stats.winRate.toFixed(1)}%</div>
      <div style={{ textAlign: 'right', color: stats.profitFactor >= 1 ? '#34d399' : '#f43f5e' }}>{stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(2)}</div>
      <div style={{ textAlign: 'right', color: stats.avgPnl >= 0 ? '#34d399' : '#f43f5e' }}>{stats.avgPnl >= 0 ? '+' : ''}${stats.avgPnl.toFixed(2)}</div>
      <div style={{ textAlign: 'right', fontWeight: 800, color: stats.netPnl >= 0 ? '#34d399' : '#f43f5e' }}>{stats.netPnl >= 0 ? '+' : ''}${stats.netPnl.toFixed(2)}</div>
    </div>
  );
}
