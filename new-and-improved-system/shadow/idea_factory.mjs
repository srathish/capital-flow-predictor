#!/usr/bin/env node
// Idea factory engine (shadow/DESIGN_idea_factory.md): tests every hypothesis in idea_registry.json.
// Stage 1 = build period with Benjamini–Hochberg q = 0.10; stage 2 = untouched holdout on the stage-1 survivors.
//   node shadow/idea_factory.mjs [--smoke]      (runs once; --force only for logged audit fixes)
import fs from 'node:fs';
import path from 'node:path';
import { isTradingDay } from '../world/prices_clean.mjs';

const SH = decodeURIComponent(new URL('.', import.meta.url).pathname), NIS = path.join(SH, '..'), C = path.join(NIS, '.cache', 'uwgreeks');
const OUT = path.join(SH, 'results_idea_factory'), SMOKE = process.argv.includes('--smoke');
const PLACEBO = +(process.argv.find((a) => a.startsWith('--placebo='))?.split('=')[1] ?? 0) > 0;
if (!SMOKE && !PLACEBO && fs.existsSync(path.join(OUT, 'summary.md')) && !process.argv.includes('--force')) { console.error('already run'); process.exit(1); }
const REG = JSON.parse(fs.readFileSync(path.join(SH, 'idea_registry.json'), 'utf8')).hypotheses;
const TICKERS = ['SPY', 'QQQ', 'IWM', 'DIA', 'SMH', 'XLK', 'XLF', 'XLE', 'XLV', 'XLY', 'XLI', 'XLP', 'XLU', 'GLD', 'TLT', 'AAPL', 'MSFT', 'NVDA', 'AMZN', 'META', 'GOOGL', 'TSLA', 'AMD', 'AVGO', 'JPM'];
const INDEX = new Set(['SPY', 'QQQ', 'IWM', 'DIA']), BUILD_END = '2025-06-30', HOLD_START = '2025-07-01';
const SPLITS = JSON.parse(fs.readFileSync(path.join(C, 'splits.json'), 'utf8'));
const VIX = JSON.parse(fs.readFileSync(path.join(NIS, '.cache', 'vix_cboe.json'), 'utf8'));
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length, sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const addD = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);

// ---- calendar features (known in advance) ----
const thirdFriday = (y, m) => { const d = new Date(Date.UTC(y, m, 1)); const off = (5 - d.getUTCDay() + 7) % 7; return new Date(Date.UTC(y, m, 1 + off + 14)).toISOString().slice(0, 10); };
const opexDay = (d) => { let t = thirdFriday(+d.slice(0, 4), +d.slice(5, 7) - 1); while (!isTradingDay(t)) t = addD(t, -1); return t; };
const prevTD = (d) => { let t = addD(d, -1); while (!isTradingDay(t)) t = addD(t, -1); return t; }, nextTD = (d) => { let t = addD(d, 1); while (!isTradingDay(t)) t = addD(t, 1); return t; };
function calendar(d) { const w = new Date(d + 'T12:00:00Z').getUTCDay(), ox = opexDay(d), oxPrevMonth = opexDay(addD(d.slice(0, 8) + '01', -1));
  const wkStart = addD(ox, -((new Date(ox + 'T12:00:00Z').getUTCDay() + 6) % 7)), nwd = (() => { let t = addD(d, 1); while ([0, 6].includes(new Date(t + 'T12:00:00Z').getUTCDay())) t = addD(t, 1); return t; })();
  return { N11: +(w === 1), N12: +(w === 5), N13: +(d === ox), N14: +(d === nextTD(ox) || d === nextTD(oxPrevMonth)), N15: +(d >= wkStart && d <= ox),
    N16: +(nextTD(d).slice(0, 7) !== d.slice(0, 7)), N17: +(prevTD(d).slice(0, 7) !== d.slice(0, 7)), N18: +!isTradingDay(nwd) }; }

