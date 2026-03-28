// ============================================
// Institutional Sniper Strategy — Wrapper
//
// Wraps the existing evaluateSniperSignal() engine
// into the StrategyEngine interface WITHOUT any
// modification to the original engine logic.
// ============================================

import type { StrategyEngine, StrategySignal, StrategyCategory } from '../strategyRegistry';
import type { StrategyContext } from '../strategyContext';
import { evaluateSniperSignal } from '../sniperEngine';

export const sniperStrategy: StrategyEngine = {
  id: 'institutional_sniper',
  name: 'Institutional Sniper',
  category: 'PULLBACK' as StrategyCategory,
  description: 'Precision pullback entries using ZLSMA, SVP, RSI and Chandelier Exit on mean-reversion pivots',
  supportedSides: ['LONG', 'SHORT'],
  defaultEnabled: true,
  canOverrideBtcRegime: false,
  regimeOverrideMinScore: 999,  // Cannot override — pullbacks should respect macro

  evaluate(ctx: StrategyContext): StrategySignal | null {
    // Delegate to existing engine — no logic change
    const signal = evaluateSniperSignal(
      ctx.tf1h,
      ctx.tf15m,
      ctx.activeMode,
      ctx.balance,
      ctx.regime,
      ctx.regimeScoreBonusLong,
      ctx.regimeScoreBonusShort,
      ctx.orderFlow,
      ctx.btc4hTrend,
      ctx.regimeLabel,
      ctx.symbol
    );

    if (!signal) return null;

    // Normalize into StrategySignal
    return {
      strategyId:   this.id,
      strategyName: this.name,
      kind:         'SNIPER',
      setupType:    signal.entryType || 'PULLBACK_REVERSAL',
      symbol:       ctx.symbol,
      side:         signal.side,
      entryPrice:   signal.entryPrice,
      stopLoss:     signal.stopLoss,
      takeProfit:   signal.takeProfit,
      takeProfit2:  signal.takeProfit2,
      qty:          signal.qty,
      sizeUSDT:     signal.sizeUSDT,
      score:        signal.score,
      confidence:   'MEDIUM',   // Will be reclassified by registry
      reasons:      signal.reasons,
      regimeAlignment: 'ALIGNED',  // Will be reclassified by registry
      executionClass:  'EXECUTABLE', // Will be reclassified by registry
      atr15:        signal.atr15,
      volRatio:     signal.volRatio,
      entryType:    signal.entryType,
      entryTiming:  signal.entryTiming,
      btcRegimeAtEntry: signal.btcRegimeAtEntry,
      tags:         ['PULLBACK', 'INSTITUTIONAL'],
      debugLog:     signal.debugLog || []
    };
  }
};
