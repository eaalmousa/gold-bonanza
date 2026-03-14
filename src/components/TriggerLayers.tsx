import React from 'react';
import { Database } from 'lucide-react';
import { useTradingStore } from '../store/tradingStore';

export default function TriggerLayers() {
  const triggerLevels = useTradingStore(s => s.triggerLevels);

  return (
    <div className="sections-stack">
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        paddingBottom: 16, borderBottom: '1px solid var(--border-subtle)'
      }}>
        <Database className="gold-brand" size={24} />
        <div>
          <h2 className="font-cinzel" style={{ fontSize: 18, fontWeight: 900, letterSpacing: '0.1em' }}>
            LEVEL DATABASE v10.6 & TRIGGER LAYER v10
          </h2>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.2em', marginTop: 4 }}>
            REAL-TIME TRACKING OF MICROSTRUCTURE LEVELS & STATE TRANSITIONS
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
        {triggerLevels.map((level, i) => {
          let bgColors = ['rgba(13,17,23,0.6)', 'rgba(0,0,0,0.6)', 'rgba(0,0,0,0.6)', 'rgba(0,0,0,0.6)'];
          let iconColors = ['var(--text-muted)', 'var(--text-muted)', 'var(--text-muted)', 'var(--text-muted)'];
          
          if (level.state === 'WAIT') {
            bgColors[0] = 'rgba(212,175,55,0.2)';
            iconColors[0] = 'var(--gold)';
          }
          if (level.state === 'BROKE') {
            bgColors[0] = 'rgba(212,175,55,0.2)'; bgColors[1] = 'rgba(244,63,94,0.2)';
            iconColors[0] = 'var(--gold)'; iconColors[1] = 'var(--red)';
          }
          if (level.state === 'RETEST') {
            bgColors[0] = 'rgba(212,175,55,0.2)'; bgColors[1] = 'rgba(244,63,94,0.2)'; bgColors[2] = 'rgba(59,130,246,0.2)';
            iconColors[0] = 'var(--gold)'; iconColors[1] = 'var(--red)'; iconColors[2] = 'var(--blue)';
          }
          if (level.state === 'TRIGGERED') {
            bgColors = ['rgba(212,175,55,0.2)', 'rgba(244,63,94,0.2)', 'rgba(59,130,246,0.2)', 'rgba(16,185,129,0.2)'];
            iconColors = ['var(--gold)', 'var(--red)', 'var(--blue)', 'var(--green)'];
          }

          return (
            <div key={i} style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 12,
              padding: 20,
              display: 'flex', flexDirection: 'column', gap: 16,
              boxShadow: level.state === 'TRIGGERED' ? '0 0 20px rgba(16,185,129,0.1)' : 'none'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: 15, fontWeight: 900, fontFamily: '"JetBrains Mono", monospace' }}>
                    {level.symbol}
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.1em' }}>
                    {level.type} LEVEL: {level.level}
                  </span>
                </div>
                <div style={{ 
                  background: 'rgba(212,175,55,0.1)', padding: '4px 8px', borderRadius: 4,
                  fontSize: 10, fontWeight: 900, fontFamily: '"JetBrains Mono", monospace', color: 'var(--gold)'
                }}>
                  {level.confidence}% CONF
                </div>
              </div>

              {/* State Progress Sequence */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                {['WAIT', 'BROKE', 'RETEST', 'TRIGGERED'].map((state, idx) => (
                  <React.Fragment key={state}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, zIndex: 1 }}>
                      <div style={{
                        width: 24, height: 24, borderRadius: '50%',
                        background: bgColors[idx],
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        border: `1px solid ${iconColors[idx]}`
                      }}>
                        {level.state === state && (
                          <div style={{ width: 8, height: 8, borderRadius: '50%', background: iconColors[idx], boxShadow: `0 0 10px ${iconColors[idx]}` }} />
                        )}
                      </div>
                      <span style={{ fontSize: 9, fontWeight: 800, color: iconColors[idx], letterSpacing: '0.05em' }}>
                        {state}
                      </span>
                    </div>
                    {idx < 3 && (
                      <div style={{ 
                        flex: 1, height: 2, 
                        background: bgColors[idx + 1] !== 'rgba(0,0,0,0.6)' && bgColors[idx + 1] !== 'rgba(13,17,23,0.6)' 
                          ? iconColors[idx + 1] : 'var(--border-subtle)',
                        margin: '0 -4px',
                        transform: 'translateY(-8px)', zIndex: 0 
                      }} />
                    )}
                  </React.Fragment>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
