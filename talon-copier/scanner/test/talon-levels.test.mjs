// talon-levels.test.mjs — deterministic Talon-level reproduction (pure, no network).
import { talonLevels, talonLevelsBearish } from '../lib/talon-levels.mjs';

let pass = 0, fail = 0;
const eq = (n, g, w) => { if (JSON.stringify(g) === JSON.stringify(w)) pass++; else { fail++; console.log(`  ✗ ${n}: got ${JSON.stringify(g)} want ${JSON.stringify(w)}`); } };
const ok = (n, c) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}`); } };

// MU-like: spot 972 · +gamma support 960/940 below · +gamma walls 995/1000/1100 above
// (plus a tiny 5% wall we should keep and a short-gamma 965 that is NOT support) ·
// vanna magnets 1000/1100/1190 above.
const s = {
  spot: 972,
  gamma: { nodes: [
    { strike: 960, sign: 'pos', share: 8, position: 'below' },
    { strike: 940, sign: 'pos', share: 5, position: 'below' },
    { strike: 965, sign: 'neg', share: 6, position: 'below' }, // short-gamma, not a support
    { strike: 995, sign: 'pos', share: 4, position: 'above' },
    { strike: 1000, sign: 'pos', share: 10, position: 'above' },
    { strike: 1100, sign: 'pos', share: 7, position: 'above' },
    { strike: 985, sign: 'pos', share: 1, position: 'above' }, // tiny wall, filtered
  ] },
  vanna: { nodes: [
    { strike: 1000, sign: 'pos', share: 6, position: 'above' },
    { strike: 1100, sign: 'pos', share: 8, position: 'above' },
    { strike: 1190, sign: 'pos', share: 5, position: 'above' },
    { strike: 900, sign: 'pos', share: 4, position: 'below' },
  ] },
};

const L = talonLevels(s);
eq('OTE = nearest +gamma support below spot', L.ote, 960);
eq('invalidation = next support below', L.invalidation, 940);
eq('T1 = nearest SIGNIFICANT +gamma wall (tiny 985 skipped)', L.first_target, 995);
eq('swing = vanna magnets above', L.swing_targets, [1000, 1100, 1190]);
ok('R:R = (995-960)/(960-940) = 1.75', Math.abs(L.rr - 1.75) < 0.01);

// bearish mirror
const Lb = talonLevelsBearish(s);
eq('bearish OTE = nearest resistance above', Lb.ote, 995);
eq('bearish first_target = nearest floor below', Lb.first_target, 960);
eq('bearish swing = vanna below', Lb.swing_targets, [900]);

console.log(`\ntalon-levels.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
