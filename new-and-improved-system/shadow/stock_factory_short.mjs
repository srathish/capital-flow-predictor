#!/usr/bin/env node
// Stock-finding factory, SHORT horizon (shadow/DESIGN_stock_factory.md): 56 features × 4 outcomes (W1/W2/W4/WV), weekly
// cross-sections of the 300 stocks chosen by liquidity as of 2023-10-31; UW greek exposure by strike at each week's last
// close + prices + SEC fundamentals. Build: forward windows end ≤ 2025-06-30; holdout: rebalance ≥ 2025-07-01.
//   node --max-old-space-size=8000 shadow/stock_factory_short.mjs [--smoke]   (runs once; --force only for logged audit fixes)
import fs from 'node:fs';
import path from 'node:path';
import { TAGS } from '../world/facts_collect.mjs';
import { loadW } from '../world/universe_prices.mjs';
import { isTradingDay } from '../world/prices_clean.mjs';
import { sharesAdjusted } from './split_shares.mjs';
import { splitEvents, adjustedBars, factorAt, nearEvent } from './weekly_basis.mjs';

const SH = decodeURIComponent(new URL('.', import.meta.url).pathname), NIS = path.join(SH, '..'), C = path.join(NIS, '.cache'), GW = path.join(C, 'uwgreeks_w');
const OUT = path.join(SH, 'results_stock_factory'), SMOKE = process.argv.includes('--smoke');
if (!SMOKE && !process.argv.includes('--beyond') && !process.argv.includes('--asym') && !process.argv.includes('--picks') && fs.existsSync(path.join(OUT, 'short_summary.md')) && !process.argv.includes('--force')) { console.error('already run'); process.exit(1); }
const REG = JSON.parse(fs.readFileSync(path.join(SH, 'stock_registry.json'), 'utf8')).hypotheses.filter((h) => h.horizon === 'short' && h.feature !== 'S43'); // amendment 2: S43 duplicated S37's ranks
const rd = (f, d = null) => { try { return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d; } catch { return d; } };
const addD = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10), days = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5;
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN), median = (a) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
const sdv = (a) => { if (a.length < 2) return NaN; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const log = (s) => console.error(`${new Date().toISOString().slice(11, 19)} ${s}`);
const TICKERS = JSON.parse(fs.readFileSync(path.join(GW, 'tickers.json'), 'utf8'));
const BUILD_END = '2025-06-30', HOLD_START = '2025-07-01';
const FEATS = [...new Set(REG.map((h) => h.feature))].sort(), FI = new Map(FEATS.map((f, i) => [f, i]));

// ---------- fundamentals for S50 / S51 (point-in-time, earliest-filed per period — same rule as the long engine) ----------
function series(facts, tags) { const q = new Map(), ann = new Map();
  for (const tag of tags) for (const x of facts?.[tag] ?? []) { if (!x.s) continue; const dur = days(x.s, x.e), tgt = dur >= 80 && dur <= 100 ? q : dur >= 350 && dur <= 380 ? ann : null; if (!tgt) continue;
    const cur = tgt.get(x.e); if (cur && cur.f <= x.f) continue; tgt.set(x.e, { v: x.v, f: x.f, s: x.s }); }
  for (const [e, a] of ann) { if ([...q.keys()].some((k) => Math.abs(days(k, e)) <= 5)) continue; const inside = [...q.entries()].filter(([k, x]) => days(a.s, x.s) >= -5 && days(k, e) >= 0); if (inside.length !== 3) continue;
    q.set(e, { v: a.v - inside.reduce((s, [, x]) => s + x.v, 0), f: [a.f, ...inside.map(([, x]) => x.f)].sort().at(-1) }); }
  return [...q].map(([e, x]) => ({ e, v: x.v, f: x.f })).sort((a, b) => a.e.localeCompare(b.e)); }
const FUND = new Map();
for (const t of TICKERS) { const F = rd(path.join(C, 'edgar', 'facts', `${t}.json`)); const sh = sharesAdjusted(C, t)?.series ?? [];
  if (!F?.rev) { FUND.set(t, { Q: [], sh }); continue; }
  const rev = series(F.rev, TAGS.rev), gp = new Map(series(F.gp, TAGS.gp).map((x) => [x.e, x])), cost = new Map(series(F.cost, TAGS.cost).map((x) => [x.e, x]));
  FUND.set(t, { Q: rev.map((r) => { const a = gp.get(r.e), c = cost.get(r.e); let gm = null, fg = r.f; if (a) { gm = a.v / r.v; fg = [r.f, a.f].sort().at(-1); } else if (c) { gm = (r.v - c.v) / r.v; fg = [r.f, c.f].sort().at(-1); } return { e: r.e, rev: r.v, f: r.f, gm, fg }; }), sh }); }
function v5raw(t, d) { const Q = FUND.get(t).Q.filter((x) => x.f <= d), q0 = Q.at(-1); if (!q0 || days(q0.e, d) > 200) return null;
  const near = (ref, lo, hi) => ref && Q.filter((x) => { const k = days(x.e, ref.e); return k >= lo && k <= hi; }).at(-1);
  const q1 = near(q0, 80, 100), q4 = near(q0, 345, 385), q5 = near(q1, 345, 385); if (!(q4?.rev > 0) || !(q5?.rev > 0)) return null;
  const g0 = q0.rev / q4.rev - 1, accel = g0 - (q1.rev / q5.rev - 1), dGM = q0.gm != null && q4.gm != null && q0.fg <= d && q4.fg <= d ? q0.gm - q4.gm : NaN; return { g0, accel, dGM }; }

// ---------- greek snapshot summary (strikes [k, cg, pg, cd, pd, cc, pc, cv, pv], raw strikes, S = raw price) ----------
function summarize(s, S) {
  if (!s?.length || s.filter((r) => Math.abs(r[0] / S - 1) <= 0.08).length < 5) return null;
  const k = s.map((r) => r[0]), g = s.map((r) => r[1] + r[2]), v = s.map((r) => r[7] + r[8]), ch = s.map((r) => r[5] + r[6]), dl = s.map((r) => r[3] + r[4]);
  const sum = (a, f = () => true) => a.reduce((q, x, i) => q + (f(i) ? x : 0), 0), asum = (a, f = () => true) => a.reduce((q, x, i) => q + (f(i) ? Math.abs(x) : 0), 0);
  const bal = (a, f) => { const A = asum(a, f); return A > 0 ? sum(a, f) / A : NaN; }, win = (p) => (i) => Math.abs(k[i] / S - 1) <= p;
  const G = asum(g); if (!(G > 0)) return null;
  let iK = 0; g.forEach((x, i) => { if (Math.abs(x) > Math.abs(g[iK])) iK = i; });
  const strong = k.filter((_, i) => Math.abs(g[i]) >= 0.5 * Math.abs(g[iK])), up = strong.filter((x) => x > S), dn = strong.filter((x) => x < S);
  let iP = -1; g.forEach((x, i) => { if (x > 0 && (iP < 0 || x > g[iP])) iP = i; }); let iV = 0; v.forEach((x, i) => { if (Math.abs(x) > Math.abs(v[iV])) iV = i; });
  const cg = sum(s.map((r) => r[1])), pg = sum(s.map((r) => r[2])), cd = sum(s.map((r) => r[3])), pd = sum(s.map((r) => r[4])), Va = asum(v), Ds = asum(dl);
  return { netG: sum(g), absG: G, netV: sum(v), absD: Ds, cd, pd, cg, pg, Kr: k[iK] / S, gK: g[iK],
    S01: sum(g) / G, S02: bal(g, win(0.02)), S03: bal(g, win(0.05)), S04: +(sum(g) < 0), S05: asum(g, (i) => k[i] < S) / G,
    S06: k[iK] / S - 1, S07: Math.abs(k[iK] / S - 1), S08: +(g[iK] > 0), S09: Math.abs(g[iK]) / G, S10: up.length ? Math.min(...up) / S - 1 : 0.3, S11: dn.length ? 1 - Math.max(...dn) / S : 0.3,
    S12: iP >= 0 ? k[iP] / S - 1 : NaN, S13: cg + Math.abs(pg) > 0 ? cg / (cg + Math.abs(pg)) : NaN,
    S17: Va > 0 ? sum(v) / Va : NaN, S18: bal(v, win(0.02)), S19: Va > 0 ? (sum(v, (i) => k[i] > S) - sum(v, (i) => k[i] < S)) / Va : NaN, S20: k[iV] / S - 1,
    S21: bal(ch, () => true), S22: bal(ch, win(0.02)), S23: Ds > 0 ? sum(dl) / Ds : NaN, S24: Math.abs(pd) > 0 ? cd / Math.abs(pd) : NaN, S25: bal(dl, win(0.02)), S49: +(k[iV] > S) };
}

// ---------- per-ticker weekly rows ----------
const RAW = new Map(); // t → { weeks: [{d, sum}], bars, bi }
let nT = 0;
const MEDV = (a) => { const z = [...a].sort((x, y) => x - y); return z[z.length >> 1]; };
for (const t of TICKERS) { const f = path.join(GW, `${t}.jsonl`); if (!fs.existsSync(f)) continue;
  const raw = loadW(t).filter((b) => isTradingDay(b.d) && b.c > 0), rawC = new Map(raw.map((b) => [b.d, b.c]));
  const snaps = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).sort((a, b) => a.d.localeCompare(b.d));
  // amendment 2: confirmed split events (price breaks checked against the option chain, SEC restatements) → continuous prices
  const { ev, unexplained } = splitEvents(C, t, raw, snaps.map((x) => ({ d: x.d, ratio: x.ratio })));
  const bars = adjustedBars(raw, ev);
  for (const e of ev.filter((x) => x.kind === 'sec')) { const pre = bars.filter((b) => b.d < e.after).slice(-60).map((b) => b.v), post = bars.filter((b) => b.d > e.at).slice(0, 60).map((b) => b.v); // volume basis (AVGO's is raw)
    if (pre.length > 20 && post.length > 20) { const r = MEDV(post) / MEDV(pre); if (Math.abs(Math.log(r / e.q)) < Math.abs(Math.log(r))) for (const b of bars) if (b.d < e.at && (factorAt(ev, b.d) ?? e.q) !== 1) b.v *= e.q; } }
  const bi = new Map(bars.map((b, i) => [b.d, i])), weeks = [];
  for (const x of snaps) { const j = bi.get(x.d); if (j == null) continue;
    const ratioAdj = x.ratio == null ? null : x.ratio * rawC.get(x.d) / bars[j].c, fct = nearEvent(ev, x.d) ? null : factorAt(ev, x.d, ratioAdj);
    let sm = null; if (fct != null && x.s.length) { const s = fct === 1 ? x.s : x.s.map((r) => [r[0], r[1] * fct * fct, r[2] * fct * fct, r[3] * fct, r[4] * fct, r[5] * fct, r[6] * fct, r[7] * fct, r[8] * fct]); sm = summarize(s, bars[j].c * fct); }
    weeks.push({ d: x.d, j, sum: sm, raw: fct != null ? bars[j].c * fct : null, strikes: fct != null && x.s.length ? x.s.map((r) => r[0]) : null }); }
  RAW.set(t, { weeks, bars, bi, unexplained }); if (++nT >= (SMOKE ? 1e9 : 1e9)) break; }
