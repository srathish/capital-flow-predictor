#!/usr/bin/env node
// Permutation test — the anti-overfit gate. Shuffle the feature label WITHIN each week
// (preserving week composition + group sizes) N times; how often does chance beat the
// observed mean-R gap? If p isn't small, the "edge" is noise from slicing 72 rows.
import { resolveFromRoot, readJson, log } from '../../lib/util.mjs';
const D = readJson(resolveFromRoot('research/perexpiry-oos/dataset.json'));
const rows = D.rows;
const R = (x) => x.R_stop ?? 0;
const mean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
const WEEKS = ['2026-07-13', '2026-07-20', '2026-07-27', '2026-08-03'];
// seeded LCG so results are reproducible without Date/Math.random reliance issues
let seed = 1234567;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

function stratPerm(isA, nPerm = 20000) {
  const A = rows.filter(isA), B = rows.filter((r) => !isA(r));
  const obs = mean(A.map(R)) - mean(B.map(R));
  const byWeek = {}; for (const r of rows) (byWeek[r.week] ||= []).push(r);
  const kOf = {}; for (const w of WEEKS) kOf[w] = (byWeek[w] || []).filter(isA).length;
  let ge = 0;
  for (let p = 0; p < nPerm; p++) {
    const aR = [], bR = [];
    for (const w of WEEKS) {
      const arr = (byWeek[w] || []).map(R);
      for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
      for (let i = 0; i < arr.length; i++) (i < kOf[w] ? aR : bR).push(arr[i]);
    }
    if (mean(aR) - mean(bR) >= obs) ge++;
  }
  return { nA: A.length, nB: B.length, meanA: mean(A.map(R)), meanB: mean(B.map(R)), obs, p: ge / nPerm };
}

log(`\n════ PERMUTATION TESTS (stratified by week, 20k shuffles, seeded) ════`);
log('p = P(random split beats observed gap). Small p = signal; p>0.1 = likely noise.\n');
const tests = [
  ['near wall (<=4%) vs far/none', (r) => r.t1RoomPct != null && r.t1RoomPct <= 4],
  ['CONFIRM vs not', (r) => r.verdict === 'CONFIRM'],
  ['strongFloor vs not', (r) => r.strongFloor],
  ['magnet <50M vs >=50M', (r) => r.vannaMagnetM > 0 && r.vannaMagnetM < 50],
  ['magnet 50-200M (the trap) vs rest', (r) => r.vannaMagnetM >= 50 && r.vannaMagnetM < 200],
  ['near wall & magnet<50M vs rest', (r) => r.t1RoomPct != null && r.t1RoomPct <= 4 && r.vannaMagnetM < 50],
  ['has ANY wall (room!=null) vs none', (r) => r.t1RoomPct != null],
];
for (const [name, fn] of tests) {
  const t = stratPerm(fn);
  const flag = t.p <= 0.05 ? ' ***' : t.p <= 0.10 ? ' *' : t.obs < 0 ? '  (neg)' : '';
  log(`${name.padEnd(38)} A=${String(t.nA).padStart(2)}(${t.meanA >= 0 ? '+' : ''}${t.meanA.toFixed(2)}) B=${String(t.nB).padStart(2)}(${t.meanB >= 0 ? '+' : ''}${t.meanB.toFixed(2)})  gap ${t.obs >= 0 ? '+' : ''}${t.obs.toFixed(2)}  p=${t.p.toFixed(3)}${flag}`);
}
log('\n*** p<=.05  * p<=.10.  Reminder: 4 weeks / 72 rows is WEAK evidence even at p<.05 (multiple comparisons).');
