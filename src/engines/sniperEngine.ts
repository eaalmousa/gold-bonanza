// ============================================
// Sniper Engine v3 — Precision Pullback Engine
// Updated: 2026-03-21
// Audit Mode: Enhanced Diagnostics for Over-Rejection Investigation
// ============================================

import type { Kline, Signal, ModeConfig, MarketRegime, OrderFlowSnapshot } from '../types/trading';
import { calcEMA, calcRSI, calcATR, calcSMA, calcZLSMA, calcSessionVolumeProfile, calcChandelierExit } from './indicators';

// ─── DEBUG LOGGER ─────────────────────────────────────────────────
export const globalDebugLogs: string[][] = [];
function makeDebugLog(symbol?: string): string[] {
  const log: string[] = [];
  if (symbol) log.push(`[SniperV3] ${symbol}`);
  globalDebugLogs.push(log);
  return log;
}

export interface DiagnosticSummary {
  symbol: string;
  side: string;
  regime: string;
  trend1H: string;
  zlsmaValue: number | string;
  zlsmaSlopePct: number | string;
  svpContext: string;
  ceStopValue: number | string;
  entryPrice: number | string;
  targetPrice: number | string;
  slopePass: boolean;
  displacementPass: boolean;
  retestPass: boolean;
  ceilFloorPass: boolean;
  score: number;
  netRR: number | string;
  decision: 'ACCEPT' | 'REJECT' | 'UNKNOWN';
  rejectReason: string;
}

function printDiagnostic(diag: DiagnosticSummary) {
  const color = diag.decision === 'ACCEPT' ? '\x1b[32m' : '\x1b[33m';
  const reset = '\x1b[0m';
  
  console.log(`\n${color}┌─── [GATEWAY AUDIT: ${diag.symbol}] ─────────────────────────────${reset}`);
  console.log(`${color}│${reset} [MACRO LAYER]  Bias: ${diag.trend1H.padEnd(12)} | Regime: ${diag.regime}`);
  console.log(`${color}│${reset} [SLOPE LAYER]  ZLSMA: ${diag.zlsmaValue.toString().padEnd(10)} | Slope: ${diag.zlsmaSlopePct}`);
  console.log(`${color}│${reset} [LOC LAYER]    SVP: ${diag.svpContext}`);
  console.log(`${color}│${reset} [OUTCOME]      ${diag.decision === 'ACCEPT' ? '🏆 ACCEPTED' : '🚫 REJECTED'}`);
  if (diag.decision === 'REJECT') {
    console.log(`${color}│${reset} [REASON]       ${diag.rejectReason}`);
  }
  console.log(`${color}└───────────────────────────────────────────────────────────────${reset}\n`);
}

export function evaluateSniperSignal(
  tf1h: Kline[],
  tf15m: Kline[],
  activeMode: ModeConfig,
  balance: number,
  regime?: MarketRegime,
  regimeScoreBonusLong?: number,
  regimeScoreBonusShort?: number,
  orderFlow?: OrderFlowSnapshot,
  btc4hTrend?: 'UP' | 'DOWN' | 'RANGING',
  btcRegimeLabel?: string,
  symbol?: string
): Signal | null {
  const diag: DiagnosticSummary = {
    symbol: symbol || 'UNKNOWN',
    side: 'UNKNOWN',
    regime: regime || 'UNKNOWN',
    trend1H: 'UNKNOWN',
    zlsmaValue: '...',
    zlsmaSlopePct: '...',
    svpContext: '...',
    ceStopValue: '...',
    entryPrice: '...',
    targetPrice: '...',
    slopePass: false,
    displacementPass: false,
    retestPass: false,
    ceilFloorPass: false,
    score: 0,
    netRR: 0,
    decision: 'UNKNOWN',
    rejectReason: 'None'
  };

  const debugLog = makeDebugLog(symbol);
  
  try {
    const result = evaluateSniperSignalInner(
      tf1h, tf15m, activeMode, balance, regime, regimeScoreBonusLong, regimeScoreBonusShort, 
      orderFlow, btc4hTrend, btcRegimeLabel, symbol, debugLog, diag
    );
    
    if (result) {
      diag.decision = 'ACCEPT';
      diag.score = result.score;
    } else {
      diag.decision = 'REJECT';
      for (let i = debugLog.length - 1; i >= 0; i--) {
        if (debugLog[i].startsWith('REJECT:')) {
          diag.rejectReason = debugLog[i].replace('REJECT: ', '').trim();
          break;
        }
      }
    }
    
    printDiagnostic(diag);
    return result;
  } catch (err: any) {
    console.error(`[SniperEngine] Error processing ${symbol}: ${err.message}`);
    diag.decision = 'REJECT';
    diag.rejectReason = `ERROR: ${err.message}`;
    printDiagnostic(diag);
    return null;
  }
}

