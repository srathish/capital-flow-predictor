// ENTRY PIKA GATE — pre-registered test (RESEARCH ONLY, Clause 0: no live code).
//
// HYPOTHESIS: a fire should be SUPPRESSED when, AT FIRE TIME, the opposing pika
// anchor (bull -> strongest pika at/above spot = ceiling; bear -> strongest pika
// at/below spot = floor; mirrors evaluateSurfaceExit in src/tracker/plays.js) is
// (a) within X% of spot AND (b) relSig >= R. Motivation: the two 2026-07-14 QQQ
// 720C losers never printed a single green minute and both died to
// "opposing_pika_$720_hardened" -- i.e. the loss looks baked in at ENTRY.
//
// PRE-REGISTERED SWEEP: X in {0.3%, 0.5%, 1.0%} x R in {0.08, 0.12, 0.20}
//   (0.08 = live INVALIDATE_ANCHOR_MIN_RELSIG, 0.20 = live PIN_MIN_RELSIG)
// VARIANT "HARD": additionally require the anchor to be ALREADY HARDENING at fire
//   time vs a PRE-fire baseline (30m before the fire): relSig >= 1.5x AND +>=5pp
//   (mirrors INVALIDATE_ANCHOR_RATIO / _MIN_GAIN).
//
// P&L: the verified scale-out ladder (1/3 @+50, 1/3 @+100, trail gb30/stop60),
//   2-consecutive-bar confirmed rung fills, 3% haircut on market legs
//   (== research/exit-study/SCALEOUT_VERIFY_2026-07-13.md realistic settings).
//   Robustness: also LIVE-TRAIL a50/gb15 and HOLD-EOD.
//
// PASS BAR (pre-registered):
//   (1) BLOCKED cohort mean realized clearly < 0 AND < KEPT cohort (bootstrap p);
//   (2) gated system beats ungated on BOTH walk-forward halves (avg/trade);
//   (3) survives Bonferroni across the 9 (18 w/ variant) cells;
//   (4) winner-kill rate not catastrophic (report share of total gains destroyed);
//   (5) INCREMENTAL over the bull tape gate (re-run on post-tape-gate mix).
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

// ---------- option paths (identical convention to verify_scaleout.mjs) ----------
function buildPath(fire) {
  const opt = load(path.join(CACHE, `${fire.sym}_${fire.day}.json`))
    .map(c => ({ ts: Date.parse(c.start_time), close: Number(c.close) || 0 }))
    .filter(c => c.close > 0).sort((a, b) => a.ts - b.ts);
  if (opt.length < 4) return null;
  const ei = opt.findIndex(o => o.ts >= fire.fireTsMs + 60000);
  if (ei < 0 || ei >= opt.length - 2) return null;
  const entry = opt[ei].close;
  if (!(entry > 0)) return null;
  return { fire, day: fire.day, ticker: fire.ticker,
    steps: opt.slice(ei).map(o => ({ ts: o.ts, g: (o.close - entry) / entry })) };
}

// ---------- exits ----------
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
const TRAIL = P => ({ g: trailLeg(P.steps, 0, 0.50, 0.15, 0.60), marketFrac: 1 });
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
// CAUSAL: last frame at/BEFORE ts. null if none (never look ahead).
function frameAt(fr, ts) {
  let best = null;
  for (const f of fr) { if (f.tsMs <= ts) best = f; else break; }
  return best;
}
// nodes exactly as fire-loop.js computeNodesFromSnapshot / domain/significance.js
function nodes(frame) {
  let tot = 0;
  const rows = frame.strikes.map(r => ({ strike: Number(r.strike), gamma: Number(r.gamma) || 0 }));
  for (const r of rows) tot += Math.abs(r.gamma);
  if (!(tot > 0)) return [];
  return rows.map(r => ({ strike: r.strike, gamma: r.gamma,
    sign: r.gamma > 0 ? 'pika' : r.gamma < 0 ? 'barney' : 'zero',
    relSig: Math.abs(r.gamma) / tot }));
}
// opposing anchor = strongest pika on the far side (bull: at/above spot; bear: at/below)
function opposingAnchor(frame, isBull) {
  const ns = nodes(frame);
  if (!ns.length) return null;
  const side = ns.filter(n => n.sign === 'pika' && (isBull ? n.strike >= frame.spot : n.strike <= frame.spot));
  if (!side.length) return null;
  return side.sort((a, b) => b.relSig - a.relSig)[0];
}

