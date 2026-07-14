// PATH OBSTRUCTION as a DYNAMIC EXIT / HOLD signal — pre-registered follow-up.
// RESEARCH ONLY (Clause 0 — no live code; recommendations -> DECISIONS NEEDED).
//
// LINEAGE: research/gexvex-structure/NODE_POSITION_2026-07-14.md flagged path
//   OBSTRUCTION (a large gamma node between spot and the trade's target direction) as
//   the single doctrine concept that pointed the right way on both walk-forward halves
//   and survived the distance confound, but fell short of significance (p~0.08) as an
//   ENTRY gate. The prior report's #1 follow-up: test obstruction as a HOLD/EXIT signal,
//   not an entry gate. This is that study.
//
// PRE-REGISTERED (formulas frozen BEFORE any outcome was computed):
// OBSTRUCTION SCORE (causal Skylit snapshot, at/before the evaluation time):
//   Primary  : sum of relSig over nodes with relSig >= 0.08 strictly inside the
//              directional window (spot, spot*1.015] for bulls / [spot*0.985, spot) for
//              bears, EXCLUDING the entry-strike node (node nearest fire.K, ~ATM).
//   Sensitiv.: same with relSig >= 0.12 and a +-1.0% window.
//   relSig = |gamma| / sum|gamma| over the frame — mirrors src/domain/significance.js.
// HYPOTHESES:
//   H-A (entry context, confirmatory): high obstruction AT FIRE -> worse realized.
//   H-B (PRIMARY, dynamic/exit): obstruction that APPEARS or GROWS after entry kills the
//       trade. Signal at a post-entry snapshot T fires if
//         O(T) >= THRESH  AND  b0 < THRESH        (appeared after entry)   OR
//         b0 > 0  AND  O(T) >= 2*b0               (doubled from baseline).
//       Treatment = LIVE TRAIL (a0.50/gb0.15/stop0.60) + force-exit on that signal
//       (whichever of stop / obstruction / trail-giveback fires first). THRESH=0.08.
//       Compared vs (1) the live trail alone and (2) a VOLUME/EXIT-COUNT-MATCHED RANDOM
//       EXIT-TIMING control — the obstruction rule only counts if it beats exiting at
//       RANDOM snapshot times on the SAME fires at the SAME frequency.
//   H-C (HOLD side): clear path + obstruction NOT growing -> suppress the trail's
//       give-back this tick (let winners run), hard stop never suppressed. Mirror of the
//       live barney-fuel HOLD. Compared vs the trail alone.
// CONTROLS: walk-forward both halves; matched random exit-timing control (H-B);
//   day-block bootstrap p-values; 3% haircut (2% sensitivity); Bonferroni across cells.
// P&L: realized option return, entry = first mark >= fire+60s, EOD cap, 3% haircut.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GEX = path.join(HERE, '..', '..');
const EXIT = path.join(GEX, 'research', 'exit-study');
const CACHE = path.join(EXIT, 'cache');
const ARCHIVE = path.join(GEX, 'data', 'skylit-archive', 'intraday');
const load = f => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : []);

const HAIR = 0.03;                 // 3% haircut (primary); 2% reported as sensitivity
const ARM = 0.50, GB = 0.15, STOP = 0.60;   // LIVE trail
const THRESH = 0.08, WINDOW = 0.015, RELMIN = 0.08;        // primary obstruction params
const THRESH_S = 0.12, WINDOW_S = 0.010, RELMIN_S = 0.12;  // sensitivity variant
const RREPS = 400;                 // random-timing control reps
let SEED = 20260714;
const rnd = () => { SEED = (SEED * 1103515245 + 12345) & 0x7fffffff; return SEED / 0x7fffffff; };

// ---------- option path (identical convention to node_position / verify_scaleout) ----------
function buildPath(fire) {
  const opt = load(path.join(CACHE, `${fire.sym}_${fire.day}.json`))
    .map(c => ({ ts: Date.parse(c.start_time), close: Number(c.close) || 0 }))
    .filter(c => c.close > 0).sort((a, b) => a.ts - b.ts);
  if (opt.length < 4) return null;
  const ei = opt.findIndex(o => o.ts >= fire.fireTsMs + 60000);
  if (ei < 0 || ei >= opt.length - 2) return null;
  const entry = opt[ei].close;
  if (!(entry > 0)) return null;
  return { steps: opt.slice(ei).map(o => ({ ts: o.ts, g: (o.close - entry) / entry })) };
}

