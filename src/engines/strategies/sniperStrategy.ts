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

  metadata: {
    indicators: ['ZLSMA-20', 'EMA-20/50', 'RSI-14', 'ATR-14', 'Chandelier Exit', 'Session Volume Profile (SVP)', 'Volume SMA-20'],
    howItWorks: 'Identifies high-probability pullback reversal entries at institutional value zones. Waits for price to retrace into the ZLSMA/EMA confluence zone with volume deceleration, then detects reversal candle patterns confirmed by RSI and Chandelier Exit alignment.',
    entryLogic: 'Price must pull back into the EMA20/ZLSMA zone on the 15m timeframe while the 1H trend remains intact. A bullish/bearish reversal candle must form at the zone with body ratio and close position confirmation.',
    confirmationLogic: 'RSI must be in a healthy range (not overbought/oversold extremes). Volume must show deceleration during pullback and acceleration on the reversal candle. SVP point-of-control alignment adds confluence.',
    stopLossLogic: 'Stop placed below the recent swing low (LONG) or above swing high (SHORT), adjusted by ATR buffer. Safety cap prevents risk inflation beyond 2x intended risk.',
    takeProfitLogic: 'TP1 and TP2 calculated as R-multiples of the stop distance. Default 1.5R and 2.5R, configurable via mode settings.',
    bestConditions: 'Works best in trending markets with healthy pullbacks. Optimal during BTC trending regimes with clear EMA structure on the 1H timeframe.',
    style: 'REVERSAL',
    regimeBehavior: 'Strictly obeys BTC regime. Will not fire counter-trend signals. Score bonuses/penalties applied based on regime alignment.',
    signalClass: 'Primarily SNIPER class. Can reach SUPER_SNIPER on high-score pullbacks with multi-factor confluence.'
  },

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