// ---------- bull tape gate (mirrors bull-tape-gate.js; same recon as verify_scaleout) ----------
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
function tapeBlocks(P) {
  if (P.fire.dir <= 0) return false;                       // gate only touches bulls
  const { day, fireTsMs: ts } = P.fire;
  const spy = spotAt('SPY', day, ts), spyP = priorClose('SPY', day);
  const qqq = spotAt('QQQ', day, ts), qqqP = priorClose('QQQ', day);
  if (spy == null || spyP == null || qqq == null || qqqP == null) return false;
  return spy < spyP && qqq < qqqP;                          // all-3-below (SPXW≈SPY)
}

// ---------- build records ----------
const fires = load(path.join(EXIT, 'fires_index.json'));
const recs = [];
let noPath = 0, noFrame = 0, noAnchor = 0;
for (const f of fires) {
  const P = buildPath(f);
  if (!P) { noPath++; continue; }
  const fr = frames(f.day, f.ticker);
  const f0 = fr.length ? frameAt(fr, f.fireTsMs) : null;
  if (!f0) { noFrame++; continue; }
  const isBull = f.dir > 0;
  const a = opposingAnchor(f0, isBull);
  if (!a) { noAnchor++; continue; }
  // pre-fire baseline (30m before) for the "already hardening" variant
  const fPre = frameAt(fr, f.fireTsMs - 30 * 60000);
  let preSig = null;
  if (fPre && fPre.tsMs < f0.tsMs) {
    const pn = nodes(fPre).find(n => n.strike === a.strike);
    preSig = pn ? pn.relSig : 0;
  }
  recs.push({
    day: f.day, ticker: f.ticker, state: f.state, dir: f.dir, P,
    spot: f0.spot,
    anchorStrike: a.strike,
    anchorSig: a.relSig,
    anchorDist: Math.abs(a.strike - f0.spot) / f0.spot,
    preSig,                                   // null if no pre-frame
    tapeBlocked: tapeBlocks(P),
    lad: realized(LADDER, P), tr: realized(TRAIL, P), eod: realized(EODF, P),
    staleMin: (f.fireTsMs - f0.tsMs) / 60000,
  });
}

// ---------- stats ----------
const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
const sum = a => a.reduce((s, x) => s + x, 0);
const p1 = x => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}` : '   -');
const pctf = (n, d) => (d ? `${(100 * n / d).toFixed(0)}%` : ' -');
function pf(a) { const w = sum(a.filter(x => x > 0)), l = -sum(a.filter(x => x < 0)); return l > 0 ? w / l : Infinity; }
function bootMean(a, B = 4000) {  // p = P(mean >= 0) for a one-sided "is it negative" test
  const n = a.length, out = [];
  if (!n) return { lo: NaN, hi: NaN, pNeg: NaN };
  for (let b = 0; b < B; b++) { let s = 0; for (let i = 0; i < n; i++) s += a[(Math.random() * n) | 0]; out.push(s / n); }
  out.sort((x, y) => x - y);
  return { lo: out[(0.025 * B) | 0], hi: out[(0.975 * B) | 0], pNeg: out.filter(x => x >= 0).length / B };
}
function bootDiff(a, b, B = 4000) { // unpaired: p = P(meanA - meanB >= 0)
  const out = [];
  for (let k = 0; k < B; k++) {
    let sa = 0, sb = 0;
    for (let i = 0; i < a.length; i++) sa += a[(Math.random() * a.length) | 0];
    for (let i = 0; i < b.length; i++) sb += b[(Math.random() * b.length) | 0];
    out.push(sa / a.length - sb / b.length);
  }
  out.sort((x, y) => x - y);
  return { point: mean(a) - mean(b), lo: out[100], hi: out[3899], pGE0: out.filter(x => x >= 0).length / B };
}

const days = [...new Set(recs.map(r => r.day))].sort();
const split = days[Math.floor(days.length / 2)];
for (const r of recs) r.isTest = r.day >= split;

console.log(`# ENTRY PIKA GATE — pre-registered sweep`);
console.log(`fires ${fires.length} | recs ${recs.length} (dropped: noPath ${noPath}, noFrame ${noFrame}, noAnchor ${noAnchor})`);
console.log(`days ${days.length}  WF split ${split}  train ${recs.filter(r => !r.isTest).length} / test ${recs.filter(r => r.isTest).length}`);
console.log(`surface staleness at fire: median ${[...recs.map(r => r.staleMin)].sort((a, b) => a - b)[recs.length >> 1].toFixed(1)}m, p95 ${[...recs.map(r => r.staleMin)].sort((a, b) => a - b)[(recs.length * 0.95) | 0].toFixed(1)}m`);
console.log(`anchor present: ${recs.length} | pre-fire baseline available: ${recs.filter(r => r.preSig != null).length}`);
console.log(`\nbaseline (ALL, ladder): n=${recs.length} avg ${p1(mean(recs.map(r => r.lad)))} win ${pctf(recs.filter(r => r.lad > 0).length, recs.length)} PF ${pf(recs.map(r => r.lad)).toFixed(2)}`);

