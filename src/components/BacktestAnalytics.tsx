// ============================================
// Backtest Analytics — Gold Bonanza
//
// Additive performance analytics layer
// visualising backtest trade distributions.
// ============================================

import { useMemo } from 'react';
import type { BacktestTrade } from '../engines/backtestEngine';
import { AreaChart, Activity, Target, ArrowUpRight, Layers } from 'lucide-react';

interface Props {
  trades: BacktestTrade[];
}

export default function BacktestAnalytics({ trades }: Props) {
  if (trades.length === 0) return null;

  const data = useMemo(() => {
    // 1. Group by Strategy
    const byStrategy = groupBy(trades, t => t.strategyId);
    const strategyStats = Object.keys(byStrategy).map(id => ({
      id, ...summarize(byStrategy[id])
    })).sort((a, b) => b.netPnl - a.netPnl);

    // 2. Group by Symbol
    const bySymbol = groupBy(trades, t => t.symbol);
    const symbolStats = Object.keys(bySymbol).map(sym => ({
      sym, ...summarize(bySymbol[sym])
    })).sort((a, b) => b.netPnl - a.netPnl);

    // 3. Side and Regime
    const longs = trades.filter(t => t.side === 'LONG');
    const shorts = trades.filter(t => t.side === 'SHORT');
    const aligned = trades.filter(t => t.regimeAlignment === 'ALIGNED');
    const overrides = trades.filter(t => t.regimeAlignment === 'COUNTER_REGIME_OVERRIDE');

    const sideStats = {
      LONG: summarize(longs),
      SHORT: summarize(shorts)
    };

    const regimeStats = {
      ALIGNED: summarize(aligned),
      OVERRIDE: summarize(overrides)
    };

    // 4. Streaks (Iterating in chronological order of exit)
    let maxWins = 0, currentWins = 0;
    let maxLoss = 0, currentLoss = 0;
    for (const t of trades) {
      if (t.pnl > 0) {
        currentWins++;
        if (currentLoss > 0) currentLoss = 0;
        if (currentWins > maxWins) maxWins = currentWins;
      } else if (t.pnl < 0) {
        currentLoss++;
        if (currentWins > 0) currentWins = 0;
        if (currentLoss > maxLoss) maxLoss = currentLoss;
      } else {
        // Break even (e.g. timeout at same price) breaks both streaks
        currentWins = 0;
        currentLoss = 0;
      }
    }

    return { strategyStats, symbolStats, sideStats, regimeStats, maxWins, maxLoss };
  }, [trades]);

  return (
    <div style={{
      marginTop: 24,
      borderRadius: 'var(--radius-lg)',
      background: 'rgba(13,17,23,0.65)',
      border: '1px solid rgba(255,255,255,0.06)',
      overflow: 'hidden'
    }}>
      <div style={{
        padding: '16px 24px',
        display: 'flex', alignItems: 'center', gap: 10,
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        background: 'rgba(255,255,255,0.02)'
      }}>
        <AreaChart size={16} color="var(--text-muted)" />
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.2em', color: 'var(--text-secondary)' }}>
          PERFORMANCE ANALYTICS
        </span>
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
              {data.symbolStats.slice(0, 5).map(s => (
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
              {data.symbolStats.slice(-5).reverse().map(s => (
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
