// ARM A — EXIT-DECISION CADENCE (research only, Clause 0).
// Pre-registered in GRANULARITY_2026-07-14.md.
//
// Q: does evaluating the LIVE TRAIL more often (finer cadence) improve realized,
//    or does it just sample more noise?
//
// Live tracker (src/tracker/plays.js): trail arms at peak>=+50%, exits when
// mid <= peak*(1-0.15). NO hard stop exists in production (verified by grep) —
// the brief's "hardstop=0.60" is run as a labelled SECONDARY variant only.
//
// Cadence sim: the refresh loop only OBSERVES the mark every k minutes, so both
// the peak (best_mark) and the exit check advance only on observed samples.
// Phase-averaged over all k offsets so nothing is a phase artifact.
//
// CONTINUOUS (k->0) bound: UW candles carry high/low, so we can simulate
// sub-minute monitoring for real — peak tracks the candle HIGH, the stop triggers
// off the candle LOW, and fills at the stop price peak_g - gb*(1+peak_g).
// Intra-candle ordering is unknowable => report a BAND (optimistic/pessimistic).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, 'cache');
const load = f => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : []);

const ARM = 0.50, GB = 0.15, HARDSTOP = 0.60;

// Build per-minute path WITH intra-candle extremes (needed for the continuous bound).
function buildPath(fire) {
  const opt = load(path.join(CACHE, `${fire.sym}_${fire.day}.json`))
    .map(c => ({
      ts: Date.parse(c.start_time),
      close: Number(c.close) || 0,
      high: Number(c.high) || 0,
      low: Number(c.low) || 0,
    }))
    .filter(c => c.close > 0 && c.high > 0 && c.low > 0)
    .sort((a, b) => a.ts - b.ts);
  if (opt.length < 4) return null;
  const entryTs = fire.fireTsMs + 60000;
  const ei = opt.findIndex(o => o.ts >= entryTs);
  if (ei < 0 || ei >= opt.length - 2) return null;
  const entry = opt[ei].close;
  if (!(entry > 0)) return null;
  const steps = opt.slice(ei).map(o => ({
    ts: o.ts,
    g: (o.close - entry) / entry,
    gh: (o.high - entry) / entry,
    gl: (o.low - entry) / entry,
  }));
  return { fire, entry, steps, day: fire.day };
}

// ---- LIVE TRAIL at observation cadence k (minutes), phase p ----
// Faithful: peak and exit-check both only advance on OBSERVED samples.
function trailCadence(P, k, p, { hardstop = false } = {}) {
  let peak = 0, armed = false;
  for (let i = 0; i < P.steps.length; i++) {
    const isLast = i === P.steps.length - 1;
    const observed = (i % k) === p;
    if (!observed) continue;                    // loop simply didn't run this minute
    const s = P.steps[i];
    if (s.g > peak) peak = s.g;                 // best_mark updates only when polled
    if (!armed && peak >= ARM) armed = true;
    if (hardstop && s.g <= -HARDSTOP) return { g: s.g, exited: true };
    if (armed && s.g <= peak - GB * (1 + peak)) return { g: s.g, exited: true };
    if (isLast) break;
  }
  return { g: P.steps.at(-1).g, exited: false }; // EOD flat
}

// ---- CONTINUOUS (sub-minute) bound: stop fills AT the trigger price ----
// pessimistic: high updates peak first, then low is checked (trail is tightest).
// optimistic : low checked against the pre-high peak, then high updates peak.
function trailContinuous(P, mode, { hardstop = false } = {}) {
  let peak = 0, armed = false;
  for (const s of P.steps) {
    if (mode === 'pess') {
      if (s.gh > peak) peak = s.gh;
      if (!armed && peak >= ARM) armed = true;
      if (hardstop && s.gl <= -HARDSTOP) return { g: -HARDSTOP, exited: true };
      if (armed) {
        const trig = peak - GB * (1 + peak);
        if (s.gl <= trig) return { g: trig, exited: true }; // stop fills at trigger
      }
    } else {
      if (hardstop && s.gl <= -HARDSTOP) return { g: -HARDSTOP, exited: true };
      if (armed) {
        const trig = peak - GB * (1 + peak);
        if (s.gl <= trig) return { g: trig, exited: true };
      }
      if (s.gh > peak) peak = s.gh;
      if (!armed && peak >= ARM) armed = true;
      if (armed) {
        const trig = peak - GB * (1 + peak);
        if (s.gl <= trig) return { g: trig, exited: true };
      }
    }
  }
  return { g: P.steps.at(-1).g, exited: false };
}
const holdEOD = P => ({ g: P.steps.at(-1).g, exited: false });

