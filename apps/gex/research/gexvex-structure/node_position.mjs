// NODE POSITION (floor/ceiling/midpoint) — pre-registered test. RESEARCH ONLY (Clause 0).
//
// MOTIVATION: docs/skylit-academy.md Ch1 + Ch3 say we trade EXTREMES, not MIDPOINTS.
//   FLOOR   = largest |exposure| node BELOW spot   (support)
//   CEILING = largest |exposure| node ABOVE spot   (resistance)
//   "Midpoints are dead space... We fade extremes, not midpoints. If price is between
//    nodes, the R:R is against you." + "Skylit doctrine requires a 3:1 minimum R:R."
// Our patterns (reverse-rug.js / rug-setup.js) only require that a qualifying pika
// EXISTS below/above spot. They NEVER check WHERE SPOT SITS between floor and ceiling.
// So the system is free to fire at midpoints, which the doctrine explicitly forbids.
//
// PRE-REGISTERED (stated before looking at outcomes):
//   H1: fires at a STRUCTURAL EXTREME (pos<=0.20 or pos>=0.80) outperform MIDPOINT
//       fires (0.35<=pos<=0.65). Midpoints are the losing cohort.
//   H2: direction-aligned — a CALL at the FLOOR (bounce off support) outperforms a
//       CALL at/into the CEILING. Mirror for puts.
//   H0: null — node position carries no information.
//
// FEATURE (strictly causal — surface snapshot AT OR BEFORE fire time, never after):
//   pos = (spot - floor) / (ceiling - floor)     0 = at floor, 1 = at ceiling, .5 = midpoint
//   Node/relSig definition mirrors src/domain/significance.js exactly.
//
// P&L: LIVE TRAIL (arm 0.50 / gb 0.15 / stop 0.60) signal->EOD, 3% haircut. SAME exit
//   for baseline and every treatment. Robustness: scale-out ladder + hold-EOD.
//
// PASS BAR (pre-registered):
//   (1) midpoint cohort mean < 0 AND < extremes (unpaired bootstrap);
//   (2) the suppression gate beats a VOLUME-MATCHED RANDOM SKIP out-of-sample on BOTH
//       walk-forward halves. Baseline is negative, so ANY volume cut looks good for
//       free: system_random(f) = f * baseAll, and
//       vsRandom = f * (mean(kept) - baseAll)  -> only positive if the fires we KEEP
//       beat the AVERAGE baseline fire. This is the only honest test.
//   (3) survives Bonferroni across every cell tested.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GEX = path.join(HERE, '..', '..');
const EXIT = path.join(GEX, 'research', 'exit-study');
const CACHE = path.join(EXIT, 'cache');
const UND = path.join(EXIT, 'cache_underlying');
const ARCHIVE = path.join(GEX, 'data', 'skylit-archive', 'intraday');
const load = f => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : []);

const HAIR = 0.03, NBAR = 2;
const MIN_SIG = 0.05;   // min_significance_for_floor_ceiling (config/calibrated_thresholds.json)
const MIN_GK = 0.03;    // min_significance_for_gatekeeper

// ---------- option paths (identical convention to verify_scaleout / entry_pika_gate) ----------
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
function trailLeg(steps, startIdx, arm, gb, stop) {
  let peak = -Infinity, armed = false;
  for (let i = startIdx; i < steps.length; i++) {
    const g = steps[i].g;
    if (g > peak) peak = g;
    if (!armed && peak >= arm) armed = true;
    if (stop != null && g <= -stop) return g;
    if (armed && (1 + g) <= (1 + peak) * (1 - gb)) return g;
  }
  return steps.at(-1).g;
}
function confirmFill(steps, take, nbar) {
  let run = 0;
  for (let i = 0; i < steps.length; i++) {
    if (steps[i].g >= take) { run += 1; if (run >= nbar) return i; } else run = 0;
  }
  return -1;
}
const LADDER = P => {
  const s = P.steps;
  const i1 = confirmFill(s, 0.50, NBAR);
  if (i1 < 0) return { g: trailLeg(s, 0, 0.50, 0.30, 0.60), marketFrac: 1 };
  const i2 = confirmFill(s, 1.00, NBAR);
  if (i2 < 0) return { g: (1 / 3) * 0.50 + (2 / 3) * trailLeg(s, i1, 0.50, 0.30, 0.60), marketFrac: 2 / 3 };
  return { g: (1 / 3) * 0.50 + (1 / 3) * 1.00 + (1 / 3) * trailLeg(s, i2, 1.00, 0.30, 0.60), marketFrac: 1 / 3 };
};
const TRAIL = P => ({ g: trailLeg(P.steps, 0, 0.50, 0.15, 0.60), marketFrac: 1 });   // LIVE trail
const EODF = P => ({ g: P.steps.at(-1).g, marketFrac: 1 });
const realized = (fn, P) => { const r = fn(P); return r.g - HAIR * (r.marketFrac || 0); };