const Xs = [0.003, 0.005, 0.010];
const Rs = [0.08, 0.12, 0.20];

function evalCell(pool, blockFn, key = 'lad') {
  const blocked = pool.filter(blockFn), kept = pool.filter(r => !blockFn(r));
  const bg = blocked.map(r => r[key]), kg = kept.map(r => r[key]), ag = pool.map(r => r[key]);
  const tr = pool.filter(r => !r.isTest), te = pool.filter(r => r.isTest);
  const trK = tr.filter(r => !blockFn(r)), teK = te.filter(r => !blockFn(r));
  const dTr = mean(trK.map(r => r[key])) - mean(tr.map(r => r[key]));
  const dTe = mean(teK.map(r => r[key])) - mean(te.map(r => r[key]));
  const winnersBlocked = blocked.filter(r => r[key] > 0).length;
  const allWinners = pool.filter(r => r[key] > 0).length;
  const gainsBlocked = sum(bg.filter(x => x > 0));
  const gainsAll = sum(ag.filter(x => x > 0));
  return {
    nB: blocked.length, nK: kept.length, blocked, kept,
    blkAvg: mean(bg), kptAvg: mean(kg), allAvg: mean(ag),
    dAll: mean(kg) - mean(ag), dTr, dTe,
    blkWin: winnersBlocked / (blocked.length || 1),
    winnerKill: winnersBlocked / (allWinners || 1),
    gainKill: gainsBlocked / (gainsAll || 1),
    totAll: sum(ag), totKept: sum(kg),
    pfAll: pf(ag), pfKept: pf(kg),
    winAll: pool.filter(r => r[key] > 0).length / pool.length,
    winKept: kept.filter(r => r[key] > 0).length / (kept.length || 1),
  };
}

function sweep(title, pool, variant) {
  console.log(`\n${'='.repeat(112)}\n${title}   (n=${pool.length}, ungated avg ${p1(mean(pool.map(r => r.lad)))}, win ${pctf(pool.filter(r => r.lad > 0).length, pool.length)}, PF ${pf(pool.map(r => r.lad)).toFixed(2)})\n${'='.repeat(112)}`);
  console.log(`${'X'.padEnd(6)}${'R'.padEnd(6)}${'nBlk'.padStart(5)}${'blkAvg'.padStart(8)}${'blkCI'.padStart(16)}${'pMean>=0'.padStart(9)}${'kptAvg'.padStart(8)}${'ΔAll'.padStart(7)}${'ΔTrain'.padStart(8)}${'ΔTest'.padStart(7)}${'blkWin%'.padStart(8)}${'winKill'.padStart(8)}${'gainKill'.padStart(9)}${'PF→'.padStart(11)}`);
  const cells = [];
  for (const X of Xs) for (const R of Rs) {
    const fn = variant === 'hard'
      ? (r => r.anchorDist <= X && r.anchorSig >= R && r.preSig != null && r.preSig > 0 &&
             r.anchorSig >= r.preSig * 1.5 && r.anchorSig - r.preSig >= 0.05)
      : (r => r.anchorDist <= X && r.anchorSig >= R);
    const c = evalCell(pool, fn);
    if (!c.nB) { console.log(`${(X * 100).toFixed(1) + '%'} ${String(R).padEnd(6)}    0  (no fires blocked)`); continue; }
    const ci = bootMean(c.blocked.map(r => r.lad));
    cells.push({ X, R, c, ci });
    console.log(
      `${((X * 100).toFixed(1) + '%').padEnd(6)}${String(R).padEnd(6)}${String(c.nB).padStart(5)}` +
      `${p1(c.blkAvg).padStart(8)}${`[${p1(ci.lo)},${p1(ci.hi)}]`.padStart(16)}${ci.pNeg.toFixed(3).padStart(9)}` +
      `${p1(c.kptAvg).padStart(8)}${p1(c.dAll).padStart(7)}${p1(c.dTr).padStart(8)}${p1(c.dTe).padStart(7)}` +
      `${pctf(c.blocked.filter(r => r.lad > 0).length, c.nB).padStart(8)}${pctf(c.blocked.filter(r => r.lad > 0).length, pool.filter(r => r.lad > 0).length).padStart(8)}` +
      `${(100 * c.gainKill).toFixed(0) + '%'}`.padStart(9) +
      `${(c.pfAll.toFixed(2) + '→' + c.pfKept.toFixed(2)).padStart(11)}` +
      `${(c.dTr > 0 && c.dTe > 0 && ci.hi < 0) ? '  <<< both WF halves + blk-cohort CI<0' : ''}`);
  }
  return cells;
}

