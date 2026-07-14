// EXHAUSTION ENTRY — pre-registered (RESEARCH ONLY, Clause 0: no live code).
//
// BACKGROUND (what already died):
//   - PULLBACK_ENTRY_2026-07-14: conditioning on the OPTION's own path is endogenous.
//     The retracement IS the failure signal -> adverse selection. KILLED.
//   - ENTRY_PIKA_GATE_2026-07-14: static "opposing pika near spot" gate INVERTED.
//     Closing insight: a pika at spot is FUEL when price pushes THROUGH it and DEATH
//     when it doesn't. Presence is not the signal; momentum-through is.
//   - MEASURED FACT (n=1295): median 30-min drawdown from signal -31.7%; 66% down >20%.
//     We buy impulse exhaustion because the signal needs structural confirmation, which
//     only exists AFTER price has moved.
//
// THIS STUDY: an EXOGENOUS, SIGNAL-TIME discriminator between IMPULSE-EXHAUSTION fires
// and TREND-CONTINUATION fires. Everything below is computed from the UNDERLYING tape
// and the SKYLIT SURFACE at/before fire time. Nothing touches the option's own path.
//
// ============================ PRE-REGISTERED (before any outcome was inspected) =======
// Let d = trade direction (+1 call, -1 put). All features are SIGNED IN TRADE DIRECTION.
// Underlying = SPY for SPXW (proxy), else the ticker itself. Regular-hours 1m bars only.
//
// A. EXTENSION
//   ext_open  = d*(spot-open)/open
//   range_pos = share of the day's range-so-far already travelled in trade dir, in [0,1]
//               bull: (spot-lo)/(hi-lo)   bear: (hi-spot)/(hi-lo)
//   vwap_dist = d*(spot-vwap)/vwap
//   ma20_dist = d*(spot-MA20)/MA20        ma60_dist = d*(spot-MA60)/MA60
//   spent     = d*(spot-open)/open / typRange, typRange = median of the prior 5 sessions'
//               regular-hours (hi-lo)/open  ("how much of the day's implied move is used")
//
// B. VELOCITY / DECELERATION
//   r5,r15,r30 = d*(spot/spot_{t-5,15,30m} - 1)
//   accel      = r5 - r5_prior   (r5_prior = d-signed return t-10m -> t-5m). accel<0 = decelerating.
//   frontload  = r5 / |r30|      (share of the 30m move done in the last 5m)
//   imp_age    = minutes since the trailing 60m extreme AGAINST the trade (bull: the low;
//                bear: the high) — age of the current impulse.
//
// C. STRUCTURE AHEAD (causal Skylit frame at/before fire ts; own ticker's surface)
//   wall_rs   = relSig of the strongest OPPOSING pika in the path ahead within 2% of spot
//               (bull: strikes >= spot; bear: strikes <= spot). 0 if none.
//   wall_dist = |wall_strike - spot|/spot  (2% if none)
//   barney    = sum |gamma| of NEGATIVE-gamma strikes in the path ahead within 1.5% / total|gamma|
//   king_share, king_dist  (largest |gamma| strike anywhere on the surface)
//   mass_below = sum |gamma| below spot / total |gamma|   (the one confirmed factor)
//
// D. INTERACTION (wall vs escalator — the leading hypothesis)
//   FUEL = zw(wall_rs) * z(accel)      big wall + accelerating INTO it = breakout fuel
//                                      big wall + decelerating       = death
//   (also tested: barney * accel, and wall_rs * r5)
//
// ---- PRE-REGISTERED EXHAUSTION SCORE (mean of z-scores, z's fit on the TRAIN half only) --
//   EXH = mean[ z(range_pos), z(spent), z(vwap_dist), z(ma20_dist),
//               z(-accel), z(-barney), z(+wall_rs) ]
//   PREDICTION: high EXH -> negative realized P&L (monotone decreasing decile table).
//
// ---- OUTCOME ----
//   LIVE TRAIL (arm 0.50 / giveback 0.15) from signal entry (first option bar >= fireTs+60s)
//   to EOD. SAME exit for baseline and every treatment. Fill haircut h on entry AND exit:
//     realized = ((1+gRaw)*(1-h))/(1+h) - 1        default h=0.03, also reported at 0.02.
//
// ---- THE CRITICAL CONTROL ----
//   Baseline is NEGATIVE per fire, so ANY volume cut raises the per-signal mean for free.
//   Every gate is scored against a VOLUME-MATCHED RANDOM SKIP (bootstrapped, 2000 draws).
//   Verdict metric = SYSTEM total P&L over ALL signals (skipped = 0) vs random-skip@same f.
//
// Usage: node exhaustion_entry.mjs [haircut=0.03]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GEX = path.join(HERE, '..', '..');
const ES = path.join(GEX, 'research', 'exit-study');
const CACHE = path.join(ES, 'cache');
const UND = path.join(ES, 'cache_underlying');
const ARCHIVE = path.join(GEX, 'data', 'skylit-archive', 'intraday');
const load = f => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : []);

const HAIR = Number(process.argv[2] ?? 0.03);
const ARM = 0.50, GB = 0.15;