log(`${RAW.size} tickers with weekly greeks`);
const WEEKS = [...new Set([...RAW.values()].flatMap((r) => r.weeks.map((w) => w.d)))].sort();
const DATA_END = [...RAW.values()].reduce((m, r) => (r.bars.at(-1).d > m ? r.bars.at(-1).d : m), '');

// ---------- panel ----------
const H = { W1: 1, W2: 2, W4: 4, WV: 4 };
const PANEL = [];
for (let wi = 0; wi < WEEKS.length; wi++) { const d = WEEKS[wi], R = new Map(), raw4 = [];
  for (const [t, X] of RAW) { const k = X.weeks.findIndex((w) => w.d === d); if (k < 0) continue; const w = X.weeks[k], s0 = w.sum; if (!s0) continue; const { bars } = X, j = w.j, c = bars.map((b) => b.c);
    if (j < 252 || X.unexplained.some((u) => u > bars[j - 252].d && u <= d)) continue; // amendment 2: lookback crosses an unexplained price break
    const f = new Float64Array(FEATS.length).fill(NaN), set = (key, v) => { if (FI.has(key)) f[FI.get(key)] = Number.isFinite(v) ? v : NaN; };
    for (const key of Object.keys(s0)) if (/^S\d\d$/.test(key)) set(key, s0[key]);
    const prevW = (n) => { const p = X.weeks[k - n]; return p && p.sum && days(p.d, d) <= 7 * n + 4 ? p : null; };
    const p1 = prevW(1), p4 = prevW(4);
    const hist8 = X.weeks.slice(Math.max(0, k - 8), k).filter((x) => x.sum).map((x) => x.sum.absG); set('S14', hist8.length >= 6 ? s0.absG / mean(hist8) : NaN);
    let dv20 = 0; for (let q = j - 19; q <= j; q++) dv20 += bars[q].c * bars[q].v; dv20 /= 20; set('S15', dv20 > 0 ? (s0.netG * c[j] * c[j] * 0.01) / dv20 : NaN); /* amendment 2: $ gamma per 1% move */
    const h12 = X.weeks.slice(Math.max(0, k - 12), k).filter((x) => x.sum && Number.isFinite(x.sum.S02)).map((x) => x.sum.S02); set('S16', h12.length >= 8 && sdv(h12) > 0 ? (s0.S02 - mean(h12)) / sdv(h12) : NaN);
    if (p1) { const a = p1.sum; set('S26', s0.S23 - a.S23); set('S27', a.cd > 0 && s0.cd > 0 ? Math.log(s0.cd / a.cd) : NaN); set('S28', Math.abs(a.pd) > 0 && Math.abs(s0.pd) > 0 ? Math.log(Math.abs(s0.pd) / Math.abs(a.pd)) : NaN);
      set('S29', s0.S01 - a.S01); set('S30', s0.S02 - a.S02); set('S31', s0.Kr - a.Kr * (c[p1.j] / c[j])); set('S32', Math.log(s0.absG / a.absG)); set('S33', s0.S17 - a.S17); set('S34', a.absD > 0 ? Math.log(s0.absD / a.absD) : NaN);
      set('S52', a.cg > 0 && s0.cg > 0 && Math.abs(a.pg) > 0 ? Math.log((Math.abs(s0.pg) / s0.cg) / (Math.abs(a.pg) / a.cg)) : NaN); }
    if (p4 && p4.sum.cd > 0 && s0.cd > 0) set('S35', Math.log(s0.cd / p4.sum.cd));
    // price features (bars ≤ d)
    const wkAgo = X.weeks[k - 1]?.j ?? j - 5; let hi = 0, ma20 = 0, ma50 = 0, mx = -Infinity; const lr = [];
    for (let q = j - 251; q <= j; q++) hi = Math.max(hi, c[q]); for (let q = j - 19; q <= j; q++) { ma20 += c[q] / 20; lr.push(Math.log(c[q] / c[q - 1])); mx = Math.max(mx, c[q] / c[q - 1] - 1); } for (let q = j - 49; q <= j; q++) ma50 += c[q] / 50;
    set('S36', c[j] / c[wkAgo] - 1); set('S37', c[j] / c[j - 20] - 1); set('S38', c[j] / c[j - 60] - 1); set('S39', c[j] / ma20 - 1); set('S41', sdv(lr) * Math.sqrt(252)); set('S42', c[j] / hi); set('S44', mx);
    { let a = 0, b = 0; for (let q = j - 4; q <= j; q++) a += bars[q].c * bars[q].v; for (let q = j - 59; q <= j; q++) b += bars[q].c * bars[q].v; set('S40', (a / 5) / (b / 60)); }
    set('S46', +(s0.S04 === 1 && c[j] < ma50)); set('S47', +(s0.Kr > 1 && s0.gK > 0)); set('S48', +(s0.Kr < 1 && s0.gK > 0));
    // size-normalized options (split-adjusted shares filed ≤ d × adjusted price)
    let shr = null; for (const x of FUND.get(t).sh) { if (x.d <= d) shr = x; else break; } const mcap = shr && days(shr.d, d) <= 400 ? shr.v * c[j] : NaN;
    set('S53', (s0.absD * c[j]) / mcap); set('S54', (s0.netG * c[j] * c[j] * 0.01) / mcap); set('S55', (s0.netV * c[j]) / mcap); set('S56', (s0.cd * c[j]) / mcap); /* amendment 2: dollar units */
    const v5 = v5raw(t, d); set('S51', v5?.accel);
    // outcomes: entry = close of the first trading day after d, exit = close on the rebalance date h weeks later
    const o = {}; for (const [name, h] of Object.entries(H)) { const ed = WEEKS[wi + h]; if (!ed || ed > DATA_END) { o[name] = NaN; continue; } const e = X.bi.get(ed); o[name] = e != null && e > j + 1 ? c[e] / c[j + 1] - 1 : NaN; }
    R.set(t, { f, o, v5, delta: s0.S23, ma50up: c[j] > ma50, r4: c[j] / c[j - 20] - 1, sic2: null }); if (Number.isFinite(o.W4)) raw4.push(o.W4); }
  if (R.size < 30) continue;
  // cross-sectional pieces: S43 (4-week return vs the cross-section), S45 (delta above median & uptrend), S50 (v5 score rank)
  const mu4 = mean([...R.values()].map((x) => x.r4)), dMed = median([...R.values()].map((x) => x.delta));
  const ok = [...R].filter(([, x]) => x.v5 && Number.isFinite(x.v5.dGM)), pr = (vals) => { const s = vals.sort((a, b) => a - b); return (v) => { let lo = 0, hi = s.length; while (lo < hi) { const m = (lo + hi) >> 1; if (s[m] < v) lo = m + 1; else hi = m; } return lo / Math.max(1, s.length - 1); }; };
  const rg = pr(ok.map(([, x]) => x.v5.g0)), ra = pr(ok.map(([, x]) => x.v5.accel)), rm = pr(ok.map(([, x]) => x.v5.dGM));
  for (const [t, x] of R) { const F = (key, v) => { if (FI.has(key)) x.f[FI.get(key)] = Number.isFinite(v) ? v : NaN; };
    F('S43', x.r4 - mu4); F('S45', Number.isFinite(x.delta) && Number.isFinite(dMed) ? +(x.delta > dMed && x.ma50up) : NaN); F('S50', x.v5 && Number.isFinite(x.v5.dGM) ? (rg(x.v5.g0) + ra(x.v5.accel) + rm(x.v5.dGM)) / 3 : NaN); }
  // excess outcomes and the big-mover flag
  const fwd = {}; for (const name of ['W1', 'W2', 'W4']) { const v = [...R].filter(([, x]) => Number.isFinite(x.o[name])), m = mean(v.map(([, x]) => x.o[name])); fwd[name] = v.length >= 30 ? new Map(v.map(([t, x]) => [t, x.o[name] - m])) : null; }
  if (raw4.length >= 30) { const s = [...raw4].sort((a, b) => a - b), cut = s[Math.floor(0.9 * (s.length - 1))]; fwd.WV = new Map([...R].filter(([, x]) => Number.isFinite(x.o.W4)).map(([t, x]) => [t, x.o.W4 >= cut ? 1 : 0])); } else fwd.WV = null;
  PANEL.push({ M: d, wi, R, fwd }); }
