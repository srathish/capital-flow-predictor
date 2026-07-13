// Trailing-stop RE-CALIBRATION study (RESEARCH ONLY, Clause 0).
// Task: two questions on the FULL replay set (~1,295 fires / 61 days).
//   (1) Grid the tracker's trailing stop: arm ∈ {.30,.50,.75,1.00} × gb ∈
//       {.10,.15,.20,.30}, plus a TWO-STAGE trail (lock/scale ½ at +50%, trail
//       the remainder looser at 25-30%). Which combo maximizes REALIZED, and
//       does it survive walk-forward + a 2-3% fill haircut? Is the current
//       0.50/0.15 near-optimal or beaten?
//   (2) WINNER-RUNNER vs EARLY-CUT split: split fires by whether they reach
//       +25% within the first N minutes. Do early-runners deserve a looser trail
//       and non-runners a faster cut? Test a trajectory-conditioned exit vs the
//       flat trail.
//
// Tracker fidelity: the live trail (plays.js) arms when peak_gain >= TRAIL_ARM_MIN_GAIN
// and exits when mid <= peak_mark*(1-gb). Algebraically that exit-gain is
// peak_g - gb*(1+peak_g) — identical to backtest_strategies.mjs trail(). There is
// NO pre-arm hard stop in the live trail, so the pure trail here has none either.
// (The live structural exit needs the Skylit surface, unavailable on the replay
// set, so the trail is isolated — the correct object for a parameter recal.)
//
// Baselines (report vs BOTH):  CURRENT = trail(0.50,0.15);  HOLD-EOD = no mgmt.
// Fidelity guardrails identical to backtest_variants.mjs:
//   entry = option close at first candle >= fireTs+60s; exits on candle CLOSE only.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, 'cache');
const load = f => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : []);

function buildPath(fire) {
  const opt = load(path.join(CACHE, `${fire.sym}_${fire.day}.json`))
    .map(c => ({ ts: Date.parse(c.start_time), close: Number(c.close) || 0 }))
    .filter(c => c.close > 0).sort((a, b) => a.ts - b.ts);
  if (opt.length < 4) return null;
  const entryTs = fire.fireTsMs + 60000;
  const ei = opt.findIndex(o => o.ts >= entryTs);
  if (ei < 0 || ei >= opt.length - 2) return null;
  const entry = opt[ei].close;
  if (!(entry > 0)) return null;
  const steps = opt.slice(ei).map(o => ({ ts: o.ts, g: (o.close - entry) / entry }));
  return { fire, entry, steps, day: fire.day };
}

// ---- exit families (each returns {g, exited} — exited=true means a reactive
//      trail/scale sell fired, so a fill haircut applies; hold-to-EOD does not). ----
const HAIR = Number(process.argv[2] || 0); // fill haircut in return points on reactive exits

// pure trailing, tracker-faithful. arm then exit on peak_g - gb*(1+peak_g).
function trail(arm, gb) {
  return P => {
    let peak = 0, armed = false;
    for (const s of P.steps) {
      if (s.g > peak) peak = s.g;
      if (!armed && peak >= arm) armed = true;
      if (armed && s.g <= peak - gb * (1 + peak)) return { g: s.g, exited: true };
    }
    return { g: P.steps.at(-1).g, exited: false };
  };
}
// two-stage: lock HALF at +lockAt (limit fill, no haircut on that half), trail the
// remainder off the full peak at gb. Realized = 0.5*lockAt + 0.5*(remainder exit).
function twoStage(lockAt, gb) {
  return P => {
    let peak = 0, locked = false;
    for (const s of P.steps) {
      if (s.g > peak) peak = s.g;
      if (!locked && s.g >= lockAt) locked = true;
      if (locked && s.g <= peak - gb * (1 + peak)) {
        return { g: 0.5 * lockAt + 0.5 * s.g, exited: true, half: true };
      }
    }
    const last = P.steps.at(-1).g;
    return { g: locked ? 0.5 * lockAt + 0.5 * last : last, exited: false };
  };
}
function holdEOD() { return P => ({ g: P.steps.at(-1).g, exited: false }); }