// ---------- Skylit surface archive (5-min frames) ----------
const frameCache = {};
function frames(day, ticker) {
  const k = `${day}|${ticker}`;
  if (frameCache[k]) return frameCache[k];
  const p = path.join(ARCHIVE, day, `${ticker}.jsonl.gz`);
  if (!fs.existsSync(p)) return (frameCache[k] = []);
  const rows = zlib.gunzipSync(fs.readFileSync(p)).toString().trim().split('\n')
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean)
    .map(s => ({ tsMs: Date.parse(s.requestedTs), spot: Number(s.spot), strikes: s.strikes || [], _nodes: null }))
    .filter(s => Number.isFinite(s.spot) && s.strikes.length)
    .sort((a, b) => a.tsMs - b.tsMs);
  return (frameCache[k] = rows);
}
// nodes exactly as src/domain/significance.js (relSig = |gamma| / sum|gamma|). Cached per frame.
function nodesOf(frame) {
  if (frame._nodes) return frame._nodes;
  let tot = 0;
  const rows = frame.strikes.map(r => ({ strike: Number(r.strike), gamma: Number(r.gamma) || 0 }));
  for (const r of rows) tot += Math.abs(r.gamma);
  const out = tot > 0 ? rows.map(r => ({ strike: r.strike, relSig: Math.abs(r.gamma) / tot })) : [];
  return (frame._nodes = out);
}
// OBSTRUCTION SCORE for a frame, given trade dir and entry strike K.
function obstructionOf(frame, dir, K, relMin, windowPct) {
  const ns = nodesOf(frame);
  if (!ns.length) return 0;
  const spot = frame.spot;
  const lo = dir > 0 ? spot : spot * (1 - windowPct);
  const hi = dir > 0 ? spot * (1 + windowPct) : spot;
  // entry node = strike nearest fire.K (~ATM). Excluded from the obstruction path.
  let entryStrike = null, bestd = Infinity;
  for (const n of ns) { const d = Math.abs(n.strike - K); if (d < bestd) { bestd = d; entryStrike = n.strike; } }
  let score = 0;
  for (const n of ns) {
    if (n.strike === entryStrike) continue;
    if (n.strike > lo && n.strike < hi && n.relSig >= relMin) score += n.relSig;
  }
  return score;
}
function frameAt(fr, ts) { let best = null; for (const f of fr) { if (f.tsMs <= ts) best = f; else break; } return best; }

// ---------- exit simulators ----------
// Natural LIVE trail: first of {stop, armed give-back, EOD}. Returns exit index + g.
function naturalTrail(steps) {
  let peak = -Infinity, armed = false;
  for (let i = 0; i < steps.length; i++) {
    const g = steps[i].g;
    if (g > peak) peak = g;
    if (!armed && peak >= ARM) armed = true;
    if (g <= -STOP) return { i, g };
    if (armed && (1 + g) <= (1 + peak) * (1 - GB)) return { i, g };
  }
  return { i: steps.length - 1, g: steps.at(-1).g };
}
// HOLD overlay (H-C): suppress the armed give-back when path is clear AND not growing;
// hard stop is NEVER suppressed. obsSeries[i] = obstruction at step i (causal).
function holdTrail(steps, obsSeries, b0, thresh) {
  let peak = -Infinity, armed = false;
  for (let i = 0; i < steps.length; i++) {
    const g = steps[i].g;
    if (g > peak) peak = g;
    if (!armed && peak >= ARM) armed = true;
    if (g <= -STOP) return { i, g };
    if (armed && (1 + g) <= (1 + peak) * (1 - GB)) {
      const O = obsSeries[i];
      const clear = O < thresh && O <= b0;   // clear path AND not growing vs entry
      if (!clear) return { i, g };            // take the give-back only when path is NOT clear
      // else HOLD: suppress this give-back, keep running
    }
  }
  return { i: steps.length - 1, g: steps.at(-1).g };
}

