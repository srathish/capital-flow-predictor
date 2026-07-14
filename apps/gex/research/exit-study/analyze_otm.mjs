// PAIRED MONEYNESS EXPERIMENT — analysis (RESEARCH ONLY, Clause 0).
// The replay set is ATM-only by construction, so moneyness was UNOBSERVABLE. We
// manufactured the variation: for each replay fire we pulled the SAME fire's option
// at +0.5% / +1.0% / +2.0% OTM. Same signal, same second, same ticker, same direction
// — the ONLY thing that varies is the strike. This is a clean causal read on moneyness,
// 18x the live sample, and it is the experiment the live ladder only hints at.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, 'cache'), OTM = path.join(HERE, 'cache_otm');
const load = f => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : []);
const replay = load(path.join(HERE, '..', '..', 'scripts', 'out', 'replay-fires-2026-04-10_2026-07-08.json'));
const jobs = load(path.join(HERE, 'otm_jobs.json'));
const occ = (t, day, dir, K) =>
  `${t}${day.slice(2, 4)}${day.slice(5, 7)}${day.slice(8, 10)}${dir > 0 ? 'C' : 'P'}${String(Math.round(K * 1000)).padStart(8, '0')}`;

// legs keyed by fire
const legsBy = new Map();
for (const j of jobs) {
  const k = `${j.ticker}|${j.fireTsMs}`;
  if (!legsBy.has(k)) legsBy.set(k, []);
  legsBy.get(k).push(j);
}

// build one leg's path from a cache dir
function pathOf(dir_, sym, day, fireTsMs, exitTsMs) {
  const opt = load(path.join(dir_, `${sym}_${day}.json`))
    .map(c => ({ ts: Date.parse(c.start_time), close: Number(c.close) || 0,
      pa: Number(c.premium_ask_side) || 0, va: Number(c.volume_ask_side) || 0,
      pb: Number(c.premium_bid_side) || 0, vb: Number(c.volume_bid_side) || 0 }))
    .filter(c => c.close > 0).sort((a, b) => a.ts - b.ts);
  if (opt.length < 4) return null;
  const ei = opt.findIndex(o => o.ts >= fireTsMs + 60000);
  if (ei < 0 || ei >= opt.length - 2) return null;
  const entry = opt[ei].close; if (!(entry > 0)) return null;
  const steps = opt.slice(ei).map(o => ({ ts: o.ts, g: (o.close - entry) / entry }));
  let structG = steps.at(-1).g;
  if (exitTsMs) { const si = steps.findIndex(s => s.ts >= exitTsMs); if (si > 0) structG = steps[si].g; }
  // relative spread at entry (ask-side avg px vs bid-side avg px), 5-candle window
  const w = opt.slice(ei, ei + 5); const sp = [];
  for (const c of w) if (c.va > 0 && c.vb > 0) {
    const a = c.pa / c.va, b = c.pb / c.vb;
    if (a > 0 && b > 0 && a >= b) sp.push((a - b) / ((a + b) / 2));
  }
  return { entry, structG, eod: steps.at(-1).g,
    spread: sp.length ? sp.reduce((s, x) => s + x, 0) / sp.length : null };
}

// assemble paired fires: ATM leg + OTM legs
const paired = [];
for (const f of replay) {
  const atm = pathOf(CACHE, occ(f.ticker, f.day, f.dir, f.K), f.day, f.fireTsMs, f.exitTsMs);
  if (!atm) continue;
  const legs = { 0: { ...atm, off: 0, K: f.K, mny: Math.abs(f.K - f.entrySpot) / f.entrySpot } };
  for (const j of (legsBy.get(`${f.ticker}|${f.fireTsMs}`) || [])) {
    const p = pathOf(OTM, j.sym, j.day, f.fireTsMs, f.exitTsMs);
    if (p) legs[j.off] = { ...p, off: j.off, K: j.K, mny: Math.abs(j.K - f.entrySpot) / f.entrySpot };
  }
  paired.push({ day: f.day, ticker: f.ticker, state: f.state, dir: f.dir, legs });
}
const days = [...new Set(paired.map(p => p.day))].sort();
console.log(`paired fires: ${paired.length} over ${days.length} days`);
const OFFS = [0, 0.005, 0.010, 0.020];
for (const o of OFFS) console.log(`  leg +${(100 * o).toFixed(1)}% present on ${paired.filter(p => p.legs[o]).length} fires`);

const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
const medn = a => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
function stats(g) {
  const pos = g.filter(x => x > 0);
  const gp = pos.reduce((s, x) => s + x, 0), gl = -g.filter(x => x <= 0).reduce((s, x) => s + x, 0);
  return { n: g.length, win: pos.length / g.length, exp: mean(g), pf: gl > 0 ? gp / gl : Infinity };
}
const pc = x => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;
const f2 = x => (x === Infinity ? ' inf' : x.toFixed(2));
function binomP(k, n) { const C = (n, k) => { let r = 1; for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1); return r; }; let s = 0; for (let i = k; i <= n; i++) s += C(n, i); return s / 2 ** n; }

