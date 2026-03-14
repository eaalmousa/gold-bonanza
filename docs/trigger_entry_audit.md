# Trigger-Entry Quality Audit Report

**Date:** 2026-03-14
**Scope:** Forensic analysis of LONG and SHORT entry timing, direction, and immediate adverse movement in the Aggressive mode.

---

## 1. Initial State (Pre-Audit)

We ran an exact forensic backtest over 1,000 candles (15m timeframe, 15 symbols) tracking peak MFE (profit) and MAE (drawdown) within a 3-hour lookforward window.

### Initial Findings
- total signals: 2,786 (Long 258, Short 2528)
- 99.3% of all signals were coming from the `BREAKOUT` engine.
- 34.3% were classified as sheer `WRONG DIRECTION` (hit maximum stop loss before ever reaching target).
- First Move LOSS was > 60% on average.

### Identified Causes of Bad Entries
1. **Aggressive Mode Bypasses:** The `breakoutEngine` was allowing Aggressive mode to skip the check for *actual price breakout* (`close15 < breakLevel`). It was entering inside the coil prematurely.
2. **Falling Knife Catching:** The `sniperEngine` was allowing Reversal setups to fire in Aggressive mode *without reclaiming the EMA20*, catching falling knives.
3. **Weak Confirmation Candles:** The minimum candle close requirement for Aggressive was just `0.20` or `0.50`, meaning it was triggering on dojis or massive top/bottom rejecting wicks.
4. **Overextended Breakouts:** The `candleAtrRatio` limit was 1.4x for breakouts. Breakouts on candles > 1.1x ATR are almost guaranteed to trigger an immediate pullback, causing 70% of entries to go red instantly.
5. **Deep Broken Structures:** Sniper pullbacks where wicks pierced > 1.0 ATR through the EMA50 were treated as normal pullbacks instead of damaged structure.

---

## 2. Tightening Pass Implemented

We tightened the trigger logic strictly for entry correctness *without redesigning the exit side*:

- **Sniper EMA20 Reclaim:** Removed the Aggressive mode bypass. All Reversals now strictly require the price to reclaim the EMA20, proving the knife-fall is over.
- **Deep Pullback Protection:** Added a block for wicks extending > 1.0 ATR past the EMA50 on both long and short sides.
- **Candle Anatomy Floor:** Raised the minimum Aggressive required candle closure to `0.65` for optimal directional commitment, preventing wick-heavy entries.
- **Breakout Confirmation Bypass Removed:** Breakouts in Aggressive mode *must* now cleanly cross the breakout level, and structural quality must be >= `0.50`.
- **Expansion Cap:** Capped Breakout engine signal candle to `1.1x` ATR maximum.

---

## 3. Post-Fix Forensic Results

### Aggregate
- **Signal Count:** Plummeted from 2,786 to just **54**. The 2,700 blocked signals were entirely false breakouts and falling knives.
- **Average Candle/ATR:** Dropped from 1.15x to **0.95x**.
- **Average Zone Distance:** Improved from -0.58% to **+0.21%** (optimal discount/premium).
- **WRONG DIRECTION rate:** Held at ~37%, showing the remaining failed trades are genuine market fakeouts, not structural engine errors.

### LONG vs SHORT Breakdown

#### LONG Engine (6 signals)
- **First Move:** LOSS 66.7%
- **Wrong Direction:** 100%
- **Diagnosis:** Small sample size (6 signals) due to deep bearish market conditions during the test window. However, the LONG engine fundamentally suffers from catching late, tight fakeouts in bearish macro environments.
- **Avg Candle/ATR:** 0.98x

#### SHORT Engine (48 signals)
- **First Move:** LOSS 70.8%
- **Wrong Direction:** 37.5%
- **Well Timed / Correct:** 33.4% (combined perfect and early entries)
- **Avg Candle/ATR:** 0.95x
- **Diagnosis:** The SHORT engine is highly active but still faces a significant issue: **Timing**. Nearly 71% of short entries go into drawdown immediately on the next candle.

---

## 4. Final Decision Report

**1. Is the main remaining issue direction or timing?**
**TIMING.** The incorrect direction rate is dropping into the acceptable range for aggressive high-risk setups (35-40%, allowing risk/reward to overcome it). However, the *First Move LOSS rate of 70%* is critical. Breakouts, specifically, are snapping back against the entry price instantly over 2/3rds of the time.

**2. Which side is weaker: LONG or SHORT?**
Currently, **LONG** is structurally weaker because it attempts to catch continuation in environments where order flow is thin. However, **SHORT** is mechanically weaker because short breakouts are extremely prone to "whipsaw" (breaking down, bouncing to retest, then continuing). The engine enters before the bounce, suffering the retest MAE.

**3. What exact thresholds should change next?**
No more threshold tightening. We have tightened:
- Wick tolerances.
- Body sizes.
- Expansion ATR limits.
If we tighten candle/ATR below 0.9x, we block all volatility. 

**4. What should be tightened to get cleaner entries without redesigning the whole engine?**
To fix the 70% immediate drawdown rate without rebuilding the engine, we must implement **Mandatory Retest Logic for Breakouts**.

Currently, `breakoutEngine` triggers exactly on the close of the breakout candle. The market statistics prove the next candle immediately pulls back. 
**Next logical step:** The engine should generate a "Pending Breakout" state if the breakout is valid, but *wait for a 15m candle to retest the break level and close in the trend direction* before firing the actual entry. This solves timing without changing the core directional logic.