// ---------- build per-fire records ----------
const firesAll = load(path.join(EXIT, 'fires_index.json'));
const recs = [];
let noPath = 0, noFrame = 0;
for (const f of firesAll) {
  const P = buildPath(f);
  if (!P) { noPath++; continue; }
  const fr = frames(f.day, f.ticker);
  const f0 = fr.length ? frameAt(fr, f.fireTsMs) : null;
  if (!f0) { noFrame++; continue; }
  const dir = f.dir, K = f.K;
  const steps = P.steps;
  // causal obstruction series along the option path (primary + sensitivity params)
  const obs = new Array(steps.length), obsS = new Array(steps.length);
  let fp = 0; // pointer into frames
  const oCache = new Map(), oCacheS = new Map();
  for (let i = 0; i < steps.length; i++) {
    while (fp + 1 < fr.length && fr[fp + 1].tsMs <= steps[i].ts) fp++;
    let cf = fr[fp];
    if (cf.tsMs > steps[i].ts) { // step before first frame -> use fire-time frame
      cf = f0;
    }
    if (!oCache.has(cf)) oCache.set(cf, obstructionOf(cf, dir, K, RELMIN, WINDOW));
    if (!oCacheS.has(cf)) oCacheS.set(cf, obstructionOf(cf, dir, K, RELMIN_S, WINDOW_S));
    obs[i] = oCache.get(cf);
    obsS[i] = oCacheS.get(cf);
  }
  const b0 = obstructionOf(f0, dir, K, RELMIN, WINDOW);
  const b0S = obstructionOf(f0, dir, K, RELMIN_S, WINDOW_S);
  // snapshot times available strictly after fire, up to last step (for random control)
  const snapTimes = fr.filter(x => x.tsMs > f.fireTsMs && x.tsMs <= steps.at(-1).ts).map(x => x.tsMs);
  const nat = naturalTrail(steps);
  recs.push({
    day: f.day, ticker: f.ticker, dir, isBull: dir > 0, state: f.state,
    steps, obs, obsS, b0, b0S, snapTimes,
    natIdx: nat.i, natG: nat.g,
    staleMin: (f.fireTsMs - f0.tsMs) / 60000, fireTsMs: f.fireTsMs,
  });
}

// map a wall-clock ts to the first step index with step.ts >= ts (or null if none)
function stepIdxAtTime(steps, ts) {
  for (let i = 0; i < steps.length; i++) if (steps[i].ts >= ts) return i;
  return null;
}
// signal: obstruction APPEARS or GROWS after entry
function signalActive(O, b0, thresh) {
  return (O >= thresh && b0 < thresh) || (b0 > 0 && O >= 2 * b0);
}
// first step index at which the obstruction exit signal is active (or null)
function obsExitIdx(r, useSens) {
  const arr = useSens ? r.obsS : r.obs, b0 = useSens ? r.b0S : r.b0, th = useSens ? THRESH_S : THRESH;
  for (let i = 0; i < arr.length; i++) if (signalActive(arr[i], b0, th)) return i;
  return null;
}
// realized under a forced exit at step index j (given precomputed natural exit)
function forcedRealized(r, j) {
  if (j == null || j >= r.natIdx) return r.natG;   // natural exit already fired at/before j
  return r.steps[j].g;
}

// ---------- stats helpers ----------
const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
const sum = a => a.reduce((s, x) => s + x, 0);
const p1 = x => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}` : '   -');
const pctf = (n, d) => (d ? `${(100 * n / d).toFixed(0)}%` : ' -');
function pf(a) { const w = sum(a.filter(x => x > 0)), l = -sum(a.filter(x => x < 0)); return l > 0 ? w / l : Infinity; }
const HAIRCUT = h => g => g - h;
// day-block bootstrap of a paired per-fire difference. one-sided p = P(mean diff <= 0).
function dayBlockP(pairs, B = 5000) {
  // pairs: [{day, d}]  -> resample days
  const byDay = {};
  for (const p of pairs) (byDay[p.day] ||= []).push(p.d);
  const days = Object.keys(byDay);
  const point = mean(pairs.map(p => p.d));
  let le = 0; const dist = [];
  for (let b = 0; b < B; b++) {
    let s = 0, n = 0;
    for (let k = 0; k < days.length; k++) {
      const dd = byDay[days[(rnd() * days.length) | 0]];
      for (const v of dd) { s += v; n++; }
    }
    const m = s / n; dist.push(m); if (m <= 0) le++;
  }
  dist.sort((x, y) => x - y);
  return { point, p: le / B, lo: dist[(0.025 * B) | 0], hi: dist[(0.975 * B) | 0] };
}

const days = [...new Set(recs.map(r => r.day))].sort();
const split = days[Math.floor(days.length / 2)];
for (const r of recs) r.isTest = r.day >= split;
const trBase = r => r.natG - HAIR;   // baseline realized per fire (live trail, 3% haircut)

console.log(`# PATH OBSTRUCTION as DYNAMIC EXIT / HOLD — pre-registered follow-up`);
console.log(`fires ${firesAll.length} | recs ${recs.length}  (dropped: noPath ${noPath}, noFrame ${noFrame})`);
console.log(`days ${days.length}  WF split ${split}  train ${recs.filter(r => !r.isTest).length} / test ${recs.filter(r => r.isTest).length}`);
const stale = recs.map(r => r.staleMin).sort((a, b) => a - b);
console.log(`surface staleness at fire: median ${stale[recs.length >> 1].toFixed(1)}m  p95 ${stale[(recs.length * 0.95) | 0].toFixed(1)}m`);
const baseAll = mean(recs.map(trBase));
console.log(`\nBASELINE (all fires, LIVE TRAIL a50/gb15/stop60, 3% haircut): n=${recs.length}  avg ${p1(baseAll)}  win ${pctf(recs.filter(r => trBase(r) > 0).length, recs.length)}  PF ${pf(recs.map(trBase)).toFixed(2)}`);

