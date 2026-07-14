// ADDENDUM to entry_pika_gate.mjs — the ONLY thing that looked alive in the
// pre-registered sweep was a BULL-ONLY asymmetry (blocked bulls ~-1% vs kept
// bulls +16.6%), while the mirror BEAR rule INVERTS (blocked bears +13%: the
// gate nukes good trades). A rule that only works one way is the exact signature
// of a tape/structure SHADOW (cf. BEAR_GATE_2026-07-13, study 77). So this
// script tries to kill the bull-ceiling gate with the two known confounders:
//   (1) tape strength (n_above: how many of SPY/QQQ/SPXW are above prior close)
//   (2) mass-below-spot (the ONE confirmed structural factor, SPXW-only)
// plus walk-forward, day-clustered bootstrap, and Bonferroni across the 9 cells.
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

function buildPath(fire) {
  const opt = load(path.join(CACHE, `${fire.sym}_${fire.day}.json`))
    .map(c => ({ ts: Date.parse(c.start_time), close: Number(c.close) || 0 }))
    .filter(c => c.close > 0).sort((a, b) => a.ts - b.ts);
  if (opt.length < 4) return null;
  const ei = opt.findIndex(o => o.ts >= fire.fireTsMs + 60000);
  if (ei < 0 || ei >= opt.length - 2) return null;
  const entry = opt[ei].close;
  if (!(entry > 0)) return null;
  return { steps: opt.slice(ei).map(o => ({ g: (o.close - entry) / entry })) };
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
  for (let i = 0; i < steps.length; i++) { if (steps[i].g >= take) { if (++run >= nbar) return i; } else run = 0; }
  return -1;
}
function ladder(P) {
  const s = P.steps;
  const i1 = confirmFill(s, 0.50, NBAR);
  if (i1 < 0) return trailLeg(s, 0, 0.50, 0.30, 0.60) - HAIR;
  const i2 = confirmFill(s, 1.00, NBAR);
  if (i2 < 0) return (1 / 3) * 0.50 + (2 / 3) * trailLeg(s, i1, 0.50, 0.30, 0.60) - HAIR * (2 / 3);
  return (1 / 3) * 0.50 + (1 / 3) * 1.00 + (1 / 3) * trailLeg(s, i2, 1.00, 0.30, 0.60) - HAIR / 3;
}

const frameCache = {};
function frames(day, ticker) {
  const k = `${day}|${ticker}`;
  if (frameCache[k]) return frameCache[k];
  const p = path.join(ARCHIVE, day, `${ticker}.jsonl.gz`);
  if (!fs.existsSync(p)) return (frameCache[k] = []);
  return (frameCache[k] = zlib.gunzipSync(fs.readFileSync(p)).toString().trim().split('\n')
    .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
    .map(s => ({ tsMs: Date.parse(s.requestedTs), spot: Number(s.spot), strikes: s.strikes || [] }))
    .filter(s => Number.isFinite(s.spot) && s.strikes.length).sort((a, b) => a.tsMs - b.tsMs));
}
const frameAt = (fr, ts) => { let b = null; for (const f of fr) { if (f.tsMs <= ts) b = f; else break; } return b; };

const undDaysCache = {};
function undDays(t) {
  if (undDaysCache[t]) return undDaysCache[t];
  const m = {};
  for (const f of fs.readdirSync(UND).filter(f => f.startsWith(`${t}_`)).sort()) {
    m[f.slice(t.length + 1, t.length + 11)] = load(path.join(UND, f)).filter(c => c.market_time === 'r')
      .map(c => ({ ts: Date.parse(c.start_time), close: +c.close })).filter(c => c.close > 0).sort((a, b) => a.ts - b.ts);
  }
  return (undDaysCache[t] = m);
}
function priorClose(t, day) { const m = undDays(t), ds = Object.keys(m).sort(), i = ds.indexOf(day); if (i <= 0) return null; const p = m[ds[i - 1]]; return p?.length ? p.at(-1).close : null; }
function spotAt(t, day, ts) { const rows = undDays(t)[day]; if (!rows?.length) return null; let s = null; for (const r of rows) { if (r.ts <= ts) s = r.close; else break; } return s; }

