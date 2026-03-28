// ============================================
// Strategy Registry — Gold Bonanza
//
// Central plugin-style architecture:
//  - StrategyEngine interface that all strategies implement
//  - StrategySignal normalized output schema
//  - StrategyRegistry singleton for registration/evaluation
//  - Regime Gate for BTC directional permission
//  - Signal classification and compatibility bridge
//
// IMPORTANT: This layer does NOT touch execution,
// exit, or trade management. It only produces
// normalized signals for the existing pipeline.
// ============================================

import type { Signal, MarketRegime, ModeConfig } from '../types/trading';
import type { StrategyContext } from './strategyContext';

// ─── STRATEGY CATEGORIES ──────────────────────────────────────────────────────

export type StrategyCategory =
  | 'PULLBACK'
  | 'BREAKOUT'
  | 'SWEEP'
  | 'TREND'
  | 'REVERSAL'
  | 'MOMENTUM'
  | 'MICROSTRUCTURE';

// ─── STRATEGY PRESETS ─────────────────────────────────────────────────────────

export interface StrategyPreset {
  id: string;
  name: string;
  description: string;
  strategyIds: string[];
}

export const STRATEGY_PRESETS: StrategyPreset[] = [
  {
    id: 'ALL',
    name: 'All Strategies',
    description: 'Every registered strategy active',
    strategyIds: [] // Special: empty means ALL
  },
  {
    id: 'TREND_PACK',
    name: 'Trend Pack',
    description: 'Pullback + trend continuation setups',
    strategyIds: ['institutional_sniper', 'trend_continuation']
  },
  {
    id: 'BREAKOUT_PACK',
    name: 'Breakout Pack',
    description: 'Breakout + sweep reclaim setups',
    strategyIds: ['super_sniper_breakout', 'sweep_reclaim']
  },
  {
    id: 'SMART_MONEY_PACK',
    name: 'Smart Money Pack',
    description: 'Sweep reclaim + institutional sniper',
    strategyIds: ['institutional_sniper', 'sweep_reclaim']
  },
  {
    id: 'CUSTOM',
    name: 'Custom',
    description: 'Manual strategy selection',
    strategyIds: []
  }
];

// ─── NORMALIZED SIGNAL SCHEMA ─────────────────────────────────────────────────

export interface StrategySignal {
  // Identity
  strategyId:   string;
  strategyName: string;
  kind:         'SNIPER' | 'SUPER_SNIPER' | 'BREAKOUT' | 'SWEEP' | 'TREND' | 'PREDICTIVE';
  setupType:    string;  // e.g. 'PULLBACK_REVERSAL', 'SWEEP_RECLAIM', 'EMA_CONTINUATION'

  // Core trade parameters
  symbol:      string;
  side:        'LONG' | 'SHORT';
  entryPrice:  number;
  stopLoss:    number;
  takeProfit:  number;
  takeProfit2?: number;
  qty:         number;
  sizeUSDT:    number;

  // Scoring
  score:       number;
  confidence:  'LOW' | 'MEDIUM' | 'HIGH' | 'ULTRA';
  reasons:     string[];

  // Classification
  regimeAlignment: 'ALIGNED' | 'COUNTER_REGIME_OVERRIDE' | 'NEUTRAL';
  executionClass:  'WATCHLIST' | 'SNIPER' | 'SUPER_SNIPER' | 'EXECUTABLE';

  // Metadata
  atr15:            number;
  volRatio:         number;
  entryType?:       string;
  entryTiming?:     'EARLY' | 'OPTIMAL' | 'LATE';
  btcRegimeAtEntry?: string;
  tags:             string[];
  debugLog:         string[];
  breakLevel?:      number;
}

// ─── STRATEGY ENGINE INTERFACE ────────────────────────────────────────────────

export interface StrategyEngine {
  readonly id:          string;
  readonly name:        string;
  readonly category:    StrategyCategory;
  readonly description: string;
  readonly supportedSides: ('LONG' | 'SHORT')[];
  readonly defaultEnabled: boolean;

  /** If true, this strategy can request BTC regime bypass for high-confidence setups */
  readonly canOverrideBtcRegime: boolean;

  /** Minimum score required to bypass BTC directional restriction */
  readonly regimeOverrideMinScore: number;

  /**
   * Main evaluation entry point.
   * Returns a normalized StrategySignal or null if no setup found.
   * Must NOT perform execution, exit, or side-effect logic.
   */
  evaluate(ctx: StrategyContext): StrategySignal | null;
}

// ─── BTC REGIME GATE ──────────────────────────────────────────────────────────

