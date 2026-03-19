import { useState, useEffect } from 'react';
import { Target, X, TrendingUp, RefreshCw, Wifi, WifiOff, Activity, Clock } from 'lucide-react';
import { api } from '../services/api';
import { useTradingStore } from '../store/tradingStore';
import type { ActiveTrade, SignalRow } from '../types/trading';
import { getCanonicalPositionCount } from '../utils/positionCount';

export default function CommandSyncHub() {
  const [loading, setLoading] = useState(true);
  const [binanceConnected, setBinanceConnected] = useState(false);
  const [closingSymbols, setClosingSymbols] = useState<Set<string>>(new Set());

  // Pull from local store (manually-deployed trades and queued signals)
  const { 
    activeTrades: rawTrades, pipelineSignals: rawSignals, 
    removeActiveTrade, deploySignal,
    binancePositions: rawPositions, setBinancePositions
  } = useTradingStore();

  const activeTrades = Array.isArray(rawTrades) ? rawTrades : [];
  const pipelineSignals = Array.isArray(rawSignals) ? rawSignals : [];
  const binancePositions = Array.isArray(rawPositions) ? rawPositions : [];

  useEffect(() => {
    let mounted = true;
    const fetchPositions = async () => {
      try {
        const data = await api.getPositions();
        if (mounted && Array.isArray(data)) {
          setBinancePositions(data);
          setBinanceConnected(true);
          setLoading(false);
        } else if (mounted) {
          setBinanceConnected(false);
          setLoading(false);
        }
      } catch (e) {
        // Binance not configured or offline — still show local trades
        if (mounted) {
          setBinanceConnected(false);
          setLoading(false);
        }
      }
    };
    fetchPositions();
    const interval = setInterval(fetchPositions, 5000);
    window.addEventListener('refreshPositions', fetchPositions);
    return () => {
      mounted = false;
      clearInterval(interval);
      window.removeEventListener('refreshPositions', fetchPositions);
    };
  }, []);

  const handleCloseBinance = async (symbol: string, amtStr: string) => {
    if (closingSymbols.has(symbol)) return;
    try {
      setClosingSymbols(prev => new Set(prev).add(symbol));
      const amt = parseFloat(amtStr);
      const posSide = amt > 0 ? 'LONG' : 'SHORT';
      await api.closeTrade(symbol, posSide, Math.abs(amt));
      const data = await api.getPositions();
      setBinancePositions(data);
    } catch (e: any) {
      alert('Failed to close trade: ' + e.message);
    } finally {
      setClosingSymbols(prev => {
        const next = new Set(prev);
        next.delete(symbol);
        return next;
      });
    }
  };

  const handleCloseLocal = (id: string) => {
    const idx = activeTrades.findIndex(t => t.id === id);
    if (idx >= 0) removeActiveTrade(idx);
  };

  // CANONICAL count — same formula as Header.tsx and SystemStatus.tsx
  const { total: totalCount } = getCanonicalPositionCount(binancePositions, activeTrades, pipelineSignals);

  // Keep these for rendering the separate sections below
  const binanceSymbols = new Set(binancePositions.map((p: any) => p.symbol?.toUpperCase()));
  const localOnly      = activeTrades.filter(t => !binanceSymbols.has(t.symbol?.toUpperCase()));
  const allPending     = pipelineSignals.filter(s => s.status === 'QUEUED');

  return (
    <section>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 20, paddingBottom: 12, borderBottom: '1px solid rgba(212,175,55,0.1)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Target size={20} color="var(--gold)" />
          <div>
            <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: '0.2em', color: 'var(--gold-light)' }}>
              COMMAND SYNC HUB
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
              {loading ? 'Connecting...' : `${totalCount} Active Trade${totalCount !== 1 ? 's' : ''}`}
              {' '}{loading && '(Syncing...)'}
            </div>
          </div>
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          fontSize: 10, fontWeight: 700,
          color: binanceConnected ? 'var(--green)' : 'var(--text-muted)'
        }}>
          {binanceConnected ? <Wifi size={12} /> : <WifiOff size={12} />}
          {binanceConnected ? 'BINANCE LIVE' : 'LOCAL ONLY'}
        </div>
      </div>

      {totalCount === 0 ? (
        <div style={{
          padding: '40px 24px',
          borderRadius: 'var(--radius-lg)',
          border: '1px dashed rgba(255,255,255,0.06)',
          textAlign: 'center',
          color: 'var(--text-muted)',
          fontSize: 12
        }}>
          <TrendingUp size={24} style={{ opacity: 0.3, marginBottom: 8 }} />
          <div>No active positions. Deploy a signal to see it here.</div>
        </div>
      ) : (
        <div className="trades-grid">

          {/* ── Pending (Queued) signals ── */}
          {allPending.map((row, i) => {
            const sym = row.symbol.replace('USDT', '');
            return (
              <div key={`pending-${row.id}`} className="opportunity-card card-entry" style={{
                padding: '24px 22px', background: 'rgba(212,175,55,0.02)',
                borderColor: 'var(--gold)', animationDelay: `${i * 0.08}s`,
                boxShadow: '0 0 20px rgba(212,175,55,0.05)'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <div>
                    <div className="font-mono" style={{ fontWeight: 900, fontSize: 16, fontStyle: 'italic' }}>
                      {sym}<span style={{ color: 'var(--text-muted)', fontSize: 11 }}>USDT</span>
                    </div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--gold-light)', letterSpacing: '0.1em', marginTop: 2 }}>
                       QUEUED {row.signal.side}
                    </div>
                  </div>
                  <button
                    onClick={() => deploySignal(row.id)}
                    className="premium-btn"
                    style={{ padding: '8px 16px', fontSize: 10 }}
                  >
                    DEPLOY NOW
                  </button>
                </div>
                <div style={{
                  padding: '8px 10px', borderRadius: 'var(--radius-sm)', background: 'rgba(212,175,55,0.05)',
                  border: '1px solid rgba(212,175,55,0.1)', textAlign: 'center', marginBottom: 12
                }}>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 800 }}>MAPPING STATUS</div>
                  <div style={{ fontSize: 11, fontWeight: 900, color: 'var(--gold)' }}>AWAITING COMMAND EXECUTION</div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <div style={{ padding: '6px 8px', borderRadius: 'var(--radius-sm)', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-subtle)' }}>
                    <div style={{ fontSize: 8, color: 'var(--text-muted)', fontWeight: 800 }}>ENTRY</div>
                    <div className="font-mono" style={{ fontSize: 10, fontWeight: 900 }}>{fmtPrice(row.signal.entryPrice)}</div>
                  </div>
                  <div style={{ padding: '6px 8px', borderRadius: 'var(--radius-sm)', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-subtle)' }}>
                    <div style={{ fontSize: 8, color: 'var(--text-muted)', fontWeight: 800 }}>SIZE</div>
                    <div className="font-mono" style={{ fontSize: 10, fontWeight: 900 }}>${row.signal.sizeUSDT.toFixed(2)}</div>
                  </div>
                </div>
              </div>
            );
          })}

          {/* ── Binance live positions ── */}
          {binancePositions.map((pos, i) => {
            const entryPrice = parseFloat(pos.entryPrice);
            const pnlUSD = parseFloat(pos.unRealizedProfit);
            const leverage = parseFloat(pos.leverage);
            const amt = parseFloat(pos.positionAmt);
            const side = amt > 0 ? 'LONG' : 'SHORT';
            const sizeUSDT = Math.abs(amt * entryPrice);
            const pnlPct = sizeUSDT > 0 ? (pnlUSD / (sizeUSDT / leverage)) * 100 : 0;
            const sym = pos.symbol.replace('USDT', '');
            const isClosing = closingSymbols.has(pos.symbol);

            return (
              <div key={`binance-${pos.symbol}-${i}`} className="opportunity-card card-entry" style={{
                padding: '24px 22px',
                borderColor: pnlUSD >= 0 ? 'rgba(16,185,129,0.2)' : 'rgba(244,63,94,0.2)',
                animationDelay: `${i * 0.08}s`,
                opacity: isClosing ? 0.5 : 1
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <div>
                    <div className="font-mono" style={{ fontWeight: 900, fontSize: 16, fontStyle: 'italic' }}>
                      {sym}<span style={{ color: 'var(--text-muted)', fontSize: 11 }}>USDT</span>
                    </div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--gold-light)', letterSpacing: '0.1em', marginTop: 2 }}>
                      {leverage}x {side}
                    </div>
                  </div>
                  <button
                    onClick={() => handleCloseBinance(pos.symbol, pos.positionAmt)}
                    disabled={isClosing}
                    style={{
                      background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.3)',
                      borderRadius: 'var(--radius-sm)', padding: '6px 8px',
                      cursor: isClosing ? 'wait' : 'pointer',
                      color: 'var(--red)', display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}
                    title="Close position"
                  >
                    {isClosing ? <RefreshCw size={14} /> : <X size={14} />}
                  </button>
                </div>

                <div style={{
                  padding: '14px', borderRadius: 'var(--radius-sm)',
                  background: pnlUSD >= 0 ? 'var(--green-soft)' : 'var(--red-soft)',
                  border: `1px solid ${pnlUSD >= 0 ? 'rgba(16,185,129,0.2)' : 'rgba(244,63,94,0.2)'}`,
                  textAlign: 'center', marginBottom: 16
                }}>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.2em', fontWeight: 800, marginBottom: 4 }}>UNREALIZED PnL (ROE)</div>
                  <div className="font-mono" style={{ fontSize: 20, fontWeight: 900, fontStyle: 'italic', color: pnlUSD >= 0 ? 'var(--green)' : 'var(--red)' }}>
                    {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%
                  </div>
                  <div className="font-mono" style={{ fontSize: 12, fontWeight: 700, color: pnlUSD >= 0 ? 'var(--green)' : 'var(--red)', marginTop: 4, opacity: 0.85 }}>
                    {pnlUSD >= 0 ? '+' : ''}{pnlUSD.toFixed(2)} USDT
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  {[
                    { label: 'ENTRY', value: fmtPrice(entryPrice) },
                    { label: 'SIZE', value: `$${sizeUSDT.toFixed(2)}` },
                  ].map(m => (
                    <div key={m.label} style={{ padding: '8px 10px', borderRadius: 'var(--radius-sm)', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border-subtle)' }}>
                      <div style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.15em', fontWeight: 800, marginBottom: 2 }}>{m.label}</div>
                      <div className="font-mono" style={{ fontSize: 11, fontWeight: 900, fontStyle: 'italic' }}>{m.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {/* ── Local (manually deployed) trades — full lifecycle ── */}
          {localOnly.map((trade, i) => {
            // Find prior signals for this same symbol for history display
            const history = pipelineSignals.filter(s => 
              s.symbol.toUpperCase() === trade.symbol.toUpperCase() && 
              s.id !== trade.signalId
            ).slice(0, 6);

            return (
              <LocalTradeCard
                key={trade.id}
                trade={trade}
                index={binancePositions.length + i}
                history={history}
                onClose={() => handleCloseLocal(trade.id)}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

// ─── Status Meta ─────────────────────────────────────────────────────────────
const STATUS_META: Record<string, { label: string; color: string; bg: string; border: string }> = {
  ACTIVE:     { label: 'ACTIVE',     color: 'var(--green)',     bg: 'rgba(34,197,94,0.05)',   border: 'rgba(34,197,94,0.25)' },
  TP1_HIT:    { label: 'TP1 HIT',    color: 'var(--green)',     bg: 'rgba(34,197,94,0.08)',   border: 'rgba(34,197,94,0.3)' },
  TP2_HIT:    { label: 'TP2 HIT ✓', color: '#a3e635',          bg: 'rgba(163,230,53,0.08)',  border: 'rgba(163,230,53,0.3)' },
  SL_HIT:     { label: 'SL HIT',     color: 'var(--red)',       bg: 'rgba(244,63,94,0.08)',   border: 'rgba(244,63,94,0.3)' },
  CANCELLED:  { label: 'CANCELLED',  color: 'var(--text-muted)',bg: 'rgba(255,255,255,0.03)', border: 'rgba(255,255,255,0.08)' },
  CLOSED:     { label: 'CLOSED',     color: 'var(--text-muted)',bg: 'rgba(255,255,255,0.03)', border: 'rgba(255,255,255,0.08)' },
};

function LocalTradeCard({ 
  trade, index, onClose, history 
}: { 
  trade: ActiveTrade; index: number; onClose: () => void; history: SignalRow[] 
}) {
  const sym = trade.symbol.replace('USDT', '');
  const meta = STATUS_META[trade.status] ?? STATUS_META['ACTIVE'];
  const TERMINAL = ['TP1_HIT', 'TP2_HIT', 'SL_HIT', 'CLOSED', 'CANCELLED'];
  const isTerminal = TERMINAL.includes(trade.status);

  const pnl = trade.unrealizedPnl ?? 0;
  const realized = trade.realizedPnl;
  const displayPnl = isTerminal && realized !== undefined ? realized : pnl;
  const isPnlPos   = displayPnl >= 0;

  return (
    <div
      className="opportunity-card card-entry"
      style={{
        padding: '24px 22px',
        borderColor: trade.side === 'LONG' ? 'rgba(16,185,129,0.2)' : 'rgba(244,63,94,0.2)',
        animationDelay: `${index * 0.08}s`,
        opacity: isTerminal ? 0.8 : 1
      }}
    >
      {/* ── Versioning Badge ── */}
      {trade.signalId && (
        <div style={{ fontSize: 8, fontWeight: 900, color: 'var(--text-muted)', marginBottom: 8, letterSpacing: '0.1em' }}>
          INSTANCE ID: {trade.id.split('_').pop()?.toUpperCase()}
        </div>
      )}

      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
        <div>
          <div className="font-mono" style={{ fontWeight: 900, fontSize: 16, fontStyle: 'italic' }}>
            {sym}<span style={{ color: 'var(--text-muted)', fontSize: 11 }}>USDT</span>
          </div>
          <div style={{ fontSize: 10, fontWeight: 700, color: trade.side === 'LONG' ? 'var(--green)' : 'var(--red)', marginTop: 2 }}>
            {trade.leverage}x {trade.side}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
          {/* Status pill */}
          <div style={{
            padding: '4px 10px', borderRadius: 'var(--radius-full)',
            background: meta.bg, border: `1px solid ${meta.border}`,
            fontSize: 10, fontWeight: 900, color: meta.color, letterSpacing: '0.1em'
          }}>
            {meta.label}
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.2)',
              borderRadius: 6, padding: '4px 6px', cursor: 'pointer',
              color: 'var(--red)', display: 'flex', alignItems: 'center'
            }}
            title="Remove"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {/* ── PnL Banner ── */}
      <div style={{
        padding: '10px 14px', borderRadius: 'var(--radius-sm)',
        background: isPnlPos ? 'var(--green-soft)' : 'var(--red-soft)',
        border: `1px solid ${isPnlPos ? 'rgba(34,197,94,0.2)' : 'rgba(244,63,94,0.2)'}`,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12
      }}>
        <div>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 800, letterSpacing: '0.15em' }}>
            {isTerminal ? 'REALIZED PnL' : 'UNREALIZED PnL'}
          </div>
          <div className="font-mono" style={{ fontSize: 18, fontWeight: 900, fontStyle: 'italic', color: isPnlPos ? 'var(--green)' : 'var(--red)' }}>
            {displayPnl >= 0 ? '+' : ''}{displayPnl.toFixed(2)} USDT
          </div>
        </div>
        {trade.rMultiple !== undefined && (
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 800 }}>R MULTIPLE</div>
            <div className="font-mono" style={{ fontSize: 16, fontWeight: 900, color: trade.rMultiple >= 0 ? 'var(--green)' : 'var(--red)' }}>
              {trade.rMultiple >= 0 ? '+' : ''}{trade.rMultiple.toFixed(2)}R
            </div>
          </div>
        )}
      </div>

      {/* ── Level Metrics ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 6, marginBottom: 12 }}>
        {[
          { label: 'ENTRY', value: fmtPrice(trade.entryPrice) },
          { label: 'SL',    value: `${fmtPrice(trade.sl)}`, sub: trade.distToSl !== undefined ? `${trade.distToSl > 0 ? '+' : ''}${trade.distToSl.toFixed(2)}%` : undefined },
          { label: 'TP 1',  value: fmtPrice(trade.t1),  sub: trade.distToTp1 !== undefined ? `${trade.distToTp1.toFixed(2)}%` : undefined },
          { label: 'TP 2',  value: trade.t2 ? fmtPrice(trade.t2) : '--', sub: trade.distToTp2 !== undefined ? `${trade.distToTp2.toFixed(2)}%` : undefined },
        ].map(m => (
          <div key={m.label} style={{ padding: '6px 8px', borderRadius: 'var(--radius-sm)', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border-subtle)', textAlign: 'center' }}>
            <div style={{ fontSize: 8, color: 'var(--text-muted)', fontWeight: 800, letterSpacing: '0.1em' }}>{m.label}</div>
            <div className="font-mono" style={{ fontSize: 10, fontWeight: 900 }}>{m.value}</div>
            {m.sub && <div style={{ fontSize: 8, color: 'var(--text-muted)', marginTop: 1 }}>{m.sub}</div>}
          </div>
        ))}
      </div>

      {/* ── Live price + last updated ── */}
      {trade.livePrice !== undefined && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontSize: 11, color: 'var(--text-muted)' }}>
          <Activity size={12} />
          <span>Live: <strong className="font-mono" style={{ color: 'var(--text-primary)' }}>{fmtPrice(trade.livePrice)}</strong></span>
          {trade.priceUpdatedAt && (
            <span style={{ opacity: 0.5 }}>· {new Date(trade.priceUpdatedAt).toLocaleTimeString()}</span>
          )}
        </div>
      )}

      {/* ── Analytical metadata ── */}
      {(trade.score !== undefined || trade.entryType) && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {trade.score !== undefined && (
            <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 4, background: 'rgba(212,175,55,0.08)', color: 'var(--gold)', border: '1px solid rgba(212,175,55,0.2)' }}>
              SCORE {trade.score}
            </span>
          )}
          {trade.entryType && (
            <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 4, background: 'rgba(255,255,255,0.04)', color: 'var(--text-muted)', border: '1px solid rgba(255,255,255,0.08)' }}>
              {trade.entryType}
            </span>
          )}
          {trade.entryTiming && (
            <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 4, background: 'rgba(255,255,255,0.04)', color: 'var(--text-muted)', border: '1px solid rgba(255,255,255,0.08)' }}>
              {trade.entryTiming}
            </span>
          )}
        </div>
      )}

      {/* ── Status History timeline ── */}
      {trade.statusHistory && trade.statusHistory.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 800, letterSpacing: '0.15em', marginBottom: 6 }}>STATUS TIMELINE</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {trade.statusHistory.slice().reverse().map((ev, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10 }}>
                <Clock size={10} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                <span style={{ color: STATUS_META[ev.status]?.color ?? 'var(--text-secondary)', fontWeight: 700 }}>{ev.status}</span>
                {ev.price && <span className="font-mono" style={{ color: 'var(--text-muted)' }}>@ {fmtPrice(ev.price)}</span>}
                <span style={{ color: 'var(--text-muted)', opacity: 0.5, marginLeft: 'auto', whiteSpace: 'nowrap' }}>
                  {new Date(ev.ts).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Signal History (Versioning) ── */}
      {history.length > 0 && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 800, letterSpacing: '0.15em', marginBottom: 8 }}>
            PRIOR SIGNALS FOR {sym}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {history.map(prev => (
              <div key={prev.id} style={{ 
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', 
                fontSize: 10, padding: '4px 8px', background: 'rgba(255,255,255,0.02)', borderRadius: 4 
              }}>
                <span style={{ color: 'var(--text-secondary)' }}>
                  {prev.signal.kind} {prev.signal.side} @ {fmtPrice(prev.signal.entryPrice)}
                </span>
                <span style={{ fontSize: 8, color: 'var(--gold)', fontWeight: 800 }}>
                  {prev.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
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
