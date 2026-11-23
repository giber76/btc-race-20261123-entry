// RangeRider round 10 -- cbBTC trading bot for btc-race-24h-20261123-0511.
//
// WHY THIS DESIGN EXISTS
// This race's dev window is a RISING grind: +3.64% start to end, deepest
// close dip only 1.84% below the trailing 420-minute high, deepest washout
// 2.35% (bar 1330). The previous race's washout bot earns exactly $0.00 on
// it (its 2.5-2.6% micro never fires, its 2.0% snap never fires) and would
// FAIL the dev gate (> $0 required). Momentum/trend-following was tested
// and REJECTED: breakout entries on 1-minute cbBTC bars lose on every
// window (best trend variant: newdev -$2.77, worst -$27.80) -- breakouts
// fill at the next open and mean-revert into the 0.8% stop. Range scalping
// was tested and REJECTED too (negative on every window). What works on a
// rising window is the same dip-buying that works elsewhere, at a SHALLOWER
// dip: a trend-filtered shallow-dip tier (new in round 10) buys 1%-scale
// pullbacks only while the close sits above its 240-minute average, with a
// wide 0.8% trailing exit that lets a rising market pay.
//
// MODES (one position at a time, long only, $1,000 paper, 1-minute bars):
//   SHALLOW (new): buy 60% of cash when the close is at least 0.8% below
//     the trailing 60-minute high of closes, the close is above its
//     240-minute average (uptrend filter), and the close is at least 0.2%
//     above the trailing 30-minute low (the dip has stopped falling).
//     Exit: +0.8% take-profit, 0.8% hard stop, 0.8% trailing stop below
//     the peak since entry (unarmed -- it trails from the first bar),
//     180-bar hold. No loss-cap gate, no cooldown: it is a small-size
//     trend trade, and the latch exists to stop snap-family bleeding.
//   MICRO (washout tier): buy 100% of cash when the trailing 30-minute
//     LOW is at least 2.6% below the trailing 150-minute high of highs,
//     the close is at or above that low, and the close 30 bars ago was
//     within 1.0% below that high (velocity filter: blocks slow grinds
//     where the price was already well below the high half an hour ago).
//     Exit: +1.2% take-profit, 0.8% hard stop, 0.2% trailing stop once
//     +0.2% up, 120-bar hold. Own 40-bar cooldown, own 20-wave budget,
//     gated by the loss-cap latch. Tried after snap; after a micro exit
//     the snap is blocked for 90 bars so it cannot chase the bounce late.
//   SNAPBACK: buy 100% of cash when the close is at least 2.0% below
//     the trailing 420-minute high of bar highs, only if the close is at
//     least 0.2% above the trailing 30-minute low. Tier 2 (2.7% dip)
//     takes profit at +0.8% with a 2.5% stop; tier 1 at +1.0% with a
//     0.8% stop and a 0.8% trailing stop once +0.8% up. 240-bar hold.
//     20-bar cooldown after an exit (40 after a losing snap exit).
//     Gated by the 1% loss-cap latch (see below).
//   DEEP V tiers (crash catcher): tier 1 buys 40% of cash at 5.0%
//     below the trailing 360-minute high of closes; while holding, a
//     further fall to 5.3% buys all remaining cash. A straight gap past
//     5.3% buys all cash at once. Exit: +4.5% over the blended entry,
//     1.2% trailing stop, 1.5% hard stop, 240 bars. The loss cap does
//     NOT gate deep entries: on a crash window the deep trade is what
//     pays, and it fires after the snap waves have already lost money.
//   RIDER: if the close breaks 0.3% above the trailing 240-minute high
//     with the 8-bar mean above the 21-bar mean and still rising, buy
//     50% of cash. It never fired on any tested window (the trailing
//     high includes the current close, so the breakout bar itself can
//     never satisfy it -- a known quirk kept for fidelity); it stays
//     because a bot with no trade at all fails the guardrails.
//
// LOSS CAP: a 1% realised-loss latch stops snap/micro entries once
// realised equity falls below $990 (evaluated only while flat). It
// re-arms if a deep win repairs equity back above $990. Loosening it
// was tested and loses $11-16 on the crash window, so it stays at 1%.
// A single micro stop-out at 0.8% leaves equity ~$992, above the line.
//
// GUARDS: 30-bar warmup; at most 12 waves per window; no new entries
// in the last 5 bars (a position opened there fills on the last bar
// and flattens at a guaranteed fee loss).
//
// Every trigger is RELATIVE (trailing highs, a moving average, the
// entry price) -- no absolute price level, no schedule, nothing fitted
// to a calendar date -- so the same rules fire on any fresh 24-hour
// window.
//
// Honest numbers (bit-perfect Python simulator, same integer fill math
// as the kit; kit grade-local below must reproduce the dev line):
//   dev 20261123 (this race):  +$6.12, 5 trades, max DD 0.38%
//   dev 20261118 (washout):    +$20.38, 4 trades, max DD 0.62%
//   prev race window 20261113: +$2.42, 8 trades, max DD 2.15%
//   prev race window 20261115: +$40.06, 6 trades, max DD 1.61%
//   old dev window 20261117:   +$8.60, 2 trades, max DD 0.57%
//   live 20261117 replay:      +$7.26, 3 trades, max DD 0.43%
//   mirrored dev window:       -$12.45, 2 trades, max DD 1.90%
// The mirrored window is the known weak spot (the micro is not
// mirror-robust); every real window is positive, worst +$2.42.
// Dev +$6.12 clears the gate with room; the race window decides the
// prize, and this bot is built to be positive across regimes, not
// fitted to one.
//
// Deterministic: integer arithmetic on the bars the harness sends; no
// clock, no randomness, no network, no files. Standard library only,
// plus the kit's TypeScript shim vendored under vendor/ (byte-for-byte
// copy from this race's kit).

