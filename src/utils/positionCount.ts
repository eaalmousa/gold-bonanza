// ============================================================
// CANONICAL POSITION COUNT — Single shared helper
// Use this in Header, SystemStatus, and CommandSyncHub.
// DO NOT invent separate counting logic per component.
// ============================================================

/**
 * Returns the canonical active position count.
 * - Binance live positions: confirmed on exchange
 * - localOnly: activeTrades NOT already in binancePositions (avoids double-counting)
 * - pending: signals sitting in QUEUED state (user pressed Queue but not deployed yet)
 */
export function getCanonicalPositionCount(
  binancePositions: any[],
  activeTrades: any[],
  pipelineSignals?: any[]
): { binance: number; paper: number; localReal: number; queued: number; total: number } {
  const safePositions = Array.isArray(binancePositions) ? binancePositions : [];
  const safeTrades    = Array.isArray(activeTrades)     ? activeTrades     : [];
  const safeSignals   = Array.isArray(pipelineSignals)  ? pipelineSignals  : [];

  const TERMINAL = ['TP1_HIT', 'TP2_HIT', 'SL_HIT', 'CLOSED', 'CANCELLED'];

  // Binance symbols already tracked live
  const binanceSymbols = new Set(
    safePositions.map((p: any) => (p?.symbol || '').toUpperCase())
  );

  // Local active trades NOT in Binance (non-terminal)
  const localOnly = safeTrades.filter((t: any) => {
    if (!t?.symbol) return false;
    if (TERMINAL.includes(t.status)) return false;
    return !binanceSymbols.has(t.symbol.toUpperCase());
  });

  const paperTrades = localOnly.filter(t => t.accountMode === 'DEMO');
  const localReal   = localOnly.filter(t => t.accountMode !== 'DEMO');

  // Signals queued by user but not yet submitted to exchange
  const queued = safeSignals.filter((s: any) => s?.status === 'QUEUED');

  return {
    binance:   safePositions.length,
    paper:     paperTrades.length,
    localReal: localReal.length,
    queued:    queued.length,
    total:     safePositions.length + paperTrades.length + localReal.length + queued.length,
  };
}
