// Exit-variant study — HARD-STOP FAMILY + FILL PENALTY (RESEARCH ONLY, Clause 0).
// Broadens EXIT_SIM_2026-07-13 (66 live fires) to the FULL replay dataset
// (1339 engine fires Apr10-Jul08 + 16 live) using REAL per-minute UW option marks.
//
// Fidelity guardrails (same as backtest_strategies.mjs):
//   - entry = option close at first candle >= fireTs + 60s (confirmation delay)
//   - all exits evaluated on candle CLOSE only (no intra-bar look-ahead)
//   - realized = (exit_close - entry)/entry
//
// Baseline (null) on the full replay set = HOLD-TO-EOD. Replay fires have no
// recorded live exit, so hold-EOD is the reconstructable no-management null a
// hard stop must beat. (In EXIT_SIM, hold-EOD ~= the current structure exit to
// within +3pts, so this is a faithful, slightly-conservative stand-in.)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, 'cache');
const load = f => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : []);

// ---- build per-fire option path (entry + gain steps) ----
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

// ---- exit families. Each returns realized gain fraction, and whether a STOP
//      actually fired (so a fill penalty can be applied only on stop exits). ----
// hold-to-EOD null
function holdEOD(P) { return { g: P.steps.at(-1).g, stopped: false }; }
// hard stop at -s (else hold EOD)
function hardStop(s) {
  return P => {
    for (const st of P.steps) if (st.g <= -s) return { g: st.g, stopped: true };
    return { g: P.steps.at(-1).g, stopped: false };
  };
}
// scale-out: sell HALF at +take once peak reaches it; the other half runs with a
// hard stop at -s (else EOD). Realized = 0.5*take + 0.5*(rest exit).
function scaleHalf(take, s) {
  return P => {
    let tookHalf = false; let restStopped = false;
    for (const st of P.steps) {
      if (!tookHalf && st.g >= take) tookHalf = true;
      if (st.g <= -s) { // stop hits the (remaining) position
        const g = tookHalf ? 0.5 * take + 0.5 * st.g : st.g;
        return { g, stopped: true };
      }
    }
    const last = P.steps.at(-1).g;
    const g = tookHalf ? 0.5 * take + 0.5 * last : last;
    return { g, stopped: false };
  };
}

const FAM = {
  'HOLD-EOD (null)': holdEOD,
  'STOP-25': hardStop(0.25),
  'STOP-30': hardStop(0.30),
  'STOP-35': hardStop(0.35),
  'STOP-40': hardStop(0.40),
  'STOP-50': hardStop(0.50),
  'SCALE +50/-30': scaleHalf(0.50, 0.30),
  'SCALE +50/-35': scaleHalf(0.50, 0.35),
  'SCALE +50/-40': scaleHalf(0.50, 0.40),
  'SCALE +75/-30': scaleHalf(0.75, 0.30),
};

// ---- stats helpers ----
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
const med = a => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const win = a => a.filter(x => x > 0).length / a.length;
const pct = x => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;
const p1 = x => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}`;

// ---- load + build ----
const fires = load(path.join(HERE, 'fires_index.json'));
const built = [];
for (const f of fires) { const P = buildPath(f); if (P) built.push(P); }
const days = [...new Set(built.map(P => P.day))].sort();
console.error(`built paths: ${built.length}/${fires.length} over ${days.length} days`);

// FILL PENALTY on stop exits (haircut in return points). 0 = frictionless.
const HAIR = Number(process.argv[2] || 0); // e.g. 0.02, 0.03
function realized(name, P) {
  const r = FAM[name](P);
  return r.stopped ? r.g - HAIR : r.g;
}

// ---- per-family aggregate over a subset ----
function agg(name, subset) {
  const g = subset.map(P => realized(name, P));
  return { name, n: g.length, mean: mean(g), med: med(g), win: win(g), g };
}

// ---- walk-forward: chronological day halves ----
const splitIdx = Math.floor(days.length / 2);
const trainDays = new Set(days.slice(0, splitIdx));
const testDays = new Set(days.slice(splitIdx));
const trainSet = built.filter(P => trainDays.has(P.day));
const testSet = built.filter(P => testDays.has(P.day));

// ---- leave-one-day-out worst Δ vs baseline ----
function looWorst(name) {
  let worst = Infinity;
  for (const d of days) {
    const sub = built.filter(P => P.day !== d);
    const dFam = mean(sub.map(P => realized(name, P)));
    const dBase = mean(sub.map(P => realized('HOLD-EOD (null)', P)));
    worst = Math.min(worst, dFam - dBase);
  }
  return worst;
}

// ---- bootstrap CI on Δ vs baseline (paired, by fire) ----
function bootDelta(name, B = 2000) {
  const paired = built.map(P => realized(name, P) - realized('HOLD-EOD (null)', P));
  const n = paired.length; const out = [];
  for (let b = 0; b < B; b++) {
    let s = 0; for (let i = 0; i < n; i++) s += paired[(Math.random() * n) | 0];
    out.push(s / n);
  }
  out.sort((a, b) => a - b);
  const lo = out[Math.floor(0.025 * B)], hi = out[Math.floor(0.975 * B)];
  // one-sided p that Δ<=0
  const pgt = out.filter(x => x <= 0).length / B;
  return { lo, hi, p: pgt, point: mean(paired) };
}

// ---- report ----
console.log(`\n# EXIT-VARIANT BACKTEST  (fill penalty = ${(HAIR * 100).toFixed(1)}% on stop exits)`);
console.log(`Built ${built.length} fires over ${days.length} days (${days[0]} -> ${days.at(-1)}). Baseline = HOLD-EOD.\n`);

