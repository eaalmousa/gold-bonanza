// ============================================
// Trend Continuation Strategy — NEW
//
// Detects EMA pullback continuation entries:
// 1. Price in established 1H trend (above/below EMA50)
// 2. 15m pullback to EMA20/50 zone without breaking structure
// 3. Bounce candle confirmation
// 4. Volume not exhausted
//
// Classic "buy the dip in an uptrend" / "sell the
// rally in a downtrend" with institutional quality.
// ============================================

import type { StrategyEngine, StrategySignal, StrategyCategory } from '../strategyRegistry';
import type { StrategyContext } from '../strategyContext';

export const trendContinuationStrategy: StrategyEngine = {
  id: 'trend_continuation',
  name: 'Trend Continuation',
  category: 'TREND' as StrategyCategory,
  description: 'EMA pullback continuation — buys dips in uptrends, sells rallies in downtrends with structural confirmation',
  supportedSides: ['LONG', 'SHORT'],
  defaultEnabled: true,
  canOverrideBtcRegime: false,  // Trend continuation must align with macro
  regimeOverrideMinScore: 999,

  evaluate(ctx: StrategyContext): StrategySignal | null {
    const debugLog: string[] = [`[TrendCont] ${ctx.symbol}`];
    const modeKey = ctx.activeMode.key;

    if (ctx.regime === 'CRASH') { debugLog.push('REJECT: CRASH regime'); return null; }
    if (ctx.regime === 'CHOP' && modeKey !== 'AGGRESSIVE') { debugLog.push('REJECT: CHOP regime (non-aggressive)'); return null; }

    const lastIdx = ctx.lastIdx15;
    if (lastIdx < 10) return null;

    const candle = ctx.tf15m[lastIdx];
    const prev   = ctx.tf15m[lastIdx - 1];
    const e20    = ctx.ema20_15[lastIdx];
    const e50    = ctx.ema50_15[lastIdx];
    const atr    = ctx.atr14_15[lastIdx];
    const rsi    = ctx.rsi14_15[lastIdx];
    const volAvg = ctx.volSMA20_15[lastIdx];
    const e50_1h = ctx.ema50_1h[ctx.lastIdx1h];
    const e200_1h = ctx.ema200_1h[ctx.lastIdx1h];
    const close1h = ctx.closes1h[ctx.lastIdx1h];

    if (!e20 || !e50 || !atr || !rsi || !volAvg || !e50_1h || !e200_1h) {
      debugLog.push('REJECT: indicators null');
      return null;
    }

    const range = Math.max(1e-9, candle.high - candle.low);
    const body = Math.abs(candle.close - candle.open);
    const bodyRatio = body / range;
    const volRatio = candle.volume / volAvg;

    // ── Mode-specific thresholds ──
    const minBodyPct = modeKey === 'AGGRESSIVE' ? 0.35 : 0.50;
    const minScore = modeKey === 'AGGRESSIVE' ? 7 : modeKey === 'CONSERVATIVE' ? 13 : 10;

    // ════════════════════════════════════════════════════════════════════
    //  LONG TREND CONTINUATION
    // ════════════════════════════════════════════════════════════════════
    const isUptrend1h = close1h > e50_1h && e50_1h > e200_1h;

    if (isUptrend1h && ctx.htfBias !== 'BEAR' && ctx.htfBias !== 'BREAKDOWN') {
      // ── Pullback to EMA zone ──
      const touchedEma = candle.low <= e20 * 1.003 || candle.low <= e50 * 1.005;
      const heldAboveEma = candle.close > e20;
      const isBullish = candle.close > candle.open;
      const closedAbovePrev = candle.close > Math.max(prev.open, prev.close);

      if (!touchedEma) { debugLog.push('REJECT: no EMA pullback'); }
      else if (!heldAboveEma) { debugLog.push('REJECT: broke below EMA20'); }
      else if (!isBullish) { debugLog.push('REJECT: not bullish candle'); }
      else if (bodyRatio < minBodyPct) { debugLog.push('REJECT: weak body'); }
      else {
        let score = 3; // Base: trend + pullback + bounce
        const reasons: string[] = ['EMA pullback in 1H uptrend'];

        // ── Scoring ──
        if (closedAbovePrev) { score += 2; reasons.push('Displacement confirmed'); }
        if (volRatio > 1.3) { score += 2; reasons.push(`Volume bounce (${volRatio.toFixed(1)}x)`); }
        else { score += 1; }
        if (bodyRatio > 0.65) { score += 1; reasons.push('Strong body'); }
        if (rsi > 40 && rsi < 65) { score += 2; reasons.push(`RSI healthy (${rsi.toFixed(0)})`); }
        else if (rsi >= 30 && rsi < 40) { score += 1; reasons.push('RSI near oversold — deep pullback'); }

        // EMA spacing / structure health
        const emaSpread = ((e20 - e50) / e50) * 100;
        if (emaSpread > 0.3) { score += 1; reasons.push('EMA spread healthy'); }

        score += (ctx.regimeScoreBonusLong || 0);
        if (ctx.svp5d && candle.close > ctx.svp5d.poc) { score += 1; reasons.push('Above POC'); }

        // MACD confirmation 
        const macdH = ctx.macd_15.histogram[lastIdx];
        const macdHPrev = ctx.macd_15.histogram[lastIdx - 1];
        if (macdH != null && macdHPrev != null && macdH > macdHPrev) {
          score += 1; reasons.push('MACD momentum turning up');
        }

        if (score < minScore) { debugLog.push(`REJECT: Score ${score} < ${minScore}`); return null; }

        // ── Sizing ──
        const entry = candle.high * 1.0010;
        const sl = Math.min(candle.low, e50 * 0.998) * (1 - 0.0012);
        const stopDist = Math.max(entry - sl, entry * 0.0035);

        if (!ctx.balance || ctx.balance <= 0) { debugLog.push('REJECT: zero balance'); return null; }
        const intendedRisk = ctx.balance * ctx.activeMode.riskPct;
        if (intendedRisk <= 0) { debugLog.push('REJECT: zero risk'); return null; }

        const qty = intendedRisk / stopDist;
        const sizeUSDT = qty * entry;
        if (qty <= 0 || sizeUSDT < 5.0) { debugLog.push('REJECT: below min notional'); return null; }

        const tp1RR = (ctx.activeMode as any).tp1RR ?? 1.5;
        const tp2RR = (ctx.activeMode as any).tp2RR ?? 2.5;
        const tp1Only = (ctx.activeMode as any).tp1Only === true;
        const riskDist = entry - sl;

        debugLog.push(`ACCEPT: LONG TREND_CONT score=${score} qty=${qty.toFixed(4)}`);

        return {
          strategyId: this.id, strategyName: this.name,
          kind: 'TREND', setupType: 'EMA_PULLBACK_LONG',
          symbol: ctx.symbol, side: 'LONG',
          entryPrice: entry, stopLoss: sl,
          takeProfit: entry + riskDist * tp1RR,
          takeProfit2: tp1Only ? undefined : entry + riskDist * tp2RR,
          qty, sizeUSDT, score, confidence: 'MEDIUM', reasons,
          regimeAlignment: 'ALIGNED', executionClass: 'EXECUTABLE',
          atr15: atr, volRatio,
          entryType: 'CONTINUATION', entryTiming: volRatio > 1.5 ? 'OPTIMAL' : 'EARLY',
          btcRegimeAtEntry: ctx.regimeLabel,
          tags: ['TREND', 'PULLBACK', 'EMA'],
          debugLog
        };
      }
    }

    // ════════════════════════════════════════════════════════════════════
    //  SHORT TREND CONTINUATION
    // ════════════════════════════════════════════════════════════════════
    const isDowntrend1h = close1h < e50_1h && e50_1h < e200_1h;

    if (isDowntrend1h && ctx.htfBias !== 'BULL' && ctx.htfBias !== 'RECOVERY') {
      const touchedEma = candle.high >= e20 * 0.997 || candle.high >= e50 * 0.995;
      const heldBelowEma = candle.close < e20;
      const isBearish = candle.close < candle.open;
      const closedBelowPrev = candle.close < Math.min(prev.open, prev.close);

      if (!touchedEma) { debugLog.push('REJECT: no EMA rally for short'); }
      else if (!heldBelowEma) { debugLog.push('REJECT: broke above EMA20'); }
      else if (!isBearish) { debugLog.push('REJECT: not bearish candle'); }
      else if (bodyRatio < minBodyPct) { debugLog.push('REJECT: weak body'); }
      else {
        let score = 3;
        const reasons: string[] = ['EMA rally rejection in 1H downtrend'];

        if (closedBelowPrev) { score += 2; reasons.push('Displacement confirmed'); }
        if (volRatio > 1.3) { score += 2; reasons.push(`Volume rejection (${volRatio.toFixed(1)}x)`); }
        else { score += 1; }
        if (bodyRatio > 0.65) { score += 1; reasons.push('Strong body'); }
        if (rsi > 55 && rsi < 70) { score += 2; reasons.push(`RSI healthy (${rsi.toFixed(0)})`); }
        else if (rsi >= 70) { score += 1; reasons.push('RSI overbought — deep rally'); }

        const emaSpread = ((e50 - e20) / e50) * 100;
        if (emaSpread > 0.3) { score += 1; reasons.push('EMA bear spread healthy'); }

        score += (ctx.regimeScoreBonusShort || 0);
        if (ctx.svp5d && candle.close < ctx.svp5d.poc) { score += 1; reasons.push('Below POC'); }

        const macdH = ctx.macd_15.histogram[lastIdx];
        const macdHPrev = ctx.macd_15.histogram[lastIdx - 1];
        if (macdH != null && macdHPrev != null && macdH < macdHPrev) {
          score += 1; reasons.push('MACD momentum turning down');
        }

        if (score < minScore) { debugLog.push(`REJECT: Score ${score} < ${minScore}`); return null; }

        const entry = candle.low * (1 - 0.0010);
        const sl = Math.max(candle.high, e50 * 1.002) * (1 + 0.0012);
        const stopDist = Math.max(sl - entry, entry * 0.0035);

        if (!ctx.balance || ctx.balance <= 0) { debugLog.push('REJECT: zero balance'); return null; }
        const intendedRisk = ctx.balance * ctx.activeMode.riskPct;
        if (intendedRisk <= 0) { debugLog.push('REJECT: zero risk'); return null; }

        const qty = intendedRisk / stopDist;
        const sizeUSDT = qty * entry;
        if (qty <= 0 || sizeUSDT < 5.0) { debugLog.push('REJECT: below min notional'); return null; }

        const tp1RR = (ctx.activeMode as any).tp1RR ?? 1.5;
        const tp2RR = (ctx.activeMode as any).tp2RR ?? 2.5;
        const tp1Only = (ctx.activeMode as any).tp1Only === true;
        const riskDist = sl - entry;

        debugLog.push(`ACCEPT: SHORT TREND_CONT score=${score} qty=${qty.toFixed(4)}`);

        return {
          strategyId: this.id, strategyName: this.name,
          kind: 'TREND', setupType: 'EMA_PULLBACK_SHORT',
          symbol: ctx.symbol, side: 'SHORT',
          entryPrice: entry, stopLoss: sl,
          takeProfit: entry - riskDist * tp1RR,
          takeProfit2: tp1Only ? undefined : entry - riskDist * tp2RR,
          qty, sizeUSDT, score, confidence: 'MEDIUM', reasons,
          regimeAlignment: 'ALIGNED', executionClass: 'EXECUTABLE',
          atr15: atr, volRatio,
          entryType: 'CONTINUATION', entryTiming: volRatio > 1.5 ? 'OPTIMAL' : 'EARLY',
          btcRegimeAtEntry: ctx.regimeLabel,
          tags: ['TREND', 'PULLBACK', 'EMA'],
          debugLog
        };
      }
    }

    return null;
  }
};