// ---- per-day greek summary (strikes: [k, cg, pg, cd, pd, cc, pc, cv, pv]) ----
function summarize(s, S) { // S = RAW price (adjusted close × split factor); strikes are raw
  if (!s?.length) return null;
  if (s.filter((r) => Math.abs(r[0] / S - 1) <= 0.08).length < 5) return null; // amendment 2 guard (was ±3%; strike spacing dropped good days)
  const g = s.map((r) => r[1] + r[2]), v = s.map((r) => r[7] + r[8]), ch = s.map((r) => r[5] + r[6]), dl = s.map((r) => r[3] + r[4]), k = s.map((r) => r[0]);
  const sum = (a, f = () => true) => a.reduce((q, x, i) => q + (f(i) ? x : 0), 0), asum = (a, f = () => true) => a.reduce((q, x, i) => q + (f(i) ? Math.abs(x) : 0), 0);
  const bal = (a, f) => { const A = asum(a, f); return A > 0 ? sum(a, f) / A : NaN; }, win = (p) => (i) => Math.abs(k[i] / S - 1) <= p;
  const G = asum(g); if (!(G > 0)) return null;
  let iK = 0; g.forEach((x, i) => { if (Math.abs(x) > Math.abs(g[iK])) iK = i; }); const K = k[iK];
  const strong = k.filter((_, i) => Math.abs(g[i]) >= 0.5 * Math.abs(g[iK]));
  const up = strong.filter((x) => x > S), dn = strong.filter((x) => x < S);
  let iP = -1, iN = -1; g.forEach((x, i) => { if (x > 0 && (iP < 0 || x > g[iP])) iP = i; if (x < 0 && (iN < 0 || x < g[iN])) iN = i; });
  let iV = 0; v.forEach((x, i) => { if (Math.abs(x) > Math.abs(v[iV])) iV = i; });
  const cg = sum(s.map((r) => r[1])), pg = sum(s.map((r) => r[2])), cd = sum(s.map((r) => r[3])), pd = sum(s.map((r) => r[4]));
  const Va = asum(v), Ds = asum(dl);
  return { S, K, Kr: K / S, gK: g[iK], netG: sum(g), absG: G,
    G01: sum(g) / G, G02: bal(g, win(0.01)), G03: bal(g, win(0.02)), G04: bal(g, win(0.05)), G05: +(sum(g) < 0),
    G06: asum(g, (i) => k[i] < S) / G, G07: bal(g, (i) => k[i] < S), G08: bal(g, (i) => k[i] > S),
    G09: (K - S) / S, G10: Math.abs(K - S) / S, G11: +(g[iK] > 0), G12: Math.abs(g[iK]) / G, G13: g.reduce((q, x) => q + (Math.abs(x) / G) ** 2, 0),
    G14: up.length ? (Math.min(...up) - S) / S : 0.3, G15: dn.length ? (S - Math.max(...dn)) / S : 0.3,
    G17: iP >= 0 ? (k[iP] - S) / S : NaN, G18: iN >= 0 ? (k[iN] - S) / S : NaN, G19: cg + Math.abs(pg) > 0 ? cg / (cg + Math.abs(pg)) : NaN,
    V01: Va > 0 ? sum(v) / Va : NaN, V02: bal(v, win(0.02)), V03: Va > 0 ? (sum(v, (i) => k[i] > S) - sum(v, (i) => k[i] < S)) / Va : NaN, V04: (k[iV] - S) / S, V05: +(sum(v) > 0),
    C01: bal(ch, () => true), C02: bal(ch, win(0.02)), C03: Ds > 0 ? sum(ch) / Ds : NaN,
    D01: Ds > 0 ? sum(dl) / Ds : NaN, D02: Math.abs(pd) > 0 ? cd / Math.abs(pd) : NaN, D03: bal(dl, win(0.02)) };
}