// ---------- Skylit surface archive ----------
const frameCache = {};
function frames(day, ticker) {
  const k = `${day}|${ticker}`;
  if (frameCache[k]) return frameCache[k];
  const p = path.join(ARCHIVE, day, `${ticker}.jsonl.gz`);
  if (!fs.existsSync(p)) return (frameCache[k] = []);
  const rows = zlib.gunzipSync(fs.readFileSync(p)).toString().trim().split('\n')
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean)
    .map(s => ({ tsMs: Date.parse(s.requestedTs), spot: Number(s.spot), strikes: s.strikes || [] }))
    .filter(s => Number.isFinite(s.spot) && s.strikes.length)
    .sort((a, b) => a.tsMs - b.tsMs);
  return (frameCache[k] = rows);
}
// CAUSAL: last frame at/BEFORE ts. null if none.
function frameAt(fr, ts) {
  let best = null;
  for (const f of fr) { if (f.tsMs <= ts) best = f; else break; }
  return best;
}
// nodes exactly as src/domain/significance.js (relSig = |gamma| / sum|gamma|)
function nodes(frame) {
  let tot = 0;
  const rows = frame.strikes.map(r => ({ strike: Number(r.strike), gamma: Number(r.gamma) || 0 }));
  for (const r of rows) tot += Math.abs(r.gamma);
  if (!(tot > 0)) return [];
  return rows.map(r => ({
    strike: r.strike, gamma: r.gamma, absG: Math.abs(r.gamma),
    sign: r.gamma > 0 ? 'pika' : r.gamma < 0 ? 'barney' : 'zero',
    relSig: Math.abs(r.gamma) / tot,
  }));
}
// FLOOR / CEILING per doctrine Ch3: largest |exposure| node below / above spot.
// minSig=0 -> literal doctrine ("largest node"); minSig=0.05 -> production significance floor.
function structure(frame, minSig) {
  const ns = nodes(frame);
  if (!ns.length) return null;
  const spot = frame.spot;
  const below = ns.filter(n => n.strike < spot && n.relSig >= minSig);
  const above = ns.filter(n => n.strike > spot && n.relSig >= minSig);
  if (!below.length || !above.length) return null;
  const floor = below.reduce((a, b) => (b.absG > a.absG ? b : a));
  const ceil = above.reduce((a, b) => (b.absG > a.absG ? b : a));
  const width = ceil.strike - floor.strike;
  if (!(width > 0)) return null;
  const king = ns.reduce((a, b) => (b.absG > a.absG ? b : a));
  return { ns, spot, floor, ceil, king, width, pos: (spot - floor.strike) / width };
}
// path mass between spot and target: air pocket = LOW node mass in the direction of travel.
// signed = net gamma in the path (negative => barney / negative-gamma air pocket => violent).
function pathStats(st, targetStrike) {
  const lo = Math.min(st.spot, targetStrike), hi = Math.max(st.spot, targetStrike);
  const inPath = st.ns.filter(n => n.strike > lo && n.strike < hi);
  const mass = inPath.reduce((s, n) => s + n.relSig, 0);          // total relSig in path
  const signed = inPath.reduce((s, n) => s + n.gamma, 0);         // net gamma sign in path
  const gk = inPath.filter(n => n.relSig >= MIN_GK)
    .sort((a, b) => b.relSig - a.relSig)[0] || null;              // gatekeeper = biggest node in path
  return { mass, signedNeg: signed < 0, gkSig: gk ? gk.relSig : 0, hasGK: !!gk };
}

// ---------- bull tape gate (the one validated rule; mirrors bull-tape-gate.js) ----------
const undDaysCache = {};
function undDays(t) {
  if (undDaysCache[t]) return undDaysCache[t];
  const m = {};
  for (const f of fs.readdirSync(UND).filter(f => f.startsWith(`${t}_`)).sort()) {
    const day = f.slice(t.length + 1, t.length + 11);
    m[day] = load(path.join(UND, f)).filter(c => c.market_time === 'r')
      .map(c => ({ ts: Date.parse(c.start_time), close: +c.close })).filter(c => c.close > 0)
      .sort((a, b) => a.ts - b.ts);
  }
  return (undDaysCache[t] = m);
}
function priorClose(t, day) {
  const m = undDays(t), ds = Object.keys(m).sort(), i = ds.indexOf(day);
  if (i <= 0) return null;
  const prev = m[ds[i - 1]];
  return prev && prev.length ? prev.at(-1).close : null;
}
function spotAt(t, day, ts) {
  const rows = undDays(t)[day];
  if (!rows?.length) return null;
  let s = null;
  for (const r of rows) { if (r.ts <= ts) s = r.close; else break; }
  return s;
}
function tapeBlocks(fire) {
  if (fire.dir <= 0) return false;
  const { day, fireTsMs: ts } = fire;
  const spy = spotAt('SPY', day, ts), spyP = priorClose('SPY', day);
  const qqq = spotAt('QQQ', day, ts), qqqP = priorClose('QQQ', day);
  if (spy == null || spyP == null || qqq == null || qqqP == null) return false;
  return spy < spyP && qqq < qqqP;
}

