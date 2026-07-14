// TIME-OF-DAY CUTOFF + TAPE-GATE INCREMENTAL (RESEARCH ONLY, Clause 0).
// Replay set (1,295 fires / 61 days, real per-minute UW marks). Tests:
//   (2) does an EARLIER intraday cutoff (no new fires after 12:00/13:00/14:00 ET)
//       beat the existing 15:15 ET cutoff, out-of-sample?
//   (4) incremental value of each candidate OVER the bull tape gate.
// Bull tape gate (reconstruction of bull-tape-gate.js): block BULL fires when the
// index tape is ALL below prior close. Reconstructed from cache_underlying 1m bars
// (SPY + QQQ; SPY stands in for the SPX leg, ~0.99 intraday corr) — labelled as a
// reconstruction, not the live gate byte-for-byte.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, 'cache');
const UND = path.join(HERE, 'cache_underlying');
const load = f => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : []);

const fires = load(path.join(HERE, 'fires_index.json'));
const replay = load(path.join(HERE, '..', '..', 'scripts', 'out', 'replay-fires-2026-04-10_2026-07-08.json'));
const meta = new Map();
for (const r of replay) meta.set(`${r.ticker}|${r.fireTsMs}|${r.K}|${r.dir}`, r);

// ---- underlying series (regular session only) ----
const ser = new Map();
function bars(t, day) {
  const k = `${t}|${day}`;
  if (!ser.has(k)) ser.set(k, load(path.join(UND, `${t}_${day}.json`))
    .map(c => ({ ts: Date.parse(c.start_time), close: Number(c.close) || 0, mt: c.market_time }))
    .filter(c => c.close > 0 && c.mt === 'r').sort((a, b) => a.ts - b.ts));
  return ser.get(k);
}
const allDays = [...new Set(fires.map(f => f.day))].sort();
function priorClose(t, day) {
  const i = allDays.indexOf(day);
  for (let j = i - 1; j >= 0; j--) { const b = bars(t, allDays[j]); if (b.length) return b.at(-1).close; }
  return null;
}
function spotAt(t, day, ts) {
  const b = bars(t, day); if (!b.length) return null;
  let last = null; for (const x of b) { if (x.ts > ts) break; last = x.close; }
  return last ?? b[0].close;
}

// ---- build fires with returns + features ----
function build(f) {
  const opt = load(path.join(CACHE, `${f.sym}_${f.day}.json`))
    .map(c => ({ ts: Date.parse(c.start_time), close: Number(c.close) || 0 }))
    .filter(c => c.close > 0).sort((a, b) => a.ts - b.ts);
  if (opt.length < 4) return null;
  const ei = opt.findIndex(o => o.ts >= f.fireTsMs + 60000);
  if (ei < 0 || ei >= opt.length - 2) return null;
  const entry = opt[ei].close; if (!(entry > 0)) return null;
  const m = meta.get(`${f.ticker}|${f.fireTsMs}|${f.K}|${f.dir}`);
  const steps = opt.slice(ei).map(o => ({ ts: o.ts, g: (o.close - entry) / entry }));
  let structG = steps.at(-1).g;
  if (m?.exitTsMs) { const si = steps.findIndex(s => s.ts >= m.exitTsMs); if (si > 0) structG = steps[si].g; }
  const d = new Date(f.fireTsMs);
  const etHour = (f.fireTsMs - Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 13, 30, 0)) / 3600000 + 9.5;
  // tape reconstruction: is each index above its prior close at fire time?
  const above = t => {
    const s = spotAt(t, f.day, f.fireTsMs), pc = priorClose(t, f.day);
    return (s != null && pc != null) ? (s > pc ? 1 : 0) : null;
  };
  const aSPY = above('SPY'), aQQQ = above('QQQ');
  const nAbove = (aSPY == null || aQQQ == null) ? null : aSPY + aQQQ;   // 0..2 (SPX leg ~ SPY)
  const isBull = f.state && f.state.startsWith('BULL');
  // live bull gate: BLOCK a BULL fire when the tape is ALL BELOW prior close (nAbove==0)
  const gatePass = (isBull && nAbove === 0) ? false : true;
  return { day: f.day, ticker: f.ticker, state: f.state, isBull, entry, structG,
    eod: steps.at(-1).g, etHour, nAbove, gatePass };
}
const built = [];
for (const f of fires) { const b = build(f); if (b) built.push(b); }
const days = [...new Set(built.map(b => b.day))].sort();
console.log(`built ${built.length} fires / ${days.length} days; gate-evaluable ${built.filter(b => b.nAbove != null).length}`);