// ---- build the panel ----
const spyBars = JSON.parse(fs.readFileSync(path.join(C, 'SPY_ohlc.json'), 'utf8')), spyIdx = new Map(spyBars.map((b, i) => [b.d, i]));
const rv20 = (d) => { const i = spyIdx.get(d); if (i == null || i < 21) return NaN; const r = []; for (let q = i - 19; q <= i; q++) r.push(Math.log(spyBars[q].c / spyBars[q - 1].c)); return sd(r) * Math.sqrt(252) * 100; };
const rows = [];
for (const T of SMOKE ? TICKERS.slice(0, 3) : TICKERS) {
  const bf = path.join(C, `${T}_ohlc.json`), gf = path.join(C, `${T}.jsonl`); if (!fs.existsSync(bf) || !fs.existsSync(gf)) { console.error(`missing ${T}`); continue; }
  const bars = JSON.parse(fs.readFileSync(bf, 'utf8')), GR = new Map(fs.readFileSync(gf, 'utf8').split('\n').filter(Boolean).map((l) => { const j = JSON.parse(l); const f = j.factor ?? 1;
    // amendment 2: UW gex scales ~factor² across a split, delta/charm/vanna ~factor → put pre-split days on the post-split scale
    if (f !== 1) j.s = j.s.map((r) => [r[0], r[1] * f * f, r[2] * f * f, r[3] * f, r[4] * f, r[5] * f, r[6] * f, r[7] * f, r[8] * f]); return [j.d, j]; }));
  // amendment 2: the chain on the day either side of a split boundary is transitional → not used
  for (const sg of SPLITS[T] ?? []) { const j = bars.findIndex((x) => x.d > sg.to); if (j > 0) { GR.delete(bars[j - 1].d); GR.delete(bars[j].d); } }
  // amendment 1: some tickers' UW volume is not split-adjusted (AVGO). If volume jumps by ~the split factor across a
  // detected split, scale pre-split volume by the factor so dollar volume (G21) is continuous.
  for (const sg of SPLITS[T] ?? []) { const j = bars.findIndex((x) => x.d > sg.to); if (j < 10 || j + 10 > bars.length) continue;
    const mv = (a) => a.reduce((q, x) => q + x.v, 0) / a.length, r = mv(bars.slice(j, j + 10)) / mv(bars.slice(j - 10, j));
    if (Math.abs(Math.log(r / sg.factor)) < Math.abs(Math.log(r))) { for (const x of bars) if (x.d <= sg.to) x.v *= sg.factor; /* amendment 2: all pre-split bars */ console.error(`${T}: pre-split volume ×${sg.factor}`); } }
  const idx = new Map(bars.map((b, i) => [b.d, i])), R = (q) => (bars[q].h - bars[q].l) / bars[q - 1].c;
  const sumCache = new Map(), summ = (q) => { if (q < 0) return null; const d = bars[q].d; if (!sumCache.has(d)) sumCache.set(d, GR.has(d) ? summarize(GR.get(d).s, bars[q].c * (GR.get(d).factor ?? 1)) : null); return sumCache.get(d); };
  for (let i = 21; i < bars.length; i++) { // amendment 1: was 62
    const d = bars[i].d, b = bars[i], p = bars[i - 1], s1 = summ(i - 1); if (!s1 || d < '2023-11-09') continue;
    const vix1 = VIX[p.d], vix2 = VIX[bars[i - 2].d]; if (vix1 == null) continue;
    let m20 = 0; for (let q = i - 20; q < i; q++) m20 += R(q); m20 /= 20;
    const Kadj = s1.Kr * p.c, s2 = summ(i - 2), s6 = summ(i - 6), ma20 = mean(bars.slice(i - 20, i).map((x) => x.c));
    const hist = (key, n) => { const a = []; for (let q = i - 1 - n; q < i - 1; q++) { const s = summ(q); if (s && Number.isFinite(s[key])) a.push(s[key]); } return a; };
    const z = (key) => { const a = hist(key, 60); if (a.length < 40) return NaN; const sdv = sd(a); return sdv > 0 ? (s1[key] - mean(a)) / sdv : NaN; };
    const g20 = []; for (let q = i - 20; q < i; q++) { const s = summ(q); if (s) g20.push(s.absG); }
    const dv20 = mean(bars.slice(i - 20, i).map((x) => x.c * x.v));
    const f = { ...Object.fromEntries(Object.entries(s1).filter(([k]) => /^[GVCD]\d\d$/.test(k))),
      G16: s1.G14 + s1.G15, G20: g20.length >= 15 ? Math.log(s1.absG / mean(g20)) : NaN, G21: dv20 > 0 ? s1.netG / dv20 : NaN, G22: z('G01'), G23: z('G03'),
      Y01: s2 ? s1.G01 - s2.G01 : NaN, Y02: s2 ? s1.G03 - s2.G03 : NaN, Y03: s6 ? s1.G01 - s6.G01 : NaN, Y04: s2 ? s1.Kr - s2.Kr * (bars[i - 2].c / p.c) : NaN, Y05: s2 ? Math.log(s1.absG / s2.absG) : NaN,
      Y06: s2 ? s1.V01 - s2.V01 : NaN, Y07: s2 ? s1.C01 - s2.C01 : NaN, Y08: s2 ? s1.D01 - s2.D01 : NaN, Y09: s2 ? s1.G17 - s2.G17 : NaN,
      N01: Math.log(vix1), N02: vix2 != null ? vix1 - vix2 : NaN, N03: p.c / bars[i - 2].c - 1, N04: p.c / bars[i - 6].c - 1, N05: p.c / bars[i - 21].c - 1, N06: p.c / ma20 - 1,
      N07: R(i - 1) / m20, N08: p.h > p.l ? (p.c - p.l) / (p.h - p.l) : NaN, N09: p.h > p.l ? Math.abs(p.c - p.o) / (p.h - p.l) : NaN, N10: Math.log(vix1 / rv20(p.d)), ...calendar(d),
      I01: s1.G01 * +(vix1 > 20), I02: s1.G03 * +(p.c > ma20), I03: +(s1.Kr > 1 && s1.gK > 0), I04: +(s1.Kr < 1 && s1.gK > 0), I05: +(s1.netG < 0 && p.c < ma20), I06: s1.G06 * +(s1.netG > 0) };
    const o = { R1: Math.log(R(i)), R2: i + 4 < bars.length ? Math.log(mean([0, 1, 2, 3, 4].map((q) => R(i + q)))) : NaN, S1: b.h > b.l ? Math.abs(b.c - b.o) / (b.h - b.l) : NaN,
      D1: (b.c / b.o - 1) / m20, D2: (b.c / p.c - 1) / m20, D3: (b.o / p.c - 1) / m20, D4: i + 4 < bars.length ? (bars[i + 4].c / p.c - 1) / m20 : NaN,
      P1: (Math.abs(b.o - Kadj) - Math.abs(b.c - Kadj)) / b.o / m20 };
    const ctl = { prevR: Math.log(R(i - 1)), m20: Math.log(m20), vix: Math.log(vix1), prevT: f.N09, ret1: f.N03 / m20, openK: Math.abs(b.o - Kadj) / b.o };
    const end4 = i + 4 < bars.length ? bars[i + 4].d : '9999';
    rows.push({ T, d, f, o, ctl, end4 });
  }
}
if (SMOKE) { console.log(JSON.stringify({ rows: rows.length, tickers: [...new Set(rows.map((r) => r.T))], first: rows[0]?.d, last: rows.at(-1)?.d, nanShare: Object.fromEntries(Object.keys(rows[0]?.f ?? {}).map((k) => [k, +(rows.filter((r) => !Number.isFinite(r.f[k])).length / rows.length).toFixed(3)]).filter(([, v]) => v > 0)) })); process.exit(0); }

