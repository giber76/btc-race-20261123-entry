[![make.fun](https://make.fun/badge/btc-race-24h-20261123-0511.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511)
[![rank](https://make.fun/badge/btc-race-24h-20261123-0511/giber76/btc-race-20261123-entry/rank.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511)
[![reward](https://make.fun/badge/btc-race-24h-20261123-0511/giber76/btc-race-20261123-entry/reward.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511)

# RangeRider round 10 — cbBTC trading bot

Entry for [make.fun btc-race-24h-20261123-0511](https://make.fun/bounty/btc-race-24h-20261123-0511)
("Race a BTC trading bot live for 24 hours", $50, top 10 on the live 24h race window).

## Why round 10 exists

This race's dev window is a **rising grind** (+3.64% start to end, deepest
close dip only 1.84% below the trailing 420-minute high, deepest washout
2.35%). The previous race's washout bot earns exactly **$0.00** on it — its
2.5–2.6% micro never fires, its 2.0% snap never fires — and would fail the
dev gate (net PnL above $0 required). Momentum/trend-following was tested
and rejected: breakout entries on 1-minute cbBTC bars lose on every window
(best trend variant: dev −$2.77, worst −$27.80), because breakouts fill at
the next open and mean-revert into the 0.8% stop. Range scalping was tested
and rejected too (negative on every window). What works on a rising window
is the same dip-buying that works elsewhere, at a shallower dip: a new
trend-filtered **shallow-dip tier** buys 1%-scale pullbacks only while the
close sits above its 240-minute average, with a wide 0.8% trailing exit.

## Strategy

A five-mode bot with only relative triggers (trailing highs, a moving
average, the entry price) — no absolute price level, no schedule — so the
same rules fire on any fresh 24-hour window.

- **Shallow dip (new in round 10):** buy 60% of cash when the close is at
  least 0.8% below the trailing 60-minute high of closes, the close is
  above its 240-minute average (uptrend filter), and the close is at least
  0.2% above the trailing 30-minute low. Exit: +0.8% take-profit, 0.8%
  hard stop, 0.8% trailing stop below the peak since entry (unarmed),
  180-bar hold. No loss-cap gate, no cooldown.
- **Washout micro:** buy 100% of cash when the trailing 30-minute low is
  at least 2.6% below the trailing 150-minute high of highs, the close is
  at or above that low, and the close 30 bars ago was within 1.0% below
  that high (velocity filter: blocks slow grinds). Exit: +1.2%
  take-profit, 0.8% hard stop, 0.2% trailing stop once +0.2% up,
  120-bar hold. Own 40-bar cooldown, own 20-wave budget, gated by the
  loss-cap latch. After a micro exit the snap is blocked for 90 bars.
- **Snapback:** buy 100% of cash when the close is ≥ 2.0% below the
  trailing 420-minute high of bar highs, only if the close is at least
  0.2% above the trailing 30-minute low. Exit: +1.0% take-profit, 0.8%
  trailing stop once +0.8% up, 0.8% hard stop (tier 1; 2.5% for tier 2),
  240-bar hold. Tier 2 takes profit at +0.8%. A 20-bar cooldown after an
  exit (40 after a losing snap exit) and a 1% loss cap latching snap
  entries off below $990 realised equity.
- **Deep V tiers (crash windows):** tier 1 buys 40% of cash at 5.0%
  below the trailing 360-minute high; while holding it, a further fall
  to 5.3% buys all remaining cash. Exit: +4.5% over the blended entry,
  1.2% trailing stop, 1.5% hard stop, 240 bars. The loss cap does NOT
  gate deep entries.
- **Rider (rising windows):** if the close breaks 0.3% above the
  trailing 240-minute high with the 8-bar mean above the 21-bar mean
  and still rising, buy 50% of cash. It never fired on any tested
  window; it stays because a bot with no trade at all fails the
  guardrails.

## Honest numbers (bit-perfect Python simulator, same integer fill math as the kit)

| Window | PnL | Trades | Max DD |
|---|---|---|---|
| dev 20261123 (this race) | +$6.12 | 5 | 0.38% |
| dev 20261118 (washout) | +$20.38 | 4 | 0.62% |
| prev race window 20261113 | +$2.42 | 8 | 2.15% |
| prev race window 20261115 | +$40.06 | 6 | 1.61% |
| old dev window 20261117 | +$8.60 | 2 | 0.57% |
| live 20261117 replay | +$7.26 | 3 | 0.43% |
| mirrored dev window | −$12.45 | 2 | 1.90% |

Dev +$6.12 clears the gate with room. The mirrored window is the known
weak spot (the micro is not mirror-robust); every real window is
positive, worst +$2.42. The race window decides the prize, and this bot
is built to be positive across regimes, not fitted to one.

## Run

```sh
node cli/makefun.mjs grade-local --kit <kit-dir> --bot main.ts --driver process
```

Deterministic: integer arithmetic on the bars the harness sends; no clock,
no randomness, no network, no files. Standard library only, plus the kit's
TypeScript shim vendored under `vendor/` (byte-for-byte copy from this race's kit).