// ================= underlying =================
const undKey = t => (t === 'SPXW' ? 'SPY' : t);
const undCache = {};
function undDays(t) {
  if (undCache[t]) return undCache[t];
  const m = {};
  for (const f of fs.readdirSync(UND).filter(x => x.startsWith(`${t}_`)).sort()) {
    const day = f.slice(t.length + 1, t.length + 11);
    m[day] = load(path.join(UND, f)).filter(c => c.market_time === 'r')
      .map(c => ({ ts: Date.parse(c.start_time), o: +c.open, h: +c.high, l: +c.low, c: +c.close, v: +c.volume || 0 }))
      .filter(b => b.c > 0).sort((a, b) => a.ts - b.ts);
  }
  return (undCache[t] = m);
}
// typical daily range = median of prior 5 sessions' (hi-lo)/open
const typCache = {};
function typRange(t, day) {
  const k = `${t}|${day}`;
  if (typCache[k] != null) return typCache[k];
  const m = undDays(t), ds = Object.keys(m).sort(), i = ds.indexOf(day);
  const rs = [];
  for (let j = Math.max(0, i - 5); j < i; j++) {
    const b = m[ds[j]]; if (!b?.length) continue;
    const hi = Math.max(...b.map(x => x.h)), lo = Math.min(...b.map(x => x.l));
    if (b[0].o > 0) rs.push((hi - lo) / b[0].o);
  }
  rs.sort((a, b) => a - b);
  return (typCache[k] = rs.length ? rs[rs.length >> 1] : 0.01);
}

// ================= skylit surface =================
const frameCache = {};
function frames(day, ticker) {
  const k = `${day}|${ticker}`;
  if (frameCache[k]) return frameCache[k];
  const p = path.join(ARCHIVE, day, `${ticker}.jsonl.gz`);
  if (!fs.existsSync(p)) return (frameCache[k] = []);
  const rows = zlib.gunzipSync(fs.readFileSync(p)).toString().trim().split('\n')
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean)
    .map(s => ({ tsMs: Date.parse(s.requestedTs), spot: +s.spot, strikes: s.strikes || [] }))
    .filter(s => Number.isFinite(s.spot) && s.strikes.length)
    .sort((a, b) => a.tsMs - b.tsMs);
  return (frameCache[k] = rows);
}
function frameAt(fr, ts) { let best = null; for (const f of fr) { if (f.tsMs <= ts) best = f; else break; } return best; }

function structure(fire) {
  const fr = frameAt(frames(fire.day, fire.ticker), fire.fireTsMs);
  if (!fr) return null;
  const S = fr.spot, d = fire.dir;
  let tot = 0;
  const rows = fr.strikes.map(r => ({ K: +r.strike, g: +r.gamma || 0 }));
  for (const r of rows) tot += Math.abs(r.g);
  if (!(tot > 0)) return null;
  // opposing pika in the path ahead within 2%
  let wall = null;
  for (const r of rows) {
    if (r.g <= 0) continue;
    const ahead = d > 0 ? r.K >= S : r.K <= S;
    if (!ahead) continue;
    const dist = Math.abs(r.K - S) / S;
    if (dist > 0.02) continue;
    const rs = r.g / tot;
    if (!wall || rs > wall.rs) wall = { rs, dist, K: r.K };
  }
  // barney (negative gamma) fuel in the path ahead within 1.5%
  let barney = 0;
  for (const r of rows) {
    if (r.g >= 0) continue;
    const ahead = d > 0 ? r.K >= S : r.K <= S;
    if (!ahead) continue;
    if (Math.abs(r.K - S) / S > 0.015) continue;
    barney += Math.abs(r.g);
  }
  let king = rows[0];
  for (const r of rows) if (Math.abs(r.g) > Math.abs(king.g)) king = r;
  let below = 0;
  for (const r of rows) if (r.K < S) below += Math.abs(r.g);
  return {
    wall_rs: wall ? wall.rs : 0,
    wall_dist: wall ? wall.dist : 0.02,
    barney: barney / tot,
    king_share: Math.abs(king.g) / tot,
    king_dist: Math.abs(king.K - S) / S * (d > 0 ? (king.K >= S ? 1 : -1) : (king.K <= S ? 1 : -1)), // + = king is ahead
    mass_below: below / tot,
    surf_spot: S,
  };
}

// ================= features =================
function tape(fire) {
  const t = undKey(fire.ticker);
  const bars = undDays(t)[fire.day];
  if (!bars?.length) return null;
  const ts = fire.fireTsMs, d = fire.dir;
  let i = -1;
  for (let j = 0; j < bars.length; j++) { if (bars[j].ts <= ts) i = j; else break; }
  if (i < 31) return null;                        // need >=30m of history (drops the first half hour only)
  const cur = bars[i].c, open = bars[0].o;
  let hi = -Infinity, lo = Infinity, pv = 0, vv = 0;
  for (let j = 0; j <= i; j++) { const b = bars[j];
    if (b.h > hi) hi = b.h; if (b.l < lo) lo = b.l;
    const tp = (b.h + b.l + b.c) / 3; pv += tp * b.v; vv += b.v; }
  const vwap = vv > 0 ? pv / vv : cur;
  const rng = hi - lo;
  const range_pos = rng > 0 ? (d > 0 ? (cur - lo) / rng : (hi - cur) / rng) : 0.5;
  const ma = n => { const k = Math.min(n, i + 1); let s = 0; for (let j = i - k + 1; j <= i; j++) s += bars[j].c; return s / k; };
  const ma20 = ma(20), ma60 = ma(60);
  const px = k => bars[i - k].c;
  const r = k => d * (cur / px(k) - 1);
  const r5 = r(5), r15 = r(15), r30 = r(30);
  const r5prior = d * (px(5) / px(10) - 1);
  const accel = r5 - r5prior;
  const frontload = Math.abs(r30) > 1e-6 ? r5 / Math.abs(r30) : 0;
  // impulse age: minutes since the 60m extreme AGAINST the trade
  let ext = i, extv = d > 0 ? Infinity : -Infinity;
  for (let j = Math.max(0, i - 60); j <= i; j++) {
    const v = bars[j].c;
    if (d > 0 ? v < extv : v > extv) { extv = v; ext = j; }
  }
  const tr = typRange(t, fire.day);
  return {
    spot: cur,
    ext_open: d * (cur - open) / open,
    range_pos,
    vwap_dist: d * (cur - vwap) / vwap,
    ma20_dist: d * (cur - ma20) / ma20,
    ma60_dist: d * (cur - ma60) / ma60,
    spent: tr > 0 ? (d * (cur - open) / open) / tr : 0,
    r5, r15, r30, accel, frontload,
    imp_age: i - ext,
    minsFromOpen: i,
  };
}

