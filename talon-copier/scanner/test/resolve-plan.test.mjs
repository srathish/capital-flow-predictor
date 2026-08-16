// resolve-plan.test.mjs — the gap-aware fill fix (the bug that fabricated ~4x R).
import { resolvePlan } from '../lib/resolve-plan.mjs';
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}`); } };
const near = (n, g, w) => ok(`${n} (${g?.toFixed?.(2)}≈${w})`, g != null && Math.abs(g - w) < 0.02);
const bar = (date, o, h, l, c) => ({ date, open: o, high: h, low: l, close: c });

// GAP-UP past the trigger: fill at the OPEN, not the trigger. MSFT-like: trig 382, but the
// bar opens 390 and never trades below 388 → you fill 390, not 382.
{
  const plan = { direction: 'long', entry_trigger: 382, invalidation: 378.5, target: 410, runner_target: 420 };
  const oh = [bar('2026-07-27', 390, 394, 388, 393), bar('2026-07-30', 437, 466, 432, 464)];
  const r = resolvePlan(plan, oh, {});
  near('gap-up fills at open 390 not trigger 382', r.entry, 390);
  // risk = 390-378.5 = 11.5; both rungs (410,420) hit → avg((410-390)/11.5,(420-390)/11.5)=~2.17R
  ok('gap-up R is deflated (~2.2R not ~8.9R)', r.R_stop > 1.5 && r.R_stop < 2.6);
}
// Normal breakout (no gap): price rises through the trigger intraday → fill at the trigger.
{
  const plan = { direction: 'long', entry_trigger: 100, invalidation: 98, target: 106, runner_target: 110 };
  const oh = [bar('2026-08-03', 99, 107, 98.5, 106.5), bar('2026-08-04', 106, 111, 105, 110.5)];
  const r = resolvePlan(plan, oh, {});
  near('breakout fills at trigger 100', r.entry, 100);
  near('both rungs → +((106-100)+(110-100))/2 /2 = 4R', r.R_stop, 4);
}
// Short gap-down past the trigger: fill at the open (min), not the trigger.
{
  const plan = { direction: 'short', entry_trigger: 50, invalidation: 52, target: 46, runner_target: 42 };
  const oh = [bar('2026-08-03', 48, 49, 44, 45)]; // opens 48 (already below the 50 short trigger)
  const r = resolvePlan(plan, oh, {});
  near('short gap-down fills at open 48 not 50', r.entry, 48);
}
// no-fill: price never reaches the trigger.
{
  const plan = { direction: 'long', entry_trigger: 120, invalidation: 118, target: 126, runner_target: 130 };
  const oh = [bar('2026-08-03', 100, 105, 99, 104)];
  ok('no fill when trigger never reached', resolvePlan(plan, oh, {}).outcome === 'no_fill');
}
// intraday-stop bound is <= close-stop when a tight stop is wicked then recovers.
{
  const plan = { direction: 'long', entry_trigger: 100, invalidation: 99, target: 105, runner_target: 110 };
  // wicks to 98.5 (below 99) intraday but closes 101, then runs to 110
  const oh = [bar('2026-08-03', 100, 102, 98.5, 101), bar('2026-08-04', 101, 111, 100.5, 110)];
  const r = resolvePlan(plan, oh, {});
  ok('close-stop survives the wick (positive)', r.R_stop > 0);
  ok('intraday-stop is whipsawed out (<= close-stop)', r.R_intra <= r.R_stop);
}
console.log(`\nresolve-plan.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