const base = agg('HOLD-EOD (null)', built);
console.log(`ALL FIRES  (n=${base.n})`);
console.log('family'.padEnd(18) + 'avg'.padStart(8) + 'med'.padStart(8) + 'win%'.padStart(7) + 'Δbase'.padStart(8) + 'boot95CI'.padStart(18) + 'p'.padStart(7) + 'LOOworst'.padStart(10) + '  WF');
for (const name of Object.keys(FAM)) {
  const a = agg(name, built);
  const d = a.mean - base.mean;
  const trA = mean(trainSet.map(P => realized(name, P))) - mean(trainSet.map(P => realized('HOLD-EOD (null)', P)));
  const teA = mean(testSet.map(P => realized(name, P))) - mean(testSet.map(P => realized('HOLD-EOD (null)', P)));
  const wf = (name === 'HOLD-EOD (null)') ? '—' : ((trA > 0 && teA > 0) ? 'YES' : 'no');
  const boot = name === 'HOLD-EOD (null)' ? null : bootDelta(name);
  const loo = name === 'HOLD-EOD (null)' ? null : looWorst(name);
  const ci = boot ? `[${p1(boot.lo)},${p1(boot.hi)}]` : '';
  console.log(
    name.padEnd(18) + pct(a.mean).padStart(8) + pct(a.med).padStart(8) +
    (a.win * 100).toFixed(0).padStart(6) + '%' + p1(d).padStart(8) +
    ci.padStart(18) + (boot ? boot.p.toFixed(3) : '').padStart(7) +
    (loo != null ? p1(loo) : '').padStart(10) + '  ' + wf
  );
}

// ---- walk-forward detail ----
console.log(`\nWALK-FORWARD  train=${days.slice(0, splitIdx).length}d (${days[0]}..${days[splitIdx - 1]}, n=${trainSet.length})  test=${days.slice(splitIdx).length}d (${days[splitIdx]}..${days.at(-1)}, n=${testSet.length})`);
const trBase = mean(trainSet.map(P => realized('HOLD-EOD (null)', P)));
const teBase = mean(testSet.map(P => realized('HOLD-EOD (null)', P)));
console.log(`baseline: train ${pct(trBase)}  test ${pct(teBase)}`);
console.log('family'.padEnd(18) + 'trainΔ'.padStart(9) + 'testΔ'.padStart(9) + '  pass');
for (const name of Object.keys(FAM)) {
  if (name === 'HOLD-EOD (null)') continue;
  const trA = mean(trainSet.map(P => realized(name, P))) - trBase;
  const teA = mean(testSet.map(P => realized(name, P))) - teBase;
  console.log(name.padEnd(18) + p1(trA).padStart(9) + p1(teA).padStart(9) + '  ' + ((trA > 0 && teA > 0) ? 'YES' : 'no'));
}

// ---- stop-level sensitivity curve (plateau vs spike) ----
console.log(`\nSTOP-LEVEL SENSITIVITY (hard stop only, Δ vs HOLD-EOD, all fires):`);
for (const s of [0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50, 0.60]) {
  const fam = P => { for (const st of P.steps) if (st.g <= -s) return { g: st.g, stopped: true }; return { g: P.steps.at(-1).g, stopped: false }; };
  const g = built.map(P => { const r = fam(P); return r.stopped ? r.g - HAIR : r.g; });
  const d = mean(g) - base.mean;
  const bar = '#'.repeat(Math.max(0, Math.round(d * 100 / 2)));
  console.log(`  -${(s * 100).toFixed(0).padStart(2)}%  Δ ${p1(d).padStart(7)}  win ${(win(g) * 100).toFixed(0).padStart(2)}%  ${bar}`);
}

// ---- BULL_REVERSE-only cut (the real signal edge) ----
const bull = built.filter(P => P.fire.state === 'BULL_REVERSE');
console.log(`\nBULL_REVERSE ONLY  (n=${bull.length})`);
const bBase = mean(bull.map(P => realized('HOLD-EOD (null)', P)));
console.log('family'.padEnd(18) + 'avg'.padStart(8) + 'Δbase'.padStart(8));
for (const name of Object.keys(FAM)) {
  const m = mean(bull.map(P => realized(name, P)));
  console.log(name.padEnd(18) + pct(m).padStart(8) + (name === 'HOLD-EOD (null)' ? '' : p1(m - bBase)).padStart(8));
}