// ================= option path + trail =================
function buildPath(fire) {
  const opt = load(path.join(CACHE, `${fire.sym}_${fire.day}.json`))
    .map(c => ({ ts: Date.parse(c.start_time), close: +c.close || 0 }))
    .filter(c => c.close > 0).sort((a, b) => a.ts - b.ts);
  if (opt.length < 4) return null;
  const ei = opt.findIndex(o => o.ts >= fire.fireTsMs + 60000);
  if (ei < 0 || ei >= opt.length - 2) return null;
  const E = opt[ei].close;
  if (!(E > 0)) return null;
  return { fire, E, ei, bars: opt, day: fire.day, ticker: fire.ticker, dir: fire.dir, state: fire.state };
}
function trailFrom(bars, startIdx, entryPx) {
  let peak = 0, armed = false, g = 0;
  for (let i = startIdx; i < bars.length; i++) {
    g = bars[i].close / entryPx - 1;
    if (g > peak) peak = g;
    if (!armed && peak >= ARM) armed = true;
    if (armed && (1 + g) <= (1 + peak) * (1 - GB)) return g;
  }
  return g;
}
const net = g => ((1 + g) * (1 - HAIR)) / (1 + HAIR) - 1;

// ================= stats =================
const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
const sd = a => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))) || 1; };
const med = a => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = x => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + '%' : ' n/a');
const winr = a => (a.length ? a.filter(x => x > 0).length / a.length : NaN);
const pf = a => { const w = a.filter(x => x > 0).reduce((s, x) => s + x, 0); const l = -a.filter(x => x <= 0).reduce((s, x) => s + x, 0); return l > 0 ? w / l : Infinity; };
const sum = a => a.reduce((s, x) => s + x, 0);
function corr(x, y) { const mx = mean(x), my = mean(y); let n = 0, dx = 0, dy = 0;
  for (let i = 0; i < x.length; i++) { n += (x[i] - mx) * (y[i] - my); dx += (x[i] - mx) ** 2; dy += (y[i] - my) ** 2; }
  return dx > 0 && dy > 0 ? n / Math.sqrt(dx * dy) : 0; }

// ================= build dataset =================
const fires = JSON.parse(fs.readFileSync(path.join(ES, 'fires_index.json'), 'utf8'));
const D = [];
let noOpt = 0, noTape = 0, noStruct = 0;
for (const f of fires) {
  const P = buildPath(f); if (!P) { noOpt++; continue; }
  const T = tape(f); if (!T) { noTape++; continue; }
  const S = structure(f); if (!S) { noStruct++; continue; }
  D.push({ ...P, f: { ...T, ...S }, base: net(trailFrom(P.bars, P.ei, P.E)) });
}
console.log(`# EXHAUSTION ENTRY — haircut ${(HAIR * 100).toFixed(0)}%/side, exit = LIVE TRAIL arm ${ARM} gb ${GB} to EOD`);
console.log(`fires ${fires.length} -> usable ${D.length}  (dropped: no option path ${noOpt}, no tape/<60m history ${noTape}, no surface ${noStruct})`);
const days = [...new Set(D.map(d => d.day))].sort();
const cut = days[Math.floor(days.length / 2)];
const TRAIN = D.filter(d => d.day < cut), TEST = D.filter(d => d.day >= cut);
console.log(`days ${days.length}  walk-forward split at ${cut}: TRAIN ${TRAIN.length} / TEST ${TEST.length}`);
console.log(`baseline system P&L: all ${pct(mean(D.map(d => d.base)))}/fire  train ${pct(mean(TRAIN.map(d => d.base)))}  test ${pct(mean(TEST.map(d => d.base)))}`);
console.log(`baseline win% ${(100 * winr(D.map(d => d.base))).toFixed(1)}  PF ${pf(D.map(d => d.base)).toFixed(2)}  TOTAL ${pct(sum(D.map(d => d.base)))} (sum of per-fire returns)\n`);

// z-scores fit on TRAIN ONLY
const FEATS = ['ext_open', 'range_pos', 'vwap_dist', 'ma20_dist', 'ma60_dist', 'spent',
  'r5', 'r15', 'r30', 'accel', 'frontload', 'imp_age',
  'wall_rs', 'wall_dist', 'barney', 'king_share', 'king_dist', 'mass_below'];
const Z = {};
for (const k of FEATS) { const v = TRAIN.map(d => d.f[k]); Z[k] = { m: mean(v), s: sd(v) }; }
const z = (d, k) => (d.f[k] - Z[k].m) / Z[k].s;

// PRE-REGISTERED EXHAUSTION SCORE
const EXH = d => (z(d, 'range_pos') + z(d, 'spent') + z(d, 'vwap_dist') + z(d, 'ma20_dist')
  - z(d, 'accel') - z(d, 'barney') + z(d, 'wall_rs')) / 7;
// INTERACTION scores (hypothesis D)
const FUEL = d => z(d, 'wall_rs') * z(d, 'accel');
const FUEL2 = d => z(d, 'barney') * z(d, 'accel');
const FUEL3 = d => z(d, 'wall_rs') * z(d, 'r5');
for (const d of D) { d.exh = EXH(d); d.fuel = FUEL(d); d.fuel2 = FUEL2(d); d.fuel3 = FUEL3(d); }
// accessor: composite scores live on d, engineered features live on d.f
const V = (d, k) => (d[k] !== undefined ? d[k] : d.f[k]);