export interface RegimeGateResult {
  regime:            MarketRegime;
  btc4hTrend:        'UP' | 'DOWN' | 'RANGING';
  allowedSides:      ('LONG' | 'SHORT')[];
  strictness:        'NORMAL' | 'ELEVATED' | 'MAXIMUM';
  overrideAllowed:   boolean;
  overrideMinScore:  number;
  reason:            string;
}

/**
 * Evaluates BTC macro regime to determine directional permissions.
 * This is the GLOBAL filter — sits above all strategy logic.
 */
export function evaluateRegimeGate(
  regime: MarketRegime,
  btc4hTrend: 'UP' | 'DOWN' | 'RANGING',
  btcRsi?: number,
  modeKey: string = 'BALANCED'
): RegimeGateResult {
  // ── CRASH: Block everything, no overrides ──
  if (regime === 'CRASH') {
    return {
      regime, btc4hTrend,
      allowedSides: [],
      strictness: 'MAXIMUM',
      overrideAllowed: false,
      overrideMinScore: 999,
      reason: 'BTC CRASH — all entries blocked, no overrides'
    };
  }

  // Mode-aware override score thresholds
  const overrideScoreByMode: Record<string, number> = {
    CONSERVATIVE: 16,
    BALANCED: 14,
    AGGRESSIVE: 11
  };
  const baseOverrideScore = overrideScoreByMode[modeKey] || 14;

  // ── CHOP: Both sides allowed but elevated thresholds ──
  if (regime === 'CHOP') {
    return {
      regime, btc4hTrend,
      allowedSides: ['LONG', 'SHORT'],
      strictness: 'ELEVATED',
      overrideAllowed: true,
      overrideMinScore: baseOverrideScore,
      reason: 'BTC CHOP — both sides allowed with elevated thresholds'
    };
  }

  // ── Directional gating based on BTC 4H trend ──
  if (btc4hTrend === 'UP') {
    return {
      regime, btc4hTrend,
      allowedSides: ['LONG'],
      strictness: 'NORMAL',
      overrideAllowed: true,
      overrideMinScore: baseOverrideScore,
      reason: 'BTC 4H bullish — LONG favored, SHORT requires override'
    };
  }

  if (btc4hTrend === 'DOWN') {
    return {
      regime, btc4hTrend,
      allowedSides: ['SHORT'],
      strictness: regime === 'TRENDING_DOWN' ? 'ELEVATED' : 'NORMAL',
      overrideAllowed: true,
      overrideMinScore: baseOverrideScore + (regime === 'TRENDING_DOWN' ? 2 : 0),
      reason: 'BTC 4H bearish — SHORT favored, LONG requires override'
    };
  }

  // ── RANGING: Both sides, slightly elevated ──
  return {
    regime, btc4hTrend,
    allowedSides: ['LONG', 'SHORT'],
    strictness: 'ELEVATED',
    overrideAllowed: true,
    overrideMinScore: baseOverrideScore,
    reason: 'BTC 4H ranging — both sides allowed, elevated scrutiny'
  };
}

// ─── SIGNAL CLASSIFICATION ────────────────────────────────────────────────────

function classifyConfidence(score: number): 'LOW' | 'MEDIUM' | 'HIGH' | 'ULTRA' {
  if (score >= 16) return 'ULTRA';
  if (score >= 12) return 'HIGH';
  if (score >= 8)  return 'MEDIUM';
  return 'LOW';
}

function classifyExecutionClass(
  signal: StrategySignal,
  regimeGate: RegimeGateResult
): 'WATCHLIST' | 'SNIPER' | 'SUPER_SNIPER' | 'EXECUTABLE' {
  // Blocked by regime = watchlist only
  if (!regimeGate.allowedSides.includes(signal.side) && signal.regimeAlignment !== 'COUNTER_REGIME_OVERRIDE') {
    return 'WATCHLIST';
  }

  if (signal.confidence === 'ULTRA') return 'SUPER_SNIPER';
  if (signal.confidence === 'HIGH')  return 'SNIPER';
  if (signal.confidence === 'MEDIUM') return 'EXECUTABLE';
  return 'WATCHLIST';
}

// ─── REGIME ALIGNMENT CHECK ───────────────────────────────────────────────────