// trajectory classifier: did the fire reach +25% within the first N minutes?
function earlyRunner(P, N, thr = 0.25) {
  const t0 = P.steps[0].ts;
  for (const s of P.steps) { if (s.ts - t0 > N * 60000) break; if (s.g >= thr) return true; }
  return false;
}
// conditioned exit: pick a different exit fn by early-runner status
function conditioned(N, runnerFn, nonRunnerFn) {
  return P => (earlyRunner(P, N) ? runnerFn(P) : nonRunnerFn(P));
}

// realized with haircut applied to reactive exits (the half-lock leg fills clean)
function realized(fn, P) {
  const r = fn(P);
  if (!r.exited) return r.g;
  return r.half ? r.g - 0.5 * HAIR : r.g - HAIR;   // two-stage: only the remainder leg is reactive
}

// ---- families ----
const FAM = {};
FAM['HOLD-EOD (null)'] = holdEOD();
FAM['CURRENT 0.50/0.15'] = trail(0.50, 0.15);
for (const arm of [0.30, 0.50, 0.75, 1.00])
  for (const gb of [0.10, 0.15, 0.20, 0.30])
    FAM[`trail ${arm.toFixed(2)}/${gb.toFixed(2)}`] = trail(arm, gb);
FAM['2stage +50 / tr25'] = twoStage(0.50, 0.25);
FAM['2stage +50 / tr30'] = twoStage(0.50, 0.30);
FAM['2stage +50 / tr20'] = twoStage(0.50, 0.20);

// ---- stats helpers ----
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
const med = a => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const win = a => a.length ? a.filter(x => x > 0).length / a.length : NaN;
const pct = x => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;
const p1 = x => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}`;

// ---- load + build ----
const fires = load(path.join(HERE, 'fires_index.json'));
const built = [];
for (const f of fires) { const P = buildPath(f); if (P) built.push(P); }
const days = [...new Set(built.map(P => P.day))].sort();
console.error(`built paths: ${built.length}/${fires.length} over ${days.length} days`);

const splitIdx = Math.floor(days.length / 2);
const trainDays = new Set(days.slice(0, splitIdx));
const testDays = new Set(days.slice(splitIdx));
const trainSet = built.filter(P => trainDays.has(P.day));
const testSet = built.filter(P => testDays.has(P.day));

function aggG(fn, subset) { return subset.map(P => realized(fn, P)); }
// paired bootstrap Δ vs a reference family
function bootDelta(fn, refFn, subset, B = 2000) {
  const paired = subset.map(P => realized(fn, P) - realized(refFn, P));
  const n = paired.length; const out = [];
  for (let b = 0; b < B; b++) { let s = 0; for (let i = 0; i < n; i++) s += paired[(Math.random() * n) | 0]; out.push(s / n); }
  out.sort((a, b) => a - b);
  return { lo: out[Math.floor(0.025 * B)], hi: out[Math.floor(0.975 * B)], p: out.filter(x => x <= 0).length / B, point: mean(paired) };
}
function looWorst(fn, refFn) {
  let worst = Infinity;
  for (const d of days) {
    const sub = built.filter(P => P.day !== d);
    worst = Math.min(worst, mean(aggG(fn, sub)) - mean(aggG(refFn, sub)));
  }
  return worst;
}

// ================= REPORT =================
console.log(`\n# TRAIL RE-CALIBRATION  (fill haircut = ${(HAIR * 100).toFixed(1)}% on reactive exits)`);
console.log(`Built ${built.length} fires over ${days.length} days (${days[0]} -> ${days.at(-1)}).`);
const curr = FAM['CURRENT 0.50/0.15'], hold = FAM['HOLD-EOD (null)'];
console.log(`Baselines:  HOLD-EOD avg ${pct(mean(aggG(hold, built)))} | CURRENT 0.50/0.15 avg ${pct(mean(aggG(curr, built)))}\n`);

