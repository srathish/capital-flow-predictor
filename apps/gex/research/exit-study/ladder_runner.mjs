// LADDER × RUNNER study (RESEARCH ONLY, Clause 0).
// Question: the verified scale-out ladder (⅓@+50 / ⅓@+100 / trail final third) beats
// the live trail on average, but CAPS the fat tail (ghost A/B lost -3.9pt on the day
// containing a +432% runner). Is there a runner-preserving variant that keeps the
// round-trip capture AND the tail?
//
// PRE-REGISTERED variants (fixed BEFORE any result was looked at) — see VARIANTS below.
// Fidelity: entry = option close at first candle >= fire+60s; all exits close-basis;
// limit rungs credited only if the level HOLDS >= NBAR consecutive bars; haircut on the
// MARKET-exited fraction (trail/stop/EOD); 'all' mode charges every leg incl. limits.
//
// Usage: node ladder_runner.mjs [haircut=0.03] [nbar=2] [all]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, 'cache');
const load = f => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : []);

const HAIR = Number(process.argv[2] ?? 0.03);
const NBAR = Number(process.argv[3] ?? 2);
const HAIR_ALL = process.argv[4] === 'all';

// ---------- path build (same contract as verify_scaleout.mjs) ----------
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
  // running peak (causal, close basis) — used for runner-aware logic and MFE labels
  let pk = -Infinity; const peakUpTo = steps.map(s => (pk = Math.max(pk, s.g)));
  return { fire, entry, steps, peakUpTo, day: fire.day, ticker: fire.ticker,
           mfe: peakUpTo.at(-1), eod: steps.at(-1).g };
}

// ---------- legs ----------
// trailing leg from startIdx. peak0 = peak already seen (causal). arm = level at which
// the trail activates. gb = giveback fraction of peak. stop = hard stop (null = none).
function trailLeg(steps, startIdx, peak0, arm, gb, stop) {
  let peak = peak0, armed = peak >= arm;
  for (let i = startIdx; i < steps.length; i++) {
    const g = steps[i].g;
    if (g > peak) peak = g;
    if (!armed && peak >= arm) armed = true;
    if (stop != null && g <= -stop) return g;
    if (armed && (1 + g) <= (1 + peak) * (1 - gb)) return g;
  }
  return steps.at(-1).g;
}
function holdLeg(steps) { return steps.at(-1).g; }

// rung fill: index of the Nth consecutive bar whose CLOSE is at/above `take`, searching
// from `from`. -1 if the level is never held that long.
function confirmFill(steps, take, nbar, from = 0) {
  let run = 0;
  for (let i = from; i < steps.length; i++) {
    if (steps[i].g >= take) { run += 1; if (run >= nbar) return i; }
    else run = 0;
  }
  return -1;
}

// ---------- PRE-REGISTERED VARIANTS ----------
// Every family returns { g, marketFrac } — marketFrac = position fraction exited at
// market (haircut applies); the rest left at limit rungs.
const FAM = {};

// --- baselines ---
FAM['HOLD-EOD']                = P => ({ g: holdLeg(P.steps), marketFrac: 1 });
FAM['LIVE-TRAIL a50/gb15']     = P => ({ g: trailLeg(P.steps, 0, -Infinity, 0.50, 0.15, 0.60), marketFrac: 1 });

// --- BASE LADDER (the verified one): ⅓@+50, ⅓@+100, final third trails gb30/stop60 ---
// generic two-rung ladder with configurable back-half management
function ladder2(t1, t2, backFn) {
  return P => {
    const s = P.steps;
    const i1 = confirmFill(s, t1, NBAR);
    if (i1 < 0) return { g: trailLeg(s, 0, -Infinity, 0.50, 0.30, 0.60), marketFrac: 1 }; // never reached rung1
    const i2 = confirmFill(s, t2, NBAR, i1);
    if (i2 < 0) {                                   // rung1 only
      const rest = backFn(s, i1, P.peakUpTo[i1], 2 / 3);
      return { g: (1 / 3) * t1 + (2 / 3) * rest.g, marketFrac: 2 / 3 };
    }
    const rest = backFn(s, i2, P.peakUpTo[i2], 1 / 3);
    return { g: (1 / 3) * t1 + (1 / 3) * t2 + (1 / 3) * rest.g, marketFrac: 1 / 3 };
  };
}
const backTrail = (gb, stop = 0.60) => (s, i, pk) => ({ g: trailLeg(s, i, pk, -Infinity, gb, stop) });
const backHold  = () => (s) => ({ g: holdLeg(s) });

