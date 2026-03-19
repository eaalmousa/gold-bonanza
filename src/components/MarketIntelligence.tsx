// MarketIntelligence component
import type { MarketRow } from '../types/trading';
import { BarChart3 } from 'lucide-react';

interface Props {
  rows: MarketRow[];
}

export default function MarketIntelligence({ rows }: Props) {
  const display = Array.isArray(rows) ? rows.slice(0, 24) : [];

  return (
    <section>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20,
        paddingBottom: 12, borderBottom: '1px solid rgba(212,175,55,0.1)'
      }}>
        <BarChart3 size={20} color="var(--gold)" />
        <div>
          <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: '0.2em', color: 'var(--gold-light)' }}>
            MARKET INTELLIGENCE
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
            Top movers across the monitored universe
          </div>
        </div>
      </div>

      {display.length === 0 ? (
        <div style={{
          padding: '30px 24px',
          borderRadius: 'var(--radius-lg)',
          border: '1px dashed rgba(255,255,255,0.06)',
          textAlign: 'center',
          color: 'var(--text-muted)',
          fontSize: 12
        }}>
          Warming up... Market data loading.
        </div>
      ) : (
        <div className="market-grid">
          {display.map((r, i) => {
            const sym = r.symbol.replace('USDT', '');
            const isUp = r.changePct >= 0;
            return (
              <div key={r.symbol} className="opportunity-card card-entry" style={{
                padding: '18px 16px',
                animationDelay: `${i * 0.04}s`
              }}>
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                }}>
                  <div>
                    <div className="font-mono" style={{ fontWeight: 900, fontSize: 13, fontStyle: 'italic' }}>
                      {sym}<span style={{ color: 'var(--text-muted)', fontSize: 10 }}>USDT</span>
                    </div>
                    <div className="font-mono" style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                      ${fmtPrice(r.lastPrice)}
                    </div>
                  </div>
                  <div className="font-mono" style={{
                    fontWeight: 900, fontSize: 13, fontStyle: 'italic',
                    color: isUp ? 'var(--green)' : 'var(--red)',
                    padding: '6px 12px',
                    borderRadius: 'var(--radius-full)',
                    background: isUp ? 'var(--green-soft)' : 'var(--red-soft)',
                    border: `1px solid ${isUp ? 'rgba(16,185,129,0.2)' : 'rgba(244,63,94,0.2)'}`
                  }}>
                    {isUp ? '+' : ''}{r.changePct.toFixed(2)}%
                  </div>
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
  if (Math.abs(n) >= 100) return n.toFixed(3);
  if (Math.abs(n) >= 1) return n.toFixed(4);
  return n.toFixed(6);
}
