// MIN-CONTRACT-PRICE FILTER — HOSTILE VALIDATION (RESEARCH ONLY, Clause 0).
// Tests the post-hoc live finding (n=72) that realized P&L is monotone in the
// option's ENTRY PRICE, on the 1,355-fire replay set with real per-minute UW marks.
//
// Pre-registered:
//   H1: P&L monotonically increasing in entry price; min-price filter improves PF/exp.
//   H0: artifact of small live sample and/or a proxy for moneyness / time-of-day /
//       ticker / IV — does not replicate.
//   Pass bar: holds on BOTH walk-forward halves, survives a fill haircut, and clears
//       a multiple-comparisons discount over the thresholds tested.
//
// Fidelity: entry = option close at first candle >= fireTs+60s (confirmation delay);
// exits on candle CLOSE only; realized = (exit-entry)/entry.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, 'cache');
const UND = path.join(HERE, 'cache_underlying');
const load = f => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : []);

const fires = load(path.join(HERE, 'fires_index.json'));
// re-join replay meta (entrySpot, exitTsMs) — fires_index dropped them
const replay = load(path.join(HERE, '..', '..', 'scripts', 'out', 'replay-fires-2026-04-10_2026-07-08.json'));
const meta = new Map();
for (const r of replay) meta.set(`${r.ticker}|${r.fireTsMs}|${r.K}|${r.dir}`, r);

// ---- underlying spot lookup (for live fires / SPXW sanity) ----
const undCache = new Map();
function undBars(t, day) {
  const k = `${t}|${day}`;
  if (!undCache.has(k)) {
    const rows = load(path.join(UND, `${t === 'SPXW' ? 'SPY' : t}_${day}.json`))
      .map(c => ({ ts: Date.parse(c.start_time), close: Number(c.close) || 0 }))
      .filter(c => c.close > 0).sort((a, b) => a.ts - b.ts);
    undCache.set(k, rows);
  }
  return undCache.get(k);
}
function spotAt(t, day, ts) {
  const b = undBars(t, day); if (!b.length) return null;
  let last = null; for (const x of b) { if (x.ts > ts) break; last = x.close; }
  const px = last ?? b[0].close;
  return t === 'SPXW' ? px * 10 : px;   // crude SPX proxy; only used if entrySpot missing
}

// ---- build per-fire record ----
function build(f) {
  const raw = load(path.join(CACHE, `${f.sym}_${f.day}.json`));
  const opt = raw.map(c => ({
    ts: Date.parse(c.start_time), close: Number(c.close) || 0,
    hi: Number(c.high) || 0, lo: Number(c.low) || 0,
    ivH: Number(c.iv_high) || 0, ivL: Number(c.iv_low) || 0,
    pa: Number(c.premium_ask_side) || 0, va: Number(c.volume_ask_side) || 0,
    pb: Number(c.premium_bid_side) || 0, vb: Number(c.volume_bid_side) || 0,
  })).filter(c => c.close > 0).sort((a, b) => a.ts - b.ts);
  if (opt.length < 4) return null;
  const entryTs = f.fireTsMs + 60000;
  const ei = opt.findIndex(o => o.ts >= entryTs);
  if (ei < 0 || ei >= opt.length - 2) return null;
  const entry = opt[ei].close;
  if (!(entry > 0)) return null;

  const m = meta.get(`${f.ticker}|${f.fireTsMs}|${f.K}|${f.dir}`);
  const spot = m?.entrySpot ?? spotAt(f.ticker, f.day, f.fireTsMs);
  if (!(spot > 0)) return null;

  const steps = opt.slice(ei).map(o => ({ ts: o.ts, g: (o.close - entry) / entry }));
  // engine structure exit (replay only): first candle at/after exitTsMs
  let structG = null;
  if (m?.exitTsMs) {
    const si = steps.findIndex(s => s.ts >= m.exitTsMs);
    structG = si > 0 ? steps[si].g : (si === 0 ? (steps[1]?.g ?? steps.at(-1).g) : steps.at(-1).g);
  }

  // --- friction proxies at/near entry (5-candle window from entry) ---
  const w = opt.slice(ei, ei + 5);
  let effSpreads = [], hlRel = [];
  for (const c of w) {
    if (c.va > 0 && c.vb > 0) {
      const ask = c.pa / c.va, bid = c.pb / c.vb;
      if (ask > 0 && bid > 0 && ask >= bid) effSpreads.push((ask - bid) / ((ask + bid) / 2));
    }
    if (c.close > 0 && c.hi >= c.lo) hlRel.push((c.hi - c.lo) / c.close);
  }
  const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;

  // moneyness: positive = OTM (call K>spot, put K<spot)
  const otm = f.dir * (f.K - spot) / spot;
  const absMny = Math.abs(f.K - spot) / spot;
  // minutes to 16:00 ET close (20:00 UTC on EDT days)
  const d = new Date(f.fireTsMs);
  const closeUtc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 20, 0, 0);
  const mtc = (closeUtc - f.fireTsMs) / 60000;
  const iv = (opt[ei].ivH + opt[ei].ivL) / 2 || null;

  return {
    day: f.day, ticker: f.ticker, state: f.state, src: f.src, dir: f.dir, K: f.K, spot,
    entry, steps, structG, otm, absMny, mtc, iv,
    tickSize: entry < 3 ? 0.01 : 0.05,   // OCC: <$3 penny, >=$3 nickel (index/ETF)
    effSpread: mean(effSpreads), hlRel: mean(hlRel), nSpread: effSpreads.length,
  };
}

