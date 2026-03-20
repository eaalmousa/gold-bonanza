// ============================================
// Sniper Engine v3 — Precision Pullback Engine
// Updated: 2026-03-20
// Fix: Safe Minimum Notional Enforcement & Sizing Forensics
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
    debugLog.push('REJECT: CRASH regime');
    return null;
  }
  if (regime === 'CHOP' && modeKey !== 'AGGRESSIVE') {
    debugLog.push('REJECT: CHOP regime');
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
    debugLog.push('REJECT: Missing 1h indicators');
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
    diag.trend1H = 'NO_SLOPE';
    debugLog.push('REJECT: Weak ZLSMA slope');
    return null;
  }

  diag.side = side;
  diag.zlsmaValue = zlsmaNow.toFixed(5);
  diag.zlsmaSlopePct = zlsmaPctChange.toFixed(3);

  // BTC
  if (modeKey !== 'AGGRESSIVE' && btc4hTrend && !isBreakingDown) {
    if (side === 'LONG' && btc4hTrend === 'DOWN') { debugLog.push('REJECT: BTC 4H DOWN'); return null; }
    if (side === 'SHORT' && btc4hTrend === 'UP') { debugLog.push('REJECT: BTC 4H UP'); return null; }
  }

  // 15m
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
    debugLog.push('REJECT: Missing 15m data');
    return null;
  }

  const cfg    = activeMode.pullback;
  const slack  = cfg.valueZoneSlack;
  const range  = Math.max(1e-9, high15 - low15);
  const body   = Math.abs(close15 - open15);

  let score = 0;
  const reasons: string[] = [];

  // ===========================================================================
  //  CANONICAL SIZING ARCHITECTURE
  // ===========================================================================
  function calculateSafeSizing(
    side: 'LONG' | 'SHORT',
    entryPrice: number,
    stopLoss: number,
    balance: number,
    riskPct: number,
    debugLog: string[]
  ): { qty: number; sizeUSDT: number; intendedRisk: number; actualRisk: number } | null {
    const intendedRisk = balance * riskPct;
    const stopDistance = Math.abs(entryPrice - stopLoss);
    const minStopDist  = entryPrice * 0.0035; 
    const effectiveStopDist = Math.max(stopDistance, minStopDist);
    
    // 1. Raw Sizing
    let qty = intendedRisk / effectiveStopDist;
    let sizeUSDT = qty * entryPrice;
    
    const rawNotional = sizeUSDT;

    // 2. Minimum Notional Enforcement
    // Binance floor is 5.00 USDT. We target 5.50 USDT.
    const MIN_NOTIONAL = 5.50;
    const RISK_MULT_CAP = 2.0;

    if (sizeUSDT < MIN_NOTIONAL) {
      const adjQty = MIN_NOTIONAL / entryPrice;
      const adjRisk = adjQty * effectiveStopDist;
      const riskMultiplier = adjRisk / intendedRisk;

      if (riskMultiplier > RISK_MULT_CAP) {
        debugLog.push(`REJECT: Risk inflation safety cap triggered (${riskMultiplier.toFixed(2)}x > ${RISK_MULT_CAP}x) to meet 5.50 USDT notional.`);
        return null;
      }

      // Adjustment accepted
      qty = adjQty;
      sizeUSDT = MIN_NOTIONAL;
      debugLog.push(`NOTE: Sizing auto-raised. Multiplier: ${riskMultiplier.toFixed(2)}x. Forensics: IntendedRisk=${intendedRisk.toFixed(2)} RawSize=${rawNotional.toFixed(2)} → AdjSize=${MIN_NOTIONAL.toFixed(2)}`);
    }

    const actualRisk = qty * effectiveStopDist;

    // Verbose sizing forensics
    console.log(`[SIZING:${symbol}] side=${side} | intendedRisk=${intendedRisk.toFixed(2)} | rawNotional=${rawNotional.toFixed(2)} | adjNotional=${sizeUSDT.toFixed(2)} | actualRisk=${actualRisk.toFixed(2)}`);

    return { qty, sizeUSDT, intendedRisk, actualRisk };
  }

  if (side === 'LONG') {
    // LONG VALUE ZONE
    if (low15 > zl15! * (1 + slack)) { debugLog.push('REJECT: Above zone'); return null; }
    if (close15 < svp5d!.val) { debugLog.push('REJECT: Below VAL'); return null; }
    score += close15 > svp5d!.poc ? 4 : 2;

    // RSI
    if (rsiNow! < cfg.rsiMin || rsiNow! > cfg.rsiMax || rsiNow! <= rsiPrev!) { debugLog.push('REJECT: RSI'); return null; }
    score += 2;

    // VOLUME
    const volRatio = vol / volAvg!;
    if (volRatio < cfg.volMult) { debugLog.push('REJECT: Low vol'); return null; }
    score += 2;

    // ANATOMY
    const isBull = close15 > open15;
    const isStrong = (body / range) > 0.55 && (close15 - low15) / range > 0.70;
    const hasDisplacement = close15 > Math.max(prev.open, prev.close);

    if (!isBull || !isStrong) { debugLog.push('REJECT: Weak bull'); return null; }
    if (!hasDisplacement && modeKey !== 'AGGRESSIVE') { debugLog.push('REJECT: No displacement'); return null; }
    diag.displacementPass = true; score += 2;

    score += (regimeScoreBonus || 0);

    if (score < cfg.scoreMin) { debugLog.push('REJECT: Low score'); return null; }

    // CANONICAL SIZING CALL
    const triggerPrice = high15 * (1 + 0.0012);
    const stopLoss = Math.min(low15, svp5d!.poc, ceLong[lastIdx]!) * (1 - 0.0012);
    
    const sizing = calculateSafeSizing('LONG', triggerPrice, stopLoss, balance, activeMode.riskPct, debugLog);
    if (!sizing) return null;

    const takeProfit = triggerPrice + (triggerPrice - stopLoss) * 1.5;
    diag.entryPrice = triggerPrice.toFixed(5);
    diag.targetPrice = takeProfit.toFixed(5);
    diag.ceStopValue = stopLoss.toFixed(5);
    diag.score = score;
    diag.netRR = ((takeProfit - triggerPrice) / (triggerPrice - stopLoss)).toFixed(2);

    return {
      kind: 'SNIPER', side: 'LONG', score, reasons,
      entryPrice: triggerPrice, stopLoss, takeProfit, takeProfit2: takeProfit + (takeProfit - triggerPrice),
      qty: sizing.qty, sizeUSDT: sizing.sizeUSDT, atr15: atr, volRatio: vol / volAvg!,
      entryType: 'CONTINUATION', zoneDistancePct: 0, btcRegimeAtEntry: 'UNKNOWN', entryTiming: 'OPTIMAL', debugLog
    };

  } else {
    // SHORT BRANCH
    if (high15 < zl15! * (1 - slack) && !isBreakingDown) { debugLog.push('REJECT: Below zone'); return null; }
    if (close15 > svp5d!.vah) { debugLog.push('REJECT: Above VAH'); return null; }
    score += close15 < svp5d!.poc ? 4 : 2;

    // RSI
    if (rsiNow! > (100 - cfg.rsiMin) || rsiNow! >= rsiPrev!) { debugLog.push('REJECT: RSI Short'); return null; }
    score += 2;

    // VOLUME
    const volRatio = vol / volAvg!;
    if (volRatio < cfg.volMult) { debugLog.push('REJECT: Low vol short'); return null; }
    score += 2;

    // ANATOMY
    const isBear = close15 < open15;
    const isStrongBear = (body / range) > 0.55 && (high15 - close15) / range > 0.70;
    const hasDisplaceShort = close15 < Math.min(prev.open, prev.close);

    if (!isBear || !isStrongBear) { debugLog.push('REJECT: Weak bear'); return null; }
    if (!hasDisplaceShort && modeKey !== 'AGGRESSIVE') { debugLog.push('REJECT: No short displacement'); return null; }
    diag.displacementPass = true; score += 2;

    score += (regimeScoreBonus || 0);

    if (score < cfg.scoreMin) { debugLog.push('REJECT: Low score short'); return null; }

    // CANONICAL SIZING CALL
    const triggerPrice = low15 * (1 - 0.0012);
    const stopLoss = Math.max(high15, svp5d!.poc, ceShort[lastIdx]!) * (1 + 0.0012);

    const sizing = calculateSafeSizing('SHORT', triggerPrice, stopLoss, balance, activeMode.riskPct, debugLog);
    if (!sizing) return null;

    const takeProfit = triggerPrice - (stopLoss - triggerPrice) * 1.5;
    diag.entryPrice = triggerPrice.toFixed(5);
    diag.targetPrice = takeProfit.toFixed(5);
    diag.ceStopValue = stopLoss.toFixed(5);
    diag.score = score;
    diag.netRR = ((triggerPrice - takeProfit) / (stopLoss - triggerPrice)).toFixed(2);

    return {
      kind: 'SNIPER', side: 'SHORT', score, reasons,
      entryPrice: triggerPrice, stopLoss, takeProfit, takeProfit2: takeProfit - (triggerPrice - takeProfit),
      qty: sizing.qty, sizeUSDT: sizing.sizeUSDT, atr15: atr, volRatio: vol / volAvg!,
      entryType: 'CONTINUATION', zoneDistancePct: 0, btcRegimeAtEntry: 'UNKNOWN', entryTiming: 'OPTIMAL', debugLog
    };
  }
}