const bestOf = [];
bestOf.push(...sweep('A. ALL FIRES — plain gate (near + significant)', recs, 'plain').map(x => ({ pool: 'ALL', v: 'plain', ...x })));
bestOf.push(...sweep('B. ALL FIRES — HARD variant (also already-hardening vs 30m pre-fire)', recs.filter(r => r.preSig != null), 'hard').map(x => ({ pool: 'ALL', v: 'hard', ...x })));

const postTape = recs.filter(r => !r.tapeBlocked);
console.log(`\n\n### INCREMENTAL OVER THE BULL TAPE GATE ###`);
console.log(`tape gate blocks ${recs.filter(r => r.tapeBlocked).length} of ${recs.filter(r => r.dir > 0).length} bull fires (${recs.length} -> ${postTape.length} traded)`);
bestOf.push(...sweep('C. POST-TAPE-GATE mix — plain gate', postTape, 'plain').map(x => ({ pool: 'POSTGATE', v: 'plain', ...x })));
bestOf.push(...sweep('D. POST-TAPE-GATE mix — HARD variant', postTape.filter(r => r.preSig != null), 'hard').map(x => ({ pool: 'POSTGATE', v: 'hard', ...x })));

// overlap with the tape gate: are the pika-gate blocks just the tape-gate blocks?
console.log(`\n-- OVERLAP with tape gate (ALL fires, per cell): what % of pika-blocked fires does the tape gate ALREADY block?`);
for (const X of Xs) for (const R of Rs) {
  const b = recs.filter(r => r.anchorDist <= X && r.anchorSig >= R);
  if (!b.length) continue;
  const ov = b.filter(r => r.tapeBlocked).length;
  console.log(`  X=${(X * 100).toFixed(1)}% R=${R}: blocked ${String(b.length).padStart(4)}  already tape-blocked ${String(ov).padStart(3)} (${pctf(ov, b.length)})  bulls ${b.filter(r => r.dir > 0).length} / bears ${b.filter(r => r.dir < 0).length}`);
}

// direction split of the headline cells (a gate that only works on one side = tape shadow risk)
console.log(`\n-- DIRECTION SPLIT (ALL fires, plain gate): blocked-cohort avg by direction`);
for (const X of Xs) for (const R of Rs) {
  const b = recs.filter(r => r.anchorDist <= X && r.anchorSig >= R);
  if (b.length < 10) continue;
  const bl = b.filter(r => r.dir > 0), be = b.filter(r => r.dir < 0);
  console.log(`  X=${(X * 100).toFixed(1)}% R=${R}: BULL n=${String(bl.length).padStart(3)} avg ${p1(mean(bl.map(r => r.lad))).padStart(6)}  |  BEAR n=${String(be.length).padStart(3)} avg ${p1(mean(be.map(r => r.lad))).padStart(6)}  || kept BULL ${p1(mean(recs.filter(r => r.dir > 0 && !(r.anchorDist <= X && r.anchorSig >= R)).map(r => r.lad)))} BEAR ${p1(mean(recs.filter(r => r.dir < 0 && !(r.anchorDist <= X && r.anchorSig >= R)).map(r => r.lad)))}`);
}