// ---- OLS with Driscoll–Kraay SEs (same code as gamma_range.mjs, audited 2026-10-09) ----
const solve = (A, b) => { const n = A.length, M = A.map((r, i) => [...r, b[i]]); for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; [M[c], M[p]] = [M[p], M[c]];
  for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; } } return M.map((r, i) => r[n] / r[i]); };
const inv = (A) => A.map((_, i) => solve(A, A.map((__, k) => (k === i ? 1 : 0)))).reduce((acc, col, i) => { col.forEach((v, r) => { (acc[r] ??= [])[i] = v; }); return acc; }, []);
function ols(R, lag = 5) { // R: [{y, x:[...], t}] ; returns coefficient/t of x[1]... all
  const k = R[0].x.length, XtX = Array.from({ length: k }, () => Array(k).fill(0)), Xty = Array(k).fill(0);
  for (const r of R) for (let a = 0; a < k; a++) { Xty[a] += r.x[a] * r.y; for (let b = a; b < k; b++) XtX[a][b] += r.x[a] * r.x[b]; }
  for (let a = 0; a < k; a++) for (let b = 0; b < a; b++) XtX[a][b] = XtX[b][a];
  const beta = solve(XtX, Xty), Ai = inv(XtX), h = new Map();
  for (const r of R) { const e = r.y - r.x.reduce((s, v, a) => s + v * beta[a], 0); const v = h.get(r.t) ?? h.set(r.t, Array(k).fill(0)).get(r.t); for (let a = 0; a < k; a++) v[a] += r.x[a] * e; }
  const H = [...h.keys()].sort().map((t) => h.get(t)), S = Array.from({ length: k }, () => Array(k).fill(0));
  for (let L = 0; L <= lag; L++) { const w = 1 - L / (lag + 1); for (let t = L; t < H.length; t++) for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) S[a][b] += L === 0 ? H[t][a] * H[t][b] : w * (H[t][a] * H[t - L][b] + H[t - L][a] * H[t][b]); }
  const se = (a) => Math.sqrt(Ai[a].reduce((s, v, c) => s + v * S[c].reduce((q, w2, d2) => q + w2 * Ai[d2][a], 0), 0));
  return { beta, se, n: R.length };
}
const Phi = (x) => { const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp(-x * x / 2), p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; };
const pval = (t, sign) => (sign === '+' ? 1 - Phi(t) : sign === '-' ? Phi(t) : 2 * (1 - Phi(Math.abs(t))));
const bh = (ps, q) => { const o = ps.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0]); let kmax = -1; o.forEach(([p], r) => { if (p <= ((r + 1) / o.length) * q) kmax = r; }); const keep = new Set(o.slice(0, kmax + 1).map(([, i]) => i)); return ps.map((_, i) => keep.has(i)); };
const CTRL = { R1: ['prevR', 'm20', 'vix'], R2: ['prevR', 'm20', 'vix'], S1: ['prevT', 'm20', 'vix'], D1: ['ret1'], D2: ['ret1'], D3: ['ret1'], D4: ['ret1'], P1: ['openK'] };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))]; };

