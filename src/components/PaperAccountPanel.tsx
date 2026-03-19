import { useTradingStore } from '../store/tradingStore';
import { TrendingUp, TrendingDown, Activity, BarChart2, RefreshCw, BookOpen, ShieldAlert, Zap } from 'lucide-react';


const MODE_META: Record<string, { label: string; color: string; bg: string; border: string; warn?: string }> = {
  PAPER:  { label: '📋 PAPER',   color: '#818cf8', bg: 'rgba(99,102,241,0.1)',  border: 'rgba(99,102,241,0.35)',
            warn: 'New deployments target PAPER. Existing positions unaffected.' },
  DEMO:   { label: '🧪 DEMO',    color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.35)',
            warn: 'New deployments target Binance Demo. Existing positions unaffected.' },
  LIVE:   { label: '⚡ LIVE',    color: 'var(--red)', bg: 'rgba(244,63,94,0.1)', border: 'rgba(244,63,94,0.35)',
            warn: 'REAL MONEY. New deployments target live exchange. Cannot be undone.' },
};

const FALLBACK_META = { label: 'UNKNOWN', color: 'var(--text-muted)', bg: 'rgba(255,255,255,0.05)', border: 'rgba(255,255,255,0.1)' };

const RESULT_COLOR: Record<string, string> = {
  PAPER:      '#818cf8',
  SUBMITTED:  'var(--green)',
  SUBMITTING: '#f59e0b',
  FAILED:     'var(--red)',
};