const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
function stats(g) {
  const pos = g.filter(x => x > 0);
  const gp = pos.reduce((s, x) => s + x, 0), gl = -g.filter(x => x <= 0).reduce((s, x) => s + x, 0);
  return { n: g.length, win: pos.length / g.length, exp: mean(g), pf: gl > 0 ? gp / gl : Infinity };
}
const pc = x => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;
const f2 = x => (x === Infinity ? ' inf' : x.toFixed(2));
const POL = { STRUCT: b => b.structG, HOLD_EOD: b => b.eod };
const splitIdx = Math.floor(days.length / 2);
const H1 = new Set(days.slice(0, splitIdx)), H2 = new Set(days.slice(splitIdx));

// ================== 2. TIME-OF-DAY CUTOFF ==================
console.log('\n' + '='.repeat(76));
console.log('# TIME-OF-DAY CUTOFF SWEEP (replay). Existing live cutoff = 15:15 ET.');
console.log('  "no new fires after H" — does an EARLIER cutoff help OOS?\n');
for (const [pn, pf] of Object.entries(POL)) {
  const all = built.map(pf), A = stats(all);
  console.log(`-- ${pn}  baseline: n=${A.n} win ${(A.win * 100).toFixed(0)}% exp ${pc(A.exp)} PF ${f2(A.pf)}`);
  console.log('cutoff'.padEnd(11) + 'kept%'.padStart(7) + 'n'.padStart(6) + 'win%'.padStart(7) + 'exp'.padStart(9)
    + 'PF'.padStart(7) + 'Δexp'.padStart(9) + '|' + 'H1Δ'.padStart(8) + 'H2Δ'.padStart(8) + '  WF');
  for (const h of [11, 12, 13, 14, 15]) {
    const sub = built.filter(b => b.etHour < h);
    if (sub.length < 30) continue;
    const s = stats(sub.map(pf));
    const h1 = mean(built.filter(b => H1.has(b.day) && b.etHour < h).map(pf)) - mean(built.filter(b => H1.has(b.day)).map(pf));
    const h2 = mean(built.filter(b => H2.has(b.day) && b.etHour < h).map(pf)) - mean(built.filter(b => H2.has(b.day)).map(pf));
    console.log(`before ${h}:00`.padEnd(11) + `${(100 * sub.length / built.length).toFixed(0)}%`.padStart(7)
      + String(s.n).padStart(6) + (s.win * 100).toFixed(0).padStart(6) + '%' + pc(s.exp).padStart(9) + f2(s.pf).padStart(7)
      + pc(s.exp - A.exp).padStart(9) + '|' + pc(h1).padStart(8) + pc(h2).padStart(8)
      + '  ' + (h1 > 0 && h2 > 0 ? 'YES' : 'no'));
  }
  // hour-by-hour expectancy (compare to the live afternoon collapse)
  console.log('  hourly expectancy:');
  for (let h = 9; h <= 15; h++) {
    const s = built.filter(b => Math.floor(b.etHour) === h);
    if (s.length < 10) continue;
    const st = stats(s.map(pf));
    console.log(`    ${String(h).padStart(2)}:00  n=${String(st.n).padStart(4)}  exp ${pc(st.exp).padStart(7)}  PF ${f2(st.pf)}`);
  }
  console.log('');
}
// permutation MC over the 5 cutoffs
function permMax(pf, cand, key, B = 2000) {
  const g = built.map(pf), v = built.map(key), base = mean(g);
  const obs = Math.max(...cand.map(c => { const s = g.filter((_, i) => v[i] < c); return s.length >= 30 ? mean(s) - base : -Infinity; }));
  let ge = 0;
  for (let b = 0; b < B; b++) {
    const sv = v.slice();
    for (let i = sv.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [sv[i], sv[j]] = [sv[j], sv[i]]; }
    const mx = Math.max(...cand.map(c => { const s = g.filter((_, i) => sv[i] < c); return s.length >= 30 ? mean(s) - base : -Infinity; }));
    if (mx >= obs) ge++;
  }
  return { obs, p: (ge + 1) / (B + 1) };
}
console.log('MC discount over the 5 cutoffs (permutation, B=2000):');
for (const [pn, pf] of Object.entries(POL)) {
  const r = permMax(pf, [11, 12, 13, 14, 15], b => b.etHour);
  console.log(`  ${pn.padEnd(10)} best Δexp ${pc(r.obs).padStart(7)}   FWER p = ${r.p.toFixed(4)}`);
}