for (const pol of ['structG', 'eod']) {
  console.log('\n' + '='.repeat(76));
  console.log(`# MONEYNESS LADDER — exit policy: ${pol === 'structG' ? 'STRUCT (engine exit)' : 'HOLD-EOD'}`);
  console.log('\nMARGINAL (all fires that have the leg):');
  console.log('leg'.padEnd(12) + 'n'.padStart(6) + 'win%'.padStart(7) + 'exp'.padStart(9) + 'PF'.padStart(7)
    + 'medRet'.padStart(9) + 'avg$'.padStart(8) + 'relSpr'.padStart(8));
  for (const o of OFFS) {
    const L = paired.filter(p => p.legs[o]).map(p => p.legs[o]);
    if (!L.length) continue;
    const s = stats(L.map(l => l[pol]));
    const sp = L.map(l => l.spread).filter(x => x != null);
    console.log(`+${(100 * o).toFixed(1)}% OTM`.padEnd(12) + String(s.n).padStart(6) + (s.win * 100).toFixed(0).padStart(6) + '%'
      + pc(s.exp).padStart(9) + f2(s.pf).padStart(7) + pc(medn(L.map(l => l[pol]))).padStart(9)
      + `$${mean(L.map(l => l.entry)).toFixed(2)}`.padStart(8)
      + `${(100 * mean(sp)).toFixed(1)}%`.padStart(8));
  }
  console.log('\nPAIRED Δ vs the ATM leg (same fire, same second — only the strike differs):');
  console.log('pair'.padEnd(16) + 'n'.padStart(6) + 'meanΔ'.padStart(9) + 'medΔ'.padStart(9)
    + 'ATM wins'.padStart(10) + '  sign-test p (ATM better)');
  for (const o of OFFS.slice(1)) {
    const P = paired.filter(p => p.legs[o] && p.legs[0]);
    if (P.length < 20) continue;
    const d = P.map(p => p.legs[o][pol] - p.legs[0][pol]);
    const atmW = d.filter(x => x < 0).length;
    console.log(`+${(100 * o).toFixed(1)}% vs ATM`.padEnd(16) + String(d.length).padStart(6)
      + pc(mean(d)).padStart(9) + pc(medn(d)).padStart(9) + `${atmW}/${d.length}`.padStart(10)
      + `   ${binomP(atmW, d.length).toExponential(2)}`);
  }
  // per ticker
  console.log('\nPer-ticker paired Δ vs ATM (mean):');
  console.log('ticker'.padEnd(8) + OFFS.slice(1).map(o => `+${(100 * o).toFixed(1)}%`.padStart(11)).join(''));
  for (const t of ['SPXW', 'SPY', 'QQQ']) {
    let line = t.padEnd(8);
    for (const o of OFFS.slice(1)) {
      const P = paired.filter(p => p.ticker === t && p.legs[o] && p.legs[0]);
      line += (P.length >= 10 ? pc(mean(P.map(p => p.legs[o][pol] - p.legs[0][pol]))) : `n=${P.length}`).padStart(11);
    }
    console.log(line);
  }
  // walk-forward on the paired delta
  const sp2 = Math.floor(days.length / 2);
  const H1 = new Set(days.slice(0, sp2)), H2 = new Set(days.slice(sp2));
  console.log('\nWalk-forward on the paired Δ (is "ATM beats OTM" stable across halves?):');
  console.log('pair'.padEnd(16) + 'H1 meanΔ'.padStart(10) + 'H2 meanΔ'.padStart(10) + '  both negative (ATM wins twice)?');
  for (const o of OFFS.slice(1)) {
    const P = paired.filter(p => p.legs[o] && p.legs[0]);
    const d1 = P.filter(p => H1.has(p.day)).map(p => p.legs[o][pol] - p.legs[0][pol]);
    const d2 = P.filter(p => H2.has(p.day)).map(p => p.legs[o][pol] - p.legs[0][pol]);
    if (d1.length < 10 || d2.length < 10) continue;
    console.log(`+${(100 * o).toFixed(1)}% vs ATM`.padEnd(16) + pc(mean(d1)).padStart(10) + pc(mean(d2)).padStart(10)
      + `   ${mean(d1) < 0 && mean(d2) < 0 ? 'YES — ATM wins in BOTH halves' : 'no'}`);
  }
}

// friction: relative spread vs moneyness
console.log('\n' + '='.repeat(76));
console.log('# FRICTION vs MONEYNESS (modeled from ask-side/bid-side marks)');
console.log('leg'.padEnd(12) + 'n'.padStart(6) + 'avg$entry'.padStart(11) + 'rel spread'.padStart(12) + 'med rel spread'.padStart(16));
for (const o of OFFS) {
  const L = paired.filter(p => p.legs[o]).map(p => p.legs[o]).filter(l => l.spread != null);
  if (!L.length) continue;
  console.log(`+${(100 * o).toFixed(1)}% OTM`.padEnd(12) + String(L.length).padStart(6)
    + `$${mean(L.map(l => l.entry)).toFixed(2)}`.padStart(11)
    + `${(100 * mean(L.map(l => l.spread))).toFixed(1)}%`.padStart(12)
    + `${(100 * medn(L.map(l => l.spread))).toFixed(1)}%`.padStart(16));
}
// net-of-friction paired delta
console.log('\nPAIRED Δ vs ATM, NET of modeled round-trip spread (STRUCT):');
console.log('pair'.padEnd(16) + 'n'.padStart(6) + 'gross Δ'.padStart(10) + 'net Δ'.padStart(9));
for (const o of OFFS.slice(1)) {
  const P = paired.filter(p => p.legs[o] && p.legs[0] && p.legs[o].spread != null && p.legs[0].spread != null);
  if (P.length < 20) continue;
  const g = P.map(p => p.legs[o].structG - p.legs[0].structG);
  const n = P.map(p => (p.legs[o].structG - p.legs[o].spread) - (p.legs[0].structG - p.legs[0].spread));
  console.log(`+${(100 * o).toFixed(1)}% vs ATM`.padEnd(16) + String(P.length).padStart(6)
    + pc(mean(g)).padStart(10) + pc(mean(n)).padStart(9));
}