const fires = load(path.join(EXIT, 'fires_index.json'));
const B = [];
for (const f of fires) {
  if (f.dir <= 0) continue;                                  // BULLS only
  const P = buildPath(f);
  if (!P) continue;
  const fr = frames(f.day, f.ticker);
  const f0 = fr.length ? frameAt(fr, f.fireTsMs) : null;
  if (!f0) continue;
  let tot = 0;
  const ns = f0.strikes.map(r => ({ strike: Number(r.strike), gamma: Number(r.gamma) || 0 }));
  for (const n of ns) tot += Math.abs(n.gamma);
  if (!(tot > 0)) continue;
  const ceil = ns.filter(n => n.gamma > 0 && n.strike >= f0.spot)
    .map(n => ({ strike: n.strike, relSig: Math.abs(n.gamma) / tot }))
    .sort((a, b) => b.relSig - a.relSig)[0];
  if (!ceil) continue;
  // CONFOUNDER 1: tape strength at fire (n_above of SPY/QQQ + SPXW≈SPY)
  const spy = spotAt('SPY', f.day, f.fireTsMs), spyP = priorClose('SPY', f.day);
  const qqq = spotAt('QQQ', f.day, f.fireTsMs), qqqP = priorClose('QQQ', f.day);
  const nAbove = (spy != null && spyP != null && qqq != null && qqqP != null)
    ? (spy > spyP ? 2 : 0) + (qqq > qqqP ? 1 : 0)   // SPY counts twice (SPXW proxied to SPY)
    : null;
  const tapeBlocked = nAbove === 0;
  // CONFOUNDER 2: mass-below-spot (the one confirmed structural factor)
  let below = 0;
  for (const n of ns) if (n.strike < f0.spot) below += Math.abs(n.gamma);
  recsPush({ day: f.day, ticker: f.ticker, state: f.state,
    dist: (ceil.strike - f0.spot) / f0.spot, sig: ceil.relSig,
    massBelow: below / tot, nAbove, tapeBlocked, g: ladder(P) });
}
function recsPush(r) { B.push(r); }

const days = [...new Set(B.map(r => r.day))].sort();
const split = days[Math.floor(days.length / 2)];
for (const r of B) r.isTest = r.day >= split;

const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
const p1 = x => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}` : '  -');
// DAY-CLUSTERED bootstrap (fires within a day are not independent — resample DAYS)
function dayBootDiff(blk, kpt, B_ = 4000) {
  const dd = [...new Set([...blk, ...kpt].map(r => r.day))];
  const byDayB = {}, byDayK = {};
  for (const r of blk) (byDayB[r.day] ||= []).push(r.g);
  for (const r of kpt) (byDayK[r.day] ||= []).push(r.g);
  const out = [];
  for (let b = 0; b < B_; b++) {
    const sb = [], sk = [];
    for (let i = 0; i < dd.length; i++) {
      const d = dd[(Math.random() * dd.length) | 0];
      if (byDayB[d]) sb.push(...byDayB[d]);
      if (byDayK[d]) sk.push(...byDayK[d]);
    }
    if (sb.length && sk.length) out.push(mean(sb) - mean(sk));
  }
  out.sort((a, b) => a - b);
  const n = out.length;
  return { point: mean(blk.map(r => r.g)) - mean(kpt.map(r => r.g)),
    lo: out[(0.025 * n) | 0], hi: out[(0.975 * n) | 0], pGE0: out.filter(x => x >= 0).length / n };
}

console.log(`# BULL-CEILING GATE — confounder autopsy`);
console.log(`bull fires with path+surface: ${B.length}  days ${days.length}  WF split ${split}`);
console.log(`ungated BULL ladder avg ${p1(mean(B.map(r => r.g)))}  win ${(100 * B.filter(r => r.g > 0).length / B.length).toFixed(0)}%\n`);

