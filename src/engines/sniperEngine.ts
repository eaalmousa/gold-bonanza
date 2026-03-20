// ============================================
// Sniper Engine v3 — Precision Pullback Engine
// Updated: 2026-03-20
// Fix: Minimum Notional Enforcement (5.50 USDT)
// ============================================

import type { Kline, Signal, ModeConfig, MarketRegime, OrderFlowSnapshot } from '../types/trading';
import { calcEMA, calcRSI, calcATR, calcSMA, calcZLSMA, calcSessionVolumeProfile, calcChandelierExit } from './indicators';
import { validateOrderFlow } from './regimeFilter';

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
  if (diag.side === 'UNKNOWN' || diag.trend1H === 'UNKNOWN') return;
  
  const color = diag.decision === 'ACCEPT' ? '\x1b[32m' : '\x1b[33m';
  const reset = '\x1b[0m';
  
  console.log(`\n${color}┌─── [LIVE STRATEGY AUDIT: ${diag.symbol}] ─────────────────────────────${reset}`);
  console.log(`${color}│${reset} [MACRO LAYER]  Bias: ${diag.trend1H.padEnd(12)} | Regime: ${diag.regime}`);
  console.log(`${color}│${reset} [SLOPE LAYER]  ZLSMA: ${diag.zlsmaValue.toString().padEnd(10)} | Slope: ${diag.zlsmaSlopePct}`);
  console.log(`${color}│${reset} [LOC LAYER]    SVP: ${diag.svpContext}`);
  console.log(`${color}│${reset} [RISK LAYER]   Entry: ${diag.entryPrice} | Target: ${diag.targetPrice} | Stop(CE): ${diag.ceStopValue}`);
  console.log(`${color}│${reset} [METRICS]      Score: ${diag.score.toString().padEnd(5)} | Net RR: ${diag.netRR}`);
  console.log(`${color}│${reset} [CHECKS]       Slope: ${diag.slopePass ? '✅' : '❌'} | Displ.: ${diag.displacementPass ? '✅' : '❌'} | Retest: ${diag.retestPass ? '✅' : '❌'} | Struct.: ${diag.ceilFloorPass ? '✅' : '❌'}`);
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
  regimeScoreBonus?: number,
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
      tf1h, tf15m, activeMode, balance, regime, regimeScoreBonus, 
      orderFlow, btc4hTrend, btcRegimeLabel, symbol, debugLog, diag
    );
    
    if (result) {
      diag.decision = 'ACCEPT';
      diag.score = result.score;
      printDiagnostic(diag);
    } else {
      diag.decision = 'REJECT';
      for (let i = debugLog.length - 1; i >= 0; i--) {
        if (debugLog[i].startsWith('REJECT:')) {
          diag.rejectReason = debugLog[i].replace('REJECT: ', '').trim();
          break;
        }
      }
      printDiagnostic(diag);
    }
    
    return result;
  } catch (err: any) {
    console.error(`[SniperEngine] Diagnostic wrapper caught error processing ${symbol}: ${err.message}`);
    return null;
  }
}