FAM['BASE ⅓@50 ⅓@100 tr30']    = ladder2(0.50, 1.00, backTrail(0.30));
// (a) final third HOLDS to EOD
FAM['(a) ⅓/⅓/HOLD-EOD']        = ladder2(0.50, 1.00, backHold());
// (b) final third trails LOOSE
FAM['(b1) ⅓/⅓/tr40']           = ladder2(0.50, 1.00, backTrail(0.40));
FAM['(b2) ⅓/⅓/tr50']           = ladder2(0.50, 1.00, backTrail(0.50));

// (c) ONE rung only: ⅓@+50, remaining ⅔ trails loose
function ladder1(t1, gb) {
  return P => {
    const s = P.steps;
    const i1 = confirmFill(s, t1, NBAR);
    if (i1 < 0) return { g: trailLeg(s, 0, -Infinity, 0.50, gb, 0.60), marketFrac: 1 };
    const rest = trailLeg(s, i1, P.peakUpTo[i1], -Infinity, gb, 0.60);
    return { g: (1 / 3) * t1 + (2 / 3) * rest, marketFrac: 2 / 3 };
  };
}
FAM['(c1) ⅓@50 + ⅔ tr30']      = ladder1(0.50, 0.30);
FAM['(c2) ⅓@50 + ⅔ tr40']      = ladder1(0.50, 0.40);

// (d/e) RUNNER-AWARE: run the base ladder, but if the causal running peak has already
// reached RUN_T at the bar where rung-2 would fill, SKIP rung 2 and let the remaining
// ⅔ ride (loose trail, or hold). Purely causal — peakUpTo[i] uses bars <= i only.
function runnerAware(t1, t2, runT, backFn) {
  return P => {
    const s = P.steps;
    const i1 = confirmFill(s, t1, NBAR);
    if (i1 < 0) return { g: trailLeg(s, 0, -Infinity, 0.50, 0.30, 0.60), marketFrac: 1 };
    const i2 = confirmFill(s, t2, NBAR, i1);
    if (i2 < 0) {
      const rest = trailLeg(s, i1, P.peakUpTo[i1], -Infinity, 0.30, 0.60);
      return { g: (1 / 3) * t1 + (2 / 3) * rest, marketFrac: 2 / 3 };
    }
    if (P.peakUpTo[i2] >= runT) {                   // RUNNER detected at rung-2 time → skip rung 2
      const rest = backFn(s, i2, P.peakUpTo[i2], 2 / 3);
      return { g: (1 / 3) * t1 + (2 / 3) * rest.g, marketFrac: 2 / 3, runner: true };
    }
    const rest = trailLeg(s, i2, P.peakUpTo[i2], -Infinity, 0.30, 0.60);
    return { g: (1 / 3) * t1 + (1 / 3) * t2 + (1 / 3) * rest, marketFrac: 1 / 3 };
  };
}
FAM['(d1) RA150 → ⅔ tr40']     = runnerAware(0.50, 1.00, 1.50, backTrail(0.40));
FAM['(d2) RA200 → ⅔ tr40']     = runnerAware(0.50, 1.00, 2.00, backTrail(0.40));
FAM['(e1) RA150 → ⅔ tr50']     = runnerAware(0.50, 1.00, 1.50, backTrail(0.50));
FAM['(e2) RA150 → ⅔ HOLD']     = runnerAware(0.50, 1.00, 1.50, backHold());

const CANDIDATES = ['(a) ⅓/⅓/HOLD-EOD','(b1) ⅓/⅓/tr40','(b2) ⅓/⅓/tr50','(c1) ⅓@50 + ⅔ tr30',
  '(c2) ⅓@50 + ⅔ tr40','(d1) RA150 → ⅔ tr40','(d2) RA200 → ⅔ tr40','(e1) RA150 → ⅔ tr50','(e2) RA150 → ⅔ HOLD'];

