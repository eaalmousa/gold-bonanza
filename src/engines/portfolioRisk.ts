// ============================================
// Portfolio Risk Manager — Gold Bonanza
// Controls exposure concentration:
//  - Max N positions in same direction
//  - Correlated alt group buckets (max 2 per group)
//  - BTC regime-based long throttling
//  - "Same wave" protection (no 2 longs opened in same scan cycle)
// ============================================

import type { MarketRegime } from '../types/trading';

// ─── CORRELATION GROUPS ────────────────────────────────────────────────
// Assets in the same group move together. Max 2 in any one group.
// Derived from real historical BTC correlation coefficients (>0.80)

export const CORRELATION_GROUPS: Record<string, string[]> = {
  // Large caps — all move with BTC
  BTC_MAJORS:    ['BTCUSDT', 'ETHUSDT', 'BNBUSDT'],

  // ETH ecosystem: all follow ETH closely
  ETH_LAYER2:    ['ARBUSDT', 'OPUSDT', 'MATICUSDT', 'IMXUSDT', 'LRCUSDT', 'STXUSDT'],

  // Solana cluster
  SOL_CLUSTER:   ['SOLUSDT', 'RAYUSDT', 'JITOUSDT', 'BONKUSDT'],

  // Layer 1 alts
  LAYER1_ALTS:   ['AVAXUSDT', 'NEARUSDT', 'APTUSDT', 'SEIUSDT', 'SUIUSDT', 'INJUSDT', 'TONUSDT'],

  // DeFi bluechips
  DEFI_BLUE:     ['AAVEUSDT', 'UNIUSDT', 'CRVUSDT', 'MKRUSDT', 'SNXUSDT', 'COMPUSDT', 'BALUSDT'],

  // AI/Compute narrative
  AI_COMPUTE:    ['FETUSDT', 'AGIXUSDT', 'RNDRUSDT', 'OCEAANUSDT', 'GRTUSDT'],

  // Meme tier
  MEME_COINS:    ['DOGEUSDT', 'SHIBUSDT', 'PEPEUSDT', 'FLOKIUSDT', 'BONKUSDT'],

  // Oracle + infrastructure
  INFRA:         ['LINKUSDT', 'BANDUSDT', 'APIUSDT', 'PYTH'],

  // Gaming / metaverse
  GAMING_META:   ['AXSUSDT', 'SANDUSDT', 'MANAUSDT', 'GALAUSDT', 'ENJUSDT'],

  // XRP cluster (payment tokens)
  PAYMENT:       ['XRPUSDT', 'XLMUSDT', 'ALGOUSDT', 'XMRUSDT'],

  // Mid-cap alts (grouped by typical volatility regime)
  MID_ALTS_A:    ['LDOUSDT', 'BLURUSDT', 'GMXUSDT', '1INCHUSDT', 'ENSUSDT'],
  MID_ALTS_B:    ['RUNEUSDT', 'KAVAUSDT', 'ATOMUSDT', 'EGLDUSDT', 'QNTUSDT'],
};

// Max simultaneous open positions within a single correlation group
// Set to 2 to avoid doubling correlated risk
const MAX_PER_GROUP = 2;

// Max same-direction positions during weak/down BTC
const MAX_LONGS_IN_WEAK_BTC     = 3;  // During RANGING or early TRENDING_DOWN
const MAX_LONGS_IN_DOWNTREND    = 1;  // During confirmed TRENDING_DOWN
const MAX_LONGS_IN_CHOP         = 2;  // During CHOP

// Max total same-direction positions at any time
const MAX_SAME_DIRECTION_TOTAL  = 6;

// ─── HELPER: Find which group a symbol belongs to ───────────────────────
export function getCorrelationGroup(symbol: string): string | null {
  for (const [group, symbols] of Object.entries(CORRELATION_GROUPS)) {
    if (symbols.includes(symbol.toUpperCase())) return group;
  }
  return null;
}

// ─── ACTIVE POSITION SNAPSHOT ─────────────────────────────────────────
export interface PortfolioSnapshot {
  openPositions: Array<{
    symbol: string;
    side: 'LONG' | 'SHORT';
    entryTime: number;
  }>;
  currentScanCycleStart: number; // timestamp when current scan started
}

// ─── EXPOSURE CHECK RESULT ─────────────────────────────────────────────
export interface ExposureCheckResult {
  allowed: boolean;
  reason: string;
  groupCount?: number;
  sameDirectionCount?: number;
}

/**
 * Main portfolio exposure check.
 * Call this before allowing a new signal to be executed.
 *
 * @param symbol      - Symbol we want to enter
 * @param side        - 'LONG' | 'SHORT'
 * @param regime      - Current BTC market regime
 * @param btc4hTrend  - BTC 4H trend direction
 * @param portfolio   - Current open positions snapshot
 * @param signalsThisCycle - Symbols already signaled in THIS scan cycle (same-wave filter)
 */