// ---------- build records ----------
const fires = load(path.join(EXIT, 'fires_index.json'));
const recs = [];
let noPath = 0, noFrame = 0, noStruct = 0;
for (const f of fires) {
  const P = buildPath(f);
  if (!P) { noPath++; continue; }
  const fr = frames(f.day, f.ticker);
  const f0 = fr.length ? frameAt(fr, f.fireTsMs) : null;
  if (!f0) { noFrame++; continue; }
  const st = structure(f0, 0);                 // primary: literal doctrine
  if (!st) { noStruct++; continue; }
  const stS = structure(f0, MIN_SIG);          // robustness: production 5% significance floor
  const isBull = f.dir > 0;
  // R:R proxy (doctrine 3:1). call: reward=spot->ceiling, risk=spot->floor. put: mirror.
  const rew = isBull ? (st.ceil.strike - st.spot) : (st.spot - st.floor.strike);
  const rsk = isBull ? (st.spot - st.floor.strike) : (st.ceil.strike - st.spot);
  const rr = rsk > 0 ? rew / rsk : Infinity;
  // air pocket / gatekeeper in the direction of travel
  const pth = pathStats(st, isBull ? st.ceil.strike : st.floor.strike);
  recs.push({
    day: f.day, ticker: f.ticker, state: f.state, dir: f.dir, isBull,
    spot: st.spot, floorK: st.floor.strike, ceilK: st.ceil.strike,
    pos: st.pos, posS: stS ? stS.pos : null,
    floorSig: st.floor.relSig, ceilSig: st.ceil.relSig,
    gapPct: st.width / st.spot,
    kingSig: st.king.relSig,
    rr,
    pathMass: pth.mass, pathNeg: pth.signedNeg, gkSig: pth.gkSig,
    tapeBlocked: tapeBlocks(f),
    tr: realized(TRAIL, P), lad: realized(LADDER, P), eod: realized(EODF, P),
    staleMin: (f.fireTsMs - f0.tsMs) / 60000,
  });
}

// ---------- stats ----------
const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
const sum = a => a.reduce((s, x) => s + x, 0);
const p1 = x => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}` : '   -');
const pctf = (n, d) => (d ? `${(100 * n / d).toFixed(0)}%` : ' -');
function pf(a) { const w = sum(a.filter(x => x > 0)), l = -sum(a.filter(x => x < 0)); return l > 0 ? w / l : Infinity; }
function bootMean(a, B = 4000) {
  const n = a.length, out = [];
  if (!n) return { lo: NaN, hi: NaN, pNeg: NaN };
  for (let b = 0; b < B; b++) { let s = 0; for (let i = 0; i < n; i++) s += a[(Math.random() * n) | 0]; out.push(s / n); }
  out.sort((x, y) => x - y);
  return { lo: out[(0.025 * B) | 0], hi: out[(0.975 * B) | 0], pNeg: out.filter(x => x >= 0).length / B };
}
function bootDiff(a, b, B = 4000) {
  const out = [];
  for (let k = 0; k < B; k++) {
    let sa = 0, sb = 0;
    for (let i = 0; i < a.length; i++) sa += a[(Math.random() * a.length) | 0];
    for (let i = 0; i < b.length; i++) sb += b[(Math.random() * b.length) | 0];
    out.push(sa / a.length - sb / b.length);
  }
  out.sort((x, y) => x - y);
  return { point: mean(a) - mean(b), lo: out[(0.025 * B) | 0], hi: out[(0.975 * B) | 0], pGE0: out.filter(x => x >= 0).length / B };
}
const KEY = 'tr';   // LIVE TRAIL is the pre-registered outcome
const days = [...new Set(recs.map(r => r.day))].sort();
const split = days[Math.floor(days.length / 2)];
for (const r of recs) r.isTest = r.day >= split;
const G = r => r[KEY];

function row(label, s) {
  if (!s.length) { console.log(`${label.padEnd(30)}    0`); return; }
  const g = s.map(G);
  console.log(`${label.padEnd(30)}${String(s.length).padStart(5)}${p1(mean(g)).padStart(8)}` +
    `${pctf(s.filter(r => G(r) > 0).length, s.length).padStart(7)}${pf(g).toFixed(2).padStart(7)}` +
    `${p1(mean(s.filter(r => !r.isTest).map(G))).padStart(9)}${p1(mean(s.filter(r => r.isTest).map(G))).padStart(8)}`);
}
const HDR = `${'cohort'.padEnd(30)}${'n'.padStart(5)}${'avg%'.padStart(8)}${'win'.padStart(7)}${'PF'.padStart(7)}${'train'.padStart(9)}${'test'.padStart(8)}`;

console.log(`# NODE POSITION (floor / ceiling / midpoint) — pre-registered`);
console.log(`fires ${fires.length} | recs ${recs.length}  (dropped: noPath ${noPath}, noFrame ${noFrame}, noStruct ${noStruct})`);
console.log(`days ${days.length}  WF split ${split}  train ${recs.filter(r => !r.isTest).length} / test ${recs.filter(r => r.isTest).length}`);
const stale = recs.map(r => r.staleMin).sort((a, b) => a - b);
console.log(`surface staleness at fire: median ${stale[recs.length >> 1].toFixed(1)}m  p95 ${stale[(recs.length * 0.95) | 0].toFixed(1)}m`);
const baseAll = mean(recs.map(G));
console.log(`\nBASELINE (all fires, LIVE TRAIL a50/gb15, 3% haircut): n=${recs.length}  avg ${p1(baseAll)}  win ${pctf(recs.filter(r => G(r) > 0).length, recs.length)}  PF ${pf(recs.map(G)).toFixed(2)}`);
console.log(`  robustness: ladder ${p1(mean(recs.map(r => r.lad)))}   hold-EOD ${p1(mean(recs.map(r => r.eod)))}`);