// ---------- data ----------
const fires = load(path.join(HERE, 'fires_index.json'));
const built = [];
for (const f of fires) { const P = buildPath(f); if (P) built.push(P); }
const days = [...new Set(built.map(P => P.day))].sort();

// ---------- subsets (DIAGNOSTIC labels — post-hoc, not tradeable rules) ----------
const RUNNER    = built.filter(P => P.mfe >= 2.00);                        // reached >= +200% MFE
const ROUNDTRIP = built.filter(P => P.mfe >= 0.50 && P.eod <= 0);          // big MFE, hold gives it all back
const NEITHER   = built.filter(P => !(P.mfe >= 2.00) && !(P.mfe >= 0.50 && P.eod <= 0));

// ---------- stats ----------
const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
const realized = (fn, P) => { const r = fn(P); return r.g - HAIR * (HAIR_ALL ? 1 : (r.marketFrac || 0)); };
function bootDelta(fn, base, subset, B = 3000) {
  const paired = subset.map(P => realized(fn, P) - realized(base, P));
  const n = paired.length; if (!n) return { lo: NaN, hi: NaN, p: NaN, point: NaN };
  const out = [];
  for (let b = 0; b < B; b++) { let s = 0; for (let i = 0; i < n; i++) s += paired[(Math.random() * n) | 0]; out.push(s / n); }
  out.sort((a, b) => a - b);
  return { lo: out[(0.025 * B) | 0], hi: out[(0.975 * B) | 0], p: out.filter(x => x <= 0).length / B, point: mean(paired) };
}
function looWorst(fn, base, subset) {
  const dd = [...new Set(subset.map(P => P.day))]; let worst = Infinity;
  for (const d of dd) {
    const sub = subset.filter(P => P.day !== d); if (!sub.length) continue;
    worst = Math.min(worst, mean(sub.map(P => realized(fn, P))) - mean(sub.map(P => realized(base, P))));
  }
  return worst;
}
const splitIdx = Math.floor(days.length / 2);
const trainDays = new Set(days.slice(0, splitIdx)), testDays = new Set(days.slice(splitIdx));
function wf(fn, base, subset) {
  const tr = subset.filter(P => trainDays.has(P.day)), te = subset.filter(P => testDays.has(P.day));
  const a = tr.length ? mean(tr.map(P => realized(fn, P))) - mean(tr.map(P => realized(base, P))) : NaN;
  const b = te.length ? mean(te.map(P => realized(fn, P))) - mean(te.map(P => realized(base, P))) : NaN;
  return { tr: a, te: b, pass: a > 0 && b > 0, ntr: tr.length, nte: te.length };
}
const p1 = x => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}` : '  n/a');
const pc = x => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%` : 'n/a');
const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };

// ---------- report ----------
console.log(`# LADDER × RUNNER  (haircut=${(HAIR * 100).toFixed(1)}% ${HAIR_ALL ? 'ALL legs' : 'market legs'}, rung fill needs ${NBAR} consec closes)`);
console.log(`built ${built.length}/${fires.length} fires, ${days.length} days (${days[0]} → ${days.at(-1)})`);
console.log(`subsets: RUNNER(MFE>=200%) n=${RUNNER.length} | ROUND-TRIP(MFE>=50% & EOD<=0) n=${ROUNDTRIP.length} | NEITHER n=${NEITHER.length}`);
console.log(`  overlap RUNNER∩ROUNDTRIP = ${built.filter(P => P.mfe >= 2 && P.mfe >= 0.5 && P.eod <= 0).length}`);
console.log(`  MFE deciles: ${[0.1,0.25,0.5,0.75,0.9,0.95,0.99].map(q => { const s = built.map(P=>P.mfe).sort((a,b)=>a-b); return `p${q*100}=${pc(s[Math.floor(q*(s.length-1))])}`; }).join('  ')}`);
console.log(`  max MFE = ${pc(Math.max(...built.map(P => P.mfe)))}`);

const SUBSETS = [['POOLED', built], ['RUNNER', RUNNER], ['ROUND-TRIP', ROUNDTRIP], ['NEITHER', NEITHER]];
const BASE = FAM['BASE ⅓@50 ⅓@100 tr30'];