// fit: winsorize/standardize with BUILD-period numbers; returns {b, t, n}
const SHIFT = +(process.argv.find((a) => a.startsWith('--placebo='))?.split('=')[1] ?? 0); // amendment 1: placebo = feature series shifted SHIFT trading days (circular, per ticker, within each period)
if (SHIFT) for (const per of [(r) => r.d <= BUILD_END, (r) => r.d >= HOLD_START]) for (const T of TICKERS) { const rr = rows.filter((r) => r.T === T && per(r)); const fs0 = rr.map((r) => r.f); rr.forEach((r, j) => { r.f = { ...fs0[(j + SHIFT) % rr.length] }; }); }
const buildRows = rows.filter((r) => r.d <= BUILD_END), holdRows = rows.filter((r) => r.d >= HOLD_START);
const prepCache = new Map();
function prep(fk, ok) { const key = fk + '|' + ok; if (prepCache.has(key)) return prepCache.get(key);
  const okRow = (r) => Number.isFinite(r.f[fk]) && Number.isFinite(r.o[ok]) && CTRL[ok].every((c) => Number.isFinite(r.ctl[c])) && (!['R2', 'D4'].includes(ok) || ((r.d > BUILD_END || r.end4 <= BUILD_END) && spyIdx.get(r.d) % 5 === 0)); // amendment 1: 5-day outcomes on non-overlapping dates
  const B = buildRows.filter(okRow), tick = {};
  for (const T of new Set(B.map((r) => r.T))) { const a = B.filter((r) => r.T === T).map((r) => r.f[fk]); const binary = new Set(a).size <= 2; const lo = binary ? -Infinity : pct(a, 0.01), hi = binary ? Infinity : pct(a, 0.99);
    const w = a.map((x) => Math.min(hi, Math.max(lo, x))), m = mean(w), s = sd(w); tick[T] = { lo, hi, m, s: s > 0 ? s : NaN }; }
  const ys = B.map((r) => r.o[ok]), ylo = pct(ys, 0.01), yhi = pct(ys, 0.99);
  const P = { okRow, tick, ylo, yhi }; prepCache.set(key, P); return P; }
function fit(fk, ok, set, extra = null) { const P = prep(fk, ok); let syms = TICKERS; // dummies built from the rows that survive (amendment 2)
  const R = []; for (const r of set) { if (!P.okRow(r) || !P.tick[r.T] || !Number.isFinite(P.tick[r.T].s)) continue; if (extra && !Number.isFinite(r.f[extra.fk])) continue;
    const t = P.tick[r.T], x = (Math.min(t.hi, Math.max(t.lo, r.f[fk])) - t.m) / t.s, y = Math.min(P.yhi, Math.max(P.ylo, r.o[ok]));
    let xe = []; if (extra) { const t2 = prep(extra.fk, ok).tick[r.T]; if (!t2 || !Number.isFinite(t2.s)) continue; xe = [(Math.min(t2.hi, Math.max(t2.lo, r.f[extra.fk])) - t2.m) / t2.s]; }
    R.push({ t: r.d, T: r.T, y, x: [1, x, ...xe, ...CTRL[ok].map((c) => r.ctl[c])] }); }
  syms = TICKERS.filter((T) => R.some((r) => r.T === T)); for (const r of R) r.x.push(...syms.slice(1).map((s) => +(r.T === s)));
  // drop all-zero ticker columns (tickers absent from this set)
  const k = R[0]?.x.length ?? 0, keepCol = Array.from({ length: k }, (_, a) => a < 2 + (extra ? 1 : 0) + CTRL[ok].length || R.some((r) => r.x[a] !== 0));
  const R2 = R.map((r) => ({ ...r, x: r.x.filter((_, a) => keepCol[a]) }));
  if (R2.length < 100) return { b: NaN, t: NaN, n: R2.length };
  const o = ols(R2, 5); return { b: o.beta[1], t: o.beta[1] / o.se(1), n: o.n, bx: extra ? o.beta[2] : undefined, tx: extra ? o.beta[2] / o.se(2) : undefined }; }