log(`${PANEL.length} weekly cross-sections, median ${median(PANEL.map((p) => p.R.size))} stocks`);
if (SMOKE) { const m = PANEL.at(-30); console.log(JSON.stringify({ weeks: PANEL.length, stocks: PANEL.map((p) => p.R.size).filter((_, i) => i % 20 === 0), coverage: Object.fromEntries(FEATS.map((k) => [k, +([...m.R.values()].filter((x) => Number.isFinite(x.f[FI.get(k)])).length / m.R.size).toFixed(2)])), fwd: Object.fromEntries(Object.entries(m.fwd).map(([k, v]) => [k, v ? v.size : null])) })); process.exit(0); }


if (process.argv.includes('--picks')) { // ideas200 part B: weekly top-10 per signal + 10 random controls (features known at each close)
  const SIGS = { S17: ['S17', 1], S55: ['S55', 1], S19neg: ['S19', -1], S41: ['S41', 1], S53: ['S53', 1], S44: ['S44', 1], S07: ['S07', 1], S20: ['S20', 1], S50: ['S50', 1], S42neg: ['S42', -1], S14: ['S14', 1], S40: ['S40', 1] };
  let seed = 7; const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  const out = [];
  for (const m of PANEL) { const info = (t) => { const X = RAW.get(t), w = X.weeks.find((q) => q.d === m.M); return w?.raw && w.strikes ? { raw: w.raw, strikes: w.strikes } : null; };
    const pool = [...m.R.keys()].filter((t) => info(t)), picks = new Map(), add = (t, tag) => { if (!picks.has(t)) picks.set(t, { t, ...info(t), tags: [] }); picks.get(t).tags.push(tag); };
    for (const [name, [fk, dir]] of Object.entries(SIGS)) pool.filter((t) => Number.isFinite(m.R.get(t).f[FI.get(fk)])).sort((a, b) => dir * (m.R.get(b).f[FI.get(fk)] - m.R.get(a).f[FI.get(fk)])).slice(0, 10).forEach((t) => add(t, name));
    const w1 = (t) => m.R.get(t).f[FI.get('S36')];
    pool.filter((t) => w1(t) > 0.10).sort((a, b) => w1(b) - w1(a)).slice(0, 10).forEach((t) => add(t, 'S36up'));
    pool.filter((t) => w1(t) < -0.10).sort((a, b) => w1(a) - w1(b)).slice(0, 10).forEach((t) => add(t, 'S36dn'));
    const rk = (fk) => { const v = pool.map((t) => [t, m.R.get(t).f[FI.get(fk)]]).filter(([, x]) => Number.isFinite(x)).sort((a, b) => a[1] - b[1]); return new Map(v.map(([t], i) => [t, i / Math.max(1, v.length - 1)])); };
    const r1 = rk('S17'), r2 = rk('S41'), r3 = rk('S53'); pool.filter((t) => r1.has(t) && r2.has(t) && r3.has(t)).sort((a, b) => (r1.get(b) + r2.get(b) + r3.get(b)) - (r1.get(a) + r2.get(a) + r3.get(a))).slice(0, 10).forEach((t) => add(t, 'COMBO'));
    const ctl = [...pool]; for (let i = ctl.length - 1; i > 0; i--) { const k = Math.floor(rnd() * (i + 1)); [ctl[i], ctl[k]] = [ctl[k], ctl[i]]; } ctl.slice(0, 10).forEach((t) => add(t, 'CONTROL'));
    out.push({ d: m.M, picks: [...picks.values()] }); }
  fs.mkdirSync(path.join(C, 'bigmover'), { recursive: true }); fs.writeFileSync(path.join(C, 'bigmover', 'picks.json'), JSON.stringify(out));
  console.log(`weeks ${out.length}, stock-weeks ${out.reduce((s, w) => s + w.picks.length, 0)}`); process.exit(0); }