const Xs = [0.003, 0.005, 0.010], Rs = [0.08, 0.12, 0.20];
console.log(`${'X'.padEnd(6)}${'R'.padEnd(6)}${'nBlk'.padStart(5)}${'blkAvg'.padStart(8)}${'kptAvg'.padStart(8)}${'blk-kpt'.padStart(9)}${'dayBootCI'.padStart(17)}${'P(>=0)'.padStart(8)}${'ΔTrain'.padStart(8)}${'ΔTest'.padStart(7)}${'winKill'.padStart(8)}`);
const cells = [];
for (const X of Xs) for (const R of Rs) {
  const fn = r => r.dist <= X && r.sig >= R;
  const blk = B.filter(fn), kpt = B.filter(r => !fn(r));
  if (blk.length < 10) continue;
  const d = dayBootDiff(blk, kpt);
  const tr = B.filter(r => !r.isTest), te = B.filter(r => r.isTest);
  const dTr = mean(tr.filter(r => !fn(r)).map(r => r.g)) - mean(tr.map(r => r.g));
  const dTe = mean(te.filter(r => !fn(r)).map(r => r.g)) - mean(te.map(r => r.g));
  const wk = blk.filter(r => r.g > 0).length / B.filter(r => r.g > 0).length;
  cells.push({ X, R, d, dTr, dTe, nB: blk.length });
  console.log(`${((X * 100).toFixed(1) + '%').padEnd(6)}${String(R).padEnd(6)}${String(blk.length).padStart(5)}${p1(mean(blk.map(r => r.g))).padStart(8)}${p1(mean(kpt.map(r => r.g))).padStart(8)}${p1(d.point).padStart(9)}${`[${p1(d.lo)},${p1(d.hi)}]`.padStart(17)}${d.pGE0.toFixed(3).padStart(8)}${p1(dTr).padStart(8)}${p1(dTe).padStart(7)}${((100 * wk).toFixed(0) + '%').padStart(8)}`);
}
const alpha = 0.05 / cells.length;
console.log(`\nBonferroni alpha over ${cells.length} bull cells = ${alpha.toFixed(4)}`);
const surv = cells.filter(c => c.d.pGE0 < alpha && c.dTr > 0 && c.dTe > 0);
console.log(`cells with [blocked << kept, day-clustered, Bonferroni] AND [ΔTrain>0 AND ΔTest>0]: ${surv.length}`);
for (const s of surv) console.log(`  X=${(s.X * 100).toFixed(1)}% R=${s.R}  nBlk=${s.nB}  blk-kpt ${p1(s.d.point)}  p=${s.d.pGE0.toFixed(4)}  ΔTr ${p1(s.dTr)} ΔTe ${p1(s.dTe)}`);

// ---- CONFOUNDER 1: tape strength ----
console.log(`\n== CONFOUNDER 1: is the ceiling gate just weak tape? (stratify by n_above) ==`);
console.log(`ceiling gate at X=0.5%, R=0.08 (widest sensible cell)`);
const fnRef = r => r.dist <= 0.005 && r.sig >= 0.08;
console.log(`${'n_above'.padEnd(10)}${'nBlk'.padStart(6)}${'blkAvg'.padStart(9)}${'nKept'.padStart(7)}${'kptAvg'.padStart(9)}${'blk-kpt'.padStart(9)}`);
for (const k of [0, 1, 2, 3]) {
  const S = B.filter(r => r.nAbove === k);
  if (S.length < 15) continue;
  const blk = S.filter(fnRef), kpt = S.filter(r => !fnRef(r));
  if (!blk.length || !kpt.length) continue;
  console.log(`${String(k).padEnd(10)}${String(blk.length).padStart(6)}${p1(mean(blk.map(r => r.g))).padStart(9)}${String(kpt.length).padStart(7)}${p1(mean(kpt.map(r => r.g))).padStart(9)}${p1(mean(blk.map(r => r.g)) - mean(kpt.map(r => r.g))).padStart(9)}`);
}
console.log(`\ncorrelation check: P(ceiling-gate fires | n_above) — is the gate simply firing on weak tape?`);
for (const k of [0, 1, 2, 3]) {
  const S = B.filter(r => r.nAbove === k);
  if (!S.length) continue;
  console.log(`  n_above=${k}: n=${String(S.length).padStart(4)}  ceiling-gate-blocked ${(100 * S.filter(fnRef).length / S.length).toFixed(0)}%  avg ${p1(mean(S.map(r => r.g)))}`);
}

