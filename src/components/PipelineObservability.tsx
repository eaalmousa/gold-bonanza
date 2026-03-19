import React from 'react';
import { useTradingStore } from '../store/tradingStore';

export function PipelineObservability() {
  const rawTraces = useTradingStore(s => s.pipelineTraces);
  const traces = Array.isArray(rawTraces) ? rawTraces : [];

  if (traces.length === 0) {
    return (
      <div className="bg-[#11131a] border border-[#232631] rounded-xl p-4 mb-6">
        <h3 className="text-[#e2e8f0] font-semibold flex items-center gap-2 mb-2">
          <span className="w-2 h-2 rounded-full bg-[#334155]"></span>
          Pipeline Observability
        </h3>
        <p className="text-sm text-[#475569]">Awaiting signal pipeline output...</p>
      </div>
    );
  }

  return (
    <div className="bg-[#11131a] border border-[#232631] rounded-xl p-4 mb-6 shadow-xl">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[#e2e8f0] font-semibold flex items-center gap-2 text-lg">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          Live Pipeline Observability
        </h3>
        <span className="text-xs font-semibold px-2 py-1 bg-[#1e293b] text-[#94a3b8] rounded-md border border-[#334155]">
          Last {traces.length} Traces
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-[#232631]">
        <table className="w-full text-left text-sm text-[#94a3b8]">
          <thead className="bg-[#181a24] border-b border-[#232631]">
            <tr>
              <th className="py-3 px-4 font-medium">Symbol</th>
              <th className="py-3 px-4 font-medium">Engine</th>
              <th className="py-3 px-4 font-medium">Status</th>
              <th className="py-3 px-4 font-medium">Score</th>
              <th className="py-3 px-4 font-medium">Type</th>
              <th className="py-3 px-4 font-medium">Timing</th>
              <th className="py-3 px-4 font-medium w-1/4">Last Reason</th>
              <th className="py-3 px-4 font-medium text-center block leading-[1]">BREAKING<br/><span className="text-[10px] text-zinc-500">DOWN</span></th>
              <th className="py-3 px-4 font-medium text-center">BTC Skip</th>
              <th className="py-3 px-4 font-medium text-center">Late Cap</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#232631]/50 font-mono text-xs">
            {traces.slice(0, 50).map(t => (
              <tr key={t.id} className="hover:bg-[#181a24]/80 transition-colors">
                <td className="py-2.5 px-4 text-[#f8fafc] font-semibold">{t.symbol}</td>
                <td className="py-2.5 px-4 text-emerald-400">{t.engine}</td>
                <td className="py-2.5 px-4">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium border ${
                    t.status === 'ACCEPTED' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                    t.status === 'REJECTED' ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' :
                    t.status === 'INVALIDATED' ? 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20' :
                    'bg-amber-500/10 text-amber-400 border-amber-500/20'
                  }`}>
                    {t.status}
                  </span>
                </td>
                <td className="py-2.5 px-4">
                  <span className={t.score && t.score >= 10 ? 'text-emerald-400' : ''}>{t.score ?? '-'}</span>
                </td>
                <td className="py-2.5 px-4">{t.entryType || '-'}</td>
                <td className="py-2.5 px-4">
                  <span className={`${
                    t.entryTiming === 'OPTIMAL' ? 'text-emerald-500' :
                    t.entryTiming === 'EARLY' ? 'text-amber-500' :
                    t.entryTiming === 'LATE' ? 'text-rose-500' : ''
                  }`}>
                    {t.entryTiming || '-'}
                  </span>
                </td>
                <td className="py-2.5 px-4 truncate max-w-[250px] text-zinc-300" title={t.lastRejectReason}>
                  {t.lastRejectReason || '-'}
                </td>
                <td className="py-2.5 px-4 text-center">
                  {t.usedBreakingDownBypass ? <span className="text-rose-400 font-bold">✓</span> : <span className="text-zinc-600">-</span>}
                </td>
                <td className="py-2.5 px-4 text-center">
                  {t.usedBtcBypass ? <span className="text-blue-400 font-bold">✓</span> : <span className="text-zinc-600">-</span>}
                </td>
                <td className="py-2.5 px-4 text-center">
                  {t.usedLateException ? <span className="text-amber-400 font-bold">✓</span> : <span className="text-zinc-600">-</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