// ================== 4. INCREMENTAL OVER THE BULL TAPE GATE ==================
console.log('\n' + '='.repeat(76));
console.log('# INCREMENTAL VALUE OVER THE BULL TAPE GATE (reconstruction)');
const ev = built.filter(b => b.nAbove != null);
console.log(`gate-evaluable fires: ${ev.length}`);
for (const [pn, pf] of Object.entries(POL)) {
  const pre = stats(ev.map(pf));
  const post = stats(ev.filter(b => b.gatePass).map(pf));
  console.log(`\n-- ${pn}`);
  console.log(`  pre-gate : n=${pre.n} win ${(pre.win * 100).toFixed(0)}% exp ${pc(pre.exp)} PF ${f2(pre.pf)}`);
  console.log(`  GATED    : n=${post.n} win ${(post.win * 100).toFixed(0)}% exp ${pc(post.exp)} PF ${f2(post.pf)}   (gate blocks ${pre.n - post.n})`);
  const G = ev.filter(b => b.gatePass);
  const gs = stats(G.map(pf));
  console.log('  now ADD each candidate ON TOP of the gate:');
  console.log('  ' + 'candidate'.padEnd(22) + 'n'.padStart(6) + 'exp'.padStart(9) + 'PF'.padStart(7) + 'Δ vs gate'.padStart(11) + '   H1Δ / H2Δ');
  const CAND = {
    'price >= $3': b => b.entry >= 3,
    'price >= $5': b => b.entry >= 5,
    'before 13:00 ET': b => b.etHour < 13,
    'before 14:00 ET': b => b.etHour < 14,
    'ticker = SPXW': b => b.ticker === 'SPXW',
    'ticker != SPXW': b => b.ticker !== 'SPXW',
  };
  for (const [cn, cf] of Object.entries(CAND)) {
    const s = G.filter(cf); if (s.length < 25) continue;
    const st = stats(s.map(pf));
    const h1 = mean(G.filter(b => H1.has(b.day) && cf(b)).map(pf)) - mean(G.filter(b => H1.has(b.day)).map(pf));
    const h2 = mean(G.filter(b => H2.has(b.day) && cf(b)).map(pf)) - mean(G.filter(b => H2.has(b.day)).map(pf));
    console.log('  ' + cn.padEnd(22) + String(st.n).padStart(6) + pc(st.exp).padStart(9) + f2(st.pf).padStart(7)
      + pc(st.exp - gs.exp).padStart(11) + `    ${pc(h1)} / ${pc(h2)}` + (h1 > 0 && h2 > 0 ? '  WF-YES' : '  WF-no'));
  }
}