// ---- CONFOUNDER 2: mass-below-spot (the one confirmed factor) ----
console.log(`\n== CONFOUNDER 2: mass-below-spot (the ONE confirmed structural factor) ==`);
const mb = [...B].map(r => r.massBelow).sort((a, b) => a - b);
const q1 = mb[(mb.length / 3) | 0], q2 = mb[((2 * mb.length) / 3) | 0];
console.log(`massBelow terciles: low<${q1.toFixed(2)}  high>${q2.toFixed(2)}`);
console.log(`${'massBelow'.padEnd(12)}${'nBlk'.padStart(6)}${'blkAvg'.padStart(9)}${'nKept'.padStart(7)}${'kptAvg'.padStart(9)}${'blk-kpt'.padStart(9)}`);
for (const [lab, f] of [['low', r => r.massBelow < q1], ['mid', r => r.massBelow >= q1 && r.massBelow <= q2], ['high', r => r.massBelow > q2]]) {
  const S = B.filter(f), blk = S.filter(fnRef), kpt = S.filter(r => !fnRef(r));
  if (!blk.length || !kpt.length) continue;
  console.log(`${lab.padEnd(12)}${String(blk.length).padStart(6)}${p1(mean(blk.map(r => r.g))).padStart(9)}${String(kpt.length).padStart(7)}${p1(mean(kpt.map(r => r.g))).padStart(9)}${p1(mean(blk.map(r => r.g)) - mean(kpt.map(r => r.g))).padStart(9)}`);
}
console.log(`\nceiling-gate fires vs massBelow: gate-blocked massBelow mean ${mean(B.filter(fnRef).map(r => r.massBelow)).toFixed(3)}  vs kept ${mean(B.filter(r => !fnRef(r)).map(r => r.massBelow)).toFixed(3)}`);

// ---- per-day stability (is it 2-3 days doing all the work?) ----
console.log(`\n== PER-DAY STABILITY of blk-kpt (X=0.5%,R=0.08): leave-one-day-out worst/best ==`);
let worst = Infinity, best = -Infinity, wD = '', bD = '';
for (const d of days) {
  const S = B.filter(r => r.day !== d);
  const blk = S.filter(fnRef), kpt = S.filter(r => !fnRef(r));
  if (!blk.length || !kpt.length) continue;
  const v = mean(blk.map(r => r.g)) - mean(kpt.map(r => r.g));
  if (v < worst) { worst = v; wD = d; }
  if (v > best) { best = v; bD = d; }
}
console.log(`  LOO worst ${p1(worst)} (dropping ${wD})   LOO best ${p1(best)} (dropping ${bD})   full-sample ${p1(mean(B.filter(fnRef).map(r => r.g)) - mean(B.filter(r => !fnRef(r)).map(r => r.g)))}`);

// ---- per-half detail, since the ALL-fires sweep showed ΔTest < 0 ----
console.log(`\n== WALK-FORWARD DETAIL (bull ceiling gate, X=0.5%,R=0.08) ==`);
for (const [lab, S] of [['TRAIN', B.filter(r => !r.isTest)], ['TEST', B.filter(r => r.isTest)]]) {
  const blk = S.filter(fnRef), kpt = S.filter(r => !fnRef(r));
  console.log(`  ${lab}: all n=${S.length} avg ${p1(mean(S.map(r => r.g)))} | blocked n=${blk.length} avg ${p1(mean(blk.map(r => r.g)))} | kept n=${kpt.length} avg ${p1(mean(kpt.map(r => r.g)))} | Δsystem ${p1(mean(kpt.map(r => r.g)) - mean(S.map(r => r.g)))}`);
}
// ticker split — is it SPXW-only like the confirmed factor?
console.log(`\n== TICKER SPLIT (bull ceiling gate, X=0.5%,R=0.08) ==`);
for (const tk of ['SPXW', 'SPY', 'QQQ']) {
  const S = B.filter(r => r.ticker === tk), blk = S.filter(fnRef), kpt = S.filter(r => !fnRef(r));
  if (!blk.length || !kpt.length) continue;
  console.log(`  ${tk.padEnd(5)} n=${String(S.length).padStart(4)}  blocked n=${String(blk.length).padStart(3)} avg ${p1(mean(blk.map(r => r.g))).padStart(6)}  kept n=${String(kpt.length).padStart(3)} avg ${p1(mean(kpt.map(r => r.g))).padStart(6)}  blk-kpt ${p1(mean(blk.map(r => r.g)) - mean(kpt.map(r => r.g)))}`);
}