// ---- 1. DECILES + ZONES ----
console.log(`\n${'='.repeat(78)}\n## 1. NODE POSITION — deciles  (pos = (spot-floor)/(ceiling-floor))\n${'='.repeat(78)}`);
console.log(HDR);
for (let d = 0; d < 10; d++) {
  const lo = d / 10, hi = (d + 1) / 10;
  row(`pos [${lo.toFixed(1)},${hi.toFixed(1)})`, recs.filter(r => r.pos >= lo && (d === 9 ? r.pos <= hi : r.pos < hi)));
}
const ZONES = {
  'AT-FLOOR   (pos<=0.20)': r => r.pos <= 0.20,
  'lower band (0.20-0.35)': r => r.pos > 0.20 && r.pos < 0.35,
  'MIDPOINT   (0.35-0.65)': r => r.pos >= 0.35 && r.pos <= 0.65,
  'upper band (0.65-0.80)': r => r.pos > 0.65 && r.pos < 0.80,
  'AT-CEILING (pos>=0.80)': r => r.pos >= 0.80,
};
console.log(`\n## 1b. ZONES\n${HDR}`);
for (const [k, fn] of Object.entries(ZONES)) row(k, recs.filter(fn));
const EXTREME = r => r.pos <= 0.20 || r.pos >= 0.80;
const MID = r => r.pos >= 0.35 && r.pos <= 0.65;
console.log('');
row('EXTREMES (<=.20 or >=.80)', recs.filter(EXTREME));
row('MIDPOINTS (.35-.65)', recs.filter(MID));
const dEM = bootDiff(recs.filter(EXTREME).map(G), recs.filter(MID).map(G));
console.log(`\nH1 test  extremes - midpoints = ${p1(dEM.point)}pt  CI95[${p1(dEM.lo)},${p1(dEM.hi)}]  P(diff>=0)=${dEM.pGE0.toFixed(3)}`);
const ciMid = bootMean(recs.filter(MID).map(G));
console.log(`         midpoint cohort mean CI95[${p1(ciMid.lo)},${p1(ciMid.hi)}]  P(mean>=0)=${ciMid.pNeg.toFixed(3)}`);

