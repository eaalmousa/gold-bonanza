import { Layers } from 'lucide-react';
import { useTradingStore } from '../store/tradingStore';

export default function InstitutionalLiquidityMap() {
  const liquidityLayers = useTradingStore(s => s.liquidityLayers);
  const validLayers = Array.isArray(liquidityLayers) ? liquidityLayers : [];

  return (
    <div className="sections-stack">
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        paddingBottom: 16, borderBottom: '1px solid var(--border-subtle)'
      }}>
        <Layers className="gold-brand" size={24} />
        <div>
          <h2 className="font-cinzel" style={{ fontSize: 18, fontWeight: 900, letterSpacing: '0.1em' }}>
            INSTITUTIONAL LIQUIDITY MAP
          </h2>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.2em', marginTop: 4 }}>
            REAL-TIME ORDER BOOK DYNAMICS & INSTITUTIONAL FLOW METERS
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {validLayers.map((row, i) => {
          const isCurrent = row.type === 'current';
          const isAsk = row.type === 'ask';
          const isBid = row.type === 'bid';
          
          return (
            <div key={i} style={{
              display: 'flex',
              alignItems: 'center',
              background: isCurrent ? 'rgba(212, 175, 55, 0.1)' : 'rgba(0,0,0,0.3)',
              border: isCurrent ? '1px solid var(--border-gold)' : '1px solid var(--border-subtle)',
              borderRadius: 8,
              padding: '8px 16px',
              position: 'relative',
              overflow: 'hidden'
            }}>
              {/* Background intensity bar */}
              {!isCurrent && (
                <div style={{
                  position: 'absolute',
                  top: 0, right: isAsk ? 0 : 'auto', left: isBid ? 0 : 'auto',
                  height: '100%',
                  width: `${row.intensity}%`,
                  background: isAsk 
                    ? 'linear-gradient(to left, rgba(244, 63, 94, 0.2), transparent)' 
                    : 'linear-gradient(to right, rgba(16, 185, 129, 0.2), transparent)',
                  zIndex: 0
                }} />
              )}

              <div style={{
                position: 'relative', zIndex: 1,
                display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between',
                fontFamily: '"JetBrains Mono", monospace', fontSize: 13, fontWeight: 800
              }}>
                {/* Ask Side */}
                <div style={{ width: '30%', textAlign: 'left', color: isAsk ? 'var(--red)' : 'transparent' }}>
                  {isAsk && `${row.volume} BTC`}
                </div>

                {/* Price */}
                <div style={{ 
                  width: '40%', textAlign: 'center', 
                  color: isCurrent ? 'var(--gold)' : 'var(--text-primary)',
                  fontSize: isCurrent ? 16 : 13,
                  textShadow: row.isInstitutional ? (isAsk ? '0 0 10px rgba(244,63,94,0.5)' : '0 0 10px rgba(16,185,129,0.5)') : 'none'
                }}>
                  {row.price.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  {row.isInstitutional && (
                    <span style={{ 
                      marginLeft: 8, fontSize: 10, padding: '2px 6px', 
                      background: isAsk ? 'var(--red-soft)' : 'var(--green-soft)',
                      borderRadius: 4, color: isAsk ? 'var(--red)' : 'var(--green)'
                    }}>
                      INST
                    </span>
                  )}
                </div>

                {/* Bid Side */}
                <div style={{ width: '30%', textAlign: 'right', color: isBid ? 'var(--green)' : 'transparent' }}>
                  {isBid && `${row.volume} BTC`}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