const built = [];
for (const f of fires) { const b = build(f); if (b) built.push(b); }
const days = [...new Set(built.map(b => b.day))].sort();
console.error(`built ${built.length}/${fires.length} over ${days.length} days`);
console.error(`with structG: ${built.filter(b => b.structG != null).length}`);

// ================= exit policies =================
const HAIR = Number(process.env.HAIR || 0);          // flat return-pct haircut (frictionless=0)
const REALSPREAD = process.env.REALSPREAD === '1';    // charge per-fire modeled round-trip spread
function frictionOf(b) {
  if (REALSPREAD) {
    // round-trip cost as a fraction of entry premium.
    // model: half-spread crossed on each side. spread estimate = max(observed eff spread,
    // one tick / price) — a floor, because you cannot do better than the tick.
    const tickRel = b.tickSize / b.entry;
    const s = Math.max(b.effSpread ?? 0, tickRel);
    return Math.min(s, 0.35);   // cap at 35% (degenerate sub-$0.10 contracts)
  }
  return HAIR;
}
const POL = {
  STRUCT: b => (b.structG ?? b.steps.at(-1).g),      // engine's own structure exit (system proxy)
  HOLD_EOD: b => b.steps.at(-1).g,
  STOP30: b => { for (const s of b.steps) if (s.g <= -0.30) return s.g; return b.steps.at(-1).g; },
  LADDER: b => {   // verified scale-out: half at +50%, rest stop -30% else EOD
    let took = false;
    for (const s of b.steps) {
      if (!took && s.g >= 0.50) took = true;
      if (s.g <= -0.30) return took ? 0.5 * 0.50 + 0.5 * s.g : s.g;
    }
    const L = b.steps.at(-1).g;
    return took ? 0.5 * 0.50 + 0.5 * L : L;
  },
};
const ret = (b, pol) => POL[pol](b) - frictionOf(b);