if (process.argv.includes('--asym')) { // exploratory (not pre-registered): vanna vs top-10% and bottom-10% 4-week returns, by fifth of the feature
  for (const fk of ['S17', 'S55', 'S19', 'S41']) { for (const [name, set] of [['build', (m) => WEEKS[m.wi + 4] && WEEKS[m.wi + 4] <= BUILD_END], ['holdout', (m) => m.M >= HOLD_START]]) {
    const q = [0, 1, 2, 3, 4].map(() => ({ up: 0, dn: 0, n: 0, r: [] }));
    for (const m of PANEL) { if (!set(m)) continue; const v = [...m.R].filter(([, x]) => Number.isFinite(x.o.W4) && Number.isFinite(x.f[FI.get(fk)])); if (v.length < 50) continue;
      const rs = v.map(([, x]) => x.o.W4).sort((a, b) => a - b), hi = rs[Math.floor(0.9 * (rs.length - 1))], lo = rs[Math.floor(0.1 * (rs.length - 1))], mu = mean(rs);
      const ord = v.sort((a, b) => a[1].f[FI.get(fk)] - b[1].f[FI.get(fk)]); ord.forEach(([, x], k) => { const b = Math.min(4, Math.floor((5 * k) / ord.length)); q[b].n++; if (x.o.W4 >= hi) q[b].up++; if (x.o.W4 <= lo) q[b].dn++; q[b].r.push(x.o.W4 - mu); }); }
    console.log(`${fk} ${name}: ` + q.map((b, k) => `Q${k + 1} up ${(100 * b.up / b.n).toFixed(1)}% / down ${(100 * b.dn / b.n).toFixed(1)}% / excess ${(100 * mean(b.r)).toFixed(2)}%`).join(' | ')); } }
  process.exit(0); }