// ---- Q1: full grid + two-stage, vs CURRENT and vs HOLD-EOD ----
console.log(`Q1 — GRID + TWO-STAGE  (n=${built.length})`);
console.log('family'.padEnd(20) + 'avg'.padStart(8) + 'med'.padStart(8) + 'win%'.padStart(6) +
  'Δcurr'.padStart(8) + 'Δhold'.padStart(8) + '  boot95(vs curr)'.padEnd(20) + 'p'.padStart(6) + 'LOOw'.padStart(7) + '  WF');
const currAll = mean(aggG(curr, built)), holdAll = mean(aggG(hold, built));
const currTr = mean(aggG(curr, trainSet)), currTe = mean(aggG(curr, testSet));
for (const name of Object.keys(FAM)) {
  const fn = FAM[name];
  const a = mean(aggG(fn, built));
  const dCur = a - currAll, dHold = a - holdAll;
  const isRef = name === 'CURRENT 0.50/0.15' || name === 'HOLD-EOD (null)';
  const boot = isRef ? null : bootDelta(fn, curr, built);
  const loo = isRef ? null : looWorst(fn, curr);
  const trA = mean(aggG(fn, trainSet)) - currTr, teA = mean(aggG(fn, testSet)) - currTe;
  const wf = isRef ? '—' : ((trA > 0 && teA > 0) ? 'YES' : (trA < 0 && teA < 0) ? 'no(both-)' : 'mixed');
  const ci = boot ? `[${p1(boot.lo)},${p1(boot.hi)}]` : '';
  console.log(
    name.padEnd(20) + pct(a).padStart(8) + pct(med(aggG(fn, built))).padStart(8) +
    (win(aggG(fn, built)) * 100).toFixed(0).padStart(5) + '%' +
    p1(dCur).padStart(8) + p1(dHold).padStart(8) + '  ' + ci.padEnd(18) +
    (boot ? boot.p.toFixed(3) : '').padStart(6) + (loo != null ? p1(loo) : '').padStart(7) + '  ' + wf);
}

// ---- Q1 walk-forward detail (vs CURRENT trail) ----
console.log(`\nWALK-FORWARD  train=${trainDays.size}d (${days[0]}..${days[splitIdx - 1]}, n=${trainSet.length})  test=${testDays.size}d (${days[splitIdx]}..${days.at(-1)}, n=${testSet.length})`);
console.log(`CURRENT trail baseline: train ${pct(currTr)}  test ${pct(currTe)}   HOLD-EOD: train ${pct(mean(aggG(hold, trainSet)))} test ${pct(mean(aggG(hold, testSet)))}`);
console.log('family'.padEnd(20) + 'trainΔcurr'.padStart(11) + 'testΔcurr'.padStart(11) + '  pass(beat curr both)');
for (const name of Object.keys(FAM)) {
  if (name === 'CURRENT 0.50/0.15' || name === 'HOLD-EOD (null)') continue;
  const trA = mean(aggG(FAM[name], trainSet)) - currTr, teA = mean(aggG(FAM[name], testSet)) - currTe;
  console.log(name.padEnd(20) + p1(trA).padStart(11) + p1(teA).padStart(11) + '  ' + ((trA > 0 && teA > 0) ? 'YES' : 'no'));
}

// ---- Q1 giveback-plateau at fixed arm=0.50 (plateau vs spike test) ----
console.log(`\nGIVEBACK SENSITIVITY at arm=0.50 (Δ vs HOLD-EOD, all fires) — plateau vs slope:`);
for (const gb of [0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.40]) {
  const g = aggG(trail(0.50, gb), built); const d = mean(g) - holdAll;
  console.log(`  gb ${(gb * 100).toFixed(0).padStart(2)}%  avg ${pct(mean(g)).padStart(7)}  Δhold ${p1(d).padStart(6)}  win ${(win(g) * 100).toFixed(0).padStart(2)}%  ${'#'.repeat(Math.max(0, Math.round((d + 5) * 100 / 3)))}`);
}
console.log(`ARM SENSITIVITY at gb=0.15 (Δ vs HOLD-EOD, all fires):`);
for (const arm of [0.25, 0.30, 0.40, 0.50, 0.75, 1.00, 1.50]) {
  const g = aggG(trail(arm, 0.15), built); const d = mean(g) - holdAll;
  console.log(`  arm ${(arm * 100).toFixed(0).padStart(3)}%  avg ${pct(mean(g)).padStart(7)}  Δhold ${p1(d).padStart(6)}  win ${(win(g) * 100).toFixed(0).padStart(2)}%  ${'#'.repeat(Math.max(0, Math.round((d + 5) * 100 / 3)))}`);
}