// ================= 1. Univariate monotonicity: quintile table per feature =================
console.log('## 1. Univariate signal — mean realized by QUINTILE of each feature (Q1 low .. Q5 high), full sample');
console.log('  feature       Q1      Q2      Q3      Q4      Q5   | spread(Q5-Q1) | rank-corr w/ realized');
const allScores = [...FEATS, 'exh', 'fuel', 'fuel2', 'fuel3'];
const uni = [];
for (const k of allScores) {
  const val = d => (FEATS.includes(k) ? d.f[k] : d[k]);
  const s = [...D].sort((a, b) => val(a) - val(b));
  const q = 5, sz = Math.floor(s.length / q), cells = [];
  for (let i = 0; i < q; i++) cells.push(mean(s.slice(i * sz, i === q - 1 ? s.length : (i + 1) * sz).map(d => d.base)));
  // spearman-ish: corr of ranks
  const rx = new Array(s.length); s.forEach((d, i) => { rx[i] = i; });
  const c = corr(rx, s.map(d => d.base));
  uni.push({ k, cells, spread: cells[4] - cells[0], c });
  console.log(`  ${k.padEnd(12)} ${cells.map(x => pct(x).padStart(7)).join(' ')} | ${pct(cells[4] - cells[0]).padStart(8)}      | ${c.toFixed(3).padStart(6)}`);
}

// ================= 2. Decile table for the pre-registered EXH score =================
function decileTable(set, key, label) {
  const s = [...set].sort((a, b) => a[key] - b[key]);
  const sz = Math.floor(s.length / 10);
  console.log(`\n  ${label}  (D1 = lowest ${key} .. D10 = highest)`);
  console.log('   dec    n   mean realized   median   win%    PF    | mean range_pos  accel   barney  wall_rs');
  for (let i = 0; i < 10; i++) {
    const sl = s.slice(i * sz, i === 9 ? s.length : (i + 1) * sz);
    const g = sl.map(d => d.base);
    console.log(`   D${String(i + 1).padEnd(2)} ${String(sl.length).padStart(4)}   ${pct(mean(g)).padStart(7)}      ${pct(med(g)).padStart(7)}  ${(100 * winr(g)).toFixed(0).padStart(3)}%  ${pf(g).toFixed(2).padStart(5)}   |     ${mean(sl.map(d => d.f.range_pos)).toFixed(2)}      ${(1e4 * mean(sl.map(d => d.f.accel))).toFixed(1).padStart(5)}bp  ${(100 * mean(sl.map(d => d.f.barney))).toFixed(1).padStart(4)}%   ${(100 * mean(sl.map(d => d.f.wall_rs))).toFixed(1).padStart(4)}%`);
  }
}
console.log('\n## 2. PRE-REGISTERED EXHAUSTION SCORE — decile table (prediction: high EXH -> negative)');
decileTable(D, 'exh', 'EXH, full sample');
decileTable(TRAIN, 'exh', 'EXH, TRAIN half');
decileTable(TEST, 'exh', 'EXH, TEST half');
console.log('\n## 2b. INTERACTION score FUEL = z(wall_rs)*z(accel) — hypothesis D');
decileTable(D, 'fuel', 'FUEL, full sample');
decileTable(TEST, 'fuel', 'FUEL, TEST half');

// ================= 3+4. GATE sweep vs VOLUME-MATCHED RANDOM SKIP =================
// gate: suppress the top-X% by score (or bottom-X% for FUEL, where low = death)
function gateEval(set, key, frac, hi) {
  // hi=true -> suppress the HIGHEST frac by key; hi=false -> suppress the LOWEST
  const s = [...set].sort((a, b) => V(a, key) - V(b, key));
  const nSkip = Math.round(frac * s.length);
  const skipped = hi ? s.slice(s.length - nSkip) : s.slice(0, nSkip);
  const skipSet = new Set(skipped);
  const kept = set.filter(d => !skipSet.has(d));
  const baseAll = mean(set.map(d => d.base));
  const keptG = kept.map(d => d.base), skipG = skipped.map(d => d.base);
  const f = kept.length / set.length;
  const sysTreat = sum(keptG) / set.length;             // skipped = 0
  const sysBase = baseAll;
  const sysRandom = f * baseAll;                        // volume-matched random skip (expectation)
  return { n: set.length, f, nKept: kept.length, nSkip: skipped.length,
    sysBase, sysTreat, sysRandom, vsBase: sysTreat - sysBase, vsRandom: sysTreat - sysRandom,
    perTrade: mean(keptG), baseAvg: baseAll, skipMean: mean(skipG), skipWin: winr(skipG),
    keptWin: winr(keptG), keptPF: pf(keptG), basePF: pf(set.map(d => d.base)),
    keptG, skipG, kept, skipped };
}
// TRUE bootstrapped volume-matched random skip: draw nSkip fires at random, many times
function randomSkipBoot(set, nSkip, iters = 2000) {
  const g = set.map(d => d.base), N = set.length;
  const out = [];
  for (let it = 0; it < iters; it++) {
    const idx = new Set();
    while (idx.size < nSkip) idx.add((Math.random() * N) | 0);
    let s = 0;
    for (let i = 0; i < N; i++) if (!idx.has(i)) s += g[i];
    out.push(s / N);
  }
  out.sort((a, b) => a - b);
  return { mean: mean(out), p05: out[Math.floor(0.05 * iters)], p95: out[Math.floor(0.95 * iters)],
    pctile: obs => out.filter(x => x < obs).length / iters };
}
const FRACS = [0.10, 0.20, 0.30, 0.40, 0.50];
const GATES = [['exh', true], ['fuel', false], ['range_pos', true], ['spent', true], ['accel', false], ['barney', false], ['vwap_dist', true]];
console.log('\n## 3+4. GATE SWEEP vs VOLUME-MATCHED RANDOM SKIP (bootstrap 2000 draws), FULL SAMPLE');
console.log('  The baseline is NEGATIVE, so any skip lifts the mean for free. Only vs-RANDOM counts.');
console.log('  gate            X%  | SYS base  SYS gated  SYS random(boot)  [5%..95%]        | gate pctile vs random | skipped cohort: n  baseP&L  win%');
const cells = [];
for (const [key, hi] of GATES) {
  for (const X of FRACS) {
    const e = gateEval(D, key, X, hi);
    const rb = randomSkipBoot(D, e.nSkip);
    const pctile = rb.pctile(e.sysTreat);
    cells.push({ key, hi, X, e, pctile });
    console.log(`  ${(key + (hi ? '(hi)' : '(lo)')).padEnd(14)} ${(100 * X).toFixed(0).padStart(2)}%  | ${pct(e.sysBase).padStart(7)}  ${pct(e.sysTreat).padStart(8)}   ${pct(rb.mean).padStart(8)}  [${pct(rb.p05)}..${pct(rb.p95)}] | ${(100 * pctile).toFixed(1).padStart(5)}%              | ${String(e.nSkip).padStart(4)}  ${pct(e.skipMean).padStart(7)}  ${(100 * e.skipWin).toFixed(0).padStart(3)}%`);
  }
}