if (process.argv.includes('--beyond')) { // exploratory (not pre-registered): S17 beyond S41 + S44 + S53, holdout weeks
  const rankArr = (a) => { const o = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]), r = new Array(a.length); for (let i = 0; i < o.length;) { let k = i; while (k + 1 < o.length && o[k + 1][0] === o[i][0]) k++; for (let q = i; q <= k; q++) r[o[q][1]] = (i + k) / 2; i = k + 1; } return r; };
  const solveL = (A, b) => { const n = A.length, M = A.map((r, i) => [...r, b[i]]); for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; [M[c], M[p]] = [M[p], M[c]]; for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; } } return M.map((r, i) => r[n] / r[i]); };
  const nwT = (s, lag) => { const n = s.length, m = mean(s), e = s.map((x) => x - m); let v = e.reduce((q, x) => q + x * x, 0) / n; for (let L = 1; L <= lag; L++) { let g = 0; for (let t = L; t < n; t++) g += e[t] * e[t - L]; v += 2 * (1 - L / (lag + 1)) * g / n; } return m / Math.sqrt(v / n); };
  for (const [name, set] of [['build', (m) => WEEKS[m.wi + 4] && WEEKS[m.wi + 4] <= BUILD_END], ['holdout', (m) => m.M >= HOLD_START]]) { const coef = [];
    for (const m of PANEL) { if (!m.fwd.WV || !set(m)) continue; const rows = []; for (const [t, y] of m.fwd.WV) { const x = m.R.get(t); const v = ['S17', 'S41', 'S44', 'S53'].map((k) => x.f[FI.get(k)]); if (v.every(Number.isFinite)) rows.push([...v, y]); }
      if (rows.length < 50) continue; const cols = [0, 1, 2, 3, 4].map((k) => rankArr(rows.map((r) => r[k]))), n = rows.length, X = rows.map((_, i) => [1, cols[0][i], cols[1][i], cols[2][i], cols[3][i]]), Y = cols[4];
      const XtX = [0, 1, 2, 3, 4].map((a) => [0, 1, 2, 3, 4].map((b) => X.reduce((s, r) => s + r[a] * r[b], 0))), Xty = [0, 1, 2, 3, 4].map((a) => X.reduce((s, r, i) => s + r[a] * Y[i], 0)); coef.push(solveL(XtX, Xty)[1] / n); }
    console.log(`${name}: S17 vanna balance beyond vol + lottery + options footprint — mean coef ${mean(coef).toExponential(2)}, NW t ${nwT(coef, 4).toFixed(2)} over ${coef.length} weeks`); }
  process.exit(0); }