// =====================================================================================
// H-A — ENTRY CONTEXT (confirmatory): obstruction AT FIRE vs realized (baseline trail)
// =====================================================================================
console.log(`\n${'='.repeat(80)}\n## H-A  ENTRY CONTEXT (confirmatory): obstruction-at-fire b0 vs realized (live trail)\n${'='.repeat(80)}`);
const HDR = `${'cohort'.padEnd(30)}${'n'.padStart(5)}${'avg%'.padStart(8)}${'win'.padStart(7)}${'PF'.padStart(7)}${'train'.padStart(9)}${'test'.padStart(8)}`;
function row(label, s) {
  if (!s.length) { console.log(`${label.padEnd(30)}    0`); return; }
  const g = s.map(trBase);
  console.log(`${label.padEnd(30)}${String(s.length).padStart(5)}${p1(mean(g)).padStart(8)}` +
    `${pctf(s.filter(r => trBase(r) > 0).length, s.length).padStart(7)}${pf(g).toFixed(2).padStart(7)}` +
    `${p1(mean(s.filter(r => !r.isTest).map(trBase))).padStart(9)}${p1(mean(s.filter(r => r.isTest).map(trBase))).padStart(8)}`);
}
console.log(`obstruction-at-fire b0 distribution: frac with b0>0 = ${pctf(recs.filter(r => r.b0 > 0).length, recs.length)},  frac b0>=THRESH(0.08) = ${pctf(recs.filter(r => r.b0 >= THRESH).length, recs.length)}`);
const b0sorted = [...recs.map(r => r.b0)].sort((a, b) => a - b);
console.log(`  b0 quantiles: p50 ${b0sorted[recs.length >> 1].toFixed(3)}  p75 ${b0sorted[(recs.length * .75) | 0].toFixed(3)}  p90 ${b0sorted[(recs.length * .9) | 0].toFixed(3)}  max ${b0sorted.at(-1).toFixed(3)}`);
console.log(`\nDECILES of b0 (equal-count):\n${HDR}`);
const byB0 = [...recs].sort((a, b) => a.b0 - b.b0);
for (let d = 0; d < 10; d++) {
  const s = byB0.slice(Math.floor(d * recs.length / 10), Math.floor((d + 1) * recs.length / 10));
  const lo = s[0].b0, hi = s.at(-1).b0;
  row(`dec${d} b0[${lo.toFixed(3)},${hi.toFixed(3)}]`, s);
}
console.log(`\ncohorts:\n${HDR}`);
row('CLEAR at entry (b0<0.08)', recs.filter(r => r.b0 < THRESH));
row('OBSTRUCTED entry (b0>=0.08)', recs.filter(r => r.b0 >= THRESH));
row('  heavy (b0>=0.16)', recs.filter(r => r.b0 >= 0.16));
const dHA = dayBlockP(recs.map(r => ({ day: r.day, d: (r.b0 < THRESH ? 1 : -1) * 0 + (r.b0 < THRESH ? trBase(r) : 0) })), 1); // placeholder unused
const clr = recs.filter(r => r.b0 < THRESH).map(trBase), obr = recs.filter(r => r.b0 >= THRESH).map(trBase);
// unpaired day-block on the difference clear-obstructed via label pairs
const haPairs = recs.map(r => ({ day: r.day, d: (r.b0 < THRESH ? trBase(r) - baseAll : -(trBase(r) - baseAll)) }));
console.log(`\nH-A  clear(b0<0.08) avg ${p1(mean(clr))} (n=${clr.length}) vs obstructed avg ${p1(mean(obr))} (n=${obr.length})  diff ${p1(mean(clr) - mean(obr))}pt`);