// realized with fill haircut on reactive exits only
const realize = (r, hair) => (r.exited ? r.g - hair : r.g);

// phase-averaged realized for cadence k
function cadenceRealized(P, k, hair, opts) {
  let s = 0;
  for (let p = 0; p < k; p++) s += realize(trailCadence(P, k, p, opts), hair);
  return s / k;
}

// ---- stats ----
const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
const med = a => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const win = a => (a.length ? a.filter(x => x > 0).length / a.length : NaN);
const pct = x => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(2)}%`;
const p1 = x => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(2)}`;

function bootDelta(vecA, vecB, B = 4000) {
  const d = vecA.map((v, i) => v - vecB[i]);
  const n = d.length, out = [];
  for (let b = 0; b < B; b++) { let s = 0; for (let i = 0; i < n; i++) s += d[(Math.random() * n) | 0]; out.push(s / n); }
  out.sort((a, b) => a - b);
  return { point: mean(d), lo: out[(0.025 * B) | 0], hi: out[(0.975 * B) | 0], pLE0: out.filter(x => x <= 0).length / B };
}

// ---- load ----
const fires = load(path.join(HERE, 'fires_index.json'));
const built = [];
for (const f of fires) { const P = buildPath(f); if (P) built.push(P); }
const days = [...new Set(built.map(P => P.day))].sort();
const splitIdx = Math.floor(days.length / 2);
const trainD = new Set(days.slice(0, splitIdx)), testD = new Set(days.slice(splitIdx));
const TR = built.filter(P => trainD.has(P.day)), TE = built.filter(P => testD.has(P.day));
console.log(`# ARM A — EXIT-DECISION CADENCE`);
console.log(`built ${built.length}/${fires.length} paths over ${days.length} days (${days[0]} -> ${days.at(-1)})`);
console.log(`walk-forward: train ${trainD.size}d n=${TR.length} | test ${testD.size}d n=${TE.length}\n`);

const KS = [1, 2, 5, 15];