// ================= 5. WALK-FORWARD on the vs-RANDOM metric =================
console.log('\n## 5. WALK-FORWARD (z-stats + gate thresholds fit on TRAIN, applied to TEST)');
console.log('  gate            X%  | TRAIN sys  vsRandom | TEST sys   vsRandom | TEST pctile-vs-random-boot | TEST perTrade  vs baseAvg');
let posTest = 0, nCells = 0;
const wf = [];
for (const [key, hi] of GATES) {
  for (const X of FRACS) {
    // threshold from TRAIN, applied to TEST (not a re-ranking of TEST)
    const sTr = [...TRAIN].sort((a, b) => V(a, key) - V(b, key));
    const idx = hi ? Math.floor((1 - X) * sTr.length) : Math.floor(X * sTr.length);
    const thr = V(sTr[Math.min(sTr.length - 1, Math.max(0, idx))], key);
    const blocked = d => (hi ? V(d, key) >= thr : V(d, key) <= thr);
    const evalThr = set => {
      const kept = set.filter(d => !blocked(d)), skipped = set.filter(blocked);
      const baseAll = mean(set.map(d => d.base));
      const f = kept.length / set.length;
      const sysT = sum(kept.map(d => d.base)) / set.length;
      return { f, sysT, sysBase: baseAll, vsRandom: sysT - f * baseAll, nSkip: skipped.length,
        perTrade: mean(kept.map(d => d.base)), baseAvg: baseAll, skipMean: mean(skipped.map(d => d.base)),
        keptPF: pf(kept.map(d => d.base)) };
    };
    const a = evalThr(TRAIN), b = evalThr(TEST);
    const rb = randomSkipBoot(TEST, b.nSkip);
    const pctile = rb.pctile(b.sysT);
    if (b.vsRandom > 0) posTest++;
    nCells++;
    wf.push({ key, hi, X, a, b, pctile });
    console.log(`  ${(key + (hi ? '(hi)' : '(lo)')).padEnd(14)} ${(100 * X).toFixed(0).padStart(2)}%  | ${pct(a.sysT).padStart(7)}  ${pct(a.vsRandom).padStart(7)}  | ${pct(b.sysT).padStart(7)}  ${pct(b.vsRandom).padStart(7)}  | ${(100 * pctile).toFixed(1).padStart(5)}%                      | ${pct(b.perTrade).padStart(7)}   ${pct(b.baseAvg).padStart(7)}`);
  }
}
console.log(`\n  Cells with POSITIVE TEST vs-random: ${posTest}/${nCells}  (coin-flip null expects ~${(nCells / 2).toFixed(0)})`);
const bestTr = [...wf].sort((x, y) => y.a.vsRandom - x.a.vsRandom)[0];
console.log(`  Best-in-TRAIN cell: ${bestTr.key}${bestTr.hi ? '(hi)' : '(lo)'} X=${(100 * bestTr.X).toFixed(0)}%  -> TRAIN vsRandom ${pct(bestTr.a.vsRandom)} | HONEST OOS TEST vsRandom ${pct(bestTr.b.vsRandom)}  (random-boot pctile ${(100 * bestTr.pctile).toFixed(1)}%)`);
console.log(`  MC discount: K=${nCells} cells tested. A single cell at TEST pctile p needs p > ${(100 * (1 - 0.05 / nCells)).toFixed(2)}% to clear Bonferroni-adjusted 5%.`);
const bestTe = [...wf].sort((x, y) => y.b.vsRandom - x.b.vsRandom)[0];
console.log(`  Best-in-TEST (in-sample-on-test, reference only): ${bestTe.key}${bestTe.hi ? '(hi)' : '(lo)'} X=${(100 * bestTe.X).toFixed(0)}%  TEST vsRandom ${pct(bestTe.b.vsRandom)}  pctile ${(100 * bestTe.pctile).toFixed(1)}%  -> Bonferroni: ${(1 - bestTe.pctile) * nCells < 0.05 ? 'CLEARS' : 'FAILS'}`);