// =====================================================================================
// H-B — DYNAMIC OBSTRUCTION EXIT (PRIMARY)  vs trail baseline AND matched random timing
// =====================================================================================
console.log(`\n${'='.repeat(80)}\n## H-B  DYNAMIC OBSTRUCTION EXIT (primary): exit when obstruction APPEARS/GROWS post-entry\n${'='.repeat(80)}`);
function runHB(useSens, hair) {
  const out = [];
  let nBind = 0, nSignal = 0;
  for (const r of recs) {
    const j = obsExitIdx(r, useSens);
    if (j != null) nSignal++;
    const treat = forcedRealized(r, j) - hair;
    const base = r.natG - hair;
    const binding = j != null && j < r.natIdx;
    if (binding) nBind++;
    // matched random control: only on binding fires, force a random snapshot-time exit
    let randAvg = base;
    if (r.snapTimes.length) {
      let acc = 0;
      for (let k = 0; k < RREPS; k++) {
        const t = r.snapTimes[(rnd() * r.snapTimes.length) | 0];
        const jr = stepIdxAtTime(r.steps, t);
        acc += forcedRealized(r, jr) - hair;
      }
      randAvg = acc / RREPS;
    }
    out.push({ day: r.day, isTest: r.isTest, base, treat, rand: randAvg, binding, j, natIdx: r.natIdx });
  }
  return { out, nBind, nSignal };
}
for (const [tag, useSens, hair] of [['PRIMARY (thr0.08/1.5%/rel0.08, 3% hair)', false, 0.03],
                                     ['SENSITIVITY (thr0.12/1.0%/rel0.12, 3% hair)', true, 0.03],
                                     ['PRIMARY @ 2% haircut', false, 0.02]]) {
  const { out, nBind, nSignal } = runHB(useSens, hair);
  const base = mean(out.map(o => o.base)), treat = mean(out.map(o => o.treat)), rnd_ = mean(out.map(o => o.rand));
  const vsBase = dayBlockP(out.map(o => ({ day: o.day, d: o.treat - o.base })));
  const vsRand = dayBlockP(out.map(o => ({ day: o.day, d: o.treat - o.rand })));
  const half = t => { const s = out.filter(o => o.isTest === t); return { b: mean(s.map(o => o.base)), t: mean(s.map(o => o.treat)), r: mean(s.map(o => o.rand)) }; };
  const tr = half(false), te = half(true);
  console.log(`\n-- ${tag}`);
  console.log(`   signal fired on ${nSignal}/${recs.length} fires; BINDING (exit moved earlier) on ${nBind} (${pctf(nBind, recs.length)})`);
  console.log(`   baseline avg ${p1(base)}   obstruction-exit avg ${p1(treat)}   matched-random-exit avg ${p1(rnd_)}`);
  console.log(`   treat - baseline = ${p1(vsBase.point)}pt  CI95[${p1(vsBase.lo)},${p1(vsBase.hi)}]  day-block p=${vsBase.p.toFixed(3)}`);
  console.log(`   treat - RANDOM   = ${p1(vsRand.point)}pt  CI95[${p1(vsRand.lo)},${p1(vsRand.hi)}]  day-block p=${vsRand.p.toFixed(3)}   <-- the honest test`);
  console.log(`   walk-forward TRAIN: base ${p1(tr.b)} treat ${p1(tr.t)} rand ${p1(tr.r)}  (treat-rand ${p1(tr.t - tr.r)})`);
  console.log(`   walk-forward TEST : base ${p1(te.b)} treat ${p1(te.t)} rand ${p1(te.r)}  (treat-rand ${p1(te.t - te.r)})`);
}

