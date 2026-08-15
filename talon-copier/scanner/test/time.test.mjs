// time.test.mjs — pure fixture tests for the America/New_York time math (no network).
import { skylitTimestamp, etDate, isWeekendET, isTradingDayET, priorSessions, forwardSessions } from '../lib/time.mjs';

let pass = 0, fail = 0;
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function ok(name, cond) { if (cond) pass++; else { fail++; console.log(`  ✗ ${name}`); } }

// EDT (summer, UTC-4): 16:00 ET = 20:00Z
eq('skylitTimestamp EDT 16:00', skylitTimestamp('2026-08-07', '16:00'), '2026-08-07T20:00:00.000Z');
// EST (winter, UTC-5): 16:00 ET = 21:00Z
eq('skylitTimestamp EST 16:00', skylitTimestamp('2026-01-15', '16:00'), '2026-01-15T21:00:00.000Z');
// 09:30 ET open in EDT = 13:30Z (matches replay_pull convention)
eq('skylitTimestamp EDT 09:30', skylitTimestamp('2026-07-15', '09:30'), '2026-07-15T13:30:00.000Z');

// etDate maps a UTC instant back to the ET calendar date
eq('etDate 20:00Z EDT', etDate(new Date('2026-08-07T20:00:00.000Z')), '2026-08-07');
eq('etDate 03:30Z next day still prior ET date', etDate(new Date('2026-08-08T03:30:00.000Z')), '2026-08-07');

// weekend / holiday classification
ok('2026-08-15 is Saturday', isWeekendET('2026-08-15') === true);
ok('2026-08-14 is Friday (weekday)', isWeekendET('2026-08-14') === false);
ok('2026-01-19 MLK holiday not a trading day', isTradingDayET('2026-01-19') === false);
ok('2026-01-20 is a trading day', isTradingDayET('2026-01-20') === true);
ok('2026-07-03 (observed July 4) not a trading day', isTradingDayET('2026-07-03') === false);

// trailing sessions skip weekends
eq('priorSessions Sat 8/15 x3', priorSessions('2026-08-15', 3), ['2026-08-14', '2026-08-13', '2026-08-12']);
// trailing sessions skip the MLK holiday + weekend
eq('priorSessions 1/20 x1 skips MLK+wknd', priorSessions('2026-01-20', 1), ['2026-01-16']);
// forward sessions skip the weekend
eq('forwardSessions Fri 8/14 x2', forwardSessions('2026-08-14', 2), ['2026-08-17', '2026-08-18']);

// structural invariants
const fwd = forwardSessions('2026-07-15', 10);
ok('forwardSessions all after input', fwd.every((d) => d > '2026-07-15'));
ok('forwardSessions all trading days', fwd.every(isTradingDayET));
ok('forwardSessions ascending', fwd.every((d, i) => i === 0 || d > fwd[i - 1]));
ok('forwardSessions length 10', fwd.length === 10);

console.log(`\ntime.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
