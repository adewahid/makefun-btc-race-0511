// BTC race bot — btc-race-24h-20261123-0511 ("Race a BTC trading bot live for 24 hours").
//
// Strategy, in plain words: the bot is invested from the very first tradable bar and never
// sits in cash waiting for a signal. On the first batch it can trade on it buys 60% of equity
// in CBBTC. From there it scales in with the cash that is left, whichever comes first: a dip
// ladder (extra tranches when the price falls 0.7% / 1.4% / 2.1% / 2.8% below the running
// high) or momentum adds (extra tranches when the price rises 1.5% / 3.0% above the cycle's
// entry). Total exposure never exceeds 100% of equity. One exit rule protects the downside:
// if the close falls 3% below the running peak the whole position is sold. After an exit the
// bot only re-enters on a confirmed uptrend (EMA8 crossing above EMA21 while the close is
// above EMA240), with a 40% tranche that restarts the same cycle. Trade count stays low
// (4 fills on the dev window) because every fill must earn back its ~15-35 bps round-trip
// cost, and no trend-chasing indicator is allowed to churn the book in chop.
//
// Wire notes: the hello carries the universe, capital, caps and fees; each batch carries one
// 1-minute bar and the account, and the bot answers with its orders for that bar, which fill
// at the next bar's open. Amounts are integers (micro-USDC). No wall clock, no randomness,
// no environment, no files: two runs on the same bars produce byte-identical orders.