for (const [sname, sub] of SUBSETS) {
  console.log(`\n===== ${sname}  (n=${sub.length}, days=${new Set(sub.map(P=>P.day)).size}) =====`);
  console.log(`family                       avg      med    win%   ΔvsBASE  [CI]           p      LOO    WF(tr/te)`);
  for (const name of ['HOLD-EOD', 'LIVE-TRAIL a50/gb15', 'BASE ⅓@50 ⅓@100 tr30', ...CANDIDATES]) {
    const fn = FAM[name];
    const r = sub.map(P => realized(fn, P));
    const isBase = name === 'BASE ⅓@50 ⅓@100 tr30';
    const bd = isBase ? null : bootDelta(fn, BASE, sub);
    const lo = isBase ? NaN : looWorst(fn, BASE, sub);
    const w = isBase ? null : wf(fn, BASE, sub);
    const winp = (100 * r.filter(x => x > 0).length / (r.length || 1)).toFixed(0);
    console.log(
      `${name.padEnd(26)} ${pc(mean(r)).padStart(7)} ${pc(med(r)).padStart(8)} ${winp.padStart(5)}   ` +
      (isBase ? '      —' : `${p1(bd.point).padStart(6)}  [${p1(bd.lo)},${p1(bd.hi)}]`.padEnd(24)) +
      (isBase ? '' : ` ${bd.p.toFixed(3)}  ${p1(lo).padStart(6)}   ${p1(w.tr)}/${p1(w.te)} ${w.pass ? 'YES' : 'no '}`)
    );
  }
}

// ---------- dominance screen: must beat BASE on RUNNER without losing ROUND-TRIP ----------
console.log(`\n===== DOMINANCE SCREEN (vs BASE) =====`);
console.log(`variant                     POOLED  RUNNER  ROUND-TRIP  poolWF  runWF  rtWF   verdict`);
for (const name of CANDIDATES) {
  const fn = FAM[name];
  const dP = mean(built.map(P => realized(fn, P))) - mean(built.map(P => realized(BASE, P)));
  const dR = mean(RUNNER.map(P => realized(fn, P))) - mean(RUNNER.map(P => realized(BASE, P)));
  const dT = mean(ROUNDTRIP.map(P => realized(fn, P))) - mean(ROUNDTRIP.map(P => realized(BASE, P)));
  const wP = wf(fn, BASE, built), wR = wf(fn, BASE, RUNNER), wT = wf(fn, BASE, ROUNDTRIP);
  const dominates = dP > 0 && dR > 0 && dT > -0.02 && wP.pass;   // pre-registered screen
  console.log(`${name.padEnd(26)} ${p1(dP).padStart(6)}  ${p1(dR).padStart(6)}  ${p1(dT).padStart(10)}  ` +
    `${(wP.pass?'YES':'no ').padStart(6)}  ${(wR.pass?'YES':'no ')}    ${(wT.pass?'YES':'no ')}   ${dominates ? '*** DOMINATES ***' : ''}`);
}

// ---------- how often does runner-aware actually trigger? ----------
for (const name of ['(d1) RA150 → ⅔ tr40', '(d2) RA200 → ⅔ tr40']) {
  const trig = built.filter(P => FAM[name](P).runner);
  const trigRun = trig.filter(P => P.mfe >= 2).length;
  console.log(`\n${name}: triggers on ${trig.length}/${built.length} fires (${(100*trig.length/built.length).toFixed(1)}%); ` +
    `of those ${trigRun} are true RUNNERs (precision ${(100*trigRun/(trig.length||1)).toFixed(0)}%); ` +
    `recall of RUNNER set ${(100*trigRun/(RUNNER.length||1)).toFixed(0)}%`);
}

