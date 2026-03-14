import { Target, History, Crosshair } from 'lucide-react';
import { useMemo } from 'react';
import { useTradingStore } from '../store/tradingStore';

export default function SniperRadar() {
  const { sniperSignals } = useTradingStore();
  const detectedSignals = sniperSignals.filter(s => s.status === 'DETECTED');

  // Stable blip positions — memoized so they don't jump on every render
  const blips = useMemo(() =>
    detectedSignals.slice(0, 6).map((row, i) => {
      const sector  = (i * 67 + 30) % 360;
      const radians = (sector * Math.PI) / 180;
      const radius  = 28 + (i % 3) * 18;
      return {
        cx:      Math.cos(radians) * radius,
        cy:      Math.sin(radians) * radius,
        isSuper: row.signal.kind === 'SUPER_SNIPER',
        symbol:  row.symbol,
        delay:   `${(i * 0.18).toFixed(2)}s`,
      };
    }),
    [sniperSignals]
  );

  return (
    <div className="sections-stack">

      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        paddingBottom: 16, borderBottom: '1px solid var(--border-subtle)',
      }}>
        <Target className="gold-brand" size={24} />
        <div>
          <h2 className="font-cinzel" style={{ fontSize: 18, fontWeight: 900, letterSpacing: '0.1em' }}>
            SNIPER RADAR & SIGNAL HISTORY
          </h2>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.2em', marginTop: 4 }}>
            REAL-TIME DETECTION OF SUPER SNIPER EVENTS & HISTORICAL LOG
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>

        {/* ── Radar Disc ── */}
        <div style={{
          flex: '0 0 320px', width: 320, height: 320,
          position: 'relative',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>

          {/* Dark base disc */}
          <div style={{
            position: 'absolute', inset: 0, borderRadius: '50%',
            background: 'radial-gradient(circle at center, rgba(212,175,55,0.12) 0%, rgba(4,6,10,0.96) 68%, transparent 100%)',
            border: '1px solid rgba(212,175,55,0.3)',
            boxShadow: '0 0 40px rgba(212,175,55,0.10), inset 0 0 60px rgba(0,0,0,0.7)',
          }} />

          {/* Concentric rings */}
          {[92, 68, 46, 23].map((pct) => (
            <div key={pct} style={{
              position: 'absolute',
              width: `${pct}%`, height: `${pct}%`,
              borderRadius: '50%',
              border: `1px ${pct === 46 ? 'dashed' : 'solid'} rgba(212,175,55,${(0.08 + (92 - pct) * 0.004).toFixed(3)})`,
            }} />
          ))}

          {/* Crosshair lines */}
          <div style={{
            position: 'absolute', width: '88%', height: 1,
            background: 'linear-gradient(to right, transparent, rgba(212,175,55,0.2), transparent)',
          }} />
          <div style={{
            position: 'absolute', height: '88%', width: 1,
            background: 'linear-gradient(to bottom, transparent, rgba(212,175,55,0.2), transparent)',
          }} />

          {/* Sweep — fade trail (full disc rotation) */}
          <div style={{
            position: 'absolute', inset: 0, borderRadius: '50%',
            background: 'conic-gradient(from 0deg, rgba(212,175,55,0) 0deg, rgba(212,175,55,0.04) 10deg, rgba(212,175,55,0.22) 50deg, rgba(212,175,55,0.45) 85deg, rgba(212,175,55,0) 90deg)',
            animation: 'sniper-sweep 3s linear infinite',
            transformOrigin: 'center center',
          }} />

          {/* Sweep — sharp bright leading edge */}
          <div style={{
            position: 'absolute', inset: 0, borderRadius: '50%',
            background: 'conic-gradient(from 0deg, rgba(212,175,55,0) 0deg, rgba(255,224,80,1) 1.2deg, rgba(212,175,55,0) 1.5deg)',
            animation: 'sniper-sweep 3s linear infinite',
            transformOrigin: 'center center',
          }} />

          {/* Center crosshair with 3 staggered ping rings */}
          <div style={{ position: 'relative', zIndex: 10 }}>
            <Crosshair size={22} color="var(--gold)" />
            <div style={{
              position: 'absolute', inset: '-8px', borderRadius: '50%',
              border: '1.5px solid rgba(212,175,55,0.8)',
              animation: 'sniper-ping 2.6s ease-out infinite',
            }} />
            <div style={{
              position: 'absolute', inset: '-8px', borderRadius: '50%',
              border: '1.5px solid rgba(212,175,55,0.5)',
              animation: 'sniper-ping 2.6s ease-out 0.86s infinite',
            }} />
            <div style={{
              position: 'absolute', inset: '-8px', borderRadius: '50%',
              border: '1px solid rgba(212,175,55,0.25)',
              animation: 'sniper-ping 2.6s ease-out 1.72s infinite',
            }} />
          </div>

          {/* Signal Blips */}
          {blips.map((b, i) => {
            const color = b.isSuper ? 'var(--gold)' : 'var(--blue)';
            const size  = b.isSuper ? 10 : 7;
            return (
              <div key={i} style={{
                position: 'absolute',
                left:      `calc(50% + ${b.cx}px)`,
                top:       `calc(50% + ${b.cy}px)`,
                width: size, height: size,
                transform: 'translate(-50%, -50%)',
                background: color,
                borderRadius: '50%',
                boxShadow: `0 0 ${b.isSuper ? 18 : 10}px ${color}, 0 0 5px ${color}`,
                animation: 'sniper-blip 1.5s ease-in-out infinite',
                animationDelay: b.delay,
                zIndex: 11,
              }}>
                <div style={{
                  position: 'absolute', top: -18, left: 14, whiteSpace: 'nowrap',
                  fontSize: 9, color, fontWeight: 800,
                  fontFamily: '"JetBrains Mono", monospace',
                  textShadow: `0 0 8px ${color}`,
                }}>
                  {b.symbol}
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Signal History List ── */}
        <div style={{
          flex: '2 1 400px', display: 'flex', flexDirection: 'column',
          gap: 12, maxHeight: 320, overflowY: 'auto',
        }} className="custom-scrollbar">
          {detectedSignals.slice(0, 10).map((row, i) => {
            const sig     = row.signal;
            const isSuper = sig.kind === 'SUPER_SNIPER';
            const isLong  = sig.side === 'LONG';
            return (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '12px 16px',
                background: 'rgba(0,0,0,0.4)',
                borderTop: '1px solid',
                borderRight: '1px solid',
                borderBottom: '1px solid',
                borderTopColor: isSuper ? 'rgba(212,175,55,0.25)' : 'var(--border-subtle)',
                borderRightColor: isSuper ? 'rgba(212,175,55,0.25)' : 'var(--border-subtle)',
                borderBottomColor: isSuper ? 'rgba(212,175,55,0.25)' : 'var(--border-subtle)',
                borderLeft: `4px solid ${isLong ? 'var(--green)' : 'var(--red)'}`,
                borderRadius: 8,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <History size={16} color="var(--text-muted)" />
                  <div>
                    <div style={{
                      fontFamily: '"JetBrains Mono", monospace',
                      fontWeight: 900, color: 'var(--text-primary)', fontSize: 13,
                    }}>
                      {row.symbol}
                      <span style={{
                        marginLeft: 8, fontSize: 10, padding: '2px 6px',
                        background: isSuper ? 'rgba(212,175,55,0.1)' : 'rgba(59,130,246,0.1)',
                        color: isSuper ? 'var(--gold)' : 'var(--blue)', borderRadius: 4,
                      }}>
                        {sig.kind}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                      Score: {(sig.score * 100).toFixed(1)}% | Vol Ratio: {sig.volRatio.toFixed(2)}x
                    </div>
                  </div>
                </div>
                <div style={{
                  textAlign: 'right', fontFamily: '"JetBrains Mono", monospace',
                  fontSize: 13, fontWeight: 800,
                }}>
                  <span style={{ color: isLong ? 'var(--green)' : 'var(--red)' }}>{sig.side} AT</span><br />
                  <span style={{ color: 'var(--text-primary)' }}>{sig.entryPrice.toFixed(4)}</span>
                </div>
              </div>
            );
          })}
          {detectedSignals.length === 0 && (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12, letterSpacing: '0.1em' }}>
              NO SIGNAL HISTORY AVAILABLE
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes sniper-sweep {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes sniper-ping {
          0%   { transform: scale(1);   opacity: 1; }
          100% { transform: scale(4);   opacity: 0; }
        }
        @keyframes sniper-blip {
          0%, 100% { opacity: 1;   transform: translate(-50%, -50%) scale(1);   }
          50%       { opacity: 0.35; transform: translate(-50%, -50%) scale(1.6); }
        }
      `}</style>
    </div>
  );
}