export function checkPortfolioExposure(
  symbol: string,
  side: 'LONG' | 'SHORT',
  regime: MarketRegime,
  btc4hTrend: 'UP' | 'DOWN' | 'RANGING',
  portfolio: PortfolioSnapshot,
  signalsThisCycle: Set<string>
): ExposureCheckResult {

  const open = portfolio.openPositions;

  // ─── 1. SAME-DIRECTION TOTAL CAP ─────────────────────────────────
  const sameDirectionCount = open.filter(p => p.side === side).length;
  if (sameDirectionCount >= MAX_SAME_DIRECTION_TOTAL) {
    return {
      allowed: false,
      reason: `Max ${MAX_SAME_DIRECTION_TOTAL} ${side} positions reached (currently ${sameDirectionCount})`,
      sameDirectionCount
    };
  }

  // ─── 2. BTC REGIME-BASED LONG THROTTLING ─────────────────────────
  if (side === 'LONG') {
    const longCount = sameDirectionCount; // already filtered above

    if (regime === 'CRASH') {
      return {
        allowed: false,
        reason: `BTC CRASH — all new LONG entries blocked`,
        sameDirectionCount
      };
    }

    if (regime === 'CHOP' && longCount >= MAX_LONGS_IN_CHOP) {
      return {
        allowed: false,
        reason: `BTC CHOP regime — max ${MAX_LONGS_IN_CHOP} LONGs allowed, have ${longCount}`,
        sameDirectionCount
      };
    }

    if (regime === 'TRENDING_DOWN' && btc4hTrend === 'DOWN') {
      if (longCount >= MAX_LONGS_IN_DOWNTREND) {
        return {
          allowed: false,
          reason: `BTC confirmed downtrend — only ${MAX_LONGS_IN_DOWNTREND} LONG allowed, have ${longCount}`,
          sameDirectionCount
        };
      }
    }

    if ((regime === 'RANGING' || regime === 'TRENDING_DOWN') && btc4hTrend !== 'UP') {
      if (longCount >= MAX_LONGS_IN_WEAK_BTC) {
        return {
          allowed: false,
          reason: `Weak BTC (${regime}/${btc4hTrend}) — max ${MAX_LONGS_IN_WEAK_BTC} LONGs, have ${longCount}`,
          sameDirectionCount
        };
      }
    }
  }

  // ─── 3. CORRELATION GROUP CAP ─────────────────────────────────────
  const group = getCorrelationGroup(symbol);
  if (group) {
    const groupSymbols  = CORRELATION_GROUPS[group];
    const groupCount    = open.filter(p =>
      p.side === side && groupSymbols.includes(p.symbol.toUpperCase())
    ).length;

    if (groupCount >= MAX_PER_GROUP) {
      return {
        allowed: false,
        reason: `Correlation group "${group}" already has ${groupCount} ${side} positions (max ${MAX_PER_GROUP})`,
        groupCount
      };
    }
  }

  // ─── 4. SAME-WAVE FILTER (no 2 longs in same scan cycle) ─────────
  // Prevents opening ETHUSDT long and ARBUSDT long in the same scan
  // since they will behave identically and double up on the same move.
  if (side === 'LONG' && signalsThisCycle.size > 0) {
    // Check if any signal this cycle is in the same correlation group
    if (group) {
      const groupSymbols = CORRELATION_GROUPS[group];
      const alreadyInGroup = [...signalsThisCycle].some(s =>
        groupSymbols.includes(s.toUpperCase()) && s.toUpperCase() !== symbol.toUpperCase()
      );
      if (alreadyInGroup) {
        return {
          allowed: false,
          reason: `Same-wave filter: correlated ${group} signal already queued this cycle`
        };
      }
    }
  }

  return {
    allowed: true,
    reason: `Exposure check passed (${sameDirectionCount} ${side} open, group: ${group ?? 'uncorrelated'})`,
    sameDirectionCount,
    groupCount: group ? open.filter(p => p.side === side && CORRELATION_GROUPS[group].includes(p.symbol)).length : 0
  };
}

/**
 * Summarize current portfolio concentration.
 * Useful for logging and the debug panel.
 */
export function getPortfolioConcentrationReport(portfolio: PortfolioSnapshot): string[] {
  const lines: string[] = [];
  const open = portfolio.openPositions;

  const longCount  = open.filter(p => p.side === 'LONG').length;
  const shortCount = open.filter(p => p.side === 'SHORT').length;
  lines.push(`Open: ${open.length} total (${longCount} LONG, ${shortCount} SHORT)`);

  // Group concentration
  for (const [group, symbols] of Object.entries(CORRELATION_GROUPS)) {
    const groupOpen = open.filter(p => symbols.includes(p.symbol.toUpperCase()));
    if (groupOpen.length >= 1) {
      lines.push(`  ${group}: ${groupOpen.map(p => `${p.symbol}(${p.side})`).join(', ')}`);
    }
  }

  return lines;
}