import { BPS, runBars, type Bar, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const MAX_SLIPPAGE_BPS = 300;

// Cycle sizing, in basis points of equity at the time of the order.
const OPEN_BPS = 6_000; // opening tranche on the first tradable batch: 60%
const REENTRY_BPS = 4_000; // tranche on a confirmed-trend re-entry after an exit: 40%
const DIP_RUNGS = [
  { dipBps: 70, buyBps: 1_500 }, // -0.7% from the running peak -> +15%
  { dipBps: 140, buyBps: 1_000 }, // -1.4% -> +10%
  { dipBps: 210, buyBps: 1_000 }, // -2.1% -> +10%
  { dipBps: 280, buyBps: 500 }, // -2.8% -> +5%
];
const MOMENTUM_STEPS = [
  { upBps: 150, buyBps: 1_500 }, // +1.5% above the cycle entry -> +15%
  { upBps: 300, buyBps: 1_000 }, // +3.0% -> +10%
];
const TRAIL_BPS = 300; // sell everything at -3.0% below the running peak
const EMA_FAST = 8;
const EMA_SLOW = 21;
const EMA_TREND = 240; // ~4h of 1-minute bars

/** One EMA over closes: the mean of its first span of closes, then 2 / (span + 1) per bar. */
interface Ema {
  span: number;
  warm: number[];
  value: number | null;
}

function stepEma(e: Ema, close: number): void {
  if (e.value !== null) {
    e.value += (2 / (e.span + 1)) * (close - e.value);
    return;
  }
  e.warm.push(close);
  if (e.warm.length === e.span) e.value = e.warm.reduce((a, x) => a + x, 0) / e.span;
}

/** State of one entry cycle: from an opening (or re-entry) buy until the exit that ends it. */
interface Cycle {
  /** Highest close seen while holding in this cycle (price scale 5). */
  peak: bigint;
  /** Close the cycle was entered at (price scale 5). */
  entry: bigint;
  /** Next dip rung and next momentum step still to fire. */
  rung: number;
  mom: number;
}

const fast: Ema = { span: EMA_FAST, warm: [], value: null };
const slow: Ema = { span: EMA_SLOW, warm: [], value: null };
const trend: Ema = { span: EMA_TREND, warm: [], value: null };
/** EMA_FAST - EMA_SLOW after the previous bar, once both are set. */
let prevGap: number | null = null;
let cycle: Cycle | null = null;
let opened = false;

function crossUp(): boolean {
  if (fast.value === null || slow.value === null || prevGap === null) return false;
  return fast.value - slow.value > 0 && prevGap <= 0;
}

function trendUp(close: number): boolean {
  return trend.value !== null && close > trend.value;
}

/** Size a buy in micro-USDC: the requested share of equity, capped by cash and the weight cap. */
function sizeBuy(state: BarsState, bps: number): bigint {
  const want = (BigInt(bps) * state.equity) / BPS;
  const byWeight = state.weightRoom(SYMBOL);
  let slice = want < byWeight ? want : byWeight;
  if (slice > state.cash) slice = state.cash;
  if (slice < BigInt(state.hello.fees.min_notional_quote_units)) return 0n;
  return slice;
}

await runBars({
  onBatch(state: BarsState, batch) {
    // Feed every bar into the indicators first, warm-up bars included, so the EMAs are
    // already seeded when the first tradable batch arrives.
    for (const bar of batch.bars) {
      if (bar.symbol !== SYMBOL) continue;
      const c = Number(bar.c);
      stepEma(fast, c);
      stepEma(slow, c);
      stepEma(trend, c);
    }
    const up = crossUp();
    prevGap = fast.value !== null && slow.value !== null ? fast.value - slow.value : null;

    // While warming up every order would be rejected: wait for the first tradable batch.
    if (state.warmingUp) return [];
    const close = state.close(SYMBOL);
    if (close === null) return [];
    const held = state.positions.get(SYMBOL);
    const orders: (BuyInput | SellInput)[] = [];

    if (held === undefined || held.qty === 0n) {
      // Flat. The opening buy goes on the FIRST tradable batch, unconditionally: the
      // user's hard requirement is to be invested from bar 0, never waiting hours.
      if (!opened) {
        opened = true;
        cycle = { peak: close, entry: close, rung: 0, mom: 0 };
        const slice = sizeBuy(state, OPEN_BPS);
        if (slice > 0n) orders.push({ side: 'buy', symbol: SYMBOL, notional_quote_units: slice, max_slippage_bps: MAX_SLIPPAGE_BPS });
        return orders;
      }
      // After an exit: re-enter only on a confirmed uptrend, with a smaller tranche.
      if (cycle === null && up && trendUp(Number(close))) {
        cycle = { peak: close, entry: close, rung: 0, mom: 0 };
        const slice = sizeBuy(state, REENTRY_BPS);
        if (slice > 0n) orders.push({ side: 'buy', symbol: SYMBOL, notional_quote_units: slice, max_slippage_bps: MAX_SLIPPAGE_BPS });
      }
      return orders;
    }

    // Holding: maintain the cycle's running peak.
    if (cycle === null) cycle = { peak: close, entry: close, rung: 0, mom: 0 };
    if (close > cycle.peak) cycle.peak = close;

    // Exit: the close 3% below the running peak sells the whole position.
    if (close * BPS <= cycle.peak * (BPS - BigInt(TRAIL_BPS))) {
      orders.push({ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS });
      cycle = null;
      return orders;
    }

    // Scale in, one tranche per batch at most: the dip ladder first, then momentum.
    if (cycle.rung < DIP_RUNGS.length) {
      const rung = DIP_RUNGS[cycle.rung];
      if (close * BPS <= cycle.peak * (BPS - BigInt(rung.dipBps))) {
        const slice = sizeBuy(state, rung.buyBps);
        if (slice > 0n) {
          orders.push({ side: 'buy', symbol: SYMBOL, notional_quote_units: slice, max_slippage_bps: MAX_SLIPPAGE_BPS });
          cycle.rung++;
        }
        return orders;
      }
    }
    if (cycle.mom < MOMENTUM_STEPS.length) {
      const step = MOMENTUM_STEPS[cycle.mom];
      if (close * BPS >= cycle.entry * (BPS + BigInt(step.upBps))) {
        const slice = sizeBuy(state, step.buyBps);
        if (slice > 0n) {
          orders.push({ side: 'buy', symbol: SYMBOL, notional_quote_units: slice, max_slippage_bps: MAX_SLIPPAGE_BPS });
          cycle.mom++;
        }
        return orders;
      }
    }
    return orders;
  },
});