for (const hardstop of [false, true]) {
  const label = hardstop ? 'SECONDARY: live trail + 0.60 HARDSTOP (not in production)' : 'PRIMARY: live-faithful trail 0.50/0.15 (no hardstop)';
  console.log(`\n${'='.repeat(96)}\n${label}\n${'='.repeat(96)}`);
  const opts = { hardstop };

  for (const hair of [0, 0.02, 0.03]) {
    console.log(`\n--- fill haircut ${(hair * 100).toFixed(0)}% ---`);
    console.log('cadence'.padEnd(22) + 'avg'.padStart(9) + 'med'.padStart(9) + 'win%'.padStart(7) +
      'Δ vs 1min'.padStart(11) + '  boot95(vs 1min)'.padEnd(20) + 'train Δ'.padStart(9) + 'test Δ'.padStart(9) + '  WF');

    const ref = built.map(P => cadenceRealized(P, 1, hair, opts));
    const refTR = mean(TR.map(P => cadenceRealized(P, 1, hair, opts)));
    const refTE = mean(TE.map(P => cadenceRealized(P, 1, hair, opts)));

    const rows = [];
    rows.push(['HOLD-EOD (null)', built.map(P => realize(holdEOD(P), hair)), TR.map(P => realize(holdEOD(P), hair)), TE.map(P => realize(holdEOD(P), hair))]);
    for (const mode of ['pess', 'opt']) {
      rows.push([`CONTINUOUS (${mode === 'pess' ? 'pessim' : 'optim'})`,
        built.map(P => realize(trailContinuous(P, mode, opts), hair)),
        TR.map(P => realize(trailContinuous(P, mode, opts), hair)),
        TE.map(P => realize(trailContinuous(P, mode, opts), hair))]);
    }
    for (const k of KS) {
      rows.push([`${k} min${k === 1 ? ' (= CURRENT)' : ''}`,
        built.map(P => cadenceRealized(P, k, hair, opts)),
        TR.map(P => cadenceRealized(P, k, hair, opts)),
        TE.map(P => cadenceRealized(P, k, hair, opts))]);
    }

    for (const [name, all, tr, te] of rows) {
      const isRef = name.startsWith('1 min');
      const b = isRef ? null : bootDelta(all, ref);
      const dTR = mean(tr) - refTR, dTE = mean(te) - refTE;
      const wf = isRef ? '—' : (dTR > 0 && dTE > 0) ? 'BEATS 1min both' : (dTR < 0 && dTE < 0) ? 'worse both' : 'mixed';
      console.log(name.padEnd(22) + pct(mean(all)).padStart(9) + pct(med(all)).padStart(9) +
        (win(all) * 100).toFixed(0).padStart(6) + '%' +
        (isRef ? '—' : p1(mean(all) - mean(ref))).padStart(11) + '  ' +
        (b ? `[${p1(b.lo)},${p1(b.hi)}]` : '').padEnd(18) +
        (isRef ? '—' : p1(dTR)).padStart(9) + (isRef ? '—' : p1(dTE)).padStart(9) + '  ' + wf);
    }
  }
}

// ---- how often does cadence even change the outcome? ----
console.log(`\n\n${'='.repeat(96)}\nMECHANISM — how often does the observation cadence change anything?\n${'='.repeat(96)}`);
const h = 0.02, opts = { hardstop: false };
let armedN = 0, exitedN = 0;
for (const P of built) { const r = trailCadence(P, 1, 0, opts); if (r.exited) exitedN++; let pk = 0; for (const s of P.steps) if (s.g > pk) pk = s.g; if (pk >= ARM) armedN++; }
console.log(`fires whose peak ever reaches +${(ARM * 100).toFixed(0)}% (trail can arm at all): ${armedN}/${built.length} (${(armedN / built.length * 100).toFixed(1)}%)`);
console.log(`fires where the 1-min trail actually fires an exit:                  ${exitedN}/${built.length} (${(exitedN / built.length * 100).toFixed(1)}%)`);
console.log(`=> on ${(100 - armedN / built.length * 100).toFixed(1)}% of fires the trail NEVER ARMS, so exit cadence is irrelevant to them by construction.\n`);

// per-cadence exit rate + avg exit gain, to show *why* the numbers move
console.log('cadence'.padEnd(22) + 'exit-rate'.padStart(10) + 'avg g|exited'.padStart(14) + 'avg g|held'.padStart(12));
for (const k of KS) {
  let ex = 0, gEx = 0, gHo = 0, ho = 0, tot = 0;
  for (const P of built) for (let p = 0; p < k; p++) {
    const r = trailCadence(P, k, p, opts); tot++;
    if (r.exited) { ex++; gEx += r.g; } else { ho++; gHo += r.g; }
  }
  console.log(`${k} min`.padEnd(22) + `${(ex / tot * 100).toFixed(1)}%`.padStart(10) + pct(gEx / (ex || 1)).padStart(14) + pct(gHo / (ho || 1)).padStart(12));
}
for (const mode of ['pess', 'opt']) {
  let ex = 0, gEx = 0, gHo = 0, ho = 0;
  for (const P of built) { const r = trailContinuous(P, mode, opts); if (r.exited) { ex++; gEx += r.g; } else { ho++; gHo += r.g; } }
  console.log(`CONTINUOUS (${mode})`.padEnd(22) + `${(ex / built.length * 100).toFixed(1)}%`.padStart(10) + pct(gEx / (ex || 1)).padStart(14) + pct(gHo / (ho || 1)).padStart(12));
}