// ---------- trigger-subset economics: where does (d1)'s pooled edge actually live? ----------
console.log(`\n===== TRIGGER-SUBSET ECONOMICS (d1 RA150) =====`);
for (const name of ['(d1) RA150 → ⅔ tr40', '(d2) RA200 → ⅔ tr40']) {
  const fn = FAM[name];
  const trig = built.filter(P => fn(P).runner);
  const notrig = built.filter(P => !fn(P).runner);
  const dTrig = mean(trig.map(P => realized(fn, P))) - mean(trig.map(P => realized(BASE, P)));
  const dNo = mean(notrig.map(P => realized(fn, P))) - mean(notrig.map(P => realized(BASE, P)));
  const bd = bootDelta(fn, BASE, trig, 20000);
  const nDaysTrig = new Set(trig.map(P => P.day)).size;
  console.log(`${name}: on TRIGGERED n=${trig.length} (${nDaysTrig} days) Δ=${p1(dTrig)} [CI ${p1(bd.lo)},${p1(bd.hi)}] p=${bd.p.toFixed(4)} | on NON-triggered n=${notrig.length} Δ=${p1(dNo)} (must be exactly 0 by construction)`);
  const bdPool = bootDelta(fn, BASE, built, 20000);
  console.log(`   pooled Δ=${p1(bdPool.point)} [CI ${p1(bdPool.lo)},${p1(bdPool.hi)}] p=${bdPool.p.toFixed(4)} (B=20k)`);
}

// ---------- RA THRESHOLD SENSITIVITY (robustness, not selection) ----------
console.log(`\n===== RA THRESHOLD × BACK-TRAIL SENSITIVITY (pooled Δ / runner Δ / round-trip Δ vs BASE; * = poolWF pass) =====`);
console.log(`runT \\ back    ` + ['tr30', 'tr40', 'tr50', 'HOLD'].map(s => s.padStart(20)).join(''));
for (const runT of [1.25, 1.50, 1.75, 2.00, 2.50, 3.00]) {
  const cells = [['tr30', backTrail(0.30)], ['tr40', backTrail(0.40)], ['tr50', backTrail(0.50)], ['HOLD', backHold()]].map(([, bf]) => {
    const fn = runnerAware(0.50, 1.00, runT, bf);
    const dP = mean(built.map(P => realized(fn, P))) - mean(built.map(P => realized(BASE, P)));
    const dR = mean(RUNNER.map(P => realized(fn, P))) - mean(RUNNER.map(P => realized(BASE, P)));
    const dT = mean(ROUNDTRIP.map(P => realized(fn, P))) - mean(ROUNDTRIP.map(P => realized(BASE, P)));
    return `${p1(dP)}/${p1(dR)}/${p1(dT)}${wf(fn, BASE, built).pass ? '*' : ' '}`.padStart(20);
  });
  console.log(`${runT.toFixed(2).padEnd(14)}` + cells.join(''));
}

