// ============================================
// Backtest Panel V2 — Gold Bonanza
//
// Professional backtest UI with configurable
// entry model, exit mode, symbol presets,
// analytics, and snapshot comparison.
// ============================================

import { useState, useRef } from 'react';
import { useTradingStore } from '../store/tradingStore';
import { getStrategyManifest } from '../engines/strategyInit';
import { runBacktest, DEFAULT_BACKTEST_CONFIG, SYMBOL_PRESETS } from '../engines/backtestEngine';
import type { BacktestResult, BacktestConfig, SymbolPresetKey, EntryModel, ExitMode } from '../engines/backtestEngine';
import { BarChart3, Play, Loader2, AlertTriangle, Info, Settings2, ChevronDown, ChevronUp, Save, Library } from 'lucide-react';
import BacktestAnalytics from './BacktestAnalytics';
import BacktestComparison from './BacktestComparison';
import BacktestLeaderboard from './BacktestLeaderboard';
import { useBacktestStore } from '../store/backtestStore';

export default function BacktestPanel() {
  const { enabledStrategies, strategyPreset } = useTradingStore();
  const manifest = getStrategyManifest();
  
  const [viewMode, setViewMode] = useState<'NEW_RUN' | 'SNAPSHOTS'>('NEW_RUN');
  
  // NEW RUN state
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMsg, setProgressMsg] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showAssumptions, setShowAssumptions] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  
  // Save state
  const [saveName, setSaveName] = useState('');
  const [showSave, setShowSave] = useState(false);
  
  const abortRef = useRef(false);

  // V2 config state
  const [symbolPreset, setSymbolPreset] = useState<SymbolPresetKey>('TOP_10');
  const [entryModel, setEntryModel] = useState<EntryModel>('NEXT_BAR_OPEN');
  const [exitMode, setExitMode] = useState<ExitMode>('ENHANCED_V2');

  const { snapshots, saveSnapshot, deleteSnapshot } = useBacktestStore();
  const [selectedSnaps, setSelectedSnaps] = useState<string[]>([]); // for comparison

  const activeIds = enabledStrategies.length === 0 ? manifest.map(s => s.id) : enabledStrategies;
  const activeNames = activeIds.map(id => manifest.find(s => s.id === id)?.name || id);

  const handleRun = async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    setProgress(0);
    setShowSave(false);
    abortRef.current = false;

    try {
      const preset = SYMBOL_PRESETS[symbolPreset];
      const config: BacktestConfig = {
        ...DEFAULT_BACKTEST_CONFIG,
        strategyIds: enabledStrategies,
        symbols: [...preset.symbols],
        symbolPreset: symbolPreset,
        entryModel,
        exitMode,
      };

      const res = await runBacktest(config, (pct, msg) => {
        if (abortRef.current) return;
        setProgress(pct);
        setProgressMsg(msg);
      });

      if (!abortRef.current) setResult(res);
    } catch (e: any) {
      setError(e.message || 'Backtest failed');
    } finally {
      setRunning(false);
    }
  };

  const handleSave = () => {
    if (!result || !saveName.trim()) return;
    saveSnapshot(saveName.trim(), result);
    setShowSave(false);
    setSaveName('');
    setViewMode('SNAPSHOTS'); // auto-jump to snapshots
  };

  const toggleSnapSelect = (id: string) => {
    if (selectedSnaps.includes(id)) {
      setSelectedSnaps(selectedSnaps.filter(s => s !== id));
    } else {
      if (selectedSnaps.length < 2) setSelectedSnaps([...selectedSnaps, id]);
    }
  };

  const s = result?.stats;

  return (
    <div style={{
      borderRadius: 'var(--radius-lg)',
      background: 'rgba(13,17,23,0.96)',
      border: '1px solid rgba(201,176,119,0.12)',
      overflow: 'hidden'
    }}>
      {/* Header */}
      <div style={{
        padding: '18px 24px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid rgba(255,255,255,0.04)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <BarChart3 size={16} color="var(--gold)" />
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.2em', color: 'var(--gold)' }}>
            HISTORICAL BACKTEST
          </span>
          <span style={{
            fontSize: 8, fontWeight: 700, padding: '3px 8px',
            borderRadius: 'var(--radius-full)',
            background: 'rgba(244,63,94,0.1)', color: '#f43f5e',
            letterSpacing: '0.1em'
          }}>SIMULATED</span>
          <span style={{
            fontSize: 7, fontWeight: 800, padding: '2px 6px',
            borderRadius: 'var(--radius-full)',
            background: 'rgba(34,211,238,0.08)', color: '#22d3ee',
            letterSpacing: '0.08em'
          }}>V2</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          
          {/* View Toggles */}
          <div style={{ display: 'flex', background: 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius-full)', padding: 2, marginRight: 8 }}>
            <button
              onClick={() => setViewMode('NEW_RUN')}
              style={{
                padding: '5px 12px', border: 'none', borderRadius: 'var(--radius-full)',
                background: viewMode === 'NEW_RUN' ? 'rgba(255,255,255,0.08)' : 'transparent',
                color: viewMode === 'NEW_RUN' ? 'var(--text-primary)' : 'var(--text-muted)',
                fontSize: 9, fontWeight: 800, letterSpacing: '0.1em', cursor: 'pointer', transition: 'all 0.2s'
              }}
            >NEW RUN</button>
            <button
              onClick={() => setViewMode('SNAPSHOTS')}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '5px 12px', border: 'none', borderRadius: 'var(--radius-full)',
                background: viewMode === 'SNAPSHOTS' ? 'rgba(201,176,119,0.15)' : 'transparent',
                color: viewMode === 'SNAPSHOTS' ? 'var(--gold)' : 'var(--text-muted)',
                fontSize: 9, fontWeight: 800, letterSpacing: '0.1em', cursor: 'pointer', transition: 'all 0.2s'
              }}
            >
              <Library size={10} /> SAVED ({snapshots.length})
            </button>
          </div>

          {viewMode === 'NEW_RUN' && (
            <>
              <button
                onClick={() => setShowConfig(!showConfig)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  padding: '6px 12px', borderRadius: 'var(--radius-full)',
                  fontSize: 8, fontWeight: 700, letterSpacing: '0.1em',
                  background: showConfig ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  color: 'var(--text-muted)', cursor: 'pointer', transition: 'all 0.2s'
                }}
              >
                <Settings2 size={10} /> CONFIG
                {showConfig ? <ChevronUp size={9} /> : <ChevronDown size={9} />}
              </button>
              <button
                onClick={handleRun}
                disabled={running}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '7px 18px', borderRadius: 'var(--radius-full)',
                  fontSize: 9, fontWeight: 800, letterSpacing: '0.15em',
                  background: running ? 'rgba(255,255,255,0.04)' : 'rgba(201,176,119,0.15)',
                  border: `1px solid ${running ? 'rgba(255,255,255,0.06)' : 'rgba(201,176,119,0.3)'}`,
                  color: running ? 'var(--text-muted)' : 'var(--gold)',
                  cursor: running ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                {running ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Play size={12} />}
                {running ? 'RUNNING...' : 'RUN 100-DAY BACKTEST'}
              </button>
            </>
          )}
        </div>
      </div>

      {viewMode === 'SNAPSHOTS' ? (
        // ─── SNAPSHOTS MANAGER ───
        <div style={{ padding: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.15em' }}>SAVED SNAPSHOTS</div>
            {selectedSnaps.length > 0 && (
              <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>
                {selectedSnaps.length}/2 selected for comparison
              </div>
            )}
          </div>
          
          <BacktestLeaderboard 
            snapshots={snapshots}
            selectedSnaps={selectedSnaps}
            toggleSnapSelect={toggleSnapSelect}
            deleteSnapshot={deleteSnapshot}
          />

          {/* Comparison View Mount */}
          {selectedSnaps.length === 2 && (
            <BacktestComparison
              snapA={snapshots.find(s => s.id === selectedSnaps[0])!}
              snapB={snapshots.find(s => s.id === selectedSnaps[1])!}
              onClose={() => setSelectedSnaps([])}
            />
          )}

        </div>
      ) : (
        // ─── NEW RUN VIEW ───
        <>
          {/* Active Strategies */}
          <div style={{ padding: '10px 24px', background: 'rgba(255,255,255,0.01)' }}>
            <span style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 600 }}>
              Testing: {activeNames.join(' + ')} ({strategyPreset !== 'CUSTOM' ? strategyPreset : 'Custom'})
            </span>
          </div>

          {/* Configuration Panel */}
          {showConfig && (
            <div style={{
              padding: '14px 24px',
              background: 'rgba(255,255,255,0.015)',
              borderTop: '1px solid rgba(255,255,255,0.03)',
              borderBottom: '1px solid rgba(255,255,255,0.03)',
              display: 'flex', flexDirection: 'column', gap: 14
            }}>
              {/* Symbol Universe */}
              <div>
                <div style={{ fontSize: 8, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.15em', marginBottom: 6 }}>SYMBOL UNIVERSE</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {(Object.keys(SYMBOL_PRESETS) as SymbolPresetKey[]).map(key => (
                    <ToggleBtn
                      key={key}
                      label={SYMBOL_PRESETS[key].label}
                      active={symbolPreset === key}
                      onClick={() => setSymbolPreset(key)}
                    />
                  ))}
                </div>
              </div>

              {/* Entry Model */}
              <div>
                <div style={{ fontSize: 8, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.15em', marginBottom: 6 }}>ENTRY MODEL</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <ToggleBtn label="Next-Bar Open (Realistic)" active={entryModel === 'NEXT_BAR_OPEN'} onClick={() => setEntryModel('NEXT_BAR_OPEN')} />
                  <ToggleBtn label="Signal Price (V1)" active={entryModel === 'SIGNAL_PRICE'} onClick={() => setEntryModel('SIGNAL_PRICE')} />
                </div>
                <div style={{ fontSize: 8, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.4 }}>
                  {entryModel === 'NEXT_BAR_OPEN'
                    ? '✓ Fill at the next 15m candle open after signal fires — eliminates look-ahead bias. Skips entries where next-bar open is already near SL.'
                    : '⚠ Fill at signal price on the same bar the signal fires — includes slight look-ahead (~15 min).'}
                </div>
              </div>

              {/* Exit Mode */}
              <div>
                <div style={{ fontSize: 8, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.15em', marginBottom: 6 }}>EXIT MODE</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <ToggleBtn label="Enhanced V2 (Trailing + Partial TP)" active={exitMode === 'ENHANCED_V2'} onClick={() => setExitMode('ENHANCED_V2')} />
                  <ToggleBtn label="Fixed SL/TP Only (V1)" active={exitMode === 'FIXED_SL_TP'} onClick={() => setExitMode('FIXED_SL_TP')} />
                </div>
                <div style={{ fontSize: 8, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.4 }}>
                  {exitMode === 'ENHANCED_V2'
                    ? '✓ 50% closed at TP1, remaining trails with ATR-based stop (breakeven → tighten). TP2 target on remainder. Approximates live exit engine.'
                    : '⚠ Exit only on fixed SL or TP1 hit. No trailing stop, no partial takes. Simpler but less realistic.'}
                </div>
              </div>
            </div>
          )}

          {/* Progress Bar */}
          {running && (
            <div style={{ padding: '12px 24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--text-muted)', marginBottom: 6, fontWeight: 700 }}>
                <span>{progressMsg}</span>
                <span>{progress}%</span>
              </div>
              <div className="capacity-bar-track">
                <div className="capacity-bar-fill" style={{ width: `${progress}%`, transition: 'width 0.3s' }} />
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div style={{ padding: '12px 24px', display: 'flex', alignItems: 'center', gap: 8, color: '#f43f5e', fontSize: 11 }}>
              <AlertTriangle size={14} /> {error}
            </div>
          )}

          {/* Results */}
          {s && result && (
            <div style={{ padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Key Metrics Row */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
                <MetricCard label="NET P&L" value={`$${s.netPnl.toFixed(2)}`} color={s.netPnl >= 0 ? '#34d399' : '#f43f5e'} />
                <MetricCard label="RETURN" value={`${s.returnPct.toFixed(1)}%`} color={s.returnPct >= 0 ? '#34d399' : '#f43f5e'} />
                <MetricCard label="WIN RATE" value={`${s.winRate.toFixed(1)}%`} color={s.winRate >= 50 ? '#34d399' : '#f59e0b'} />
                <MetricCard label="PROFIT FACTOR" value={s.profitFactor === Infinity ? '∞' : s.profitFactor.toFixed(2)} color={s.profitFactor >= 1.5 ? '#34d399' : s.profitFactor >= 1 ? '#f59e0b' : '#f43f5e'} />
              </div>

              {/* Equity Curve */}
              <div style={{ padding: '14px', background: 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(255,255,255,0.04)' }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.12em', marginBottom: 10 }}>EQUITY CURVE</div>
                <EquityCurve equity={result.equity} startBal={s.startingBalance} />
              </div>

              {/* Detailed Stats Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                <StatRow label="Total Trades" value={s.totalTrades.toString()} />
                <StatRow label="Winning" value={s.winningTrades.toString()} color="#34d399" />
                <StatRow label="Losing" value={s.losingTrades.toString()} color="#f43f5e" />
                {s.partialWins > 0 && <StatRow label="Partial Wins" value={s.partialWins.toString()} color="#22d3ee" />}
                <StatRow label="Timeouts" value={s.timeoutTrades.toString()} color="#94a3b8" />
                <StatRow label="Gross Profit" value={`$${s.grossProfit.toFixed(2)}`} color="#34d399" />
                <StatRow label="Gross Loss" value={`-$${s.grossLoss.toFixed(2)}`} color="#f43f5e" />
                <StatRow label="Avg Win" value={`$${s.avgWin.toFixed(2)}`} color="#34d399" />
                <StatRow label="Avg Loss" value={`-$${s.avgLoss.toFixed(2)}`} color="#f43f5e" />
                <StatRow label="Max Drawdown" value={`$${s.maxDrawdown.toFixed(2)} (${s.maxDrawdownPct.toFixed(1)}%)`} color="#f43f5e" />
                <StatRow label="Starting Balance" value={`$${s.startingBalance.toFixed(2)}`} />
                <StatRow label="Ending Balance" value={`$${s.endingBalance.toFixed(2)}`} color={s.endingBalance >= s.startingBalance ? '#34d399' : '#f43f5e'} />
                <StatRow label="Sharpe (approx)" value={s.sharpeApprox.toFixed(2)} />
              </div>

              {/* V2 Config Used Badge Row */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <ConfigBadge label="Entry" value={result.config.entryModel === 'NEXT_BAR_OPEN' ? 'Next-Bar Open' : 'Signal Price'} />
                  <ConfigBadge label="Exit" value={result.config.exitMode === 'ENHANCED_V2' ? 'V2 Enhanced' : 'Fixed SL/TP'} />
                  <ConfigBadge label="Symbols" value={`${result.config.symbols.length}`} />
                  <ConfigBadge label="Regime" value={result.config.btcRegimeEnabled ? 'ON' : 'OFF'} />
                </div>
                
                {/* Save Snapshot Handler */}
                <div style={{ position: 'relative' }}>
                  {!showSave ? (
                    <button
                      onClick={() => setShowSave(true)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        padding: '6px 14px', borderRadius: 'var(--radius-full)',
                        fontSize: 9, fontWeight: 800, letterSpacing: '0.1em',
                        background: 'rgba(201,176,119,0.1)', color: 'var(--gold)',
                        border: '1px solid rgba(201,176,119,0.2)', cursor: 'pointer',
                        transition: 'all 0.2s'
                      }}
                    >
                      <Save size={12} /> SAVE RUN SNAPSHOT
                    </button>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.05)', padding: '4px', borderRadius: 'var(--radius-full)', border: '1px solid rgba(255,255,255,0.1)' }}>
                      <input
                        autoFocus
                        value={saveName}
                        onChange={e => setSaveName(e.target.value)}
                        placeholder="Name this run..."
                        style={{
                          background: 'transparent', border: 'none', color: 'var(--text-primary)',
                          fontSize: 10, outline: 'none', padding: '0 8px', width: 140
                        }}
                        onKeyDown={e => e.key === 'Enter' && handleSave()}
                      />
                      <button onClick={handleSave} disabled={!saveName.trim()} style={{ background: 'var(--gold)', color: '#000', border: 'none', borderRadius: 'var(--radius-full)', padding: '4px 10px', fontSize: 9, fontWeight: 800, cursor: saveName.trim() ? 'pointer' : 'not-allowed' }}>SAVE</button>
                      <button onClick={() => setShowSave(false)} style={{ background: 'transparent', color: 'var(--text-muted)', border: 'none', padding: '4px 8px', fontSize: 10, cursor: 'pointer' }}>✕</button>
                    </div>
                  )}
                </div>
              </div>

              {/* Assumptions */}
              <div>
                <div
                  onClick={() => setShowAssumptions(!showAssumptions)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.12em' }}
                >
                  <Info size={12} /> BACKTEST ASSUMPTIONS {showAssumptions ? '▲' : '▼'}
                </div>
                {showAssumptions && (
                  <div style={{ marginTop: 8, padding: '10px 14px', background: 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(255,255,255,0.04)' }}>
                    {result.assumptions.map((a, i) => (
                      <div key={i} style={{
                        fontSize: 9, color: a.startsWith('⚠') ? '#f59e0b' : 'var(--text-muted)',
                        fontWeight: a.startsWith('⚠') ? 700 : 500,
                        padding: '2px 0', lineHeight: 1.5
                      }}>
                        {a}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Additive Analytics Layer */}
              <BacktestAnalytics trades={result.trades} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ToggleBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '5px 12px', borderRadius: 'var(--radius-full)',
        fontSize: 8, fontWeight: 800, letterSpacing: '0.08em',
        background: active ? 'rgba(201,176,119,0.12)' : 'rgba(255,255,255,0.02)',
        border: `1px solid ${active ? 'rgba(201,176,119,0.35)' : 'rgba(255,255,255,0.06)'}`,
        color: active ? 'var(--gold)' : 'var(--text-muted)',
        cursor: 'pointer', transition: 'all 0.2s'
      }}
    >{label}</button>
  );
}

function ConfigBadge({ label, value }: { label: string; value: string }) {
  return (
    <span style={{
      fontSize: 8, fontWeight: 700, padding: '3px 8px',
      borderRadius: 'var(--radius-full)',
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.05)',
      color: 'var(--text-muted)'
    }}>{label}: {value}</span>
  );
}

function MetricCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{
      padding: '12px 14px', borderRadius: 'var(--radius-md)',
      background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)',
      textAlign: 'center'
    }}>
      <div style={{ fontSize: 8, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.15em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color, letterSpacing: '-0.5px' }}>{value}</div>
    </div>
  );
}

function StatRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 10px', borderRadius: 'var(--radius-sm)', background: 'rgba(255,255,255,0.01)' }}>
      <span style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: 10, color: color || 'var(--text-primary)', fontWeight: 700 }}>{value}</span>
    </div>
  );
}

function EquityCurve({ equity, startBal }: { equity: { bar: number; balance: number; time: number }[]; startBal: number }) {
  if (equity.length < 2) return <div style={{ fontSize: 9, color: 'var(--text-muted)', textAlign: 'center', padding: 20 }}>No data</div>;

  const width = 600;
  const height = 120;
  const padding = { top: 10, right: 10, bottom: 20, left: 50 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  const balances = equity.map(e => e.balance);
  const minBal = Math.min(...balances) * 0.98;
  const maxBal = Math.max(...balances) * 1.02;
  const range = maxBal - minBal || 1;

  const points = equity.map((e, i) => {
    const x = padding.left + (i / (equity.length - 1)) * plotW;
    const y = padding.top + plotH - ((e.balance - minBal) / range) * plotH;
    return `${x},${y}`;
  });

  const finalBal = equity[equity.length - 1].balance;
  const isProfit = finalBal >= startBal;
  const lineColor = isProfit ? '#34d399' : '#f43f5e';
  const fillColor = isProfit ? 'rgba(52,211,153,0.08)' : 'rgba(244,63,94,0.08)';

  const areaPath = `M ${padding.left},${padding.top + plotH} L ${points.join(' L ')} L ${padding.left + plotW},${padding.top + plotH} Z`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto' }}>
      {[0, 0.25, 0.5, 0.75, 1].map(pct => {
        const y = padding.top + plotH * (1 - pct);
        const val = minBal + range * pct;
        return (
          <g key={pct}>
            <line x1={padding.left} y1={y} x2={padding.left + plotW} y2={y} stroke="rgba(255,255,255,0.04)" strokeWidth={0.5} />
            <text x={padding.left - 4} y={y + 3} fill="rgba(255,255,255,0.25)" fontSize={7} textAnchor="end">${val.toFixed(0)}</text>
          </g>
        );
      })}
      <line
        x1={padding.left} y1={padding.top + plotH - ((startBal - minBal) / range) * plotH}
        x2={padding.left + plotW} y2={padding.top + plotH - ((startBal - minBal) / range) * plotH}
        stroke="rgba(201,176,119,0.2)" strokeWidth={0.5} strokeDasharray="4,4"
      />
      <path d={areaPath} fill={fillColor} />
      <polyline points={points.join(' ')} fill="none" stroke={lineColor} strokeWidth={1.5} />
    </svg>
  );
}
