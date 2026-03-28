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

  metadata: {
    indicators: ['EMA-20/50', 'ATR-14', 'RSI-14', 'Volume SMA-20', 'Bollinger Bandwidth', 'Coil Range Detection'],
    howItWorks: 'Detects compression-to-expansion breakout patterns. Identifies tight consolidation ranges (coils), waits for a decisive break with volume confirmation, then monitors for retest confirmation before signaling entry.',
    entryLogic: 'Price must break above (LONG) or below (SHORT) a defined coil range boundary with strong candle body. Retest confirmation is preferred — the breakout candle is followed by a return to the breakout level that holds.',
    confirmationLogic: 'Volume must expand significantly above the 20-period average. RSI must be in a momentum zone (not exhausted). Candle body ratio and range expansion confirm the move is structural, not a wick trap.',
    stopLossLogic: 'Stop placed below the opposite side of the coil (LONG) or above it (SHORT), with ATR buffer. Minimum stop distance enforced at 0.4% of entry price.',
    takeProfitLogic: 'R-multiple targets based on stop distance. Default 1.5R and 2.5R. ATR-adjusted for volatile breakouts.',
    bestConditions: 'Works best after extended consolidation periods with declining volatility. Optimal when Bollinger Bandwidth is compressed and ATR is below recent averages.',
    style: 'BREAKOUT',
    regimeBehavior: 'CAN override BTC regime for confirmed high-score breakouts (≥14). Counter-regime breakouts are tagged as COUNTER_REGIME_OVERRIDE for tracking.',
    signalClass: 'Primarily SUPER_SNIPER class. Confirmed breakouts with retest are the highest-conviction trade type in the system.'
  },

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