// ---------- EXPLORATORY (post-registration, NOT in the pre-registered 9): velocity-aware ----------
// If rung-2 confirms within K bars of entry, the move is FAST → treat as runner, skip rung 2.
function velocityAware(t1, t2, kbars, backFn) {
  return P => {
    const s = P.steps;
    const i1 = confirmFill(s, t1, NBAR);
    if (i1 < 0) return { g: trailLeg(s, 0, -Infinity, 0.50, 0.30, 0.60), marketFrac: 1 };
    const i2 = confirmFill(s, t2, NBAR, i1);
    if (i2 < 0) { const r = trailLeg(s, i1, P.peakUpTo[i1], -Infinity, 0.30, 0.60); return { g: (1/3)*t1 + (2/3)*r, marketFrac: 2/3 }; }
    if (i2 <= kbars) { const r = backFn(s, i2, P.peakUpTo[i2], 2/3); return { g: (1/3)*t1 + (2/3)*r.g, marketFrac: 2/3, runner: true }; }
    const r = trailLeg(s, i2, P.peakUpTo[i2], -Infinity, 0.30, 0.60);
    return { g: (1/3)*t1 + (1/3)*t2 + (1/3)*r, marketFrac: 1/3 };
  };
}
console.log(`\n===== EXPLORATORY: VELOCITY-AWARE (skip rung 2 if +100% confirmed within K bars of entry) =====`);
console.log(`K bars   trig%   poolΔ   runnerΔ   rtΔ    p(pool)  LOO    WF`);
for (const K of [5, 10, 15, 20]) {
  const fn = velocityAware(0.50, 1.00, K, backTrail(0.40));
  const trig = built.filter(P => fn(P).runner);
  const dP = mean(built.map(P => realized(fn, P))) - mean(built.map(P => realized(BASE, P)));
  const dR = mean(RUNNER.map(P => realized(fn, P))) - mean(RUNNER.map(P => realized(BASE, P)));
  const dT = mean(ROUNDTRIP.map(P => realized(fn, P))) - mean(ROUNDTRIP.map(P => realized(BASE, P)));
  const bd = bootDelta(fn, BASE, built, 5000); const w = wf(fn, BASE, built);
  console.log(`${String(K).padEnd(8)} ${(100*trig.length/built.length).toFixed(1).padStart(5)}  ${p1(dP).padStart(6)}  ${p1(dR).padStart(7)}  ${p1(dT).padStart(6)}  ${bd.p.toFixed(3)}   ${p1(looWorst(fn, BASE, built)).padStart(5)}  ${w.pass?'YES':'no '}`);
}
// combined: RA150 OR fast-100
console.log(`\n===== EXPLORATORY: RA150 combined with velocity (either trigger) =====`);
function combo(runT, kbars, backFn) {
  return P => {
    const s = P.steps;
    const i1 = confirmFill(s, 0.50, NBAR);
    if (i1 < 0) return { g: trailLeg(s, 0, -Infinity, 0.50, 0.30, 0.60), marketFrac: 1 };
    const i2 = confirmFill(s, 1.00, NBAR, i1);
    if (i2 < 0) { const r = trailLeg(s, i1, P.peakUpTo[i1], -Infinity, 0.30, 0.60); return { g: (1/3)*0.50 + (2/3)*r, marketFrac: 2/3 }; }
    if (P.peakUpTo[i2] >= runT || i2 <= kbars) { const r = backFn(s, i2, P.peakUpTo[i2], 2/3); return { g: (1/3)*0.50 + (2/3)*r.g, marketFrac: 2/3, runner: true }; }
    const r = trailLeg(s, i2, P.peakUpTo[i2], -Infinity, 0.30, 0.60);
    return { g: (1/3)*0.50 + (1/3)*1.00 + (1/3)*r, marketFrac: 1/3 };
  };
}
for (const [rt, K] of [[1.50, 10], [1.50, 15], [1.75, 10]]) {
  const fn = combo(rt, K, backTrail(0.40));
  const trig = built.filter(P => fn(P).runner);
  const dP = mean(built.map(P => realized(fn, P))) - mean(built.map(P => realized(BASE, P)));
  const dR = mean(RUNNER.map(P => realized(fn, P))) - mean(RUNNER.map(P => realized(BASE, P)));
  const dT = mean(ROUNDTRIP.map(P => realized(fn, P))) - mean(ROUNDTRIP.map(P => realized(BASE, P)));
  const bd = bootDelta(fn, BASE, built, 5000); const w = wf(fn, BASE, built);
  console.log(`RA${(rt*100).toFixed(0)} OR fast≤${K}b: trig ${(100*trig.length/built.length).toFixed(1)}%  poolΔ ${p1(dP)} (p=${bd.p.toFixed(3)}, LOO ${p1(looWorst(fn, BASE, built))}, WF ${w.pass?'YES':'no'})  runnerΔ ${p1(dR)}  rtΔ ${p1(dT)}`);
}

// ---------- the ghost A/B day: what did the +432% runner do under each variant? ----------
const top = [...built].sort((a, b) => b.mfe - a.mfe).slice(0, 8);
console.log(`\n===== TOP-8 MFE FIRES: realized under each family =====`);
console.log(`day        ticker  MFE      EOD     ` + ['HOLD-EOD','LIVE-TRAIL a50/gb15','BASE ⅓@50 ⅓@100 tr30','(a) ⅓/⅓/HOLD-EOD','(b2) ⅓/⅓/tr50','(d1) RA150 → ⅔ tr40','(e2) RA150 → ⅔ HOLD'].map(n=>n.slice(0,9).padStart(10)).join(''));
for (const P of top) {
  const cells = ['HOLD-EOD','LIVE-TRAIL a50/gb15','BASE ⅓@50 ⅓@100 tr30','(a) ⅓/⅓/HOLD-EOD','(b2) ⅓/⅓/tr50','(d1) RA150 → ⅔ tr40','(e2) RA150 → ⅔ HOLD']
    .map(n => pc(realized(FAM[n], P)).padStart(10)).join('');
  console.log(`${P.day}  ${P.ticker.padEnd(6)} ${pc(P.mfe).padStart(7)} ${pc(P.eod).padStart(7)}  ${cells}`);
}
