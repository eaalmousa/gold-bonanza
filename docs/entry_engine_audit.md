# Gold Bonanza Entry Engine Audit
**Date:** 2026-03-14 | **Auditor:** Antigravity

---

## 🔴 Findings: Why Trades Go Into Immediate Drawdown

### FINDING 1 — LATE ENTRY ON CONFIRMATION CANDLES (CRITICAL)
**Location:** `sniperEngine.ts` — Entry price calculation
```
const triggerPrice = high15 * (1 + triggerBuffer);
```
The engine waits for a full 15-minute candle to close, then enters **above the high** of a candle that has already moved. This means:
- If the signal candle moved +0.8%, the entry is at +0.95% from where the move started.
- By the time the order executes, the initial momentum is already exhausted.

**Fix:** Add an "extension check" — if the candle close is more than 0.4x ATR above the EMA20 zone, reject the signal entirely.

---

### FINDING 2 — SCORING SYSTEM REWARDS CORRELATED SIGNALS (HIGH)
**Location:** `sniperEngine.ts` — Score tallying
The following score items are all **derived from the same moment in price action** and are not independent:
- `RSI turning up` (+2)
- `Bull impulse + vol` (+2-6)
- `Strong Accel` (+1-2)
- `Reversal confirmed` (+2-4)

A single large volume candle will trigger RSI momentum, acceleration, volume spike, AND candle anatomy all at once. This means a single event generates 4 separate score items, creating the illusion of multi-confirmation when it is actually a one-factor event.

**Fix:** Create explicit "setup type" buckets — a `CONTINUATION` type cannot simultaneously score points in the `REVERSAL` bucket.

---

### FINDING 3 — VALUE ZONE IS TOO LOOSE IN AGGRESSIVE MODE (HIGH)
**Location:** `trading.ts` — `AGGRESSIVE.pullback.valueZoneSlack = 0.02`
The zone check allows price to be **2% away** from EMA20/50 in aggressive mode:
```typescript
const tradedIntoZone = (low15 <= e20_15! * (1 + 0.02)) && (high15 >= e50_15! * (1 - 0.02));
```
At a 2% slack, the "value zone" covers an area ~4% wide — this is basically the entire normal price range of most altcoins over 12 hours. The zone has no meaning at 2%.

**Fix:** Cap aggressive slack at 0.008 (0.8%). Gate: require price to actually be BETWEEN EMA20 and EMA50, not just within 2% of either.

---

### FINDING 4 — BTC REGIME FILTER IS TOO SLOW (HIGH)
**Location:** `regimeFilter.ts` — Crash detection threshold
```
if (drop4h < -3.0 || drop12h < -5.0) → CRASH
```
A 3% drop over 4 hours is already a fast, brutal sell-off. By the time this threshold is crossed, BTC has already moved significantly and altcoins have already collapsed. Entry during this phase enters into a dead-cat bounce attempt.

**Fix:** Lower crash threshold to -1.8% over 3h. Add a new `CHOP` regime when:
- BTC 4H range < 1.5% but no clear trend
- EMA20 and EMA50 are within 0.3% of each other (compressed, direction unknown)

---

### FINDING 5 — NO "DO NOT CHASE" RULE (CRITICAL)
**Location:** `sniperEngine.ts` — no maximum extension check
Currently, the engine checks if price is "near" EMA20/50 with slack, but there is no check for:
- How far the signal candle's close is above the zone (candle already overextended)?
- What % of ATR has been covered already?
- How far price is from the original pullback low?

**Fix:** Reject if signal candle close is more than `1.0 * ATR` above the nearest EMA.

---

### FINDING 6 — ENTRY TRIGGER IS PLACED ABOVE EXTENDED CANDLE (HIGH)
**Location:** `sniperEngine.ts:279`
```
const triggerPrice = high15 * (1 + triggerBuffer); // e.g., high + 0.25%
```
The trigger is placed above the **high of the already-extended signal candle**. If the signal candle's range is 1.5% ATR, adding another 0.25% on top means entering 1.75% ATR away from the setup origin.

**Fix:** If the signal candle is large (range > 0.8x ATR), require a micro-retest before entry. Don't trigger above an overextended candle.

---

### FINDING 7 — ORDER FLOW IS BYPASSED WHEN UNAVAILABLE (MEDIUM)
**Location:** `regimeFilter.ts:143`
```typescript
if (!snapshot) {
  return { ok: true, score: 0, reasons: ['Order flow data unavailable — bypassed'] };
}
```
When order flow data is missing (which is common — websocket delays, server startup), the system **passes the check**. This means the entire order flow validation layer is silently neutered for most trades.

**Fix:** When order flow is unavailable, increase the minimum score threshold by +3 as compensation.

---

### FINDING 8 — REVERSAL AND CONTINUATION MIXED IN ONE SCORER (MEDIUM)
**Location:** `sniperEngine.ts` — combined scoring
The engine scores reversals and continuations in the same function with the same point thresholds. A genuine reversal from deeply oversold should have higher standards (needs double confirmation) while a continuation pullback entry just needs a retest of EMA20.

**Fix:** Classify signal subtype early:
- `REVERSAL` = price was below EMA50, now reclaiming EMA20 (needs double-bottom or two-bar reversal + volume)
- `CONTINUATION` = price stayed above EMA20, pulled back to it, then bounced (just needs EMA hold + RSI bounce)
- `BREAKOUT` = handled by breakoutEngine (already separate ✅)

---

### FINDING 9 — STOP LOSS USES MINIMUM OF STRUCTURE & ATR (MEDIUM)
**Location:** `sniperEngine.ts:287-288`
```
const stopLoss = Math.min(structureStop, atrStop);
```
Taking the minimum of structure and ATR creates tight stops below strong candles, which then get hit on normal retracements. Tight stops + overextended entries = near-certain drawdown.

**Fix:** Use ATR as the **primary** stop sizing with a structural cap (don't put stop tighter than 1.2x ATR below entry).

---

### FINDING 10 — SIGNAL CANDLE RANGE NOT VALIDATED (MEDIUM)
**Location:** `sniperEngine.ts` — no candle range rejection
There is no check on the absolute size of the signal candle. A signal candle that has already moved 2% is an overextended entry — entering late into a large candle typically results in immediate reversal as early buyers take profit.

**Fix:** Reject signals where candle range > 1.5x ATR. This single filter will eliminate the majority of "chasing" entries.

---

## ✅ Summary of Fixes to Implement

| # | Fix | Files Affected |
|---|---|---|
| 1 | Max extension check (1.0x ATR above EMA) | `sniperEngine.ts` |
| 2 | Separate setup types (REVERSAL vs CONTINUATION) | `sniperEngine.ts` |
| 3 | Cap aggressive slack to 0.8% | `trading.ts` |
| 4 | Lower crash threshold + add CHOP regime | `regimeFilter.ts`, `trading.ts` |
| 5 | "Do not chase" distance filter | `sniperEngine.ts` |
| 6 | Reject oversized signal candles (range > 1.5x ATR) | `sniperEngine.ts`, `breakoutEngine.ts` |
| 7 | Compensate for missing order flow with +3 score requirement | `sniperEngine.ts` |
| 8 | Quality Report on every signal (entryModel, distance, btcRegime) | `sniperEngine.ts`, `breakoutEngine.ts` |
| 9 | ATR-primary stop loss (min 1.2x ATR) | `sniperEngine.ts` |
| 10 | BTC CHOP regime blocks new trades | `regimeFilter.ts`, `scanner.ts` |