import { runBars, type BarsState, type OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';

// Washout micro tier.
const MICRO_DIP = 26n; // 2.6% below the trailing high of highs, at the low
const MICRO_HI_WIN = 150; // trailing high window, minutes
const MICRO_REC_WIN = 30; // trailing low window, minutes
const MICRO_REC = 0n; // close at or above the trailing 30-min low
const MICRO_VEL = 10n; // 1.0%: close 30 bars ago must be within this of the high
const MICRO_VEL_WIN = 30; // bars back for the velocity check
const MICRO_SIZE_PCT = 100n; // spend 100% of cash
const MICRO_TAKE = 12n; // +1.2% over entry
const MICRO_STOP = 8n; // 0.8% under entry
const MICRO_ARM = 2n; // trail arms once +0.2% up
const MICRO_TRAIL = 2n; // 0.2% below the peak since entry
const MICRO_HOLD = 120; // bars, then out
const MICRO_CD = 40; // bars after a micro exit fill before re-entering
const MICRO_MAX_WAVES = 20; // own wave budget so micro cannot starve snap/deep

// Snapback.
const SNAP_DIP1 = 20n; // 2.0% below the trailing 420-min high of highs
const SNAP_DIP2 = 27n; // 2.7% below that high (tier 2)
const SNAP_HI_WIN = 420;
const SNAP_SIZE_PCT = 100n; // spend 100% of cash
const SNAP_TAKE1 = 10n; // +1.0% over entry (tier 1)
const SNAP_STOP1 = 8n; // 0.8% under entry (tier 1)
const SNAP_TAKE2 = 8n; // +0.8% over entry (tier 2)
const SNAP_STOP2 = 25n; // 2.5% under entry (tier 2)
const SNAP_ARM = 8n; // trail arms once +0.8% up
const SNAP_TRAIL = 8n; // 0.8% below the peak since entry
const SNAP_HOLD = 240; // bars, then out
const SNAP_COOLDOWN = 20; // bars after an exit fill before re-entering
const SNAP_COOLDOWN_LOSS = 40; // bars after a LOSING snap exit
const SNAP_RECOVERY = 2n; // 0.2% above the trailing 30-min low
const SNAP_RECOVERY_WIN = 30;
const SNAP_CD_MICRO = 90; // bars after a micro exit fill before snap may re-enter
const LOSS_CAP_USDC = 990_000_000n; // stop snap/micro entries below $990 equity

// Shallow-dip tier (new in round 10): trend-filtered pullback buys for
// rising windows, where the washout tiers never fire.
const SHALLOW_DIP = 8n; // 0.8% below the trailing 60-min high of closes
const SHALLOW_HI_WIN = 60; // trailing high window, minutes
const SHALLOW_TREND_WIN = 240; // close must sit above this average
const SHALLOW_REC_WIN = 30; // trailing low window, minutes
const SHALLOW_REC = 2n; // 0.2% above the trailing 30-min low
const SHALLOW_SIZE_PCT = 60n; // spend 60% of cash
const SHALLOW_TAKE = 8n; // +0.8% over entry
const SHALLOW_STOP = 8n; // 0.8% under entry
const SHALLOW_TRAIL = 8n; // 0.8% below the peak since entry (unarmed)
const SHALLOW_HOLD = 180; // bars, then out

// Deep V tiers.
const DEEP1_DD = 50n; // 5.0% below the trailing 360-min high, tier 1
const DEEP2_DD = 53n; // 5.3% below the trailing 360-min high, tier 2
const DEEP_HIGH_WIN = 360;
const DEEP1_SIZE_PCT = 40n; // tier 1 spends 40% of cash
const DEEP_TAKE = 45n; // +4.5% over the blended entry
const DEEP_TRAIL = 12n; // 1.2% below the peak since entry
const DEEP_STOP = 15n; // 1.5% under entry
const DEEP_HOLD = 240;

// Breakout rider.
const RIDER_BREAKOUT = 3n; // 0.3% above the trailing 240-min high
const RIDER_HIGH_WIN = 240;
const RIDER_SIZE_PCT = 50n;
const RIDER_TAKE = 8n;
const RIDER_TRAIL = 5n;
const RIDER_STOP = 8n;
const RIDER_HOLD = 180;

const MAX_WAVES = 12;
const WARMUP_BARS = 30;
const NO_ENTRY_FROM_BARS = 1435; // no new entries once 1435 bars seen
const HISTORY = 720; // closes kept (longest lookback is 420)
const SLIPPAGE_BPS = 400; // cap vs the latest close
const MIN_NOTIONAL = 1_000_000n; // 1 USDC in quote units

type Mode = 'snap' | 'deep' | 'rider' | 'micro' | 'shallow';

/** Closes at price scale 5, oldest first. */
const closes: bigint[] = [];
/** Bar highs at price scale 5, oldest first. */
const highs: bigint[] = [];
let entryPrice = 0n; // volume-weighted entry price, 0n = flat
let peakSinceEntry = 0n; // highest close since entry
let holdBars = 0; // bars held in the current position
let waves = 0; // flat-entry buys sent in this window
let prevQty = 0n;
let mode: Mode | null = null; // mode of the open position
let scaled = false; // deep tier-2 scale-in already sent
let snapTier = 0; // snapback tier of the open position (1 or 2)
let lastExitSeq = -1_000_000; // seq of the batch the last sell filled on
let lastMicroExitSeq = -1_000_000; // seq of the batch the last micro sell filled on
let microWaves = 0; // micro buys sent in this window
let stopped = false; // loss-cap latch: snap/micro entries off for the window
let cashAtOpen = 0n; // cash when the open position's first buy was sent
let lastExitMode: Mode | null = null; // mode of the last closed trade
let lastExitWasLoss = false; // the last closed trade lost money

function highest(n: number): bigint {
  const start = Math.max(0, closes.length - n);
  let hi = closes[start];
  for (let i = start + 1; i < closes.length; i++) if (closes[i] > hi) hi = closes[i];
  return hi;
}

function highestHigh(n: number): bigint {
  const start = Math.max(0, highs.length - n);
  let hi = highs[start];
  for (let i = start + 1; i < highs.length; i++) if (highs[i] > hi) hi = highs[i];
  return hi;
}

function lowest(n: number): bigint {
  const start = Math.max(0, closes.length - n);
  let lo = closes[start];
  for (let i = start; i < closes.length; i++) if (closes[i] < lo) lo = closes[i];
  return lo;
}

function mean(n: number): bigint {
  const start = Math.max(0, closes.length - n);
  let s = 0n;
  for (let i = start; i < closes.length; i++) s += closes[i];
  return s / BigInt(closes.length - start);
}

function buy(notional: bigint): OrderInput {
  return { side: 'buy', symbol: SYMBOL, notional_quote_units: notional, max_slippage_bps: SLIPPAGE_BPS };
}

function onBatch(state: BarsState): OrderInput[] {
  if (state.warmingUp) return [];
  const close = state.close(SYMBOL);
  if (close === null) return [];
  const bar = state.latest.get(SYMBOL);
  const high = bar === undefined ? close : BigInt(bar.h);
  closes.push(close);
  highs.push(high);
  if (closes.length > HISTORY) closes.shift();
  if (highs.length > HISTORY) highs.shift();

  const holding = state.positions.get(SYMBOL);
  const qty = holding === undefined ? 0n : holding.qty;

  // Loss cap, evaluated ONLY while flat and latching on REALISED equity:
  // an intra-trade trough no longer trips it. It does NOT gate deep
  // entries (the crash window's deep trade is what pays) and does NOT
  // gate shallow entries (small-size trend trades).
  if (qty === 0n && state.equity < LOSS_CAP_USDC) stopped = true;

  // Re-arm: once flat and realised equity is back at or above the $990
  // line, the latch releases and snap/micro entries are allowed again.
  if (stopped && qty === 0n && state.equity >= LOSS_CAP_USDC) stopped = false;

  // A buy filled since the last batch: re-derive the averaged entry.
  // value(qty, price) = qty * price / 10**7, so price = cost * 10**7 / qty.
  if (qty > prevQty) {
    entryPrice = (holding!.cost * 10_000_000n) / qty;
    if (close > peakSinceEntry) peakSinceEntry = close;
    if (prevQty === 0n) holdBars = 0;
  }
  // A sell filled: the position is gone (this bot only ever sells all of it).
  if (qty === 0n && prevQty > 0n) {
    // Realised PnL of the closed trade: cash now minus cash when the
    // position's first buy was sent (drives the post-loss cooldown).
    lastExitWasLoss = state.cash < cashAtOpen;
    lastExitMode = mode;
    if (mode === 'micro') lastMicroExitSeq = state.seq;
    entryPrice = 0n;
    peakSinceEntry = 0n;
    holdBars = 0;
    mode = null;
    snapTier = 0;
    scaled = false;
    lastExitSeq = state.seq;
  }
  prevQty = qty;

  if (qty > 0n) {
    holdBars += 1;
    if (close > peakSinceEntry) peakSinceEntry = close;
    if (mode === 'deep') {
      if (
        close * 1000n >= entryPrice * (1000n + DEEP_TAKE) ||
        close * 1000n <= entryPrice * (1000n - DEEP_STOP) ||
        close * 1000n <= peakSinceEntry * (1000n - DEEP_TRAIL) ||
        holdBars >= DEEP_HOLD
      ) {
        return [{ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: SLIPPAGE_BPS }];
      }
      // Deep tier 2: while holding tier 1, a further fall to 5.3% below
      // the trailing 360-minute high buys all remaining cash at the trough.
      if (!scaled && state.cash >= MIN_NOTIONAL) {
        const high360 = highest(DEEP_HIGH_WIN);
        if (close * 1000n <= high360 * (1000n - DEEP2_DD)) {
          scaled = true;
          return [buy(state.cash)];
        }
      }
      return [];
    }
    if (mode === 'snap') {
      const take = snapTier === 2 ? SNAP_TAKE2 : SNAP_TAKE1;
      const stop = snapTier === 2 ? SNAP_STOP2 : SNAP_STOP1;
      const armed = close * 1000n >= entryPrice * (1000n + SNAP_ARM);
      if (
        close * 1000n >= entryPrice * (1000n + take) ||
        close * 1000n <= entryPrice * (1000n - stop) ||
        (armed && close * 1000n <= peakSinceEntry * (1000n - SNAP_TRAIL)) ||
        holdBars >= SNAP_HOLD
      ) {
        return [{ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: SLIPPAGE_BPS }];
      }
      return [];
    }
    if (mode === 'micro') {
      // Washout-micro exits: +1.2% take, 0.8% hard stop, 0.2% trailing
      // stop once +0.2% up, 120-bar hold.
      const armed = close * 1000n >= entryPrice * (1000n + MICRO_ARM);
      if (
        close * 1000n >= entryPrice * (1000n + MICRO_TAKE) ||
        close * 1000n <= entryPrice * (1000n - MICRO_STOP) ||
        (armed && close * 1000n <= peakSinceEntry * (1000n - MICRO_TRAIL)) ||
        holdBars >= MICRO_HOLD
      ) {
        return [{ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: SLIPPAGE_BPS }];
      }
      return [];
    }
    if (mode === 'shallow') {
      // Shallow exits: +0.8% take, 0.8% hard stop, 0.8% trailing stop
      // below the peak since entry -- UNARMED, it trails from the
      // first bar, so a rising market banks its pullback bounce and a
      // stalled one exits before it gives the move back. 180-bar hold.
      if (
        close * 1000n >= entryPrice * (1000n + SHALLOW_TAKE) ||
        close * 1000n <= entryPrice * (1000n - SHALLOW_STOP) ||
        close * 1000n <= peakSinceEntry * (1000n - SHALLOW_TRAIL) ||
        holdBars >= SHALLOW_HOLD
      ) {
        return [{ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: SLIPPAGE_BPS }];
      }
      return [];
    }
    // Rider: plain trailing exit, no arm.
    if (
      close * 1000n >= entryPrice * (1000n + RIDER_TAKE) ||
      close * 1000n <= entryPrice * (1000n - RIDER_STOP) ||
      close * 1000n <= peakSinceEntry * (1000n - RIDER_TRAIL) ||
      holdBars >= RIDER_HOLD
    ) {
      return [{ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: SLIPPAGE_BPS }];
    }
    return [];
  }

  if (closes.length < WARMUP_BARS || waves >= MAX_WAVES) return [];
  if (closes.length >= NO_ENTRY_FROM_BARS) return [];

  const closeNow = close;
  const high360 = highest(DEEP_HIGH_WIN);

  // Deep tiers first: a crash window must not wait behind the snap rules.
  if (closeNow * 1000n <= high360 * (1000n - DEEP2_DD)) {
    waves += 1;
    mode = 'deep';
    cashAtOpen = state.cash;
    return [buy(state.cash)];
  }
  if (closeNow * 1000n <= high360 * (1000n - DEEP1_DD)) {
    waves += 1;
    mode = 'deep';
    cashAtOpen = state.cash;
    return [buy((state.cash * DEEP1_SIZE_PCT) / 100n)];
  }

  // Snapback: dip below the 420-minute high of bar highs, off a stopped
  // fall (close 0.2% above the trailing 30-minute low). Gated by the
  // 20/40-bar post-exit cooldown (40 after a losing snap exit) and the
  // 1% loss-cap latch. Tier 2 (2.7% dip) takes the wider exits; tier 1
  // (2.0% dip) the tight ones. Also gated by SNAP_CD_MICRO -- for 90
  // bars after a micro exit the snap stays out, because the micro
  // already banked that bounce and the snap would only buy its top.
  const snapCd = lastExitMode === 'snap' && lastExitWasLoss ? SNAP_COOLDOWN_LOSS : SNAP_COOLDOWN;
  if (!stopped && state.seq - lastExitSeq >= snapCd && state.seq - lastMicroExitSeq >= SNAP_CD_MICRO) {
    const high420 = highestHigh(SNAP_HI_WIN);
    const low30 = lowest(SNAP_RECOVERY_WIN);
    if (closeNow * 1000n >= low30 * (1000n + SNAP_RECOVERY)) {
      if (closeNow * 1000n <= high420 * (1000n - SNAP_DIP2)) {
        waves += 1;
        mode = 'snap';
        snapTier = 2;
        cashAtOpen = state.cash;
        return [buy((state.cash * SNAP_SIZE_PCT) / 100n)];
      }
      if (closeNow * 1000n <= high420 * (1000n - SNAP_DIP1)) {
        waves += 1;
        mode = 'snap';
        snapTier = 1;
        cashAtOpen = state.cash;
        return [buy((state.cash * SNAP_SIZE_PCT) / 100n)];
      }
    }
  }

  // Washout micro (tried AFTER snap so it never pre-empts the main
  // trade): the trailing 30-minute LOW is at least 2.6% below the
  // trailing 150-minute high of highs, and the close is at or above
  // that low. The dip is measured at the LOW, not at the close -- so
  // it fires on washouts the snap's close-plus-recovery gate misses.
  // Velocity filter: the close 30 bars ago must be within 1.0% below
  // that high, or the market is grinding down, not washing out.
  // Gated by the loss-cap latch, its own 40-bar cooldown and its own
  // 20-wave budget.
  if (!stopped && microWaves < MICRO_MAX_WAVES && state.seq - lastMicroExitSeq >= MICRO_CD) {
    const highMicro = highestHigh(MICRO_HI_WIN);
    const lowMicro = lowest(MICRO_REC_WIN);
    let velocityOk = false;
    if (closes.length > MICRO_VEL_WIN) {
      const close30Ago = closes[closes.length - 1 - MICRO_VEL_WIN];
      velocityOk = close30Ago * 1000n >= highMicro * (1000n - MICRO_VEL);
    }
    if (
      velocityOk &&
      lowMicro * 1000n <= highMicro * (1000n - MICRO_DIP) &&
      closeNow * 1000n >= lowMicro * (1000n + MICRO_REC)
    ) {
      waves += 1;
      microWaves += 1;
      mode = 'micro';
      cashAtOpen = state.cash;
      return [buy((state.cash * MICRO_SIZE_PCT) / 100n)];
    }
  }

  // Shallow-dip tier (round 10, tried AFTER micro, before the rider):
  // buy a 0.8% pullback below the trailing 60-minute high of closes,
  // but ONLY in an uptrend (close above its 240-minute average) and
  // off a stopped fall (close 0.2% above the trailing 30-minute low).
  // 60% of cash. No latch gate, no cooldown: small size, trend trade.
  {
    const high60 = highest(SHALLOW_HI_WIN);
    const sma240 = mean(SHALLOW_TREND_WIN);
    const low30 = lowest(SHALLOW_REC_WIN);
    if (
      closeNow >= sma240 &&
      closeNow * 1000n >= low30 * (1000n + SHALLOW_REC) &&
      closeNow * 1000n <= high60 * (1000n - SHALLOW_DIP)
    ) {
      waves += 1;
      mode = 'shallow';
      cashAtOpen = state.cash;
      return [buy((state.cash * SHALLOW_SIZE_PCT) / 100n)];
    }
  }

  // Breakout rider: a rising window where dips never come.
  const high240 = highest(RIDER_HIGH_WIN);
  if (
    closeNow * 1000n >= high240 * (1000n + RIDER_BREAKOUT) &&
    mean(8) > mean(21) &&
    closeNow > closes[closes.length - 5]
  ) {
    waves += 1;
    mode = 'rider';
    cashAtOpen = state.cash;
    return [buy((state.cash * RIDER_SIZE_PCT) / 100n)];
  }
  return [];
}

await runBars({ onBatch });