// ---- Q2: winner-runner vs early-cut split ----
console.log(`\nQ2 — TRAJECTORY SPLIT: reach +25% within first N minutes?`);
for (const N of [5, 10, 15, 30]) {
  const run = built.filter(P => earlyRunner(P, N)), non = built.filter(P => !earlyRunner(P, N));
  console.log(`  N=${String(N).padStart(2)}m  runners ${String(run.length).padStart(4)} (${(run.length / built.length * 100).toFixed(0)}%)  ` +
    `hold-EOD run ${pct(mean(aggG(hold, run))).padStart(7)} / non ${pct(mean(aggG(hold, non))).padStart(7)}   ` +
    `curr-trail run ${pct(mean(aggG(curr, run))).padStart(7)} / non ${pct(mean(aggG(curr, non))).padStart(7)}`);
}

// conditioned exits (use N=10 as the split), compared vs flat CURRENT and best-flat
const N = 10;
const COND = {
  'COND run→hold / non→tr30/10': conditioned(N, holdEOD(), trail(0.30, 0.10)),
  'COND run→tr50/30 / non→tr30/10': conditioned(N, trail(0.50, 0.30), trail(0.30, 0.10)),
  'COND run→tr50/30 / non→tr30/15': conditioned(N, trail(0.50, 0.30), trail(0.30, 0.15)),
  'COND run→hold / non→tr30/15': conditioned(N, holdEOD(), trail(0.30, 0.15)),
  'COND run→tr75/30 / non→tr30/10': conditioned(N, trail(0.75, 0.30), trail(0.30, 0.10)),
};
console.log(`\nCONDITIONED EXITS (split at +25% within ${N}m)  vs CURRENT 0.50/0.15  (n=${built.length})`);
console.log('family'.padEnd(34) + 'avg'.padStart(8) + 'med'.padStart(8) + 'win%'.padStart(6) + 'Δcurr'.padStart(8) + '  boot95(vs curr)'.padEnd(20) + 'p'.padStart(6) + '  WFpass');
for (const name of Object.keys(COND)) {
  const fn = COND[name]; const g = aggG(fn, built);
  const boot = bootDelta(fn, curr, built);
  const trA = mean(aggG(fn, trainSet)) - currTr, teA = mean(aggG(fn, testSet)) - currTe;
  console.log(name.padEnd(34) + pct(mean(g)).padStart(8) + pct(med(g)).padStart(8) +
    (win(g) * 100).toFixed(0).padStart(5) + '%' + p1(mean(g) - currAll).padStart(8) + '  ' +
    `[${p1(boot.lo)},${p1(boot.hi)}]`.padEnd(18) + boot.p.toFixed(3).padStart(6) + '  ' + ((trA > 0 && teA > 0) ? 'YES' : 'no'));
}

// ---- state cuts for the top grid cells (composition matters: 521 bull, 797 bear) ----
console.log(`\nSTATE CUT — CURRENT vs a loose & a tight grid cell, by state:`);
const cells = { 'HOLD-EOD': hold, 'CURRENT 0.50/0.15': curr, 'trail 0.50/0.30': trail(0.50, 0.30), 'trail 0.30/0.10': trail(0.30, 0.10), '2stage +50/tr30': twoStage(0.50, 0.30) };
for (const st of ['BULL_REVERSE', 'BEAR_RUG']) {
  const sub = built.filter(P => P.fire.state === st);
  const parts = Object.entries(cells).map(([nm, fn]) => `${nm} ${pct(mean(aggG(fn, sub)))}`);
  console.log(`  ${st} (n=${sub.length}): ` + parts.join(' | '));
}