// ---- 2. DIRECTION-ALIGNED (H2) ----
console.log(`\n${'='.repeat(78)}\n## 2. DIRECTION-ALIGNED (H2): doctrine predicts CALLS-at-FLOOR >> CALLS-at-CEILING\n${'='.repeat(78)}`);
console.log(HDR);
const bulls = recs.filter(r => r.isBull), bears = recs.filter(r => !r.isBull);
row('CALL @ FLOOR  (pos<=.20)', bulls.filter(r => r.pos <= 0.20));
row('CALL @ mid    (.35-.65)', bulls.filter(MID));
row('CALL @ CEILING(pos>=.80)', bulls.filter(r => r.pos >= 0.80));
console.log('');
row('PUT  @ CEILING(pos>=.80)', bears.filter(r => r.pos >= 0.80));
row('PUT  @ mid    (.35-.65)', bears.filter(MID));
row('PUT  @ FLOOR  (pos<=.20)', bears.filter(r => r.pos <= 0.20));
const dB = bootDiff(bulls.filter(r => r.pos <= 0.20).map(G), bulls.filter(r => r.pos >= 0.80).map(G));
const dS = bootDiff(bears.filter(r => r.pos >= 0.80).map(G), bears.filter(r => r.pos <= 0.20).map(G));
console.log(`\nH2 calls: floor - ceiling = ${p1(dB.point)}pt CI95[${p1(dB.lo)},${p1(dB.hi)}] P(>=0)=${dB.pGE0.toFixed(3)}`);
console.log(`H2 puts : ceiling - floor = ${p1(dS.point)}pt CI95[${p1(dS.lo)},${p1(dS.hi)}] P(>=0)=${dS.pGE0.toFixed(3)}`);

// ---- 3. WHERE DOES THE SYSTEM ACTUALLY FIRE? ----
console.log(`\n${'='.repeat(78)}\n## 3. WHERE DOES THE SYSTEM ACTUALLY FIRE?\n${'='.repeat(78)}`);
for (const [k, fn] of Object.entries(ZONES)) {
  const s = recs.filter(fn);
  console.log(`  ${k.padEnd(24)} ${String(s.length).padStart(4)} / ${recs.length}  ${pctf(s.length, recs.length).padStart(4)}   (bull ${s.filter(r => r.isBull).length} / bear ${s.filter(r => !r.isBull).length})`);
}
const q = [...recs.map(r => r.pos)].sort((a, b) => a - b);
console.log(`  pos distribution: p10 ${q[(recs.length * .1) | 0].toFixed(2)}  p25 ${q[(recs.length * .25) | 0].toFixed(2)}  median ${q[recs.length >> 1].toFixed(2)}  p75 ${q[(recs.length * .75) | 0].toFixed(2)}  p90 ${q[(recs.length * .9) | 0].toFixed(2)}`);
console.log(`  mean pos: bulls ${mean(bulls.map(r => r.pos)).toFixed(3)}  bears ${mean(bears.map(r => r.pos)).toFixed(3)}`);

// ---- 4. R:R GATE ----
console.log(`\n${'='.repeat(78)}\n## 4. DOCTRINE R:R GATE  (call: reward=spot->ceil, risk=spot->floor)\n${'='.repeat(78)}`);
console.log(`NOTE: with floor/ceiling as the only levels, RR is an exact monotone transform of pos`);
console.log(`      (calls RR=(1-pos)/pos, puts RR=pos/(1-pos)) -> RR>=3 <=> "at the favourable extreme".`);
console.log(HDR);
for (const [lab, fn] of [
  ['RR < 1 (against you)', r => r.rr < 1],
  ['RR 1-2', r => r.rr >= 1 && r.rr < 2],
  ['RR 2-3', r => r.rr >= 2 && r.rr < 3],
  ['RR >= 3 (doctrine min)', r => r.rr >= 3],
]) row(lab, recs.filter(fn));

