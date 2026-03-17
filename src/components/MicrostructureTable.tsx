import { Server } from 'lucide-react';
import { useTradingStore } from '../store/tradingStore';

export default function MicrostructureTable() {
  const microstructureRows = useTradingStore(s => s.microstructureRows);

  return (
    <div className="sections-stack">
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        paddingBottom: 16, borderBottom: '1px solid var(--border-subtle)'
      }}>
        <Server className="gold-brand" size={24} />
        <div>
          <h2 className="font-cinzel" style={{ fontSize: 18, fontWeight: 900, letterSpacing: '0.1em' }}>
            MICROSTRUCTURE ENGINE TABLE
          </h2>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.2em', marginTop: 4 }}>
            DETAILED TRACKING OF CVD, ICEBERGS, AGGRESSIVE FLOW, AND LIQUIDITY CASCADES
          </div>
        </div>
      </div>

      <div style={{ overflowX: 'auto', borderRadius: 12, border: '1px solid var(--border-subtle)' }} className="custom-scrollbar">
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>SYMBOL</th>
              <th>CVD DELTA</th>
              <th>ICEBERG BLOCKS</th>
              <th>AGGRESSIVE FLOW</th>
              <th>LIQUIDITY VOLUME</th>
              <th>CASCADE STATE</th>
              <th>STRUCTURE SCORE</th>
            </tr>
          </thead>
          <tbody>
            {microstructureRows.map((row, i) => {
              const cvdPos = row.cvd.startsWith('+');
              const agExtreme = row.agFlow === 'EXTREME' || row.agFlow === 'HIGH';
              const cascadeActive = row.liqCascade === 'ACTIVE' || row.liqCascade === 'IMMINENT';

              return (
                <tr key={i}>
                  <td style={{ textAlign: 'left', color: 'var(--text-primary)', fontSize: 14 }}>{row.symbol}</td>
                  <td style={{ color: cvdPos ? 'var(--green)' : 'var(--red)' }}>{row.cvd}</td>
                   <td>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                      {row.icebergBids > 0 && <span style={{ color: 'var(--green)', fontSize: 10 }}>B[{row.icebergBids}]</span>}
                      {row.icebergAsks > 0 && <span style={{ color: 'var(--red)', fontSize: 10 }}>S[{row.icebergAsks}]</span>}
                      {row.icebergBids === 0 && row.icebergAsks === 0 && <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>EMPTY</span>}
                    </div>
                  </td>
                  <td>
                    <span style={{ 
                      padding: '4px 8px', borderRadius: 4, fontSize: 10,
                      background: agExtreme ? 'var(--red-soft)' : 'rgba(255,255,255,0.05)',
                      color: agExtreme ? 'var(--red)' : 'var(--text-muted)'
                    }}>
                      {row.agFlow}
                    </span>
                  </td>
                  <td>{row.liqVolume}</td>
                  <td>
                    <span style={{
                      padding: '4px 8px', borderRadius: 4, fontSize: 10,
                      background: cascadeActive ? 'var(--blue-soft)' : 'rgba(255,255,255,0.05)',
                      color: cascadeActive ? 'var(--blue)' : 'var(--text-muted)',
                      textShadow: cascadeActive ? '0 0 10px rgba(59,130,246,0.5)' : 'none'
                    }}>
                      {row.liqCascade}
                    </span>
                  </td>
                  <td style={{ color: parseInt(row.score) > 85 ? 'var(--gold)' : 'var(--text-muted)' }}>
                    {row.score}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