// ============ 5b. EVERY FEATURE ITS BEST SHOT: gate DIRECTION + THRESHOLD fit on TRAIN ============
// The pre-registered gates above may point the wrong way for some features. The honest way to give
// each feature its best chance without peeking at TEST: learn the sign of the feature<->P&L relation
// on TRAIN, gate in the harmful direction, pick X on TRAIN, then evaluate ONCE on TEST.
console.log('\n## 5b. EVERY FEATURE, DIRECTION + X FIT ON TRAIN, EVALUATED ONCE ON TEST (vs volume-matched random skip)');
console.log('  feature       train-dir  X*(train)  | TRAIN vsRandom | TEST vsRandom  TEST boot-pctile  day-block p');
function dbPgate(set, key, hi, thr, iters = 3000) {
  const baseAll = mean(set.map(d => d.base));
  const byDay = new Map();
  for (const d of set) {
    const blocked = hi ? V(d, key) >= thr : V(d, key) <= thr;
    const q = blocked ? 0 : d.base - baseAll;
    if (!byDay.has(d.day)) byDay.set(d.day, []);
    byDay.get(d.day).push(q);
  }
  const arr = [...byDay.values()], obs = mean(arr.flat());
  let ge = 0;
  for (let it = 0; it < iters; it++) {
    const s = [];
    for (let i = 0; i < arr.length; i++) s.push(...arr[(Math.random() * arr.length) | 0]);
    if (Math.abs(mean(s) - obs) >= Math.abs(obs)) ge++;
  }
  return (ge + 1) / (iters + 1);
}
let pos5b = 0, best5b = null;
const ALL = [...FEATS, 'exh', 'fuel', 'fuel2', 'fuel3'];
for (const key of ALL) {
  // direction from TRAIN rank-corr: positive corr -> HIGH is good -> gate the LOW tail, and vice-versa
  const sTr = [...TRAIN].sort((a, b) => V(a, key) - V(b, key));
  const rc = corr(sTr.map((_, i) => i), sTr.map(d => d.base));
  const hi = rc < 0;                                   // gate the harmful tail
  // pick X on TRAIN by best vsRandom
  let bestX = null;
  for (const X of FRACS) {
    const e = gateEval(TRAIN, key, X, hi);
    if (!bestX || e.vsRandom > bestX.e.vsRandom) bestX = { X, e };
  }
  const idx = hi ? Math.floor((1 - bestX.X) * sTr.length) : Math.floor(bestX.X * sTr.length);
  const thr = V(sTr[Math.min(sTr.length - 1, Math.max(0, idx))], key);
  const blocked = d => (hi ? V(d, key) >= thr : V(d, key) <= thr);
  const kept = TEST.filter(d => !blocked(d)), nSkip = TEST.length - kept.length;
  const baseAll = mean(TEST.map(d => d.base)), f = kept.length / TEST.length;
  const sysT = sum(kept.map(d => d.base)) / TEST.length;
  const vsR = sysT - f * baseAll;
  const rb = randomSkipBoot(TEST, nSkip);
  const p = dbPgate(TEST, key, hi, thr);
  if (vsR > 0) pos5b++;
  if (!best5b || bestX.e.vsRandom > best5b.trainVs) best5b = { key, hi, X: bestX.X, trainVs: bestX.e.vsRandom, vsR, p, pctile: rb.pctile(sysT) };
  console.log(`  ${key.padEnd(12)}  ${(hi ? 'block HI' : 'block LO').padEnd(9)} ${(100 * bestX.X).toFixed(0).padStart(3)}%      | ${pct(bestX.e.vsRandom).padStart(7)}        | ${pct(vsR).padStart(7)}       ${(100 * rb.pctile(sysT)).toFixed(1).padStart(5)}%          ${p.toFixed(3)}`);
}
console.log(`\n  Features with POSITIVE OOS vs-random: ${pos5b}/${ALL.length}  (coin-flip null expects ~${(ALL.length / 2).toFixed(0)})`);
console.log(`  The one the TRAIN would have picked: ${best5b.key} (${best5b.hi ? 'block HI' : 'block LO'}, X=${(100 * best5b.X).toFixed(0)}%)`);
console.log(`    TRAIN vsRandom ${pct(best5b.trainVs)}  ->  HONEST OOS TEST vsRandom ${pct(best5b.vsR)}  (random-boot pctile ${(100 * best5b.pctile).toFixed(1)}%, day-block p=${best5b.p.toFixed(3)})`);

