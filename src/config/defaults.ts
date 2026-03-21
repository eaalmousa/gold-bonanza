// ============================================================
// CANONICAL CONFIG DEFAULTS — Single source of truth
// Both the frontend initial state and the backend TRADER_CONFIG
// must align with these numbers.
// If you change one, change the other too.
// ============================================================

export const CANONICAL_DEFAULTS = {
  riskPct:        0.10,   // 10%  — must match RISK_PER_TRADE=0.10 in autoTrader.ts
  maxTrades:      6,      // 6    — reduced from 8 to limit concurrent exposure
  leverage:       10,     // 10x  — must match LEVERAGE=10 in autoTrader.ts
  slEnabled:      true,   // ON   — must match SL_ENABLED=true in autoTrader.ts
  tpEnabled:      true,   // ON   — must match TP_ENABLED=true in autoTrader.ts
  tp1Only:        false,  //      — must match TP1_ONLY=false in autoTrader.ts
  tp1RR:          1.50,   // 1.5R — raised from 1.25, requires better reward minimum
  tp2RR:          2.50,   //      — must match TP2_RR=2.50 in autoTrader.ts
  minScore:       10,     // 10   — max achievable sniper score ≈ 12; 20 was unachievable
  btcGate:        true,   //      — must match BTC_GATE_ENABLED=true in autoTrader.ts
  trailTp:        false,  //      — must match TRAIL_TP_ENABLED=false in autoTrader.ts
  circuitBreaker: false,  //      — must match CIRCUIT_BREAKER_ENABLED=false in autoTrader.ts
};

