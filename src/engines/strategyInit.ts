// ============================================
// Strategy Initialization — Gold Bonanza
//
// Registers all available strategies with the
// global registry. Import this module to ensure
// all strategies are available.
// ============================================

import { globalRegistry } from './strategyRegistry';
import { sniperStrategy } from './strategies/sniperStrategy';
import { breakoutStrategy } from './strategies/breakoutStrategy';
import { sweepReclaimStrategy } from './strategies/sweepReclaimStrategy';
import { trendContinuationStrategy } from './strategies/trendContinuationStrategy';

let initialized = false;

export function initializeStrategies(): void {
  if (initialized) return;

  globalRegistry.register(sniperStrategy);
  globalRegistry.register(breakoutStrategy);
  globalRegistry.register(sweepReclaimStrategy);
  globalRegistry.register(trendContinuationStrategy);

  initialized = true;
  console.log(`[StrategyInit] ${globalRegistry.getAll().length} strategies registered`);
}

/** Get all registered strategy metadata for UI */
export function getStrategyManifest() {
  return globalRegistry.getAll().map(s => ({
    id:            s.id,
    name:          s.name,
    category:      s.category,
    description:   s.description,
    supportedSides: s.supportedSides,
    defaultEnabled: s.defaultEnabled,
    canOverrideBtcRegime: s.canOverrideBtcRegime,
  }));
}

/** Default enabled strategy IDs */
export function getDefaultEnabledIds(): string[] {
  return globalRegistry.getAll()
    .filter(s => s.defaultEnabled)
    .map(s => s.id);
}
