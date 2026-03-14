# Engine v3.2 — Next Phase Validation TODO

> **This milestone is a threshold-tightening and entry-quality improvement.**
> It is NOT final strategy validation.
> Do not make strong performance claims until the tasks below are complete.

---

## What v3.2 Is

- Tightened late-entry and expansion-candle filters (documented thresholds)
- Added mandatory retest logic for moderately expanded candles
- Added CHOP regime blocking + stricter crash detection (1.8% / 3h)
- Added portfolio clustering control (12 correlation groups, same-wave filter for both directions)
- Fixed async race condition in scanner batch evaluation
- Confirmed: TypeScript zero errors, production build clean
- Backtest over 15 symbols / 500 candles shows measurable improvement vs v2

## What v3.2 Is NOT

- Final strategy validation
- Tested in live or paper-trading conditions
- Validated across multiple BTC regimes (current test was forced TRENDING_UP due to active CHOP)
- Validated on SHORT setups specifically (SHORT logic mirrors LONG but was not isolated in backtest)
- Tested with order flow data present (all backtest runs had missing flow → +3 score penalty applied)

---

## Required Next Steps Before Stronger Claims

### 1. Broader Backtest
- [ ] Expand to 40–60 symbols (not just 15)
- [ ] Increase history to 1000+ candles per symbol (~10 days of 15m data)
- [ ] Run during at least two distinct BTC regimes: one TRENDING_UP, one RANGING or TRENDING_DOWN
- [ ] Run during at least one high-volatility stress period, including either a confirmed BTC crash or a sharp liquidation phase
- [ ] Use `BALANCED` and `CONSERVATIVE` modes as well, not just `AGGRESSIVE`

### 2. LONG vs SHORT Isolation
- [ ] Run backtest with only shorts enabled and compare MAE/MFE separately
- [ ] Confirm short-side extension check (`extensionBelowZone`) behavior matches long-side results
- [ ] Verify SHORT same-wave filter behaves identically to LONG version

### 3. Live Paper-Trading Validation
- [ ] Enable paper-trading mode (no real capital) for 2–3 weeks
- [ ] Log every signal with the full quality report (entryType, entryTiming, zoneDistancePct, btcRegimeAtEntry)
- [ ] Record actual execution prices vs trigger prices — measure slippage per signal
- [ ] Capture real MAE/MFE from live execution, not backtest simulation
- [ ] Validate across multiple BTC regime transitions (CHOP → TRENDING_UP, TRENDING_DOWN → RANGING, etc.)

### 4. Performance Threshold Before Making Claims
- [ ] Collect minimum **50 new-engine signals** in live or paper trading
- [ ] Target: 1-candle immediate drawdown rate < 45% (below the backtest 50% result)
- [ ] Target: PROFIT-first move rate > 45% sustained
- [ ] Target: LATE entry rate < 20% in live conditions
- [ ] If any target is missed after 50 trades: re-audit the specific setup type that is failing

---

## Known Backtest Limitations

| Limitation | Impact |
|---|---|
| Only 6 signals passed all v3.2 filters in backtest window | Statistics on 6 samples are not robust — need 50+ |
| BTC was in CHOP during test, overridden to TRENDING_UP | CHOP/CRASH regimes not exercised |
| No order flow data available | All signals used +3 score penalty mode |
| 15m candle data only | 1H structure was held constant (not time-windowed) |
| No SHORT signals generated in test window | SHORT engine behavior is code-verified but not data-verified |

---

## Milestone Tag

`v3.2 — threshold-tightening / entry-quality milestone`
`NOT production-validated`
`Committed: 2026-03-14`