// ---- stage 1 ----
const t0 = Date.now(), S1 = REG.map((h, n) => { const r = fit(h.feature, h.outcome, buildRows); if (n % 50 === 0) console.error(`stage 1: ${n}/${REG.length} (${((Date.now() - t0) / 1000).toFixed(0)}s)`); return { ...h, b1: r.b, t1: r.t, n1: r.n, p1: Number.isFinite(r.t) ? pval(r.t, h.sign) : 1 }; });
const keep1 = bh(S1.map((h) => h.p1), 0.10); S1.forEach((h, i) => { h.stage1 = keep1[i]; });
// ---- stage 2 ----
const surv = S1.filter((h) => h.stage1);
for (const h of surv) { const r = fit(h.feature, h.outcome, holdRows); h.dir = Math.sign(h.b1) > 0 ? '+' : '-'; h.b2 = r.b; h.t2 = r.t; h.n2 = r.n; h.p2 = Number.isFinite(r.t) ? pval(r.t, h.dir) : 1;
  const ix = fit(h.feature, h.outcome, holdRows.filter((x) => INDEX.has(x.T))); h.bIdx = ix.b; h.tIdx = ix.t;
  let same = 0, tot = 0; for (const T of TICKERS) { const rr = holdRows.filter((x) => x.T === T); if (rr.length < 100) continue; const q = fit(h.feature, h.outcome, rr); if (!Number.isFinite(q.b)) continue; tot++; if (Math.sign(q.b) === Math.sign(h.b1)) same++; } h.tickSame = tot ? same / tot : NaN; }
const keep2 = bh(surv.map((h) => h.p2), 0.10); surv.forEach((h, i) => { h.passBH = keep2[i] && Math.sign(h.b2) === Math.sign(h.b1); });
// amendment 3: per-idea placebo — the real holdout t (in the build direction) must beat ≥ 19 of 20 holdout fits of the
// SAME idea with that ticker's feature series circularly shifted K trading days within the holdout
const KS = [13, 29, 43, 59, 71, 89, 101, 113, 131, 149, 163, 179, 191, 211, 227, 239, 251, 269, 283, 293];
const holdShift = new Map(); for (const K of KS) { const m = new Map(); for (const T of TICKERS) { const rr = holdRows.filter((r) => r.T === T); rr.forEach((r, j) => m.set(r, rr[(j + K) % rr.length].f)); } holdShift.set(K, holdRows.map((r) => ({ ...r, f: m.get(r) }))); }
for (const h of surv.filter((x) => x.passBH)) { const dir = Math.sign(h.b1), real = dir * h.t2, pl = KS.map((K) => dir * fit(h.feature, h.outcome, holdShift.get(K)).t).filter(Number.isFinite);
  h.placeboBeat = pl.filter((x) => real > x).length; h.placeboN = pl.length; h.placeboMax = Math.max(...pl); }
surv.forEach((h) => { h.validated = !!h.passBH && h.placeboBeat >= 19 && h.placeboN === 20; });
// incremental vs the strongest validated idea in the same outcome
const val = surv.filter((h) => h.validated), valNew = val.filter((h) => !h.seen), passBHonly = surv.filter((h) => h.passBH && !h.validated);
for (const o of new Set(val.map((h) => h.outcome))) { const grp = val.filter((h) => h.outcome === o).sort((a, b) => Math.abs(b.t2) - Math.abs(a.t2)), top = grp[0];
  for (const h of grp.slice(1)) { const r = fit(h.feature, h.outcome, holdRows, { fk: top.feature }); h.beyondTop = top.feature; h.tBeyond = r.t; } }

