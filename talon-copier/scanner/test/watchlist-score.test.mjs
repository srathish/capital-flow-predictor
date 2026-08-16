// watchlist-score.test.mjs — pure OTE-pullback resolver + aggregate (no network).
import { resolveOteSetup, aggregate } from '../lib/watchlist-score.mjs';

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}`); } };
const near = (n, g, w) => ok(`${n} (${g}≈${w})`, g != null && Math.abs(g - w) < 0.01);
const bar = (date, o, h, l, c) => ({ date, open: o, high: h, low: l, close: c });

// ---- LONG target: price dips to OTE (fill), then rallies through T1 ----
// ote 100 · inval 95 · t1 110 → risk 5, reward 10 → R +2 on target
{
  const oh = [bar('2026-08-03', 101, 103, 99, 102), bar('2026-08-04', 102, 112, 101, 111)];
  const r = resolveOteSetup({ direction: 'bullish', ote: 100, invalidation: 95, first_target: 110 }, oh, { from: '2026-08-03', to: '2026-08-07' });
  ok('long fills on the pullback', r.entered && r.entry_date === '2026-08-03');
  ok('long hits target', r.outcome === 'target');
  near('long target R', r.R, 2);
}
// ---- LONG invalidation: dips to OTE, then closes below inval ----
{
  const oh = [bar('2026-08-03', 101, 103, 99, 100), bar('2026-08-04', 99, 100, 93, 94)];
  const r = resolveOteSetup({ direction: 'long', ote: 100, invalidation: 95, first_target: 110 }, oh, {});
  ok('long invalidation outcome', r.outcome === 'invalidation');
  near('long invalidation R (close 94, close-basis)', r.R, (94 - 100) / 5);
  near('long invalidation R_stop (hard stop = -1R)', r.R_stop, -1);
}
// ---- LONG no-fill: price never dips to the OTE ----
{
  const oh = [bar('2026-08-03', 102, 106, 101, 105), bar('2026-08-04', 105, 108, 104, 107)];
  const r = resolveOteSetup({ direction: 'long', ote: 100, invalidation: 95, first_target: 110 }, oh, {});
  ok('long no-fill', !r.entered && r.outcome === 'no_fill' && r.R === 0);
}
// ---- LONG open: fills, neither target nor inval by window end → marked to last close ----
{
  const oh = [bar('2026-08-03', 101, 103, 99, 102), bar('2026-08-04', 102, 105, 100, 104)];
  const r = resolveOteSetup({ direction: 'long', ote: 100, invalidation: 95, first_target: 110 }, oh, {});
  ok('long open outcome', r.outcome === 'open');
  near('long open R (mark 104)', r.R, (104 - 100) / 5);
}
// ---- SHORT target: price rallies to OTE (fill), then drops through T1 ----
// ote 100 · inval 105 · t1 90 → risk 5, reward 10 → R +2
{
  const oh = [bar('2026-08-03', 99, 101, 98, 100), bar('2026-08-04', 100, 101, 89, 90)];
  const r = resolveOteSetup({ direction: 'bearish', ote: 100, invalidation: 105, first_target: 90 }, oh, {});
  ok('short fills on the rally', r.entered);
  ok('short hits target', r.outcome === 'target');
  near('short target R', r.R, 2);
}
// ---- incomplete levels guarded ----
ok('incomplete levels → incomplete', resolveOteSetup({ direction: 'long', ote: 100, invalidation: null, first_target: 110 }, [], {}).outcome === 'incomplete');

// ---- aggregate ----
{
  const rs = [
    { entered: true, outcome: 'target', R: 2 },
    { entered: true, outcome: 'invalidation', R: -1.2 },
    { entered: false, outcome: 'no_fill', R: 0 },
  ];
  const a = aggregate(rs);
  ok('aggregate entered=2', a.entered === 2);
  ok('aggregate hits=1', a.hits === 1);
  near('aggregate hit_rate', a.hit_rate, 0.5);
  near('aggregate avg_R', a.avg_R, 0.4);
  ok('aggregate no_fill counted', a.no_fill === 1);
}

console.log(`\nwatchlist-score.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