function evaluateSniperSignalInner(
  tf1h: Kline[],
  tf15m: Kline[],
  activeMode: ModeConfig,
  balance: number,
  regime?: MarketRegime,
  regimeScoreBonusLong?: number,
  regimeScoreBonusShort?: number,
  orderFlow?: OrderFlowSnapshot,
  btc4hTrend?: 'UP' | 'DOWN' | 'RANGING',
  btcRegimeLabel?: string,
  symbol?: string,
  debugLog: string[] = [],
  diag: DiagnosticSummary = {} as any
): Signal | null {
  const modeKey: string = activeMode.key;

  if (!tf1h || tf1h.length < 210 || !tf15m || tf15m.length < 90) {
    debugLog.push('REJECT: Insufficient klines data');
    return null;
  }

  if (regime === 'CRASH') { debugLog.push('REJECT: CRASH regime'); return null; }
  // Removed global CHOP rejection so mean-reversion pullbacks (the sniper edge) can fire in sideways regimes,
  // structurally throttling volume via Correlation Limiter limits instead of blanket freezing the pipeline.

  const closes1h  = tf1h.map(c => c.close);
  const ema50_1h  = calcEMA(closes1h, 50);
  const ema200_1h = calcEMA(closes1h, 200);
  const idx1h     = closes1h.length - 1;
  const e50_1h    = ema50_1h[idx1h];
  const e200_1h   = ema200_1h[idx1h];

  if (!e50_1h || !e200_1h) { debugLog.push('REJECT: EMAs null'); return null; }
  
  const htfBias = closes1h[idx1h] > e50_1h ? (e50_1h > e200_1h ? 'BULL' : 'RECOVERY') : (e50_1h < e200_1h ? 'BEAR' : 'BREAKDOWN');
  diag.trend1H = htfBias;

  const zlsma_1h = calcZLSMA(closes1h, 50);
  const zlsmaNow = zlsma_1h[idx1h];
  const zlsmaPrev = zlsma_1h[idx1h - 3] ?? zlsmaNow;
  if (!zlsmaNow || !zlsmaPrev) { debugLog.push('REJECT: ZLSMA null'); return null; }
  const zlsmaPctChange = ((zlsmaNow - zlsmaPrev) / zlsmaNow) * 100;
  
  diag.zlsmaValue = zlsmaNow.toFixed(4);
  diag.zlsmaSlopePct = zlsmaPctChange.toFixed(3) + '%';

  const baseThresh = modeKey === 'AGGRESSIVE' ? 0.03 : modeKey === 'CONSERVATIVE' ? 0.12 : 0.08;
  const slopeThresh = regime === 'CHOP' ? 0.01 : baseThresh;
  const breakThresh = slopeThresh + 0.05;

  const isBreakingDown = closes1h[idx1h] < e50_1h! && zlsmaPctChange < -breakThresh;
  const isRecovering   = closes1h[idx1h] > e50_1h! && zlsmaPctChange > breakThresh;

  let side: 'LONG' | 'SHORT';
  if (isBreakingDown) side = 'SHORT';
  else if (isRecovering) side = 'LONG';
  else if (zlsmaPctChange > slopeThresh) side = 'LONG';
  else if (zlsmaPctChange < -slopeThresh) side = 'SHORT';
  else { debugLog.push(`REJECT: Weak ZLSMA slope (needs > ${slopeThresh}%)`); return null; }

  diag.side = side;

  const closes15      = tf15m.map(c => c.close);
  const highs15       = tf15m.map(c => c.high);
  const lows15        = tf15m.map(c => c.low);
  const vols15        = tf15m.map(c => c.volume);
  const lastIdx       = closes15.length - 2;
  const candle        = tf15m[lastIdx];
  const prev          = tf15m[lastIdx - 1];
  
  const zlsma15       = calcZLSMA(closes15, 20);
  const rsi14_15      = calcRSI(closes15, 14);
  const atr14_15      = calcATR(highs15, lows15, closes15, 14);
  const volSMA20_15   = calcSMA(vols15, 20);
  const { ceLong, ceShort } = calcChandelierExit(highs15, lows15, closes15, 22, 3.0);
  const svp5d         = calcSessionVolumeProfile(tf1h.map(c => c.high), tf1h.map(c => c.low), closes1h, tf1h.map(c => c.volume), 120, 50);

  const zl15 = zlsma15[lastIdx];
  const rsiNow = rsi14_15[lastIdx];
  const rsiPrev = rsi14_15[lastIdx-1];
  const atr = atr14_15[lastIdx];
  const volAvg = volSMA20_15[lastIdx];

  if (!zl15 || !rsiNow || !atr || !svp5d || !volAvg) { debugLog.push('REJECT: Local indicators fail'); return null; }

  const cfg = activeMode.pullback;
  const range = Math.max(1e-9, candle.high - candle.low);

  const calculateSafeSizing = (s: string, entry: number, sl: number) => {
    const intendedRisk = balance * activeMode.riskPct;
    const stopDist = Math.abs(entry - sl);
    const effStopDist = Math.max(stopDist, entry * 0.0035);
    const rawQty = intendedRisk / effStopDist;
    const rawNotional = rawQty * entry;
    const MIN = 5.50;
    const CAP = 2.0;

    if (rawNotional < 5.0) {
      const adjQty = MIN / entry;
      const adjRisk = adjQty * effStopDist;
      const mult = adjRisk / intendedRisk;
      if (mult > CAP) {
        const trace = `[SIZING_TRACE:${s}] side=${side} | intendedRisk=$${intendedRisk.toFixed(2)} | stopDist=${((effStopDist/entry)*100).toFixed(2)}% | rawQty=${rawQty.toFixed(3)} | rawNotional=$${rawNotional.toFixed(2)} | adjQty=BLOCKED | adjNotional=BLOCKED | actualRisk=N/A | riskMult=${mult.toFixed(2)}x | DECISION=REJECT (Risk Inflation > 2.0x)`;
        debugLog.push('REJECT: min notional safety cap'); console.log(trace);
        return null;
      }
      const trace = `[SIZING_TRACE:${s}] side=${side} | intendedRisk=$${intendedRisk.toFixed(2)} | stopDist=${((effStopDist/entry)*100).toFixed(2)}% | rawQty=${rawQty.toFixed(3)} | rawNotional=$${rawNotional.toFixed(2)} | adjQty=${adjQty.toFixed(3)} | adjNotional=$${MIN.toFixed(2)} | actualRisk=$${adjRisk.toFixed(2)} | riskMult=${mult.toFixed(2)}x | DECISION=ALLOW (Safe Adjusted)`;
      console.log(trace);
      return { qty: adjQty, sizeUSDT: MIN };
    }
    const trace = `[SIZING_TRACE:${s}] side=${side} | intendedRisk=$${intendedRisk.toFixed(2)} | stopDist=${((effStopDist/entry)*100).toFixed(2)}% | rawQty=${rawQty.toFixed(3)} | rawNotional=$${rawNotional.toFixed(2)} | adjQty=${rawQty.toFixed(3)} | adjNotional=$${rawNotional.toFixed(2)} | actualRisk=$${intendedRisk.toFixed(2)} | riskMult=1.00x | DECISION=ALLOW (Natural Compliance)`;
    console.log(trace);
    return { qty: rawQty, sizeUSDT: rawNotional };
  };

  let score = 0;
  const reasons: string[] = [];
  const candleThresh = modeKey === 'AGGRESSIVE' ? 0.25 : modeKey === 'CONSERVATIVE' ? 0.55 : 0.38;

  if (side === 'LONG') {
    diag.svpContext = candle.close > svp5d.poc ? 'ABOVE POC' : (candle.close < svp5d.val ? 'BELOW VAL' : 'INSIDE');
    if (candle.low > zl15 * (1 + cfg.valueZoneSlack) && !isRecovering) { debugLog.push('REJECT: Above zone'); return null; }
    if (candle.close < svp5d.val) { debugLog.push('REJECT: Below VAL'); return null; }
    score += candle.close > svp5d.poc ? 4 : 2;
    if (rsiNow < cfg.rsiMin || rsiNow > cfg.rsiMax || rsiNow <= rsiPrev!) { debugLog.push('REJECT: RSI'); return null; }
    score += 2;
    // Volume floor is not mathematically sound for a pullback/exhaustion pivot; removed 'Volume' gate.
    score += 2;
    // Mode-aware rejection of massive counter-wicks
    if (candle.close <= candle.open || (candle.close - candle.low)/range < candleThresh) { debugLog.push('REJECT: Weak candle'); return null; }
    if (candle.close <= Math.max(prev.open, prev.close) && modeKey !== 'AGGRESSIVE') { debugLog.push('REJECT: No displacement'); return null; }
    score += 2 + (regimeScoreBonusLong || 0);

    if (score < cfg.scoreMin) { debugLog.push(`REJECT: Score ${score}`); return null; }

    const entry = candle.high * (1 + 0.0012);
    const sl = Math.min(candle.low, svp5d.poc, ceLong[lastIdx]!) * (1 - 0.0012);
    const sizing = calculateSafeSizing(symbol || 'UNK', entry, sl);
    if (!sizing) return null;

    diag.entryPrice = entry.toFixed(5);
    diag.targetPrice = (entry + (entry - sl) * 1.5).toFixed(5);
    diag.ceStopValue = (ceLong[lastIdx] || 0).toFixed(5);
    diag.score = score;
    diag.netRR = (((entry + (entry - sl) * 1.5) - entry) / (entry - sl)).toFixed(2);

    return {
      kind: 'SNIPER', side: 'LONG', score, reasons, entryPrice: entry, stopLoss: sl,
      takeProfit: entry + (entry - sl) * 1.5, takeProfit2: entry + (entry - sl) * 2.5,
      qty: sizing.qty, sizeUSDT: sizing.sizeUSDT, atr15: atr, volRatio: candle.volume / volAvg,
      entryType: 'CONTINUATION', zoneDistancePct: 0, btcRegimeAtEntry: btcRegimeLabel || 'UNKNOWN', entryTiming: 'OPTIMAL', debugLog
    };
  } else {
    diag.svpContext = candle.close < svp5d.poc ? 'BELOW POC' : (candle.close > svp5d.vah ? 'ABOVE VAH' : 'INSIDE');
    if (candle.high < zl15 * (1 - cfg.valueZoneSlack) && !isBreakingDown) { debugLog.push('REJECT: Below zone'); return null; }
    if (candle.close > svp5d.vah) { debugLog.push('REJECT: Above VAH'); return null; }
    score += candle.close < svp5d.poc ? 4 : 2;
    const rsiMaxShort = 100 - cfg.rsiMin;
    // Removed strict `rsiPrev` smoothing check as it artificially blocks valid waterfall continuations
    if (rsiNow > rsiMaxShort) { debugLog.push('REJECT: RSI Short'); return null; }
    score += 2;
    // Volume floor is not mathematically sound for a pullback/exhaustion pivot; removed 'Volume short' gate.
    score += 2;
    // Mode-aware rejection of massive counter-wicks
    if (candle.close >= candle.open || (candle.high - candle.close)/range < candleThresh) { debugLog.push('REJECT: Weak bear'); return null; }
    if (candle.close >= Math.min(prev.open, prev.close) && modeKey !== 'AGGRESSIVE') { debugLog.push('REJECT: No short displacement'); return null; }
    score += 2 + (regimeScoreBonusShort || 0);

    if (score < cfg.scoreMin) { debugLog.push(`REJECT: Score ${score}`); return null; }

    const entry = candle.low * (1 - 0.0012);
    const sl = Math.max(candle.high, svp5d.poc, ceShort[lastIdx]!) * (1 + 0.0012);
    const sizing = calculateSafeSizing(symbol || 'UNK', entry, sl);
    if (!sizing) return null;

    diag.entryPrice = entry.toFixed(5);
    diag.targetPrice = (entry - (sl - entry) * 1.5).toFixed(5);
    diag.ceStopValue = (ceShort[lastIdx] || 0).toFixed(5);
    diag.score = score;
    diag.netRR = ((entry - (entry - (sl - entry) * 1.5)) / (sl - entry)).toFixed(2);

    return {
      kind: 'SNIPER', side: 'SHORT', score, reasons, entryPrice: entry, stopLoss: sl,
      takeProfit: entry - (sl - entry) * 1.5, takeProfit2: entry - (sl - entry) * 2.5,
      qty: sizing.qty, sizeUSDT: sizing.sizeUSDT, atr15: atr, volRatio: candle.volume / volAvg,
      entryType: 'CONTINUATION', zoneDistancePct: 0, btcRegimeAtEntry: btcRegimeLabel || 'UNKNOWN', entryTiming: 'OPTIMAL', debugLog
    };
  }
}
