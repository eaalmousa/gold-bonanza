import { useState, useEffect } from 'react';
import { Target, X, TrendingUp, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { api } from '../services/api';
import { useTradingStore } from '../store/tradingStore';

export default function CommandSyncHub() {
  const [binancePositions, setBinancePositions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [binanceConnected, setBinanceConnected] = useState(false);
  const [closingSymbols, setClosingSymbols] = useState<Set<string>>(new Set());

  // Also pull from local store (manually-deployed trades)
  const { activeTrades, removeActiveTrade } = useTradingStore();

  useEffect(() => {
    let mounted = true;
    const fetchPositions = async () => {
      try {
        const data = await api.getPositions();
        if (mounted) {
          setBinancePositions(data);
          setBinanceConnected(true);
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

  const handleCloseLocal = (idx: number) => {
    removeActiveTrade(idx);
  };

  // Merge: Binance positions take priority; local trades fill in the rest
  const binanceSymbols = new Set(binancePositions.map(p => p.symbol));
  const localOnly = activeTrades.filter(t => !binanceSymbols.has(t.symbol));
  const totalCount = binancePositions.length + localOnly.length;

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

          {/* ── Local (manually deployed) trades ── */}
          {localOnly.map((trade, i) => {
            const sym = trade.symbol.replace('USDT', '');
            const idxInFull = activeTrades.indexOf(trade);

            return (
              <div key={`local-${trade.symbol}-${i}`} className="opportunity-card card-entry" style={{
                padding: '24px 22px',
                borderColor: trade.side === 'LONG' ? 'rgba(16,185,129,0.2)' : 'rgba(244,63,94,0.2)',
                animationDelay: `${(binancePositions.length + i) * 0.08}s`,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <div>
                    <div className="font-mono" style={{ fontWeight: 900, fontSize: 16, fontStyle: 'italic' }}>
                      {sym}<span style={{ color: 'var(--text-muted)', fontSize: 11 }}>USDT</span>
                    </div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--gold-light)', letterSpacing: '0.1em', marginTop: 2 }}>
                      {trade.leverage}x {trade.side}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      fontSize: 9, fontWeight: 800, padding: '2px 6px',
                      borderRadius: 4, letterSpacing: '0.1em',
                      background: 'rgba(212,175,55,0.08)', color: 'var(--text-muted)',
                      border: '1px solid rgba(212,175,55,0.2)'
                    }}>LOCAL</span>
                    <button
                      onClick={() => handleCloseLocal(idxInFull)}
                      style={{
                        background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.3)',
                        borderRadius: 'var(--radius-sm)', padding: '6px 8px',
                        cursor: 'pointer', color: 'var(--red)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                      }}
                      title="Remove from view"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>

                {/* Status banner */}
                <div style={{
                  padding: '10px 14px', borderRadius: 'var(--radius-sm)',
                  background: 'rgba(212,175,55,0.05)',
                  border: '1px solid rgba(212,175,55,0.15)',
                  textAlign: 'center', marginBottom: 16
                }}>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.2em', fontWeight: 800, marginBottom: 4 }}>STATUS</div>
                  <div style={{ fontSize: 12, fontWeight: 900, color: 'var(--gold-light)' }}>
                    DEPLOYED — AWAITING BINANCE SYNC
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 6 }}>
                  {[
                    { label: 'ENTRY', value: fmtPrice(trade.entryPrice) },
                    { label: 'SL', value: fmtPrice(trade.sl) },
                    { label: 'TP 1', value: fmtPrice(trade.t1) },
                    { label: 'TP 2', value: trade.t2 ? fmtPrice(trade.t2) : '--' },
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
        </div>
      )}
    </section>
  );
}

function fmtPrice(n: number): string {
  if (!isFinite(n)) return '--';
  if (Math.abs(n) >= 1000) return n.toFixed(2);
  if (Math.abs(n) >= 100) return n.toFixed(2);
  if (Math.abs(n) >= 1) return n.toFixed(4);
  return n.toFixed(6);
}