// ================= 6. TIMING VARIANT — delay entry until CONTINUATION confirmation =================
// Exogenous confirmation, computed on the UNDERLYING (never the option's own path):
//   after the fire, wait for a minute bar where BOTH
//     (a) underlying has made a NEW EXTREME in the trade direction >= C beyond the fire-time spot
//     (b) the last-5m dir-signed return is > 0 (momentum re-accelerating)
//   -> ENTER at that minute's option close (+haircut). If no confirmation within W -> NO TRADE.
// Also a pure TIME-DELAY control (enter at fire+W minutes, unconditionally).
function optAtOrAfter(P, ts) {
  for (let i = P.ei; i < P.bars.length; i++) if (P.bars[i].ts >= ts) return i;
  return -1;
}
function confirmIdx(d, C, W) {
  const t = undKey(d.ticker), bars = undDays(d.day ? d.day : null) ; // placeholder, replaced below
  return null;
}
function simDelayed(d, C, W, requireConfirm) {
  const t = undKey(d.ticker);
  const bars = undDays(t)[d.day];
  if (!bars?.length) return { taken: false };
  const dir = d.dir, ts0 = d.fire.fireTsMs;
  let i0 = -1;
  for (let j = 0; j < bars.length; j++) { if (bars[j].ts <= ts0) i0 = j; else break; }
  if (i0 < 6) return { taken: false };
  const S0 = bars[i0].c;
  const lim = ts0 + W * 60000;
  let hitIdx = -1;
  for (let j = i0 + 1; j < bars.length && bars[j].ts <= lim; j++) {
    if (!requireConfirm) continue;
    const px = bars[j].c;
    const newExt = dir * (px - S0) / S0 >= C;
    const r5 = j >= 5 ? dir * (px / bars[j - 5].c - 1) : 0;
    if (newExt && r5 > 0) { hitIdx = j; break; }
  }
  let entryTs;
  if (requireConfirm) { if (hitIdx < 0) return { taken: false }; entryTs = bars[hitIdx].ts + 60000; }
  else entryTs = ts0 + (W + 1) * 60000;
  const oi = optAtOrAfter(d, entryTs);
  if (oi < 0 || oi >= d.bars.length - 2) return { taken: false };
  const px = d.bars[oi].close;
  if (!(px > 0)) return { taken: false };
  return { taken: true, g: net(trailFrom(d.bars, oi, px)), waited: (entryTs - ts0) / 60000 };
}
console.log('\n## 6. TIMING VARIANT — delay entry until an EXOGENOUS continuation confirmation');
console.log('  CONFIRM: underlying makes a new dir-extreme >= C beyond fire-time spot AND last-5m dir-return > 0.');
console.log('  Applied to (a) ALL fires, (b) only the EXHAUSTED cohort (top-40% EXH; non-exhausted taken at signal).');
console.log('\n  (a) ALL fires');
console.log('  DECOMPOSITION: "SELECT-only" = take the SAME confirmed fires but at the ORIGINAL signal price.');
console.log('  It is NOT implementable (you cannot know at fire time who will confirm) but it isolates how much');
console.log('  of the gain is SELECTION (picking the fires that work) vs the DELAY itself (paying up costs you).');
console.log('   C      W   | fill%  | SYS base  SYS confirm  vsRandom@f  boot-pctile | SELECT-only sys  delay-cost | perTrade(taken)  win%   PF   | skipped baseP&L');
const CS = [0.0005, 0.0010, 0.0020], WS = [10, 20, 30];
const timing = [];
for (const C of CS) for (const W of WS) {
  const res = D.map(d => simDelayed(d, C, W, true));
  const g = res.map((r, i) => (r.taken ? r.g : 0));
  const tg = res.filter(r => r.taken).map(r => r.g);
  const selOnly = D.map((d, i) => (res[i].taken ? d.base : 0));   // same cohort, entered at the SIGNAL price
  const skipB = res.map((r, i) => (r.taken ? null : D[i].base)).filter(x => x != null);
  const f = tg.length / D.length;
  const baseAll = mean(D.map(d => d.base));
  const sysT = sum(g) / D.length, sysSel = sum(selOnly) / D.length;
  const rb = randomSkipBoot(D, D.length - tg.length);
  timing.push({ C, W, f, sysT, sysSel, vsRandom: sysT - f * baseAll, pctile: rb.pctile(sysT) });
  console.log(`   ${(C * 100).toFixed(2)}% ${String(W).padStart(2)}m  | ${(100 * f).toFixed(0).padStart(3)}%  | ${pct(baseAll).padStart(7)}  ${pct(sysT).padStart(8)}   ${pct(sysT - f * baseAll).padStart(8)}   ${(100 * rb.pctile(sysT)).toFixed(1).padStart(5)}%       | ${pct(sysSel).padStart(8)}       ${pct(sysT - sysSel).padStart(7)}   | ${pct(mean(tg)).padStart(7)}  ${(100 * winr(tg)).toFixed(0).padStart(3)}%  ${pf(tg).toFixed(2).padStart(5)} | ${pct(mean(skipB)).padStart(7)}`);
}
console.log('\n  (a2) PURE TIME-DELAY control (enter unconditionally at fire+W, no confirmation)');
console.log('   W   | fill%  | SYS base   SYS delayed   delta | perTrade  win%   PF');
for (const W of [5, 10, 20, 30, 45]) {
  const res = D.map(d => simDelayed(d, 0, W, false));
  const tg = res.filter(r => r.taken).map(r => r.g);
  const sysT = sum(res.map(r => (r.taken ? r.g : 0))) / D.length;
  const baseAll = mean(D.map(d => d.base));
  console.log(`   ${String(W).padStart(2)}m  | ${(100 * res.filter(r => r.taken).length / D.length).toFixed(0).padStart(3)}%  | ${pct(baseAll).padStart(7)}   ${pct(sysT).padStart(8)}   ${pct(sysT - baseAll).padStart(7)} | ${pct(mean(tg)).padStart(7)}  ${(100 * winr(tg)).toFixed(0).padStart(3)}%  ${pf(tg).toFixed(2).padStart(5)}`);
}
console.log('\n  (b) HYBRID: non-exhausted (bottom 60% EXH) enter at signal; exhausted (top 40%) must confirm within W or skip');
console.log('   C      W   | fill%  | SYS base  SYS hybrid  vsRandom@f  random-boot pctile');
const sEx = [...D].sort((a, b) => a.exh - b.exh);
const thr40 = sEx[Math.floor(0.6 * sEx.length)].exh;
for (const C of CS) for (const W of WS) {
  let s = 0, nTaken = 0;
  for (const d of D) {
    if (d.exh < thr40) { s += d.base; nTaken++; continue; }
    const r = simDelayed(d, C, W, true);
    if (r.taken) { s += r.g; nTaken++; }
  }
  const f = nTaken / D.length, baseAll = mean(D.map(x => x.base)), sysT = s / D.length;
  const rb = randomSkipBoot(D, D.length - nTaken);
  console.log(`   ${(C * 100).toFixed(2)}% ${String(W).padStart(2)}m  | ${(100 * f).toFixed(0).padStart(3)}%  | ${pct(baseAll).padStart(7)}  ${pct(sysT).padStart(8)}   ${pct(sysT - f * baseAll).padStart(8)}    ${(100 * rb.pctile(sysT)).toFixed(1).padStart(5)}%`);
}
// walk-forward the timing variant
console.log('\n  (c) WALK-FORWARD of the confirmation-entry (all fires)');
console.log('  DAY-BLOCK bootstrap: fires cluster within a day, so the per-fire iid bootstrap overstates n.');
console.log('  q_i = taken_i*(g_i - baseAll); mean(q) = vsRandom. Resample DAYS with replacement.');
console.log('   C      W   | TRAIN sys  vsRandom | TEST sys  vsRandom | TEST iid-pctile | TEST day-block p (2-sided)');
let posT = 0; const tcells = [];
function dayBlockP(set, C, W, iters = 3000) {
  const baseAll = mean(set.map(d => d.base));
  const byDay = new Map();
  for (const d of set) {
    const r = simDelayed(d, C, W, true);
    const q = r.taken ? r.g - baseAll : 0;
    if (!byDay.has(d.day)) byDay.set(d.day, []);
    byDay.get(d.day).push(q);
  }
  const arr = [...byDay.values()];
  const obs = mean(arr.flat());
  let ge = 0;
  for (let it = 0; it < iters; it++) {
    const s = [];
    for (let i = 0; i < arr.length; i++) s.push(...arr[(Math.random() * arr.length) | 0]);
    if (Math.abs(mean(s) - obs) >= Math.abs(obs)) ge++;
  }
  return (ge + 1) / (iters + 1);
}
for (const C of CS) for (const W of WS) {
  const ev = set => {
    const res = set.map(d => simDelayed(d, C, W, true));
    const tg = res.filter(r => r.taken).length;
    const f = tg / set.length, baseAll = mean(set.map(d => d.base));
    const sysT = sum(res.map(r => (r.taken ? r.g : 0))) / set.length;
    return { f, sysT, vsRandom: sysT - f * baseAll, nSkip: set.length - tg };
  };
  const a = ev(TRAIN), b = ev(TEST);
  const rb = randomSkipBoot(TEST, b.nSkip);
  const dbp = dayBlockP(TEST, C, W);
  if (b.vsRandom > 0) posT++;
  tcells.push({ C, W, a, b, dbp });
  console.log(`   ${(C * 100).toFixed(2)}% ${String(W).padStart(2)}m  | ${pct(a.sysT).padStart(7)}  ${pct(a.vsRandom).padStart(7)} | ${pct(b.sysT).padStart(7)}  ${pct(b.vsRandom).padStart(7)} | ${(100 * rb.pctile(b.sysT)).toFixed(1).padStart(5)}%          | ${dbp.toFixed(3)}  (Bonf x9 = ${Math.min(1, dbp * 9).toFixed(3)})`);
}
console.log(`  Cells with positive TEST vs-random: ${posT}/9`);
const bt = [...tcells].sort((x, y) => y.a.vsRandom - x.a.vsRandom)[0];
console.log(`  Best-in-TRAIN timing cell: C=${(bt.C * 100).toFixed(2)}% W=${bt.W}m -> TRAIN vsRandom ${pct(bt.a.vsRandom)} | HONEST OOS TEST vsRandom ${pct(bt.b.vsRandom)}, day-block p=${bt.dbp.toFixed(3)}, Bonferroni across ALL ${35 + 9 + 5} cells tested in this study = ${Math.min(1, bt.dbp * 49).toFixed(3)}`);