// ---------- statistics (same as the long engine, audited 2026-10-09) ----------
const rankArr = (a) => { const o = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]), r = new Array(a.length); for (let i = 0; i < o.length;) { let k = i; while (k + 1 < o.length && o[k + 1][0] === o[i][0]) k++; const avg = (i + k) / 2; for (let q = i; q <= k; q++) r[o[q][1]] = avg; i = k + 1; } return r; };
const corr = (x, y) => { const mx = mean(x), my = mean(y); let a = 0, b = 0, c = 0; for (let i = 0; i < x.length; i++) { a += (x[i] - mx) * (y[i] - my); b += (x[i] - mx) ** 2; c += (y[i] - my) ** 2; } return b > 0 && c > 0 ? a / Math.sqrt(b * c) : NaN; };
const nwT = (s, lag) => { const n = s.length; if (n < 12) return NaN; const m = mean(s), e = s.map((x) => x - m); let v = e.reduce((q, x) => q + x * x, 0) / n; for (let L = 1; L <= lag; L++) { let g = 0; for (let t = L; t < n; t++) g += e[t] * e[t - L]; v += 2 * (1 - L / (lag + 1)) * g / n; } return m / Math.sqrt(v / n); };
const Phi = (x) => { const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp(-x * x / 2), p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; };
const pval = (t, sign) => (!Number.isFinite(t) ? 1 : sign === '+' ? 1 - Phi(t) : sign === '-' ? Phi(t) : 2 * (1 - Phi(Math.abs(t))));
const bh = (ps, q) => { const o = ps.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0]); let kmax = -1; o.forEach(([p], r) => { if (p <= ((r + 1) / o.length) * q) kmax = r; }); const keep = new Set(o.slice(0, kmax + 1).map(([, i]) => i)); return ps.map((_, i) => keep.has(i)); };
const endOf = (m, o) => WEEKS[m.wi + H[o]] ?? '9999';
const inBuild = (m, o) => m.fwd[o] && endOf(m, o) <= BUILD_END, inHold = (m, o) => m.fwd[o] && m.M >= HOLD_START;
function icSeries(fk, o, sel, { perm = null, half = null } = {}) { const fi = FI.get(fk), out = [], q5 = [];
  for (const m of PANEL) { if (!sel(m, o)) continue; const xs = [], ys = [];
    for (const [t, y] of m.fwd[o]) { const src = perm ? m.R.get(perm.get(t)) : m.R.get(t); if (!src) continue; const v = src.f[fi]; if (!Number.isFinite(v)) continue; xs.push(v); ys.push(y); }
    if (xs.length < 30) continue; let X = rankArr(xs), Y = rankArr(ys);
    const icv = corr(X, Y); if (!Number.isFinite(icv)) continue; out.push(icv);
    if (!perm) { const ord = xs.map((v, i) => [v, ys[i]]).sort((a, b) => a[0] - b[0]), n5 = Math.floor(ord.length / 5); q5.push(mean(ord.slice(-n5).map((z) => z[1])) - mean(ord.slice(0, n5).map((z) => z[1]))); } }
  return { ic: out, q5 }; }