// ---- report ----
const fx = (x, d = 3) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(d) : '—');
const L = ['# Idea factory — results', `\nRun ${new Date().toISOString()} · protocol shadow/DESIGN_idea_factory.md · registry ${REG.length} hypotheses · ${new Set(rows.map((r) => r.T)).size} tickers`,
  `Build rows ${buildRows.length} (${buildRows[0]?.d} → ${buildRows.at(-1)?.d}) · holdout rows ${holdRows.length} (${holdRows[0]?.d} → ${holdRows.at(-1)?.d})\n`,
  `**Stage 1 (build, BH q = 0.10): ${surv.length} of ${REG.length} survive.** **Stage 2 (holdout, BH q = 0.10 across survivors, same sign): ${valNew.length} new ideas validated**${val.length > valNew.length ? ' (plus the already-seen gamma → range idea)' : ''}.`,
  `\nExpected false discoveries among validated at q = 0.10: about ${(val.length * 0.1).toFixed(1)}.\n`,
  '## Validated ideas (holdout + per-idea placebo)\n', '| idea | feature | outcome | predicted | build β (t) | holdout β (t) | beats own placebos | index ETFs β (t) | tickers same sign | beyond strongest in outcome (t) | mechanism |', '|---|---|---|---|---|---|---|---|---|---|---|',
  ...val.sort((a, b) => a.outcome.localeCompare(b.outcome) || Math.abs(b.t2) - Math.abs(a.t2)).map((h) => `| ${h.id}${h.seen ? ' (seen)' : ''} | ${h.definition} | ${h.outcome} | ${h.sign} | ${fx(h.b1)} (${fx(h.t1, 2)}) | **${fx(h.b2)} (${fx(h.t2, 2)})** | ${h.placeboBeat}/${h.placeboN} | ${fx(h.bIdx)} (${fx(h.tIdx, 2)}) | ${(h.tickSame * 100).toFixed(0)}% | ${h.beyondTop ? `${fx(h.tBeyond, 2)} beyond ${h.beyondTop}` : 'strongest'} | ${h.mechanism} |`),
  '\n## Passed the holdout test but NOT their own placebo (likely slow-drift artifacts)\n', '| idea | outcome | holdout t | beats own placebos | best placebo t |', '|---|---|---|---|---|', ...passBHonly.map((h) => `| ${h.id} ${h.definition} | ${h.outcome} | ${fx(h.t2, 2)} | ${h.placeboBeat}/${h.placeboN} | ${fx(h.placeboMax, 2)} |`),
  '\n## Survived stage 1 but failed the holdout\n', '| idea | outcome | build β (t) | holdout β (t) |', '|---|---|---|---|',
  ...surv.filter((h) => !h.passBH).map((h) => `| ${h.id} ${h.definition} | ${h.outcome} | ${fx(h.b1)} (${fx(h.t1, 2)}) | ${fx(h.b2)} (${fx(h.t2, 2)}) |`),
  '\nOutcome units: R1/R2 = log range (β ≈ % change in range per 1 s.d. of the feature); S1 = trendiness share; D1–D4 and P1 = fractions of the 20-day average daily range per 1 s.d. of the feature.',
  '\nFull per-hypothesis table: results_idea_factory/all.json.'];
fs.mkdirSync(OUT, { recursive: true });
if (SHIFT) { fs.writeFileSync(path.join(OUT, `placebo_${SHIFT}.json`), JSON.stringify({ shift: SHIFT, stage1: surv.length, validated: valNew.length, ids: valNew.map((h) => h.id) })); console.log(`placebo shift ${SHIFT}: stage 1 ${surv.length}, validated ${valNew.length}`); process.exit(0); }
const plac = fs.readdirSync(OUT).filter((f) => f.startsWith('placebo_')).map((f) => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8')));
L.splice(5, 0, `**Placebo (same pipeline, feature series shifted in time so it cannot carry real information):** ${plac.map((p) => `shift ${p.shift} → ${p.stage1} pass stage 1, ${p.validated} 'validated'`).join('; ') || 'not run'}. Real minus placebo ≈ the number of genuine discoveries.\n`);
fs.writeFileSync(path.join(OUT, 'all.json'), JSON.stringify(S1, null, 1)); fs.writeFileSync(path.join(OUT, 'summary.md'), L.join('\n') + '\n'); console.log(L.join('\n'));