export default function PaperAccountPanel() {
  const {
    paperMode, paperSession, activeTrades,
    resetPaperSession, setPaperMode,
    executionMode, setExecutionMode,
    executionResults
  } = useTradingStore();

  const openPaper  = activeTrades.filter(t => t.isPaperTrade);
  const modeMeta   = MODE_META[executionMode] || FALLBACK_META;
  const winRate    = paperSession.winCount + paperSession.lossCount > 0
    ? ((paperSession.winCount / (paperSession.winCount + paperSession.lossCount)) * 100).toFixed(1)
    : '--';
  const totalTrades = paperSession.winCount + paperSession.lossCount + paperSession.breakevenCount;
  const pnlPos      = paperSession.totalPnl >= 0;

  return (
    <section>

      {/* ── Execution Mode Selector ── */}
      <div style={{
        marginBottom: 20, padding: '14px 16px', borderRadius: 10,
        background: modeMeta.bg, border: `1px solid ${modeMeta.border}`
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ShieldAlert size={15} color={modeMeta.color} />
            <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: '0.2em', color: modeMeta.color }}>
              NEW DEPLOYMENT TARGET
            </span>
          </div>
          <span style={{
            fontSize: 11, fontWeight: 900, padding: '3px 10px', borderRadius: 20,
            background: modeMeta.bg, border: `1px solid ${modeMeta.border}`, color: modeMeta.color
          }}>{modeMeta.label}</span>
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          {(['PAPER', 'DEMO', 'LIVE'] as const).map(m => {
            const meta = MODE_META[m] || FALLBACK_META;
            return (
              <button
                key={m}
                onClick={() => setExecutionMode(m)}
                style={{
                  flex: 1, padding: '7px 0', fontSize: 9, fontWeight: 900, cursor: 'pointer',
                  borderRadius: 6, letterSpacing: '0.08em', transition: 'all 0.15s',
                  background: executionMode === m ? meta.bg          : 'rgba(0,0,0,0.3)',
                  border:     `1px solid ${executionMode === m ? meta.border : 'rgba(255,255,255,0.06)'}`,
                  color:      executionMode === m ? meta.color        : 'var(--text-muted)',
                }}
              >
                {meta.label}
              </button>
            );
          })}
        </div>

        {modeMeta.warn && (
          <div style={{
            marginTop: 8, padding: '6px 10px', borderRadius: 6,
            background: 'rgba(244,63,94,0.06)', border: '1px solid rgba(244,63,94,0.2)',
            fontSize: 10, color: 'var(--red)', fontWeight: 700
          }}>
            ⚠ {modeMeta.warn}
          </div>
        )}
      </div>

      {/* ── Mode-Aware Active Routing Panels ── */}
      {executionMode === 'PAPER' && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid rgba(255,255,255,0.05)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <BookOpen size={13} color={paperMode ? '#818cf8' : 'var(--text-muted)'} />
            <div>
              <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: '0.15em', color: paperMode ? '#818cf8' : 'var(--text-primary)' }}>
                PAPER SIMULATION
              </div>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 1 }}>
                {paperMode
                  ? `${openPaper.length} PAPER open · $${paperSession.currentBalance.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  : 'Inactive'}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => resetPaperSession(10000)}
              style={{
                padding: '5px 10px', fontSize: 9, fontWeight: 800, cursor: 'pointer',
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 6, color: 'var(--text-muted)',
                display: 'flex', alignItems: 'center', gap: 4
              }}
            >
              <RefreshCw size={10} /> RESET
            </button>
            <button
              onClick={() => setPaperMode(!paperMode)}
              style={{
                padding: '5px 12px', fontSize: 9, fontWeight: 900, cursor: 'pointer',
                background: paperMode ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.05)',
                border: `1px solid ${paperMode ? 'rgba(99,102,241,0.4)' : 'rgba(255,255,255,0.1)'}`,
                borderRadius: 6, color: paperMode ? '#818cf8' : 'var(--text-muted)', letterSpacing: '0.08em'
              }}
            >
              {paperMode ? '■ STOP SIM' : '▶ START SIM'}
            </button>
          </div>
        </div>
      )}

      {executionMode === 'DEMO' && (
        <div style={{ padding: '24px', textAlign: 'center', background: 'rgba(245,158,11,0.05)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 8, marginBottom: 16 }}>
          <ShieldAlert size={24} color="#f59e0b" style={{ margin: '0 auto 12px' }} />
          <div style={{ fontWeight: 900, color: '#f59e0b', fontSize: 13, letterSpacing: '0.1em' }}>DEMO DEPLOYMENTS ONLY</div>
          <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 8 }}>Future deployments will route to Binance Demo.<br/>Open live trades and paper trades are not hidden or cancelled.</div>
        </div>
      )}

      {executionMode === 'LIVE' && (
        <div style={{ padding: '24px', textAlign: 'center', background: 'rgba(244,63,94,0.05)', border: '1px solid rgba(244,63,94,0.2)', borderRadius: 8, marginBottom: 16 }}>
          <Zap size={24} color="var(--red)" style={{ margin: '0 auto 12px' }} />
          <div style={{ fontWeight: 900, color: 'var(--red)', fontSize: 13, letterSpacing: '0.1em' }}>LIVE DEPLOYMENTS ONLY</div>
          <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 8 }}>Future deployments will route to your REAL Binance account.<br/>Open TESTNET trades and paper trades are not hidden or cancelled.</div>
        </div>
      )}

      {/* ── Paper Metrics Display (Only active in PAPER mode) ── */}
      {executionMode === 'PAPER' && (
        <>
          {/* Account Summary Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 16 }}>
            {[
              {
                label: 'PAPER BALANCE',
                value: `$${paperSession.currentBalance.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                color: 'var(--text-primary)', sub: `Start: $${paperSession.startBalance.toLocaleString()}`
              },
              {
                label: 'PAPER PnL',
                value: `${pnlPos ? '+' : ''}$${paperSession.totalPnl.toFixed(2)}`,
                color: pnlPos ? 'var(--green)' : paperSession.totalPnl < 0 ? 'var(--red)' : 'var(--text-muted)',
                sub: `${pnlPos ? '+' : ''}${paperSession.startBalance > 0 ? ((paperSession.totalPnl / paperSession.startBalance) * 100).toFixed(2) : '0.00'}%`
              },
              {
                label: 'WIN RATE',
                value: winRate === '--' ? '--' : `${winRate}%`,
                color: 'var(--text-primary)', sub: `${paperSession.winCount}W / ${paperSession.lossCount}L / ${paperSession.breakevenCount}BE`
              },
              {
                label: 'AVG R',
                value: paperSession.avgRMultiple !== 0 ? `${paperSession.avgRMultiple >= 0 ? '+' : ''}${paperSession.avgRMultiple}R` : '--',
                color: paperSession.avgRMultiple >= 0 ? 'var(--green)' : 'var(--red)',
                sub: `${totalTrades} trade${totalTrades !== 1 ? 's' : ''}`
              }
            ].map(m => (
              <div key={m.label} style={{
                padding: '10px 12px', borderRadius: 8,
                background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border-subtle)'
              }}>
                <div style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 800, letterSpacing: '0.15em', marginBottom: 4 }}>{m.label}</div>
                <div className="font-mono" style={{ fontSize: 14, fontWeight: 900, color: m.color }}>{m.value}</div>
                <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 3 }}>{m.sub}</div>
              </div>
            ))}
          </div>

          {/* Open Exposure */}
          {openPaper.length > 0 && (
            <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 8, background: 'rgba(99,102,241,0.05)', border: '1px solid rgba(99,102,241,0.15)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: '#818cf8', letterSpacing: '0.1em' }}>OPEN EXPOSURE</div>
                <div className="font-mono" style={{ fontSize: 12, fontWeight: 900, color: '#818cf8' }}>
                  ${openPaper.reduce((s, t) => s + (t.sizeUSDT ?? 0), 0).toFixed(2)}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {openPaper.map(t => {
                  const pnl = t.unrealizedPnl ?? 0;
                  return (
                    <div key={t.symbol} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11 }}>
                      <Activity size={11} color="var(--text-muted)" />
                      <span className="font-mono" style={{ fontWeight: 900, minWidth: 80 }}>{t.symbol}</span>
                      <span style={{ color: t.side === 'LONG' ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>{t.side}</span>
                      <span style={{ marginLeft: 'auto', fontWeight: 800, color: pnl >= 0 ? 'var(--green)' : 'var(--red)' }}>
                        {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)} USDT
                      </span>
                      {t.rMultiple !== undefined && (
                        <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>({t.rMultiple >= 0 ? '+' : ''}{t.rMultiple}R)</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Execution Result Log ── */}
      {executionResults.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 800, letterSpacing: '0.15em', marginBottom: 8 }}>
            EXECUTION LOG ({executionResults.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 160, overflowY: 'auto' }}>
            {executionResults.slice(0, 10).map((r, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
                borderRadius: 6, background: 'rgba(0,0,0,0.25)',
                border: `1px solid ${(RESULT_COLOR[r.status] ?? 'var(--border-subtle)') + (r.status === 'FAILED' ? '40' : '22')}`,
                fontSize: 10
              }}>
                <Zap size={10} color={RESULT_COLOR[r.status] ?? 'var(--text-muted)'} />
                <span className="font-mono" style={{ fontWeight: 900, minWidth: 90 }}>{r.symbol}</span>
                <span style={{ color: RESULT_COLOR[r.status] ?? 'var(--text-muted)', fontWeight: 800 }}>{r.status}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: 9 }}>{r.mode}</span>
                {r.exchangeOrderId && (
                  <span className="font-mono" style={{ color: 'var(--text-muted)', marginLeft: 4 }}>#{r.exchangeOrderId}</span>
                )}
                {r.error && (
                  <span style={{ color: 'var(--red)', fontSize: 9, marginLeft: 4, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.error}
                  </span>
                )}
                <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', opacity: 0.5, fontSize: 9, whiteSpace: 'nowrap' }}>
                  {new Date(r.ts).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Closed Trade History (Only in PAPER mode) ── */}
      {executionMode === 'PAPER' && paperSession.closedTrades.length > 0 && (
        <div>
          <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.15em', marginBottom: 8 }}>
            CLOSED TRADES ({paperSession.closedTrades.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 240, overflowY: 'auto' }}>
            {[...paperSession.closedTrades].reverse().map((t, i) => {
              const pos = t.realizedPnl != null && t.realizedPnl >= 0;
              return (
                <div key={`${t.symbol}-${i}`} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 6,
                  background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-subtle)',
                  borderLeft: `3px solid ${t.outcome === 'WIN' ? 'var(--green)' : t.outcome === 'LOSS' ? 'var(--red)' : 'var(--text-muted)'}`
                }}>
                  {t.outcome === 'WIN'
                    ? <TrendingUp size={12} color="var(--green)" />
                    : <TrendingDown size={12} color="var(--red)" />}
                  <span className="font-mono" style={{ fontWeight: 900, fontSize: 12, minWidth: 80 }}>
                    {t.symbol.replace('USDT', '')}
                  </span>
                  <span style={{ fontSize: 10, color: t.side === 'LONG' ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>
                    {t.side}
                  </span>
                  <span style={{ fontSize: 9, background: 'rgba(255,255,255,0.05)', padding: '1px 5px', borderRadius: 3, color: 'var(--text-muted)' }}>
                    {t.entryType ?? '--'}
                  </span>
                  <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 900, color: pos ? 'var(--green)' : 'var(--red)' }}>
                    {t.realizedPnl != null ? `${pos ? '+' : ''}${t.realizedPnl.toFixed(2)}` : '--'}
                  </span>
                  {t.rMultiple !== undefined && (
                    <span className="font-mono" style={{ fontSize: 10, color: 'var(--text-muted)', minWidth: 40, textAlign: 'right' }}>
                      {t.rMultiple >= 0 ? '+' : ''}{t.rMultiple}R
                    </span>
                  )}
                  <BarChart2 size={11} color="var(--text-muted)" />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {executionMode === 'PAPER' && paperSession.closedTrades.length === 0 && !openPaper.length && executionResults.length === 0 && (
        <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 11, opacity: 0.5 }}>
          No PAPER trades opened yet. Simulation applies only to future orders.
        </div>
      )}
    </section>
  );
}