const LAG = { W1: 1, W2: 2, W4: 4, WV: 4 };
const S1 = REG.map((h) => { const { ic } = icSeries(h.feature, h.outcome, inBuild); const t = nwT(ic, LAG[h.outcome]); return { ...h, ic1: mean(ic), t1: t, n1: ic.length, p1: pval(t, h.sign) }; });
const k1 = bh(S1.map((h) => h.p1), 0.10); S1.forEach((h, i) => { h.stage1 = k1[i]; }); const surv = S1.filter((h) => h.stage1); log(`stage 1: ${surv.length} of ${S1.length}`);
for (const h of surv) { const { ic, q5 } = icSeries(h.feature, h.outcome, inHold); h.ic2 = mean(ic); h.t2 = nwT(ic, LAG[h.outcome]); h.n2 = ic.length; h.p2 = pval(h.t2, h.ic1 > 0 ? '+' : '-'); h.q5 = mean(q5); }
const k2 = bh(surv.map((h) => h.p2), 0.10); surv.forEach((h, i) => { h.passBH = k2[i] && Math.sign(h.ic2) === Math.sign(h.ic1); });
let sd = 4242; const rnd = () => ((sd = (sd * 1103515245 + 12345) % 2147483648) / 2147483648);
const TK = [...RAW.keys()].sort(), PERMS = Array.from({ length: 20 }, () => { const a = [...TK]; for (let i = a.length - 1; i > 0; i--) { const k = Math.floor(rnd() * (i + 1)); [a[i], a[k]] = [a[k], a[i]]; } return new Map(TK.map((t, i) => [t, a[i]])); });
for (const h of surv.filter((x) => x.passBH)) { const s = Math.sign(h.ic1), real = s * h.t2, pl = PERMS.map((pm) => s * nwT(icSeries(h.feature, h.outcome, inHold, { perm: pm }).ic, LAG[h.outcome])).filter(Number.isFinite);
  h.placeboBeat = pl.filter((x) => real > x).length; h.placeboN = pl.length; h.placeboMax = Math.max(...pl); }