// ---- 5. GATE TEST vs VOLUME-MATCHED RANDOM SKIP ----
// For a pure SUPPRESSION gate the entry price is unchanged, so trades kept are identical
// to their baseline counterparts. Therefore:
//   system_gate(f)   = f * mean(kept)          (per-signal, skipped = 0)
//   system_random(f) = f * baseAll             (skip a random 1-f of signals)
//   vsRandom         = f * (mean(kept) - baseAll)
// The gate is ONLY real if the fires it KEEPS beat the AVERAGE baseline fire.
console.log(`\n${'='.repeat(78)}\n## 5. GATE TEST — suppression vs VOLUME-MATCHED RANDOM SKIP (the honest test)\n${'='.repeat(78)}`);
console.log(`  system_gate = f*mean(kept) | system_random(f) = f*baseAll | vsRandom = f*(mean(kept)-baseAll)`);
console.log(`  A gate that only cuts volume gets +f-weighted credit for free; only vsRandom>0 counts.`);
const GATES = {
  'suppress MIDPOINT .35-.65': MID,
  'suppress .30-.70': r => r.pos >= 0.30 && r.pos <= 0.70,
  'suppress .25-.75': r => r.pos >= 0.25 && r.pos <= 0.75,
  'suppress .40-.60': r => r.pos >= 0.40 && r.pos <= 0.60,
  'keep only EXTREMES': r => !EXTREME(r),
  'dir-aligned: keep RR>=2': r => r.rr < 2,
  'dir-aligned: keep RR>=3': r => r.rr < 3,
  'calls@floor / puts@ceil only': r => !(r.isBull ? r.pos <= 0.35 : r.pos >= 0.65),
};
console.log(`\n${'gate'.padEnd(30)}${'nSkip'.padStart(6)}${'f'.padStart(6)}${'skipAvg'.padStart(9)}${'keptAvg'.padStart(9)}${'sysGate'.padStart(9)}${'sysRand'.padStart(9)}${'vsRand'.padStart(8)}${'p'.padStart(7)}${'vsRnd-tr'.padStart(9)}${'vsRnd-te'.padStart(9)}`);
const cells = [];
function vsRandBoot(kept, all, f, B = 4000) {   // bootstrap P(mean(kept) - mean(all) <= 0)
  const out = [];
  for (let b = 0; b < B; b++) {
    let sk = 0, sa = 0;
    for (let i = 0; i < kept.length; i++) sk += kept[(Math.random() * kept.length) | 0];
    for (let i = 0; i < all.length; i++) sa += all[(Math.random() * all.length) | 0];
    out.push(f * (sk / kept.length - sa / all.length));
  }
  return out.filter(x => x <= 0).length / B;    // p-value for "gate no better than random"
}
for (const [lab, skipFn] of Object.entries(GATES)) {
  const skip = recs.filter(skipFn), kept = recs.filter(r => !skipFn(r));
  if (!skip.length || kept.length < 20) { console.log(`${lab.padEnd(30)}  (degenerate)`); continue; }
  const f = kept.length / recs.length;
  const sysGate = f * mean(kept.map(G)), sysRand = f * baseAll, vsR = sysGate - sysRand;
  const p = vsRandBoot(kept.map(G), recs.map(G), f);
  const half = t => {
    const pool = recs.filter(r => r.isTest === t), k = pool.filter(r => !skipFn(r));
    if (!k.length) return NaN;
    const ff = k.length / pool.length;
    return ff * (mean(k.map(G)) - mean(pool.map(G)));
  };
  const vTr = half(false), vTe = half(true);
  cells.push({ lab, skip, kept, f, vsR, p, vTr, vTe });
  console.log(`${lab.padEnd(30)}${String(skip.length).padStart(6)}${f.toFixed(2).padStart(6)}` +
    `${p1(mean(skip.map(G))).padStart(9)}${p1(mean(kept.map(G))).padStart(9)}${p1(sysGate).padStart(9)}` +
    `${p1(sysRand).padStart(9)}${p1(vsR).padStart(8)}${p.toFixed(3).padStart(7)}${p1(vTr).padStart(9)}${p1(vTe).padStart(9)}` +
    `${(vTr > 0 && vTe > 0 && p < 0.05) ? '  <<<' : ''}`);
}

// ---- 6. WHAT ARE WE SKIPPING? ----
console.log(`\n${'='.repeat(78)}\n## 6. THE SKIPPED (MIDPOINT) COHORT — are we skipping losers or winners?\n${'='.repeat(78)}`);
const mids = recs.filter(MID);
const ciM = bootMean(mids.map(G));
console.log(`  midpoint cohort: n=${mids.length}  baseline avg ${p1(mean(mids.map(G)))}  CI95[${p1(ciM.lo)},${p1(ciM.hi)}]  win ${pctf(mids.filter(r => G(r) > 0).length, mids.length)}  PF ${pf(mids.map(G)).toFixed(2)}`);
console.log(`  vs ALL fires   : n=${recs.length}  baseline avg ${p1(baseAll)}  win ${pctf(recs.filter(r => G(r) > 0).length, recs.length)}  PF ${pf(recs.map(G)).toFixed(2)}`);
console.log(`  winners inside the midpoint cohort: ${mids.filter(r => G(r) > 0).length} of ${recs.filter(r => G(r) > 0).length} total winners (${pctf(mids.filter(r => G(r) > 0).length, recs.filter(r => G(r) > 0).length)})`);
console.log(`  gross gains destroyed by the skip : ${pctf(sum(mids.map(G).filter(x => x > 0)), sum(recs.map(G).filter(x => x > 0)))}`);

