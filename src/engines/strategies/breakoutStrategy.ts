// ============================================
// Super Sniper Breakout Strategy — Wrapper
//
// Wraps the existing evaluateBreakoutSignal()
// engine into the StrategyEngine interface.
//
// This strategy CAN override BTC regime because
// confirmed breakouts represent structural shifts.
// ============================================

import type { StrategyEngine, StrategySignal, StrategyCategory } from '../strategyRegistry';
import type { StrategyContext } from '../strategyContext';
import { evaluateBreakoutSignal } from '../breakoutEngine';

export const breakoutStrategy: StrategyEngine = {
  id: 'super_sniper_breakout',
  name: 'Super Sniper Breakout',
  category: 'BREAKOUT' as StrategyCategory,
  description: 'Compression breakout detection with retest confirmation, volume surge, and structural quality checks',
  supportedSides: ['LONG', 'SHORT'],
  defaultEnabled: true,
  canOverrideBtcRegime: true,   // Breakouts CAN override macro bias
  regimeOverrideMinScore: 14,   // High confidence required for counter-regime breakouts

  evaluate(ctx: StrategyContext): StrategySignal | null {
    // Delegate to existing engine — no logic change
    const signal = evaluateBreakoutSignal(
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
      kind:         'SUPER_SNIPER',
      setupType:    signal.entryType || 'BREAKOUT',
      symbol:       ctx.symbol,
      side:         signal.side,
      entryPrice:   signal.entryPrice,
      stopLoss:     signal.stopLoss,
      takeProfit:   signal.takeProfit,
      takeProfit2:  signal.takeProfit2,
      qty:          signal.qty,
      sizeUSDT:     signal.sizeUSDT,
      score:        signal.score,
      confidence:   'MEDIUM',
      reasons:      signal.reasons,
      regimeAlignment: 'ALIGNED',
      executionClass:  'EXECUTABLE',
      atr15:        signal.atr15,
      volRatio:     signal.volRatio,
      entryType:    signal.entryType,
      entryTiming:  signal.entryTiming,
      btcRegimeAtEntry: signal.btcRegimeAtEntry,
      tags:         ['BREAKOUT', 'COMPRESSION'],
      debugLog:     signal.debugLog || [],
      breakLevel:   signal.breakLevel
    };
  }
};
