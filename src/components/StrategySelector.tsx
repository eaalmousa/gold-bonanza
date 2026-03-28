// ============================================
// Strategy Selector — Gold Bonanza
//
// Compact, premium UI for selecting trading
// strategies. Supports presets, individual
// strategy toggling, and inline description
// panel powered by registry metadata.
// ============================================

import { useState } from 'react';
import { useTradingStore } from '../store/tradingStore';
import { getStrategyManifest } from '../engines/strategyInit';
import { STRATEGY_PRESETS } from '../engines/strategyRegistry';
import { Layers, ChevronDown, ChevronUp, Zap, Target, TrendingUp, Crosshair, BookOpen } from 'lucide-react';
import StrategyDescription from './StrategyDescription';

const CATEGORY_ICONS: Record<string, any> = {
  PULLBACK: Target,
  BREAKOUT: Zap,
  SWEEP: Crosshair,
  TREND: TrendingUp,
};

const CATEGORY_COLORS: Record<string, string> = {
  PULLBACK: '#22d3ee',
  BREAKOUT: '#f59e0b',
  SWEEP: '#a78bfa',
  TREND: '#34d399',
};

export default function StrategySelector() {
  const {
    enabledStrategies, strategyPreset,
    setEnabledStrategies, setStrategyPreset
  } = useTradingStore();

  const [expanded, setExpanded] = useState(false);
  const [viewingDescId, setViewingDescId] = useState<string | null>(null);
  const manifest = getStrategyManifest();

  // Determine which strategies are currently enabled
  const isAllEnabled = enabledStrategies.length === 0;
  const isEnabled = (id: string) => isAllEnabled || enabledStrategies.includes(id);

  const handlePresetChange = (presetId: string) => {
    const preset = STRATEGY_PRESETS.find(p => p.id === presetId);
    if (!preset) return;
    setStrategyPreset(presetId);
    // Empty array = ALL
    setEnabledStrategies(presetId === 'ALL' ? [] : preset.strategyIds);
  };

  const handleToggleStrategy = (id: string) => {
    let current = isAllEnabled ? manifest.map(s => s.id) : [...enabledStrategies];
    if (current.includes(id)) {
      current = current.filter(s => s !== id);
      if (current.length === 0) current = manifest.map(s => s.id); // prevent all-off
    } else {
      current.push(id);
    }
    // Check if all are enabled → collapse to empty (= ALL)
    const allIds = manifest.map(s => s.id);
    const allEnabled = allIds.every(sid => current.includes(sid));
    setEnabledStrategies(allEnabled ? [] : current);
    setStrategyPreset(allEnabled ? 'ALL' : 'CUSTOM');
  };

  const enabledCount = isAllEnabled ? manifest.length : enabledStrategies.length;

  return (
    <div style={{
      borderRadius: 'var(--radius-lg)',
      background: 'rgba(13,17,23,0.7)',
      border: '1px solid rgba(201,176,119,0.12)',
      overflow: 'hidden'
    }}>
      {/* ── Header Bar ── */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 20px',
          cursor: 'pointer',
          userSelect: 'none',
          transition: 'background 0.15s',
          background: expanded ? 'rgba(201,176,119,0.04)' : 'transparent'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Layers size={15} color="var(--gold)" />
          <span style={{
            fontSize: 10, fontWeight: 800, letterSpacing: '0.2em',
            color: 'var(--gold)', textTransform: 'uppercase'
          }}>
            STRATEGY ENGINE
          </span>
          <span style={{
            fontSize: 9, fontWeight: 700,
            padding: '3px 10px',
            borderRadius: 'var(--radius-full)',
            background: 'rgba(201,176,119,0.1)',
            color: 'var(--gold)',
            letterSpacing: '0.1em'
          }}>
            {enabledCount}/{manifest.length} ACTIVE
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Current preset badge */}
          <span style={{
            fontSize: 9, fontWeight: 800,
            padding: '3px 10px',
            borderRadius: 'var(--radius-full)',
            background: strategyPreset === 'ALL' ? 'rgba(52,211,153,0.1)' : 'rgba(245,158,11,0.1)',
            color: strategyPreset === 'ALL' ? '#34d399' : '#f59e0b',
            border: `1px solid ${strategyPreset === 'ALL' ? 'rgba(52,211,153,0.2)' : 'rgba(245,158,11,0.2)'}`,
            letterSpacing: '0.15em'
          }}>
            {STRATEGY_PRESETS.find(p => p.id === strategyPreset)?.name || 'Custom'}
          </span>
          {expanded ? <ChevronUp size={14} color="var(--text-muted)" /> : <ChevronDown size={14} color="var(--text-muted)" />}
        </div>
      </div>

      {/* ── Expandable Content ── */}
      {expanded && (
        <div style={{ padding: '0 20px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* ── Preset Selector ── */}
          <div>
            <div style={{
              fontSize: 9, fontWeight: 700, color: 'var(--text-muted)',
              letterSpacing: '0.15em', marginBottom: 8
            }}>
              PRESETS
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {STRATEGY_PRESETS.filter(p => p.id !== 'CUSTOM').map(preset => (
                <button
                  key={preset.id}
                  onClick={() => handlePresetChange(preset.id)}
                  style={{
                    padding: '6px 14px',
                    borderRadius: 'var(--radius-full)',
                    fontSize: 9, fontWeight: 800,
                    letterSpacing: '0.1em',
                    border: `1px solid ${strategyPreset === preset.id ? 'rgba(201,176,119,0.4)' : 'rgba(255,255,255,0.06)'}`,
                    background: strategyPreset === preset.id ? 'rgba(201,176,119,0.12)' : 'rgba(255,255,255,0.02)',
                    color: strategyPreset === preset.id ? 'var(--gold)' : 'var(--text-muted)',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                >
                  {preset.name}
                </button>
              ))}
            </div>
          </div>

          {/* ── Individual Strategy Cards ── */}
          <div>
            <div style={{
              fontSize: 9, fontWeight: 700, color: 'var(--text-muted)',
              letterSpacing: '0.15em', marginBottom: 8
            }}>
              STRATEGIES
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {manifest.map(strategy => {
                const active = isEnabled(strategy.id);
                const IconComp = CATEGORY_ICONS[strategy.category] || Layers;
                const catColor = CATEGORY_COLORS[strategy.category] || '#94a3b8';

                return (
                  <div key={strategy.id}>
                    <div
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '10px 14px',
                        borderRadius: viewingDescId === strategy.id ? 'var(--radius-md) var(--radius-md) 0 0' : 'var(--radius-md)',
                        border: `1px solid ${active ? catColor + '30' : 'rgba(255,255,255,0.04)'}`,
                        borderBottom: viewingDescId === strategy.id ? 'none' : undefined,
                        background: active ? catColor + '08' : 'rgba(255,255,255,0.01)',
                        transition: 'all 0.2s',
                        opacity: active ? 1 : 0.5
                      }}
                    >
                      {/* Toggle area */}
                      <div
                        onClick={() => handleToggleStrategy(strategy.id)}
                        style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, cursor: 'pointer', minWidth: 0 }}
                      >
                        {/* Status indicator */}
                        <div style={{
                          width: 8, height: 8, borderRadius: '50%',
                          background: active ? catColor : 'rgba(255,255,255,0.15)',
                          boxShadow: active ? `0 0 8px ${catColor}40` : 'none',
                          flexShrink: 0,
                          transition: 'all 0.3s'
                        }} />

                        {/* Icon */}
                        <IconComp size={14} color={active ? catColor : 'var(--text-muted)'} />

                        {/* Info */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{
                            display: 'flex', alignItems: 'center', gap: 8
                          }}>
                            <span style={{
                              fontSize: 11, fontWeight: 700,
                              color: active ? 'var(--text-primary)' : 'var(--text-muted)'
                            }}>
                              {strategy.name}
                            </span>
                            <span style={{
                              fontSize: 8, fontWeight: 700,
                              padding: '2px 6px',
                              borderRadius: 'var(--radius-full)',
                              background: catColor + '15',
                              color: catColor,
                              letterSpacing: '0.1em'
                            }}>
                              {strategy.category}
                            </span>
                            {strategy.canOverrideBtcRegime && (
                              <span style={{
                                fontSize: 7, fontWeight: 800,
                                padding: '2px 5px',
                                borderRadius: 'var(--radius-full)',
                                background: 'rgba(245,158,11,0.1)',
                                color: '#f59e0b',
                                letterSpacing: '0.1em'
                              }}>
                                REGIME OVERRIDE
                              </span>
                            )}
                          </div>
                          <div style={{
                            fontSize: 9, color: 'var(--text-muted)',
                            marginTop: 2, lineHeight: 1.3,
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                          }}>
                            {strategy.description}
                          </div>
                        </div>
                      </div>

                      {/* Sides */}
                      <div style={{ display: 'flex', gap: 4 }}>
                        {strategy.supportedSides.map(s => (
                          <span key={s} style={{
                            fontSize: 7, fontWeight: 800,
                            padding: '2px 5px',
                            borderRadius: 'var(--radius-full)',
                            background: s === 'LONG' ? 'rgba(52,211,153,0.1)' : 'rgba(244,63,94,0.1)',
                            color: s === 'LONG' ? '#34d399' : '#f43f5e'
                          }}>
                            {s}
                          </span>
                        ))}
                      </div>

                      {/* Info button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setViewingDescId(viewingDescId === strategy.id ? null : strategy.id);
                        }}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          width: 26, height: 26, borderRadius: 'var(--radius-full)',
                          background: viewingDescId === strategy.id ? 'rgba(201,176,119,0.15)' : 'rgba(255,255,255,0.03)',
                          border: `1px solid ${viewingDescId === strategy.id ? 'rgba(201,176,119,0.3)' : 'rgba(255,255,255,0.06)'}`,
                          color: viewingDescId === strategy.id ? 'var(--gold)' : 'var(--text-muted)',
                          cursor: 'pointer', transition: 'all 0.2s', flexShrink: 0
                        }}
                        title="View strategy details"
                      >
                        <BookOpen size={11} />
                      </button>
                    </div>

                    {/* Inline Description Panel */}
                    {viewingDescId === strategy.id && strategy.metadata && (
                      <div style={{
                        borderRadius: '0 0 var(--radius-md) var(--radius-md)',
                        border: `1px solid ${catColor}30`,
                        borderTop: `1px solid ${catColor}15`,
                        overflow: 'hidden'
                      }}>
                        <StrategyDescription
                          name={strategy.name}
                          category={strategy.category}
                          description={strategy.description}
                          canOverrideBtcRegime={strategy.canOverrideBtcRegime}
                          metadata={strategy.metadata}
                          onClose={() => setViewingDescId(null)}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