// ================= 7. DIRECTION SPLIT =================
console.log('\n## 7. Direction split (symmetry check) — EXH gate, vs-random, full sample');
const calls = D.filter(d => d.dir > 0), puts = D.filter(d => d.dir < 0);
console.log(`  calls n=${calls.length} (base ${pct(mean(calls.map(d => d.base)))})   puts n=${puts.length} (base ${pct(mean(puts.map(d => d.base)))})`);
console.log('  X%  | CALLS sys  vsRandom  pctile | PUTS sys  vsRandom  pctile');
for (const X of FRACS) {
  const c = gateEval(calls, 'exh', X, true), p = gateEval(puts, 'exh', X, true);
  const rc = randomSkipBoot(calls, c.nSkip), rp = randomSkipBoot(puts, p.nSkip);
  console.log(`  ${(100 * X).toFixed(0).padStart(2)}%  | ${pct(c.sysTreat).padStart(7)}  ${pct(c.vsRandom).padStart(7)}  ${(100 * rc.pctile(c.sysTreat)).toFixed(0).padStart(3)}%  | ${pct(p.sysTreat).padStart(7)}  ${pct(p.vsRandom).padStart(7)}  ${(100 * rp.pctile(p.sysTreat)).toFixed(0).padStart(3)}%`);
}

// ================= 8. Are we skipping the winners? fat tail check =================
console.log('\n## 8. FAT-TAIL CHECK — where do the top-decile baseline WINNERS sit on each score?');
const byBase = [...D].sort((a, b) => a.base - b.base);
const topW = byBase.slice(-Math.floor(0.1 * D.length));
const botL = byBase.slice(0, Math.floor(0.1 * D.length));
console.log('  score        mean(top-10% winners)   mean(bottom-10% losers)   mean(all)   separation?');
for (const k of ['exh', 'fuel', 'fuel2', 'fuel3']) {
  console.log(`  ${k.padEnd(10)}   ${mean(topW.map(d => d[k])).toFixed(3).padStart(8)}              ${mean(botL.map(d => d[k])).toFixed(3).padStart(8)}          ${mean(D.map(d => d[k])).toFixed(3).padStart(8)}    ${Math.abs(mean(topW.map(d => d[k])) - mean(botL.map(d => d[k]))) > 0.15 ? 'maybe' : 'NO'}`);
}
for (const k of FEATS) {
  const a = mean(topW.map(d => d.f[k])), b = mean(botL.map(d => d.f[k])), s = sd(D.map(d => d.f[k]));
  const sep = (a - b) / s;
  console.log(`  ${k.padEnd(10)}   ${a.toFixed(4).padStart(9)}             ${b.toFixed(4).padStart(9)}         ${mean(D.map(d => d.f[k])).toFixed(4).padStart(9)}    std-sep ${sep.toFixed(2)}`);
}

// ================= 9. haircut sensitivity =================
console.log(`\n## 9. Haircut sensitivity: this run used ${(100 * HAIR).toFixed(0)}%/side. Re-run with 'node exhaustion_entry.mjs 0.02'.`);