surv.forEach((h) => { h.validated = !!h.passBH && h.placeboBeat >= 19 && h.placeboN === 20; });
const val = surv.filter((h) => h.validated), fx = (x, d = 3) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(d) : '—'), byO = (o) => S1.filter((h) => h.outcome === o);
const L = ['# Stock-finding factory — SHORT horizon results', `\nRun ${new Date().toISOString()} · design shadow/DESIGN_stock_factory.md · ${S1.length} studies · ${PANEL.length} weeks · ${RAW.size} stocks (chosen by liquidity as of 2023-10-31)\n`,
  `**Build (windows end ≤ ${BUILD_END}), BH q = 0.10: ${surv.length} of ${S1.length} pass. Holdout (from ${HOLD_START}), BH across survivors, same sign, beat ≥ 19/20 own placebos: ${val.length} validated.**\n`,
  '| outcome | studies | pass build | validated |', '|---|---|---|---|', ...['W1', 'W2', 'W4', 'WV'].map((o) => `| ${o} | ${byO(o).length} | ${byO(o).filter((h) => h.stage1).length} | ${byO(o).filter((h) => h.validated).length} |`),
  '\n## Validated studies\n', '| study | feature | outcome | predicted | build IC (t) | holdout IC (t) | top − bottom fifth (holdout) | own placebos beaten | mechanism |', '|---|---|---|---|---|---|---|---|---|',
  ...val.sort((a, b) => a.outcome.localeCompare(b.outcome) || Math.abs(b.t2) - Math.abs(a.t2)).map((h) => `| ${h.id}${h.seen ? ' (seen)' : ''} | ${h.definition} | ${h.outcome} | ${h.sign} | ${fx(h.ic1)} (${fx(h.t1, 2)}) | **${fx(h.ic2)} (${fx(h.t2, 2)})** | ${h.outcome === 'WV' ? fx(h.q5 * 100, 1) + ' pts' : fx(h.q5 * 100, 2) + '%'} | ${h.placeboBeat}/${h.placeboN} | ${h.mechanism} |`),
  '\n## Passed the holdout test but not their own placebo\n', '| study | holdout t | placebos beaten |', '|---|---|---|', ...surv.filter((h) => h.passBH && !h.validated).map((h) => `| ${h.id} ${h.definition} | ${fx(h.t2, 2)} | ${h.placeboBeat}/${h.placeboN} |`),
  '\n## Passed build, failed holdout\n', '| study | build IC (t) | holdout IC (t) |', '|---|---|---|', ...surv.filter((h) => !h.passBH).map((h) => `| ${h.id} ${h.definition} | ${fx(h.ic1)} (${fx(h.t1, 2)}) | ${fx(h.ic2)} (${fx(h.t2, 2)}) |`)];
fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, 'short_all.json'), JSON.stringify(S1, null, 1)); fs.writeFileSync(path.join(OUT, 'short_summary.md'), L.join('\n') + '\n'); console.log(L.join('\n'));