// ---- 7. AIR POCKET / GATEKEEPER / WALL MAGNITUDE ----
console.log(`\n${'='.repeat(78)}\n## 7. AIR POCKETS, GATEKEEPERS, WALL MAGNITUDE\n${'='.repeat(78)}`);
console.log(`AIR POCKET = low node mass in the direction of travel (spot -> target).`);
console.log(HDR);
const pm = [...recs.map(r => r.pathMass)].sort((a, b) => a - b);
const t33 = pm[(recs.length / 3) | 0], t66 = pm[((2 * recs.length) / 3) | 0];
row(`path mass LOW (air pocket)`, recs.filter(r => r.pathMass <= t33));
row(`path mass MID`, recs.filter(r => r.pathMass > t33 && r.pathMass < t66));
row(`path mass HIGH (blocked)`, recs.filter(r => r.pathMass >= t66));
console.log('');
row('air pocket + NEG gamma', recs.filter(r => r.pathMass <= t33 && r.pathNeg));
row('air pocket + POS gamma', recs.filter(r => r.pathMass <= t33 && !r.pathNeg));
console.log('');
row('GATEKEEPER in path (>=3%)', recs.filter(r => r.gkSig >= MIN_GK));
row('no gatekeeper in path', recs.filter(r => r.gkSig < MIN_GK));
console.log(`\nWall magnitude / gap width:`);
console.log(HDR);
row('target wall relSig < 5%', recs.filter(r => (r.isBull ? r.ceilSig : r.floorSig) < 0.05));
row('target wall relSig >= 5%', recs.filter(r => (r.isBull ? r.ceilSig : r.floorSig) >= 0.05));
row('gap width < median', recs.filter(r => r.gapPct < [...recs.map(x => x.gapPct)].sort((a, b) => a - b)[recs.length >> 1]));
row('gap width >= median', recs.filter(r => r.gapPct >= [...recs.map(x => x.gapPct)].sort((a, b) => a - b)[recs.length >> 1]));

// ---- 7b. PATH-MASS / GATEKEEPER GATES through the SAME random-skip machinery ----
// (pre-registered item 7). These are the only cohorts that looked stable on both halves,
// so they get the honest test, not an eyeball.
console.log(`\n## 7b. PATH-MASS / GATEKEEPER GATES vs VOLUME-MATCHED RANDOM SKIP`);
console.log(`${'gate'.padEnd(30)}${'nSkip'.padStart(6)}${'f'.padStart(6)}${'skipAvg'.padStart(9)}${'keptAvg'.padStart(9)}${'vsRand'.padStart(8)}${'p'.padStart(7)}${'vsRnd-tr'.padStart(9)}${'vsRnd-te'.padStart(9)}`);
const GATES2 = {
  'suppress path-mass HIGH (t66)': r => r.pathMass >= t66,
  'suppress GATEKEEPER in path': r => r.gkSig >= MIN_GK,
  'suppress gap width >= median': r => r.gapPct >= [...recs.map(x => x.gapPct)].sort((a, b) => a - b)[recs.length >> 1],
  'GK-in-path, bulls only': r => r.isBull && r.gkSig >= MIN_GK,
  'GK-in-path, bears only': r => !r.isBull && r.gkSig >= MIN_GK,
};
for (const [lab, skipFn] of Object.entries(GATES2)) {
  const skip = recs.filter(skipFn), kept = recs.filter(r => !skipFn(r));
  if (!skip.length || kept.length < 20) { console.log(`${lab.padEnd(30)}  (degenerate)`); continue; }
  const f = kept.length / recs.length;
  const vsR = f * (mean(kept.map(G)) - baseAll);
  const p = vsRandBoot(kept.map(G), recs.map(G), f);
  const half = t => {
    const pool = recs.filter(r => r.isTest === t), k = pool.filter(r => !skipFn(r));
    if (!k.length) return NaN;
    const ff = k.length / pool.length;
    return ff * (mean(k.map(G)) - mean(pool.map(G)));
  };
  const vTr = half(false), vTe = half(true);
  cells.push({ lab, skip, kept, f, vsR, p, vTr, vTe });
  console.log(`${lab.padEnd(30)}${String(skip.length).padStart(6)}${f.toFixed(2).padStart(6)}` +
    `${p1(mean(skip.map(G))).padStart(9)}${p1(mean(kept.map(G))).padStart(9)}${p1(vsR).padStart(8)}` +
    `${p.toFixed(3).padStart(7)}${p1(vTr).padStart(9)}${p1(vTe).padStart(9)}` +
    `${(vTr > 0 && vTe > 0 && p < 0.05) ? '  <<< beats random, both halves' : ''}`);
}
// CONFOUND: is "gatekeeper in path" just "the target is far away"? Distance to target,
// gap width and path mass are mechanically linked. Stratify GK effect INSIDE distance buckets.
console.log(`\n-- CONFOUND CHECK: is the gatekeeper effect just distance-to-target?`);
for (const r of recs) r.tgtDist = Math.abs((r.isBull ? r.ceilK : r.floorK) - r.spot) / r.spot;
const td = [...recs.map(r => r.tgtDist)].sort((a, b) => a - b);
const dq = [0, td[(recs.length / 3) | 0], td[((2 * recs.length) / 3) | 0], Infinity];
console.log(`${'target-dist bucket'.padEnd(24)}${'GK in path'.padStart(18)}${'no GK'.padStart(18)}${'diff'.padStart(9)}`);
for (let i = 0; i < 3; i++) {
  const s = recs.filter(r => r.tgtDist >= dq[i] && r.tgtDist < dq[i + 1]);
  const g = s.filter(r => r.gkSig >= MIN_GK), n = s.filter(r => r.gkSig < MIN_GK);
  const lab = `[${(dq[i] * 100).toFixed(2)}%,${dq[i + 1] === Infinity ? '∞' : (dq[i + 1] * 100).toFixed(2) + '%'})`;
  console.log(`${lab.padEnd(24)}${(g.length ? `${p1(mean(g.map(G)))} (n=${g.length})` : '-').padStart(18)}` +
    `${(n.length ? `${p1(mean(n.map(G)))} (n=${n.length})` : '-').padStart(18)}` +
    `${(g.length && n.length ? p1(mean(g.map(G)) - mean(n.map(G))) : '-').padStart(9)}`);
}

