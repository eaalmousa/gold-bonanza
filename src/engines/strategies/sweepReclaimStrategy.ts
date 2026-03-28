// ============================================
// Sweep Reclaim Strategy — NEW
//
// Detects liquidity sweep patterns:
// 1. Price sweeps below a pivot low (LONG) or above a pivot high (SHORT)
// 2. Immediately reclaims through the swept level
// 3. Confirmed by volume spike + candle structure
//
// This is a "smart money" setup: engineered stops
// get taken, then institutional flow drives the
// real move in the opposite direction.
// ============================================

import type { StrategyEngine, StrategySignal, StrategyCategory } from '../strategyRegistry';
import type { StrategyContext } from '../strategyContext';

export const sweepReclaimStrategy: StrategyEngine = {
  id: 'sweep_reclaim',
  name: 'Sweep Reclaim',
  category: 'SWEEP' as StrategyCategory,
  description: 'Detects liquidity sweep and reclaim patterns — stop hunts followed by structural reclaim',
  supportedSides: ['LONG', 'SHORT'],
  defaultEnabled: true,
  canOverrideBtcRegime: true,  // Sweeps indicate institutional flow reversal
  regimeOverrideMinScore: 15,

  metadata: {
    indicators: ['Pivot Highs/Lows', 'Volume SMA-20', 'RSI-14', 'ATR-14', 'Session Volume Profile (SVP)', 'Candle Structure Analysis'],
    howItWorks: 'Detects liquidity sweep patterns where price deliberately takes out a known pivot level (triggering stop orders), then immediately reverses and reclaims above/below that level — classic institutional stop-hunt behavior.',
    entryLogic: 'A candle must wick beyond a recent pivot low (LONG) or pivot high (SHORT) by the sweep tolerance, then close back above/below that level with a strong body — proving the sweep was absorbed by institutional flow.',
    confirmationLogic: 'Volume must spike significantly above average on the sweep candle. Body-to-range ratio must confirm strong reclaim (not a weak close). Close position within the candle range must favor the reclaim direction.',
    stopLossLogic: 'Stop placed below the sweep wick low (LONG) or above sweep wick high (SHORT) with a small buffer. This is the "invalidation" level — if price returns there, the sweep thesis is wrong.',
    takeProfitLogic: 'R-multiple targets from the risk distance. Default 1.5R and 2.5R. Sweep reclaims often produce sharp moves as trapped traders unwind.',
    bestConditions: 'Works best near established support/resistance levels with visible liquidity pools. Optimal in choppy or ranging conditions where stop hunts are common. Also effective at trend exhaustion points.',
    style: 'SMART_MONEY',
    regimeBehavior: 'CAN override BTC regime for high-confidence sweeps (≥15). Sweep reclaims often mark the exact reversal point against the prevailing trend.',
    signalClass: 'SNIPER to SUPER_SNIPER depending on sweep depth, volume, and HTF alignment.'
  },

  evaluate(ctx: StrategyContext): StrategySignal | null {
    const debugLog: string[] = [`[SweepReclaim] ${ctx.symbol}`];
    const modeKey = ctx.activeMode.key;

    if (ctx.regime === 'CRASH') {
      debugLog.push('REJECT: CRASH regime');
      return null;
    }

    const lastIdx = ctx.lastIdx15;
    if (lastIdx < 20) { debugLog.push('REJECT: insufficient candle data'); return null; }

    const candle = ctx.tf15m[lastIdx];
    const atr    = ctx.atr14_15[lastIdx];
    const volAvg = ctx.volSMA20_15[lastIdx];
    const rsi    = ctx.rsi14_15[lastIdx];

    if (!atr || !volAvg || !rsi) { debugLog.push('REJECT: indicators null'); return null; }

    // ── Find recent pivot lows and highs (last 20 candles = 5 hours) ──
    const lookback = 20;
    const pivotLows:  { idx: number; price: number }[] = [];
    const pivotHighs: { idx: number; price: number }[] = [];

    for (let i = lastIdx - lookback; i < lastIdx - 2; i++) {
      if (i < 2) continue;
      const lo = ctx.lows15[i];
      const hi = ctx.highs15[i];
      // Simple local pivot: lower than both neighbors
      if (lo <= ctx.lows15[i-1] && lo <= ctx.lows15[i-2] && lo <= ctx.lows15[i+1] && lo <= ctx.lows15[i+2]) {
        pivotLows.push({ idx: i, price: lo });
      }
      if (hi >= ctx.highs15[i-1] && hi >= ctx.highs15[i-2] && hi >= ctx.highs15[i+1] && hi >= ctx.highs15[i+2]) {
        pivotHighs.push({ idx: i, price: hi });
      }
    }

    // ── Configuration by mode ──
    const sweepTolerance  = modeKey === 'AGGRESSIVE' ? 0.003 : modeKey === 'CONSERVATIVE' ? 0.001 : 0.002;
    const minVolSpike     = modeKey === 'AGGRESSIVE' ? 1.3 : modeKey === 'CONSERVATIVE' ? 2.0 : 1.6;
    const minBodyRatio    = modeKey === 'AGGRESSIVE' ? 0.40 : 0.55;
    const minScore        = modeKey === 'AGGRESSIVE' ? 8 : modeKey === 'CONSERVATIVE' ? 14 : 10;

    // ════════════════════════════════════════════════════════════════════
    // LONG SWEEP: price wicked below a pivot low then reclaimed above it
    // ════════════════════════════════════════════════════════════════════
    for (const pivot of pivotLows) {
      const sweepDepth = (pivot.price - candle.low) / pivot.price;
      const reclaimedAbove = candle.close > pivot.price;
      const wentBelow = candle.low < pivot.price * (1 - sweepTolerance);

      if (wentBelow && reclaimedAbove && candle.close > candle.open) {
        const range = Math.max(1e-9, candle.high - candle.low);
        const bodyRatio = Math.abs(candle.close - candle.open) / range;
        const volRatio = candle.volume / volAvg;
        const closePos = (candle.close - candle.low) / range;

        debugLog.push(`Sweep LOW candidate: pivot=${pivot.price.toFixed(4)} swept=${sweepDepth.toFixed(4)} vol=${volRatio.toFixed(2)}x body=${bodyRatio.toFixed(2)}`);

        // Quality checks
        if (bodyRatio < minBodyRatio) { debugLog.push('REJECT: weak body'); continue; }
        if (volRatio < minVolSpike) { debugLog.push('REJECT: low volume spike'); continue; }
        if (closePos < 0.60) { debugLog.push('REJECT: close position weak'); continue; }

        // ── Scoring ──
        let score = 4; // Base: sweep + reclaim detected
        const reasons: string[] = ['Liquidity sweep below pivot low'];

        if (volRatio > 2.0) { score += 3; reasons.push(`Strong volume (${volRatio.toFixed(1)}x)`); }
        else if (volRatio > 1.5) { score += 2; reasons.push(`Volume surge (${volRatio.toFixed(1)}x)`); }
        else { score += 1; }

        if (bodyRatio > 0.70) { score += 2; reasons.push('Full body reclaim'); }
        else { score += 1; }

        if (sweepDepth > 0.005) { score += 1; reasons.push('Deep sweep'); }

        if (ctx.htfBias === 'BULL' || ctx.htfBias === 'RECOVERY') { score += 2; reasons.push('1H trend supportive'); }
        score += (ctx.regimeScoreBonusLong || 0);

        // RSI divergence bonus
        if (rsi! < 35) { score += 1; reasons.push('RSI oversold at sweep'); }

        // SVP confluence
        if (ctx.svp5d && candle.close > ctx.svp5d.val) { score += 1; reasons.push('Above VAL'); }

        if (score < minScore) { debugLog.push(`REJECT: Score ${score} < ${minScore}`); continue; }

        // ── Sizing ──
        const entry = candle.close * 1.0012;
        const sl = Math.min(candle.low, pivot.price * (1 - 0.003)) * (1 - 0.0012);
        const stopDist = Math.max(entry - sl, entry * 0.0035);

        if (!ctx.balance || ctx.balance <= 0) { debugLog.push('REJECT: zero balance'); return null; }
        const intendedRisk = ctx.balance * ctx.activeMode.riskPct;
        if (intendedRisk <= 0) { debugLog.push('REJECT: zero risk'); return null; }

        const qty = intendedRisk / stopDist;
        const sizeUSDT = qty * entry;
        if (qty <= 0 || sizeUSDT < 5.0) { debugLog.push('REJECT: below min notional'); continue; }

        const tp1RR = (ctx.activeMode as any).tp1RR ?? 1.5;
        const tp2RR = (ctx.activeMode as any).tp2RR ?? 2.5;
        const tp1Only = (ctx.activeMode as any).tp1Only === true;
        const riskDist = entry - sl;

        debugLog.push(`ACCEPT: LONG SWEEP score=${score} qty=${qty.toFixed(4)}`);

        return {
          strategyId: this.id, strategyName: this.name,
          kind: 'SWEEP', setupType: 'SWEEP_RECLAIM_LONG',
          symbol: ctx.symbol, side: 'LONG',
          entryPrice: entry, stopLoss: sl,
          takeProfit: entry + riskDist * tp1RR,
          takeProfit2: tp1Only ? undefined : entry + riskDist * tp2RR,
          qty, sizeUSDT, score,
          confidence: 'MEDIUM', reasons,
          regimeAlignment: 'ALIGNED', executionClass: 'EXECUTABLE',
          atr15: atr, volRatio,
          entryType: 'REVERSAL', entryTiming: 'OPTIMAL',
          btcRegimeAtEntry: ctx.regimeLabel,
          tags: ['SWEEP', 'RECLAIM', 'STOP_HUNT'],
          debugLog
        };
      }
    }

    // ════════════════════════════════════════════════════════════════════
    // SHORT SWEEP: price wicked above a pivot high then reclaimed below
    // ════════════════════════════════════════════════════════════════════
    for (const pivot of pivotHighs) {
      const sweepDepth = (candle.high - pivot.price) / pivot.price;
      const reclaimedBelow = candle.close < pivot.price;
      const wentAbove = candle.high > pivot.price * (1 + sweepTolerance);

      if (wentAbove && reclaimedBelow && candle.close < candle.open) {
        const range = Math.max(1e-9, candle.high - candle.low);
        const bodyRatio = Math.abs(candle.close - candle.open) / range;
        const volRatio = candle.volume / volAvg;
        const closePos = (candle.close - candle.low) / range;

        debugLog.push(`Sweep HIGH candidate: pivot=${pivot.price.toFixed(4)} swept=${sweepDepth.toFixed(4)} vol=${volRatio.toFixed(2)}x`);

        if (bodyRatio < minBodyRatio) { debugLog.push('REJECT: weak body'); continue; }
        if (volRatio < minVolSpike) { debugLog.push('REJECT: low volume spike'); continue; }
        if (closePos > 0.40) { debugLog.push('REJECT: close position weak for short'); continue; }

        let score = 4;
        const reasons: string[] = ['Liquidity sweep above pivot high'];

        if (volRatio > 2.0) { score += 3; reasons.push(`Strong volume (${volRatio.toFixed(1)}x)`); }
        else if (volRatio > 1.5) { score += 2; reasons.push(`Volume surge (${volRatio.toFixed(1)}x)`); }
        else { score += 1; }

        if (bodyRatio > 0.70) { score += 2; reasons.push('Full body rejection'); }
        else { score += 1; }

        if (sweepDepth > 0.005) { score += 1; reasons.push('Deep sweep'); }

        if (ctx.htfBias === 'BEAR' || ctx.htfBias === 'BREAKDOWN') { score += 2; reasons.push('1H trend supportive'); }
        score += (ctx.regimeScoreBonusShort || 0);

        if (rsi! > 65) { score += 1; reasons.push('RSI overbought at sweep'); }
        if (ctx.svp5d && candle.close < ctx.svp5d.vah) { score += 1; reasons.push('Below VAH'); }

        if (score < minScore) { debugLog.push(`REJECT: Score ${score} < ${minScore}`); continue; }

        const entry = candle.close * (1 - 0.0012);
        const sl = Math.max(candle.high, pivot.price * (1 + 0.003)) * (1 + 0.0012);
        const stopDist = Math.max(sl - entry, entry * 0.0035);

        if (!ctx.balance || ctx.balance <= 0) { debugLog.push('REJECT: zero balance'); return null; }
        const intendedRisk = ctx.balance * ctx.activeMode.riskPct;
        if (intendedRisk <= 0) { debugLog.push('REJECT: zero risk'); return null; }

        const qty = intendedRisk / stopDist;
        const sizeUSDT = qty * entry;
        if (qty <= 0 || sizeUSDT < 5.0) { debugLog.push('REJECT: below min notional'); continue; }

        const tp1RR = (ctx.activeMode as any).tp1RR ?? 1.5;
        const tp2RR = (ctx.activeMode as any).tp2RR ?? 2.5;
        const tp1Only = (ctx.activeMode as any).tp1Only === true;
        const riskDist = sl - entry;

        debugLog.push(`ACCEPT: SHORT SWEEP score=${score} qty=${qty.toFixed(4)}`);

        return {
          strategyId: this.id, strategyName: this.name,
          kind: 'SWEEP', setupType: 'SWEEP_RECLAIM_SHORT',
          symbol: ctx.symbol, side: 'SHORT',
          entryPrice: entry, stopLoss: sl,
          takeProfit: entry - riskDist * tp1RR,
          takeProfit2: tp1Only ? undefined : entry - riskDist * tp2RR,
          qty, sizeUSDT, score,
          confidence: 'MEDIUM', reasons,
          regimeAlignment: 'ALIGNED', executionClass: 'EXECUTABLE',
          atr15: atr, volRatio,
          entryType: 'REVERSAL', entryTiming: 'OPTIMAL',
          btcRegimeAtEntry: ctx.regimeLabel,
          tags: ['SWEEP', 'RECLAIM', 'STOP_HUNT'],
          debugLog
        };
      }
    }

    return null;
  }
};