// MULTIPLE-COMPARISONS: Bonferroni over 9 cells x 2 variants x 2 pools = 36 tests -> alpha 0.05/36
console.log(`\n-- MULTIPLE COMPARISONS: ${bestOf.length} cells tested. Bonferroni alpha = 0.05/${bestOf.length} = ${(0.05 / bestOf.length).toFixed(4)}`);
const survivors = bestOf.filter(x => x.ci.hi < 0 && x.ci.pNeg < 0.05 / bestOf.length && x.c.dTr > 0 && x.c.dTe > 0);
console.log(`cells passing [blocked-cohort mean < 0 at Bonferroni-adjusted alpha] AND [ΔTrain>0 AND ΔTest>0]: ${survivors.length}`);
for (const s of survivors) console.log(`   ${s.pool}/${s.v} X=${(s.X * 100).toFixed(1)}% R=${s.R}: nBlk ${s.c.nB} blkAvg ${p1(s.c.blkAvg)} pNeg ${s.ci.pNeg.toFixed(4)} ΔTr ${p1(s.c.dTr)} ΔTe ${p1(s.c.dTe)} winKill ${(100 * s.c.winnerKill).toFixed(0)}%`);

// KEPT-vs-BLOCKED separation test on the widest / narrowest cells (unpaired bootstrap)
console.log(`\n-- SEPARATION TEST (blocked vs kept, unpaired bootstrap, ALL fires, plain):`);
for (const X of Xs) for (const R of Rs) {
  const fn = r => r.anchorDist <= X && r.anchorSig >= R;
  const b = recs.filter(fn).map(r => r.lad), k = recs.filter(r => !fn(r)).map(r => r.lad);
  if (b.length < 10) continue;
  const d = bootDiff(b, k);
  console.log(`  X=${(X * 100).toFixed(1)}% R=${R}: blk-kpt ${p1(d.point)} CI[${p1(d.lo)},${p1(d.hi)}] P(diff>=0)=${d.pGE0.toFixed(3)}`);
}

// robustness across exit rules (does the story depend on the ladder?)
console.log(`\n-- EXIT-RULE ROBUSTNESS (ALL fires): blocked-cohort avg under 3 exits`);
for (const X of Xs) for (const R of Rs) {
  const b = recs.filter(r => r.anchorDist <= X && r.anchorSig >= R);
  if (b.length < 10) continue;
  console.log(`  X=${(X * 100).toFixed(1)}% R=${R} n=${String(b.length).padStart(4)}: ladder ${p1(mean(b.map(r => r.lad))).padStart(6)}  live-trail ${p1(mean(b.map(r => r.tr))).padStart(6)}  hold-EOD ${p1(mean(b.map(r => r.eod))).padStart(6)}   (kept: ${p1(mean(recs.filter(r => !(r.anchorDist <= X && r.anchorSig >= R)).map(r => r.lad)))}/${p1(mean(recs.filter(r => !(r.anchorDist <= X && r.anchorSig >= R)).map(r => r.tr)))}/${p1(mean(recs.filter(r => !(r.anchorDist <= X && r.anchorSig >= R)).map(r => r.eod)))})`);
}

// the motivating 2026-07-14 QQQ 720C case is out-of-sample (archive ends 07-10); show
// what the closest analogue in-sample looks like: continuous relation anchorSig x dist
console.log(`\n-- CONTINUOUS RELATION (no thresholds): ladder avg by anchor distance x relSig bucket (ALL fires)`);
const dB = [[0, 0.003], [0.003, 0.005], [0.005, 0.01], [0.01, 0.02], [0.02, 1]];
const rB = [[0, 0.08], [0.08, 0.12], [0.12, 0.20], [0.20, 1]];
console.log(`${'dist\\relSig'.padEnd(14)}${rB.map(r => `[${r[0]},${r[1]})`.padStart(14)).join('')}`);
for (const [lo, hi] of dB) {
  let row = `${(`[${(lo * 100).toFixed(1)},${(hi * 100).toFixed(1)}%)`).padEnd(14)}`;
  for (const [rl, rh] of rB) {
    const s = recs.filter(r => r.anchorDist >= lo && r.anchorDist < hi && r.anchorSig >= rl && r.anchorSig < rh);
    row += (s.length ? `${p1(mean(s.map(r => r.lad)))}(${s.length})` : '-').padStart(14);
  }
  console.log(row);
}