// ---- 8. ROBUSTNESS: production 5% significance floor + other exits + post-tape-gate ----
console.log(`\n${'='.repeat(78)}\n## 8. ROBUSTNESS\n${'='.repeat(78)}`);
const withS = recs.filter(r => r.posS != null);
console.log(`(a) floor/ceiling defined with the PRODUCTION 5% significance floor (n=${withS.length}):`);
console.log(HDR);
row('  EXTREMES', withS.filter(r => r.posS <= 0.20 || r.posS >= 0.80));
row('  MIDPOINTS', withS.filter(r => r.posS >= 0.35 && r.posS <= 0.65));
console.log(`\n(b) midpoint vs extremes under the other two exit rules:`);
for (const k of ['lad', 'eod']) {
  const e = recs.filter(EXTREME).map(r => r[k]), m = recs.filter(MID).map(r => r[k]);
  console.log(`    ${k === 'lad' ? 'scale-out ladder' : 'hold-EOD       '}: extremes ${p1(mean(e))}  midpoints ${p1(mean(m))}  diff ${p1(mean(e) - mean(m))}`);
}
const postTape = recs.filter(r => !r.tapeBlocked);
console.log(`\n(c) INCREMENTAL over the bull tape gate (n=${postTape.length}, tape blocks ${recs.length - postTape.length}):`);
const ptBase = mean(postTape.map(G));
console.log(`    post-tape baseline ${p1(ptBase)}`);
const ptKept = postTape.filter(r => !MID(r)), ptF = ptKept.length / postTape.length;
console.log(`    suppress midpoints on top: kept n=${ptKept.length} avg ${p1(mean(ptKept.map(G)))}  vsRandom ${p1(ptF * (mean(ptKept.map(G)) - ptBase))}  (p=${vsRandBoot(ptKept.map(G), postTape.map(G), ptF).toFixed(3)})`);

// ---- 9. BONFERRONI ----
console.log(`\n${'='.repeat(78)}\n## 9. MULTIPLE COMPARISONS\n${'='.repeat(78)}`);
const NT = cells.length + 4;   // gate cells + H1 + H2call + H2put + incremental
console.log(`tests: ${NT} (${cells.length} gate cells + H1 + H2-calls + H2-puts + incremental). Bonferroni alpha = 0.05/${NT} = ${(0.05 / NT).toFixed(4)}`);
const surv = cells.filter(c => c.vsR > 0 && c.p < 0.05 / NT && c.vTr > 0 && c.vTe > 0);
console.log(`gate cells with [vsRandom>0 on BOTH WF halves] AND [p < Bonferroni alpha]: ${surv.length}`);
for (const s of surv) console.log(`   ${s.lab}: f=${s.f.toFixed(2)} vsRand ${p1(s.vsR)} p=${s.p.toFixed(4)} tr ${p1(s.vTr)} te ${p1(s.vTe)}`);
console.log(`H1 (extremes>midpoints) p=${(1 - dEM.pGE0).toFixed(4)} -> ${1 - dEM.pGE0 < 0.05 / NT ? 'SURVIVES' : 'does NOT survive'} Bonferroni`);
console.log(`H2 calls floor>ceiling  p=${(1 - dB.pGE0).toFixed(4)} -> ${1 - dB.pGE0 < 0.05 / NT ? 'SURVIVES' : 'does NOT survive'} Bonferroni`);
console.log(`H2 puts  ceiling>floor  p=${(1 - dS.pGE0).toFixed(4)} -> ${1 - dS.pGE0 < 0.05 / NT ? 'SURVIVES' : 'does NOT survive'} Bonferroni`);