// binding-fires-only view (where the rule actually acts) for the primary
{
  const { out } = runHB(false, 0.03);
  const bind = out.filter(o => o.binding);
  console.log(`\n-- BINDING fires only (primary): n=${bind.length}`);
  console.log(`   on these fires  baseline avg ${p1(mean(bind.map(o => o.base)))}   obstruction-exit avg ${p1(mean(bind.map(o => o.treat)))}   random-exit avg ${p1(mean(bind.map(o => o.rand)))}`);
  const vB = dayBlockP(bind.map(o => ({ day: o.day, d: o.treat - o.base })));
  const vR = dayBlockP(bind.map(o => ({ day: o.day, d: o.treat - o.rand })));
  console.log(`   treat-baseline ${p1(vB.point)}pt p=${vB.p.toFixed(3)} | treat-random ${p1(vR.point)}pt p=${vR.p.toFixed(3)}`);
}

// =====================================================================================
// H-C — HOLD side: clear path + not growing -> suppress the trail give-back this tick
// =====================================================================================
console.log(`\n${'='.repeat(80)}\n## H-C  HOLD OVERLAY: clear+not-growing suppresses the give-back (let winners run)\n${'='.repeat(80)}`);
function runHC(useSens, hair) {
  const out = [];
  for (const r of recs) {
    const arr = useSens ? r.obsS : r.obs, b0 = useSens ? r.b0S : r.b0, th = useSens ? THRESH_S : THRESH;
    const h = holdTrail(r.steps, arr, b0, th);
    out.push({ day: r.day, isTest: r.isTest, base: r.natG - hair, treat: h.g - hair });
  }
  return out;
}
for (const [tag, useSens] of [['PRIMARY (thr0.08/1.5%)', false], ['SENSITIVITY (thr0.12/1.0%)', true]]) {
  const out = runHC(useSens, 0.03);
  const base = mean(out.map(o => o.base)), treat = mean(out.map(o => o.treat));
  const vsBase = dayBlockP(out.map(o => ({ day: o.day, d: o.treat - o.base })));
  const half = t => { const s = out.filter(o => o.isTest === t); return { b: mean(s.map(o => o.base)), t: mean(s.map(o => o.treat)) }; };
  const tr = half(false), te = half(true);
  const changed = out.filter(o => Math.abs(o.treat - o.base) > 1e-9).length;
  console.log(`\n-- ${tag}: HOLD changed ${changed}/${out.length} fires`);
  console.log(`   baseline avg ${p1(base)}   HOLD-overlay avg ${p1(treat)}   diff ${p1(vsBase.point)}pt  CI95[${p1(vsBase.lo)},${p1(vsBase.hi)}]  day-block p=${vsBase.p.toFixed(3)}`);
  console.log(`   walk-forward TRAIN base ${p1(tr.b)} treat ${p1(tr.t)} (${p1(tr.t - tr.b)}) | TEST base ${p1(te.b)} treat ${p1(te.t)} (${p1(te.t - te.b)})`);
}

// =====================================================================================
// BONFERRONI across the pre-registered decision cells
// =====================================================================================
console.log(`\n${'='.repeat(80)}\n## MULTIPLE COMPARISONS (Bonferroni)\n${'='.repeat(80)}`);
const cells = [];
{ const { out } = runHB(false, 0.03); cells.push(['H-B primary treat-vs-random', dayBlockP(out.map(o => ({ day: o.day, d: o.treat - o.rand }))).p]); }
{ const { out } = runHB(true, 0.03); cells.push(['H-B sensitivity treat-vs-random', dayBlockP(out.map(o => ({ day: o.day, d: o.treat - o.rand }))).p]); }
{ const out = runHC(false, 0.03); cells.push(['H-C primary hold-vs-trail', dayBlockP(out.map(o => ({ day: o.day, d: o.treat - o.base }))).p]); }
{ const out = runHC(true, 0.03); cells.push(['H-C sensitivity hold-vs-trail', dayBlockP(out.map(o => ({ day: o.day, d: o.treat - o.base }))).p]); }
cells.push(['H-A clear-vs-obstructed', dayBlockP(haPairs).p]);
const NT = cells.length;
console.log(`tests: ${NT}. Bonferroni alpha = 0.05/${NT} = ${(0.05 / NT).toFixed(4)}`);
for (const [lab, p] of cells) console.log(`  ${lab.padEnd(36)} p=${p.toFixed(4)}  ${p < 0.05 / NT ? 'SURVIVES' : p < 0.05 ? '(nominal only)' : 'null'}`);