// ================= stats =================
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
const sd = a => { if (a.length < 2) return NaN; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
function stats(g) {
  const pos = g.filter(x => x > 0), neg = g.filter(x => x <= 0);
  const gp = pos.reduce((s, x) => s + x, 0), gl = -neg.reduce((s, x) => s + x, 0);
  return { n: g.length, win: pos.length / g.length, exp: mean(g), pf: gl > 0 ? gp / gl : Infinity, sd: sd(g) };
}
const pc = x => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;
const f2 = x => (x === Infinity ? ' inf' : x.toFixed(2));
const row = (lab, s) => `${lab.padEnd(22)}${String(s.n).padStart(5)}${(s.win * 100).toFixed(0).padStart(6)}%${pc(s.exp).padStart(9)}${f2(s.pf).padStart(7)}`;

// ================= 1. bucket reproduction (SAME buckets, not re-tuned) =================
const BUCKETS = [
  ['<$1', b => b.entry < 1],
  ['$1-3', b => b.entry >= 1 && b.entry < 3],
  ['$3-10', b => b.entry >= 3 && b.entry < 10],
  ['>$10', b => b.entry >= 10],
];
const POLS = Object.keys(POL);

console.log(`\n${'='.repeat(78)}\n# 1. ENTRY-PRICE BUCKET REPRODUCTION (replay set, n=${built.length})`);
console.log(`friction: ${REALSPREAD ? 'MODELED PER-FIRE SPREAD' : `flat ${(HAIR * 100).toFixed(1)}%`}\n`);
for (const pol of POLS) {
  console.log(`-- exit policy: ${pol}`);
  console.log('bucket'.padEnd(22) + 'n'.padStart(5) + 'win%'.padStart(7) + 'exp'.padStart(9) + 'PF'.padStart(7));
  for (const [lab, fn] of BUCKETS) {
    const g = built.filter(fn).map(b => ret(b, pol));
    if (g.length) console.log(row(lab, stats(g)));
  }
  console.log(row('ALL', stats(built.map(b => ret(b, pol)))));
  console.log('');
}

// ================= 2. threshold sweep + walk-forward + MC =================
const THRESH = [1, 2, 3, 5, 10];
const splitIdx = Math.floor(days.length / 2);
const trainD = new Set(days.slice(0, splitIdx)), testD = new Set(days.slice(splitIdx));
const H1 = built.filter(b => trainD.has(b.day)), H2 = built.filter(b => testD.has(b.day));

console.log('='.repeat(78));
console.log(`# 2. MIN-PRICE THRESHOLD SWEEP  (walk-forward halves)`);
console.log(`H1 ${days[0]}..${days[splitIdx - 1]} n=${H1.length} | H2 ${days[splitIdx]}..${days.at(-1)} n=${H2.length}\n`);
for (const pol of POLS) {
  const all = built.map(b => ret(b, pol)), aS = stats(all);
  console.log(`-- ${pol}   baseline(all): n=${aS.n} win ${(aS.win * 100).toFixed(0)}% exp ${pc(aS.exp)} PF ${f2(aS.pf)}`);
  console.log('minPx'.padEnd(8) + 'kept%'.padStart(7) + 'n'.padStart(6) + 'win%'.padStart(7) + 'exp'.padStart(9) + 'PF'.padStart(7)
    + 'Δexp'.padStart(9) + '|' + 'H1exp'.padStart(9) + 'H1PF'.padStart(7) + 'H2exp'.padStart(9) + 'H2PF'.padStart(7) + '  WF');
  for (const t of THRESH) {
    const sub = built.filter(b => b.entry >= t);
    if (sub.length < 20) { console.log(`>=$${t}`.padEnd(8) + '  (n<20, skipped)'); continue; }
    const s = stats(sub.map(b => ret(b, pol)));
    const s1 = stats(H1.filter(b => b.entry >= t).map(b => ret(b, pol)));
    const s2 = stats(H2.filter(b => b.entry >= t).map(b => ret(b, pol)));
    const b1 = stats(H1.map(b => ret(b, pol))), b2 = stats(H2.map(b => ret(b, pol)));
    const wf = (s1.exp > b1.exp && s2.exp > b2.exp) ? 'YES' : 'no';
    console.log(`>=$${t}`.padEnd(8) + `${(100 * sub.length / built.length).toFixed(0)}%`.padStart(7)
      + String(s.n).padStart(6) + (s.win * 100).toFixed(0).padStart(6) + '%' + pc(s.exp).padStart(9) + f2(s.pf).padStart(7)
      + pc(s.exp - aS.exp).padStart(9) + '|' + pc(s1.exp).padStart(9) + f2(s1.pf).padStart(7)
      + pc(s2.exp).padStart(9) + f2(s2.pf).padStart(7) + '  ' + wf);
  }
  console.log('');
}

// ---- multiple-comparisons: permutation of the entry-price LABEL vs returns ----
// Null: entry price carries no information about return. Shuffle entry prices across
// fires (within ticker+day block to preserve structure), recompute max Δexp over the
// 5 thresholds; family-wise p = P(max Δ_null >= max Δ_obs).
function permMaxDelta(pol, B = 2000) {
  const g = built.map(b => ret(b, pol));
  const px = built.map(b => b.entry);
  const base = mean(g);
  const obs = Math.max(...THRESH.map(t => {
    const sel = g.filter((_, i) => px[i] >= t);
    return sel.length >= 20 ? mean(sel) - base : -Infinity;
  }));
  let ge = 0;
  for (let bI = 0; bI < B; bI++) {
    const sp = px.slice();
    for (let i = sp.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [sp[i], sp[j]] = [sp[j], sp[i]]; }
    const mx = Math.max(...THRESH.map(t => {
      const sel = g.filter((_, i) => sp[i] >= t);
      return sel.length >= 20 ? mean(sel) - base : -Infinity;
    }));
    if (mx >= obs) ge++;
  }
  return { obs, p: (ge + 1) / (B + 1) };
}
console.log('='.repeat(78));
console.log('# 2b. MULTIPLE-COMPARISONS DISCOUNT (permutation over 5 thresholds, B=2000)');
console.log('policy'.padEnd(12) + 'best Δexp'.padStart(11) + 'FWER p'.padStart(9));
for (const pol of POLS) {
  const r = permMaxDelta(pol);
  console.log(pol.padEnd(12) + pc(r.obs).padStart(11) + r.p.toFixed(4).padStart(9));
}

// ================= 3. CONFOUND CONTROLS =================
console.log(`\n${'='.repeat(78)}`);
console.log('# 3. CONFOUNDS');

// correlation of entry price with candidates
function corr(a, b) {
  const n = a.length, ma = mean(a), mb = mean(b);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return num / Math.sqrt(da * db);
}
function spearman(a, b) {
  const rank = v => { const idx = v.map((x, i) => [x, i]).sort((p, q) => p[0] - q[0]); const r = new Array(v.length); idx.forEach(([, i], k) => r[i] = k); return r; };
  return corr(rank(a), rank(b));
}
const px = built.map(b => b.entry);
console.log('\nSpearman(entry price, X):');
console.log('  |moneyness|      ', spearman(px, built.map(b => b.absMny)).toFixed(3));
console.log('  OTM-ness (signed)', spearman(px, built.map(b => b.otm)).toFixed(3));
console.log('  minutes-to-close ', spearman(px, built.map(b => b.mtc)).toFixed(3));
console.log('  IV at entry      ', spearman(px, built.filter(b => b.iv).map(b => b.iv).length === built.length ? built.map(b => b.iv) : px.map(() => 0)).toFixed(3));
console.log('  is-SPXW          ', spearman(px, built.map(b => b.ticker === 'SPXW' ? 1 : 0)).toFixed(3));

// per-ticker entry price profile
console.log('\nEntry price by ticker:');
for (const t of ['SPXW', 'SPY', 'QQQ']) {
  const s = built.filter(b => b.ticker === t);
  console.log(`  ${t.padEnd(5)} n=${String(s.length).padStart(4)}  avg entry $${mean(s.map(b => b.entry)).toFixed(2)}  med $${[...s.map(b => b.entry)].sort((a, c) => a - c)[Math.floor(s.length / 2)].toFixed(2)}  avg|mny| ${(100 * mean(s.map(b => b.absMny))).toFixed(2)}%`);
}

const PRIMARY = process.env.PRIMARY || 'STRUCT';
console.log(`\n(controls evaluated on exit policy = ${PRIMARY})`);

// --- 3a WITHIN-TICKER price buckets ---
console.log('\n-- 3a. WITHIN-TICKER price buckets (does price still sort inside a ticker?)');
for (const t of ['SPXW', 'SPY', 'QQQ']) {
  const sub = built.filter(b => b.ticker === t);
  // ticker-relative quartiles of entry price (so SPY isn't just "all cheap")
  const sorted = [...sub].sort((a, b) => a.entry - b.entry);
  const q = k => sorted[Math.floor(k * (sorted.length - 1))].entry;
  const cuts = [q(0.25), q(0.5), q(0.75)];
  console.log(`  ${t}  (n=${sub.length}, price quartile cuts $${cuts.map(c => c.toFixed(2)).join(' / $')})`);
  console.log('  ' + 'quartile'.padEnd(20) + 'n'.padStart(5) + 'win%'.padStart(7) + 'exp'.padStart(9) + 'PF'.padStart(7));
  const qs = [
    ['Q1 cheapest', b => b.entry <= cuts[0]],
    ['Q2', b => b.entry > cuts[0] && b.entry <= cuts[1]],
    ['Q3', b => b.entry > cuts[1] && b.entry <= cuts[2]],
    ['Q4 priciest', b => b.entry > cuts[2]],
  ];
  for (const [lab, fn] of qs) {
    const g = sub.filter(fn).map(b => ret(b, PRIMARY));
    if (g.length) console.log('  ' + row(lab, stats(g)));
  }
  // absolute $3 filter inside ticker
  const a = stats(sub.map(b => ret(b, PRIMARY)));
  const f3 = sub.filter(b => b.entry >= 3);
  if (f3.length >= 15) console.log(`  ${t} >=$3: n=${f3.length} exp ${pc(stats(f3.map(b => ret(b, PRIMARY))).exp)} PF ${f2(stats(f3.map(b => ret(b, PRIMARY))).pf)}  (all: exp ${pc(a.exp)} PF ${f2(a.pf)})`);
  else console.log(`  ${t} >=$3: n=${f3.length} (too few)`);
}

// --- 3b WITHIN-MONEYNESS price buckets ---
console.log('\n-- 3b. MONEYNESS: is it really "don\'t buy far-OTM"?');
const MNY = [
  ['ATM  <2bp', b => b.absMny < 0.0002],
  ['2-5bp', b => b.absMny >= 0.0002 && b.absMny < 0.0005],
  ['5-10bp', b => b.absMny >= 0.0005 && b.absMny < 0.0010],
  ['>10bp', b => b.absMny >= 0.0010],
];
console.log('  moneyness bucket (marginal):');
console.log('  ' + 'bucket'.padEnd(20) + 'n'.padStart(5) + 'win%'.padStart(7) + 'exp'.padStart(9) + 'PF'.padStart(7) + '  avg$entry');
for (const [lab, fn] of MNY) {
  const s = built.filter(fn);
  if (!s.length) continue;
  console.log('  ' + row(lab, stats(s.map(b => ret(b, PRIMARY)))) + `   $${mean(s.map(b => b.entry)).toFixed(2)}`);
}
// signed OTM (are OTM contracts the losers, ITM the winners?)
console.log('\n  signed OTM-ness (+ = OTM, - = ITM):');
const OTMB = [
  ['ITM  < -5bp', b => b.otm < -0.0005],
  ['ITM  -5..0bp', b => b.otm >= -0.0005 && b.otm < 0],
  ['OTM  0..5bp', b => b.otm >= 0 && b.otm < 0.0005],
  ['OTM  5..15bp', b => b.otm >= 0.0005 && b.otm < 0.0015],
  ['OTM  >15bp', b => b.otm >= 0.0015],
];
console.log('  ' + 'bucket'.padEnd(20) + 'n'.padStart(5) + 'win%'.padStart(7) + 'exp'.padStart(9) + 'PF'.padStart(7) + '  avg$entry');
for (const [lab, fn] of OTMB) {
  const s = built.filter(fn);
  if (!s.length) continue;
  console.log('  ' + row(lab, stats(s.map(b => ret(b, PRIMARY)))) + `   $${mean(s.map(b => b.entry)).toFixed(2)}`);
}
// price effect WITHIN each moneyness band
console.log('\n  PRICE buckets WITHIN each moneyness band (does price survive the control?):');
for (const [mlab, mfn] of MNY) {
  const sub = built.filter(mfn);
  if (sub.length < 40) continue;
  const parts = BUCKETS.map(([lab, fn]) => {
    const g = sub.filter(fn).map(b => ret(b, PRIMARY));
    return g.length >= 10 ? `${lab}: n=${g.length} exp ${pc(stats(g).exp)} PF ${f2(stats(g).pf)}` : `${lab}: n=${g.length} —`;
  });
  console.log(`  [${mlab}] n=${sub.length}`);
  for (const p of parts) console.log('      ' + p);
}

// --- 3c TIME-OF-DAY ---
console.log('\n-- 3c. TIME-OF-DAY / minutes-to-close');
const TOD = [
  ['open  >300m', b => b.mtc > 300],
  ['am    180-300m', b => b.mtc > 180 && b.mtc <= 300],
  ['mid   90-180m', b => b.mtc > 90 && b.mtc <= 180],
  ['pm    30-90m', b => b.mtc > 30 && b.mtc <= 90],
  ['late  <=30m', b => b.mtc <= 30],
];
console.log('  ' + 'bucket'.padEnd(20) + 'n'.padStart(5) + 'win%'.padStart(7) + 'exp'.padStart(9) + 'PF'.padStart(7) + '  avg$entry');
for (const [lab, fn] of TOD) {
  const s = built.filter(fn);
  if (!s.length) continue;
  console.log('  ' + row(lab, stats(s.map(b => ret(b, PRIMARY)))) + `   $${mean(s.map(b => b.entry)).toFixed(2)}`);
}
console.log('\n  PRICE buckets WITHIN each time band:');
for (const [tlab, tfn] of TOD) {
  const sub = built.filter(tfn);
  if (sub.length < 40) continue;
  console.log(`  [${tlab}] n=${sub.length}`);
  for (const [lab, fn] of BUCKETS) {
    const g = sub.filter(fn).map(b => ret(b, PRIMARY));
    console.log('      ' + (g.length >= 10 ? `${lab}: n=${g.length} exp ${pc(stats(g).exp)} PF ${f2(stats(g).pf)}` : `${lab}: n=${g.length} —`));
  }
}

// --- 3d joint: within-ticker AND within-moneyness (the hardest control) ---
console.log('\n-- 3d. HARDEST CONTROL: within (ticker x moneyness) cells, does entry price still sort?');
console.log('  Per cell, split into cheap/expensive at the CELL MEDIAN price. Report Δexp (expensive - cheap).');
let cells = 0, posCells = 0, wsum = 0, wn = 0;
console.log('  ' + 'cell'.padEnd(28) + 'n'.padStart(5) + 'medPx'.padStart(8) + 'cheapExp'.padStart(10) + 'pricyExp'.padStart(10) + 'Δ'.padStart(9));
for (const t of ['SPXW', 'SPY', 'QQQ']) {
  for (const [mlab, mfn] of MNY) {
    const sub = built.filter(b => b.ticker === t && mfn(b));
    if (sub.length < 30) continue;
    const s = [...sub.map(b => b.entry)].sort((a, c) => a - c);
    const medPx = s[Math.floor(s.length / 2)];
    const cheap = sub.filter(b => b.entry < medPx).map(b => ret(b, PRIMARY));
    const pricy = sub.filter(b => b.entry >= medPx).map(b => ret(b, PRIMARY));
    if (cheap.length < 10 || pricy.length < 10) continue;
    const d = mean(pricy) - mean(cheap);
    cells++; if (d > 0) posCells++;
    wsum += d * sub.length; wn += sub.length;
    console.log('  ' + `${t} ${mlab}`.padEnd(28) + String(sub.length).padStart(5) + `$${medPx.toFixed(2)}`.padStart(8)
      + pc(mean(cheap)).padStart(10) + pc(mean(pricy)).padStart(10) + pc(d).padStart(9));
  }
}
console.log(`  => ${posCells}/${cells} cells positive; n-weighted mean Δ = ${pc(wsum / wn)}`);
// sign test p
function binomP(k, n) { // P(X>=k) under p=0.5
  const C = (n, k) => { let r = 1; for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1); return r; };
  let s = 0; for (let i = k; i <= n; i++) s += C(n, i); return s / 2 ** n;
}
if (cells) console.log(`  sign test p(>= ${posCells}/${cells} positive) = ${binomP(posCells, cells).toFixed(4)}`);