function evaluateSniperSignalInner(
  tf1h: Kline[],
  tf15m: Kline[],
  activeMode: ModeConfig,
  balance: number,
  regime?: MarketRegime,
  regimeScoreBonus?: number,
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

  // ─── GATE 1: REGIME ───────────────────────────────────
  if (regime === 'CRASH') {
    debugLog.push('REJECT: CRASH regime — no new entries');
    return null;
  }
  if (regime === 'CHOP' && modeKey !== 'AGGRESSIVE') {
    debugLog.push('REJECT: CHOP regime — skip entries');
    return null;
  }

  // ─── 1H STRUCTURE ANALYSIS ────────────────────────────
  const closes1h  = tf1h.map(c => c.close);
  const ema50_1h  = calcEMA(closes1h, 50);
  const ema200_1h = calcEMA(closes1h, 200);
  const idx1h     = closes1h.length - 1;
  const close1h   = closes1h[idx1h];
  const e50_1h    = ema50_1h[idx1h];
  const e200_1h   = ema200_1h[idx1h];

  if ([e50_1h, e200_1h].some(v => v == null)) {
    debugLog.push('REJECT: Missing 1h EMA values');
    return null;
  }

  const isMacroUptrend   = e50_1h! > e200_1h!;
  const isMacroDowntrend = e50_1h! < e200_1h!;

  const zlsma_1h = calcZLSMA(closes1h, 50);
  const zlsmaNow = zlsma_1h[idx1h];
  const zlsmaPrev = zlsma_1h[idx1h - 3] ?? zlsmaNow;
  if (zlsmaNow == null || zlsmaPrev == null) {
    debugLog.push('REJECT: ZLSMA not ready');
    return null;
  }
  
  const zlsmaPctChange = ((zlsmaNow - zlsmaPrev) / zlsmaNow) * 100;
  const slopeStrongUp   = zlsmaPctChange > 0.15;
  const slopeStrongDown = zlsmaPctChange < -0.15;

  const isBreakingDown = close1h < e50_1h! && zlsmaPctChange < -0.20;
  const isRecovering   = close1h > e50_1h! && zlsmaPctChange > 0.20;

  let side: 'LONG' | 'SHORT';

  if (modeKey === 'AGGRESSIVE') {
    side = close1h > zlsmaNow ? 'LONG' : 'SHORT';
    diag.trend1H = 'AGGRESSIVE';
    diag.slopePass = true;
  } else if (isBreakingDown) {
    side = 'SHORT';
    diag.trend1H = 'BREAKING_DOWN';
    diag.slopePass = true;
  } else if (isMacroUptrend && slopeStrongUp && close1h > zlsmaNow) {
    side = 'LONG';
    diag.trend1H = 'UPTREND';
    diag.slopePass = true;
  } else if (isMacroDowntrend && slopeStrongDown && close1h < zlsmaNow) {
    side = 'SHORT';
    diag.trend1H = 'DOWNTREND';
    diag.slopePass = true;
  } else if (isRecovering) {
    side = 'LONG';
    diag.trend1H = 'RECOVERING';
    diag.slopePass = true;
  } else {
    diag.trend1H = 'DRIFT/FLAT';
    debugLog.push(`REJECT: Weak ZLSMA slope (${zlsmaPctChange.toFixed(3)}%)`);
    return null;
  }

  diag.side = side;
  diag.zlsmaValue = zlsmaNow.toFixed(5);
  diag.zlsmaSlopePct = zlsmaPctChange.toFixed(3);

  // BTC Macro Trend
  if (modeKey !== 'AGGRESSIVE' && btc4hTrend && !isBreakingDown) {
    if (side === 'LONG' && btc4hTrend === 'DOWN') { debugLog.push('REJECT: BTC 4H DOWN'); return null; }
    if (side === 'SHORT' && btc4hTrend === 'UP') { debugLog.push('REJECT: BTC 4H UP'); return null; }
  }

  // 15m Setup
  const closes15      = tf15m.map(c => c.close);
  const highs15       = tf15m.map(c => c.high);
  const lows15        = tf15m.map(c => c.low);
  const vols15        = tf15m.map(c => c.volume);
  
  const zlsma15       = calcZLSMA(closes15, 20);
  const rsi14_15      = calcRSI(closes15, 14);
  const atr14_15      = calcATR(highs15, lows15, closes15, 14);
  const volSMA20_15   = calcSMA(vols15, 20);
  
  const { ceLong, ceShort } = calcChandelierExit(highs15, lows15, closes15, 22, 3.0);

  const lastIdx = closes15.length - 2;
  const candle  = tf15m[lastIdx];
  const prev    = tf15m[lastIdx - 1];
  const close15 = candle.close;
  const open15  = candle.open;
  const high15  = candle.high;
  const low15   = candle.low;

  const zl15      = zlsma15[lastIdx];
  const rsiNow    = rsi14_15[lastIdx];
  const rsiPrev   = rsi14_15[lastIdx - 1];
  const atr       = atr14_15[lastIdx];
  const vol       = vols15[lastIdx];
  const volAvg    = volSMA20_15[lastIdx];
  
  const svp5d = calcSessionVolumeProfile(tf1h.map(c => c.high), tf1h.map(c => c.low), closes1h, tf1h.map(c => c.volume), 120, 50);

  if (!zl15 || !rsiNow || !atr || !svp5d) {
    debugLog.push('REJECT: Indicators not ready');
    return null;
  }

  const cfg    = activeMode.pullback;
  const slack  = cfg.valueZoneSlack;
  const range  = Math.max(1e-9, high15 - low15);
  const body   = Math.abs(close15 - open15);

  let score = 0;
  const reasons: string[] = [];

  if (side === 'LONG') {
    // LONG VALUE ZONE
    const zoneTop    = zl15! * (1 + slack);
    const zoneBottom = svp5d!.poc * (1 - slack);
    const inZone = low15 <= zoneTop && high15 >= zoneBottom;
    if (!inZone) { debugLog.push('REJECT: Not in value zone'); return null; }

    // LOCATION
    if (close15 < svp5d!.val) { debugLog.push('REJECT: Below VAL'); return null; }
    diag.svpContext = close15 > svp5d!.poc ? 'Above POC' : 'Above VAL';
    score += close15 > svp5d!.poc ? 4 : 2;

    // RSI
    if (rsiNow! < cfg.rsiMin || rsiNow! > cfg.rsiMax || rsiNow! <= rsiPrev!) {
       debugLog.push(`REJECT: RSI ${rsiNow!.toFixed(1)}`);
       return null;
    }
    score += 2;

    // VOLUME
    const volRatio = vol / volAvg!;
    if (volRatio < cfg.volMult) { debugLog.push('REJECT: Low volume'); return null; }
    score += volRatio > 2 ? 4 : 2;

    // CANDLE ANATOMY
    const isBullCandle = close15 > open15;
    const bodyPct    = (body / range) * 100;
    const closePos   = (close15 - low15) / range;
    const prevTop    = Math.max(prev.open, prev.close);
    const hasDisplacement = close15 > prevTop;

    if (!isBullCandle || bodyPct < 55 || closePos < 0.70) { debugLog.push('REJECT: Weak candle'); return null; }
    if (!hasDisplacement && modeKey !== 'AGGRESSIVE') { debugLog.push('REJECT: No displacement'); return null; }
    diag.displacementPass = true;
    score += 2;

    // REGIME
    score += (regimeScoreBonus || 0);

    // FINAL SCORE
    if (score < cfg.scoreMin) { debugLog.push(`REJECT: Score ${score}`); return null; }

    // RISK
    const triggerPrice = high15 * (1 + 0.0012);
    const stopLoss     = Math.min(low15, svp5d!.poc, ceLong[lastIdx]!) * (1 - 0.0012);
    const stopDistance = Math.max(triggerPrice - stopLoss, triggerPrice * 0.0035);
    
    let qty      = (balance * activeMode.riskPct) / stopDistance;
    let sizeUSDT = qty * triggerPrice;
    if (sizeUSDT < 5.50) {
      debugLog.push(`NOTE: Sizing raised to 5.50 USDT`);
      sizeUSDT = 5.50;
      qty = sizeUSDT / triggerPrice;
    }

    const takeProfit = triggerPrice + 1.5 * stopDistance;
    const netRR = (takeProfit - triggerPrice) / stopDistance;

    diag.entryPrice = triggerPrice.toFixed(5);
    diag.targetPrice = takeProfit.toFixed(5);
    diag.ceStopValue = stopLoss.toFixed(5);
    diag.netRR = netRR.toFixed(2);
    diag.score = score;

    return {
      kind: 'SNIPER', side: 'LONG', score, reasons,
      entryPrice: triggerPrice, stopLoss, takeProfit, takeProfit2: triggerPrice + 2.5 * stopDistance,
      qty, sizeUSDT, atr15: atr, volRatio,
      entryType: 'CONTINUATION',
      zoneDistancePct: 0, btcRegimeAtEntry: 'UNKNOWN', entryTiming: 'OPTIMAL', debugLog
    };

  } else {
    // SHORT BRANCH
    const zoneTop    = svp5d!.poc * (1 + slack);
    const zoneBottom = zl15! * (1 - slack);
    const inZone     = high15 >= zoneBottom && low15 <= zoneTop;
    if (!inZone && !isBreakingDown) { debugLog.push('REJECT: Not in short zone'); return null; }

    // LOCATION
    if (close15 > svp5d!.vah) { debugLog.push('REJECT: Above VAH'); return null; }
    diag.svpContext = close15 < svp5d!.poc ? 'Below POC' : 'Below VAH';
    score += close15 < svp5d!.poc ? 4 : 2;

    // RSI
    if (rsiNow! > (100 - cfg.rsiMin) || rsiNow! >= rsiPrev!) {
       debugLog.push(`REJECT: RSI Short ${rsiNow!.toFixed(1)}`);
       return null;
    }
    score += 2;

    // VOLUME
    const volRatio = vol / volAvg!;
    if (volRatio < cfg.volMult) { debugLog.push('REJECT: Low volume short'); return null; }
    score += 2;

    // CANDLE ANATOMY
    const isBearCandle = close15 < open15;
    const bodyPct    = (body / range) * 100;
    const closePos   = (high15 - close15) / range;
    const prevBottom = Math.min(prev.open, prev.close);
    const hasDisplacement = close15 < prevBottom;

    if (!isBearCandle || bodyPct < 55 || closePos < 0.70) { debugLog.push('REJECT: Weak bear candle'); return null; }
    if (!hasDisplacement && modeKey !== 'AGGRESSIVE') { debugLog.push('REJECT: No short displacement'); return null; }
    diag.displacementPass = true;
    score += 2;

    // FINAL SCORE
    if (score < cfg.scoreMin) { debugLog.push(`REJECT: Score ${score}`); return null; }

    // RISK
    const triggerPrice = low15 * (1 - 0.0012);
    const stopLoss     = Math.max(high15, svp5d!.poc, ceShort[lastIdx]!) * (1 + 0.0012);
    const stopDistance = Math.max(stopLoss - triggerPrice, triggerPrice * 0.0035);

    let qty      = (balance * activeMode.riskPct) / stopDistance;
    let sizeUSDT = qty * triggerPrice;
    if (sizeUSDT < 5.50) {
      debugLog.push(`NOTE: SHORT sizing raised to 5.50 USDT`);
      sizeUSDT = 5.50;
      qty = sizeUSDT / triggerPrice;
    }

    const takeProfit = triggerPrice - 1.5 * stopDistance;
    const netRR = (triggerPrice - takeProfit) / stopDistance;

    diag.entryPrice = triggerPrice.toFixed(5);
    diag.targetPrice = takeProfit.toFixed(5);
    diag.ceStopValue = stopLoss.toFixed(5);
    diag.netRR = netRR.toFixed(2);
    diag.score = score;

    return {
      kind: 'SNIPER', side: 'SHORT', score, reasons,
      entryPrice: triggerPrice, stopLoss, takeProfit, takeProfit2: triggerPrice - 2.5 * stopDistance,
      qty, sizeUSDT, atr15: atr, volRatio,
      entryType: 'CONTINUATION',
      zoneDistancePct: 0, btcRegimeAtEntry: 'UNKNOWN', entryTiming: 'OPTIMAL', debugLog
    };
  }
}