function checkRegimeAlignment(
  signal: StrategySignal,
  strategy: StrategyEngine,
  regimeGate: RegimeGateResult
): 'ALIGNED' | 'COUNTER_REGIME_OVERRIDE' | 'NEUTRAL' {
  // Side is allowed — aligned
  if (regimeGate.allowedSides.includes(signal.side)) {
    return 'ALIGNED';
  }

  // Side is not allowed — can this strategy override?
  if (strategy.canOverrideBtcRegime && 
      regimeGate.overrideAllowed && 
      signal.score >= regimeGate.overrideMinScore) {
    return 'COUNTER_REGIME_OVERRIDE';
  }

  // Not aligned, can't override — will be filtered to WATCHLIST
  return 'NEUTRAL';
}

// ─── COMPATIBILITY BRIDGE: StrategySignal → existing Signal type ──────────────
/**
 * Converts a StrategySignal into the existing Signal interface
 * so the pipeline, cards, deployment, and execution layers work
 * with ZERO changes.
 */
export function toCompatibleSignal(ss: StrategySignal): Signal {
  return {
    kind: ss.kind === 'TREND' || ss.kind === 'SWEEP' ? 'SNIPER' : ss.kind as Signal['kind'],
    side: ss.side,
    score: ss.score,
    reasons: ss.reasons,
    entryPrice: ss.entryPrice,
    stopLoss: ss.stopLoss,
    takeProfit: ss.takeProfit,
    takeProfit2: ss.takeProfit2,
    qty: ss.qty,
    sizeUSDT: ss.sizeUSDT,
    atr15: ss.atr15,
    volRatio: ss.volRatio,
    entryType: ss.entryType as Signal['entryType'],
    entryTiming: ss.entryTiming,
    btcRegimeAtEntry: ss.btcRegimeAtEntry,
    zoneDistancePct: 0,
    debugLog: ss.debugLog,
    breakLevel: ss.breakLevel,
    entryModel: `${ss.strategyId}:${ss.setupType}`,
    entryHint: `[${ss.regimeAlignment}] ${ss.confidence} via ${ss.strategyName}`
  };
}

// ─── STRATEGY REGISTRY ────────────────────────────────────────────────────────

export class StrategyRegistry {
  private strategies: Map<string, StrategyEngine> = new Map();

  register(engine: StrategyEngine): void {
    if (this.strategies.has(engine.id)) {
      console.warn(`[StrategyRegistry] Overwriting existing strategy: ${engine.id}`);
    }
    this.strategies.set(engine.id, engine);
    console.log(`[StrategyRegistry] Registered: ${engine.name} (${engine.id}) [${engine.category}]`);
  }

  unregister(id: string): void {
    this.strategies.delete(id);
  }

  getAll(): StrategyEngine[] {
    return Array.from(this.strategies.values());
  }

  getById(id: string): StrategyEngine | undefined {
    return this.strategies.get(id);
  }

  getEnabled(enabledIds: string[]): StrategyEngine[] {
    // Empty list = ALL enabled (for 'ALL' preset)
    if (enabledIds.length === 0) return this.getAll();
    return enabledIds
      .map(id => this.strategies.get(id))
      .filter((e): e is StrategyEngine => e !== undefined);
  }

  /**
   * Run all enabled strategies against a symbol's context.
   * Applies BTC regime gate + signal classification.
   * Returns normalized, classified signals.
   */
  evaluateAll(
    ctx: StrategyContext,
    enabledIds: string[],
    regimeGate: RegimeGateResult
  ): StrategySignal[] {
    const strategies = this.getEnabled(enabledIds);
    const results: StrategySignal[] = [];

    for (const strategy of strategies) {
      try {
        const raw = strategy.evaluate(ctx);
        if (!raw) continue;

        // 1. Classify regime alignment
        raw.regimeAlignment = checkRegimeAlignment(raw, strategy, regimeGate);

        // 2. Classify confidence
        raw.confidence = classifyConfidence(raw.score);

        // 3. Classify execution class
        raw.executionClass = classifyExecutionClass(raw, regimeGate);

        // 4. Tag regime metadata
        if (raw.regimeAlignment === 'COUNTER_REGIME_OVERRIDE') {
          raw.tags.push('COUNTER_REGIME_OVERRIDE');
          raw.debugLog.push(
            `[REGIME_OVERRIDE] Bypassed BTC gate (score=${raw.score} ≥ ${regimeGate.overrideMinScore}) — ${regimeGate.reason}`
          );
        }

        // 5. Filter: WATCHLIST / NEUTRAL signals that can't override are still emitted
        //    but tagged so the pipeline can decide what to do
        results.push(raw);

      } catch (err: any) {
        console.error(`[StrategyRegistry] ${strategy.id} threw: ${err.message}`);
      }
    }

    return results;
  }
}

// ─── SINGLETON INSTANCE ───────────────────────────────────────────────────────

export const globalRegistry = new StrategyRegistry();