// ================= 4. FRICTION =================
console.log(`\n${'='.repeat(78)}`);
console.log('# 4. FRICTION BY PRICE BUCKET');
console.log('  effSpread = (avg ask-side px - avg bid-side px)/mid at entry (5-candle window)');
console.log('  tickRel   = min tick / entry price (hard floor on round-trip cost)');
console.log('bucket'.padEnd(12) + 'n'.padStart(5) + 'avg$'.padStart(8) + 'effSpr'.padStart(9) + 'medEffSpr'.padStart(11)
  + 'tickRel'.padStart(9) + 'hlRel'.padStart(8) + '  modeled RT cost');
for (const [lab, fn] of BUCKETS) {
  const s = built.filter(fn);
  if (!s.length) continue;
  const es = s.map(b => b.effSpread).filter(x => x != null);
  const esSorted = [...es].sort((a, b) => a - b);
  const medES = esSorted.length ? esSorted[Math.floor(esSorted.length / 2)] : NaN;
  const tr = s.map(b => b.tickSize / b.entry);
  const cost = s.map(b => Math.min(Math.max(b.effSpread ?? 0, b.tickSize / b.entry), 0.35));
  console.log(lab.padEnd(12) + String(s.length).padStart(5) + `$${mean(s.map(b => b.entry)).toFixed(2)}`.padStart(8)
    + `${(100 * mean(es)).toFixed(1)}%`.padStart(9) + `${(100 * medES).toFixed(1)}%`.padStart(11)
    + `${(100 * mean(tr)).toFixed(1)}%`.padStart(9) + `${(100 * mean(s.map(b => b.hlRel))).toFixed(1)}%`.padStart(8)
    + `   ${(100 * mean(cost)).toFixed(1)}%`);
}
// friction vs directional decomposition
console.log('\nDecomposition: gross (frictionless) vs modeled-friction net, by bucket (policy ' + PRIMARY + ')');
console.log('bucket'.padEnd(12) + 'grossExp'.padStart(10) + 'friction'.padStart(10) + 'netExp'.padStart(9) + 'grossPF'.padStart(9) + 'netPF'.padStart(8));
for (const [lab, fn] of BUCKETS) {
  const s = built.filter(fn);
  if (!s.length) continue;
  const gross = s.map(b => POL[PRIMARY](b));
  const cost = s.map(b => Math.min(Math.max(b.effSpread ?? 0, b.tickSize / b.entry), 0.35));
  const net = gross.map((g, i) => g - cost[i]);
  console.log(lab.padEnd(12) + pc(mean(gross)).padStart(10) + `-${(100 * mean(cost)).toFixed(1)}%`.padStart(10)
    + pc(mean(net)).padStart(9) + f2(stats(gross).pf).padStart(9) + f2(stats(net).pf).padStart(8));
}

// ================= 5. LIVE-SET CROSS-CHECK =================
const liveN = built.filter(b => b.src === 'live').length;
console.log(`\n(live fires present in replay-built set: ${liveN} — replay dominates, conclusions are OOS wrt the live finding)`);
