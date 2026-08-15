// resolve.test.mjs — hand-computed asserts for the outcome resolver (pure, no network).
import { resolveCard, resolveMagnetReach } from '../lib/resolve.mjs';

let pass = 0, fail = 0;
function eq(name, got, want) { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else { fail++; console.log(`  ✗ ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); } }
function approx(name, got, want, tol = 1e-9) { if (typeof got === 'number' && Math.abs(got - want) <= tol) pass++; else { fail++; console.log(`  ✗ ${name}: got ${got} want ${want}`); } }

const FROM = '2026-08-14';
const bar = (date, o, h, l, c) => ({ date, open: o, high: h, low: l, close: c });
const longPlan = (over = {}) => ({ direction: 'long', entry_trigger: 978, invalidation: 965, target: 1000, runner_target: 1100, time_stop: 5, contract: { expiry: '2026-08-21' }, ...over });

// 1. target hit intraday
let r = resolveCard(longPlan(), [bar('2026-08-17', 975, 979, 974, 977), bar('2026-08-18', 978, 990, 980, 988), bar('2026-08-19', 989, 1002, 995, 1000)], FROM);
eq('1 status target', r.status, 'target');
eq('1 triggered', r.triggered, true);
eq('1 days_to_trigger', r.days_to_trigger, 1);
eq('1 days_held', r.days_held, 3);
eq('1 hit_target', r.hit_target, true);
eq('1 hit_runner false', r.hit_runner, false);
eq('1 entry_price', r.entry_price, 978);
eq('1 exit_price', r.exit_price, 1000);
approx('1 mfe = 1002-978', r.mfe, 24);
approx('1 mae = 974-978', r.mae, -4);

// 2. invalidation on a CLOSING basis
r = resolveCard(longPlan(), [bar('2026-08-17', 975, 979, 974, 977), bar('2026-08-18', 977, 980, 960, 962)], FROM);
eq('2 status invalidation', r.status, 'invalidation');
eq('2 exit_price = close', r.exit_price, 962);
eq('2 days_held', r.days_held, 2);

// 2b. intraday dip BELOW invalidation but closes above → survives (closing basis)
r = resolveCard(longPlan(), [bar('2026-08-17', 975, 979, 974, 977), bar('2026-08-18', 977, 980, 960, 968), bar('2026-08-19', 990, 1001, 985, 1000)], FROM);
eq('2b survives intraday dip, resolves target', r.status, 'target');

// 3. pre-entry invalidation → never triggered
r = resolveCard(longPlan(), [bar('2026-08-17', 972, 977, 970, 968), bar('2026-08-18', 967, 976, 960, 963)], FROM);
eq('3 never_triggered', r.status, 'never_triggered');
eq('3 not triggered', r.triggered, false);
eq('3 reason pre-entry', r.exit_reason, 'pre-entry invalidation');

// 4. time stop
r = resolveCard(longPlan({ time_stop: 3 }), [bar('2026-08-17', 976, 979, 974, 978), bar('2026-08-18', 980, 985, 979, 983), bar('2026-08-19', 984, 990, 983, 988)], FROM);
eq('4 status time_stop', r.status, 'time_stop');
eq('4 exit at close', r.exit_price, 988);
eq('4 days_held = time_stop', r.days_held, 3);

// 5. no trigger in the whole window → never triggered
r = resolveCard(longPlan(), [bar('2026-08-17', 972, 977, 970, 975), bar('2026-08-18', 974, 976, 971, 974), bar('2026-08-19', 973, 977, 970, 976)], FROM);
eq('5 never_triggered (no trigger)', r.status, 'never_triggered');

// 6. short card mirror → target
r = resolveCard({ direction: 'short', entry_trigger: 900, invalidation: 920, target: 850, runner_target: 800, time_stop: 5, contract: { expiry: '2026-08-21' } },
  [bar('2026-08-17', 908, 905, 899, 902), bar('2026-08-18', 890, 895, 855, 860), bar('2026-08-19', 856, 858, 848, 852)], FROM);
eq('6 short status target', r.status, 'target');
eq('6 short direction', r.direction, 'short');
eq('6 short entry_price', r.entry_price, 900);
eq('6 short exit_price', r.exit_price, 850);

// resolveMagnetReach
let m = resolveMagnetReach(1000, 972.94, [bar('2026-08-17', 975, 980, 973, 978), bar('2026-08-18', 979, 990, 978, 988), bar('2026-08-19', 989, 1002, 985, 1000)], FROM, { horizonDays: 5, stopPct: 0.05 });
eq('A magnet reached', m.reached, true);
eq('A days_to_reach', m.days_to_reach, 3);
m = resolveMagnetReach(1000, 972.94, [bar('2026-08-17', 970, 975, 915, 920)], FROM, { horizonDays: 5, stopPct: 0.05 });
eq('B stopped out (close < spot*0.95)', m.stopped_out, true);
eq('B not reached', m.reached, false);
m = resolveMagnetReach(1000, 972.94, [bar('2026-08-17', 975, 980, 973, 978), bar('2026-08-18', 979, 985, 978, 983)], FROM, { horizonDays: 2, stopPct: 0.05 });
eq('C neither reached nor stopped', m.reached === false && m.stopped_out === false, true);
approx('C mfe_pct = (985-972.94)/972.94', m.mfe_pct, (985 - 972.94) / 972.94, 1e-9);

console.log(`\nresolve.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
