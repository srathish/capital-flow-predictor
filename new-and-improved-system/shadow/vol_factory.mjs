#!/usr/bin/env node
// Volatility-premium factory engine (shadow/DESIGN_vol_factory.md). Statistics code copied from idea_factory.mjs (audited).
//   node shadow/vol_factory.mjs [--smoke]   (runs once; --force only for logged audit fixes)
import fs from 'node:fs';
import path from 'node:path';
import { isTradingDay } from '../world/prices_clean.mjs';

const SH = decodeURIComponent(new URL('.', import.meta.url).pathname), NIS = path.join(SH, '..'), C = path.join(NIS, '.cache');
const OUT = path.join(SH, 'results_vol_factory'), SMOKE = process.argv.includes('--smoke');
if (!SMOKE && fs.existsSync(path.join(OUT, 'summary.md')) && !process.argv.includes('--force')) { console.error('already run'); process.exit(1); }
const REG = JSON.parse(fs.readFileSync(path.join(SH, 'vol_registry.json'), 'utf8')).hypotheses;
const TICK = { SPY: 'VIX', QQQ: 'VXN', IWM: 'RVX', DIA: 'VXD' }, START = '2023-11-09', BUILD_END = '2025-03-31', HOLD_START = '2025-04-01', END = '2026-10-02';
const CB = Object.fromEntries(['VIX1D', 'VIX9D', 'VIX', 'VIX3M', 'VXN', 'RVX', 'VXD'].map((x) => [x, JSON.parse(fs.readFileSync(path.join(C, 'cboe', `${x}.json`), 'utf8'))]));
for (const X of Object.values(CB)) for (const [d, v] of Object.entries(X)) if (d >= '2023-01-01' && v.o === v.h && v.h === v.l && v.l === v.c) delete X[d]; /* amendment 1: stale (flat) index days, e.g. VXD 2024-02-12…16 */
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length, sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const addD = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const thirdFriday = (y, m) => { const d = new Date(Date.UTC(y, m, 1)); const off = (5 - d.getUTCDay() + 7) % 7; return new Date(Date.UTC(y, m, 1 + off + 14)).toISOString().slice(0, 10); };
const opexDay = (d) => { let t = thirdFriday(+d.slice(0, 4), +d.slice(5, 7) - 1); while (!isTradingDay(t)) t = addD(t, -1); return t; };
const prevTD = (d) => { let t = addD(d, -1); while (!isTradingDay(t)) t = addD(t, -1); return t; }, nextTD = (d) => { let t = addD(d, 1); while (!isTradingDay(t)) t = addD(t, 1); return t; };
function cal(d) { const w = new Date(d + 'T12:00:00Z').getUTCDay(), ox = opexDay(d), oxPrev = opexDay(addD(d.slice(0, 8) + '01', -1)), wk = addD(ox, -((new Date(ox + 'T12:00:00Z').getUTCDay() + 6) % 7));
  return { D01: +(w === 1), D02: +(w === 5), D03: +(d === ox), D04: +(d === nextTD(ox) || d === nextTD(oxPrev)), D05: +(prevTD(d).slice(0, 7) !== d.slice(0, 7)), D06: +(d >= wk && d <= ox) }; }
function gsum(s, S) { if (!s?.length) return null; const k = s.map((r) => r[0]), g = s.map((r) => r[1] + r[2]), v = s.map((r) => r[7] + r[8]), ch = s.map((r) => r[5] + r[6]), dl = s.map((r) => r[3] + r[4]);
  const bal = (a, f) => { let A = 0, N = 0; a.forEach((x, i) => { if (f(i)) { A += Math.abs(x); N += x; } }); return A > 0 ? N / A : NaN; }, win = (p) => (i) => Math.abs(k[i] / S - 1) <= p, all = () => true;
  const G = g.reduce((q, x) => q + Math.abs(x), 0); if (!(G > 0)) return null; let iK = 0, iP = -1; g.forEach((x, i) => { if (Math.abs(x) > Math.abs(g[iK])) iK = i; if (x > 0 && (iP < 0 || x > g[iP])) iP = i; });
  return { A01: bal(g, win(0.01)), A02: bal(g, win(0.02)), A03: bal(g, win(0.05)), A04: bal(g, all), A07: +(g.reduce((q, x) => q + x, 0) < 0), A08: Math.abs(k[iK] / S - 1), A09: iP >= 0 ? k[iP] / S - 1 : NaN, A10: Math.abs(g[iK]) / G,
    A11: bal(v, all), A12: bal(ch, all), A13: bal(dl, win(0.02)) }; }

// ---------- panel ----------
const rows = [];
for (const [T, X] of Object.entries(TICK)) {
  const bars = JSON.parse(fs.readFileSync(path.join(C, 'uwgreeks', `${T}_ohlc.json`), 'utf8')), GR = new Map(fs.readFileSync(path.join(C, 'uwgreeks', `${T}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => { const j = JSON.parse(l); return [j.d, j.s]; }));
  const IV = CB[X], gs = new Map(), gsAt = (q) => { const d = bars[q].d; if (!gs.has(d)) gs.set(d, GR.has(d) ? gsum(GR.get(d), bars[q].c) : null); return gs.get(d); };
  for (let i = 62; i < bars.length; i++) { const b = bars[i], p = bars[i - 1], d = b.d; if (d < START || d > END) continue; const g1 = gsAt(i - 1), iv1 = IV[p.d]?.c, iv2 = IV[bars[i - 2].d]?.c, ivo = IV[d]?.o; if (!g1 || !iv1) continue;
    const s1 = iv1 / 100 / Math.sqrt(252), so = ivo ? ivo / 100 / Math.sqrt(252) : NaN, R = (q) => (bars[q].h - bars[q].l) / bars[q - 1].c;
    let m20 = 0; for (let q = i - 20; q < i; q++) m20 += R(q) / 20; const lr = []; for (let q = i - 20; q < i; q++) lr.push(Math.log(bars[q].c / bars[q - 1].c)); const rv = sd(lr) * Math.sqrt(252) * 100;
    const h60 = (key) => { const a = []; for (let q = i - 61; q < i - 1; q++) { const s = gsAt(q); if (s && Number.isFinite(s[key])) a.push(s[key]); } return a; }, z = (key) => { const a = h60(key); return a.length >= 40 && sd(a) > 0 ? (g1[key] - mean(a)) / sd(a) : NaN; };
    const g2 = gsAt(i - 2), ma20 = mean(bars.slice(i - 20, i).map((x) => x.c)), ivs = []; for (let q = i - 20; q < i; q++) { const v = IV[bars[q].d]?.c; if (v) ivs.push(v); }
    const vix = CB.VIX[p.d]?.c, vix3m = CB.VIX3M[p.d]?.c, vix9 = CB.VIX9D[p.d]?.c, vix1 = CB.VIX1D[p.d]?.c, v1o = CB.VIX1D[d]?.o;
    const f = { ...g1, A05: z('A02'), A06: z('A04'), A14: g2 ? g1.A02 - g2.A02 : NaN, B01: Math.log(iv1 / rv), B02: Math.log(iv1), B03: iv2 ? iv1 - iv2 : NaN, B04: vix && vix3m ? Math.log(vix / vix3m) : NaN, B05: vix && vix9 ? Math.log(vix9 / vix) : NaN, B06: vix1 && vix9 ? Math.log(vix1 / vix9) : NaN,
      B07: ivs.length >= 15 ? iv1 / mean(ivs) : NaN, C01: Math.abs(p.c / bars[i - 2].c - 1) / s1, C02: R(i - 1) / m20, C03: p.c / bars[i - 6].c - 1, C04: p.c / ma20 - 1, C05: Math.abs(b.o / p.c - 1) / s1, ...cal(d) };
    const o = { V1: 1 - Math.abs(b.c - p.c) / (0.8 * s1 * p.c), V2: Number.isFinite(so) ? 1 - Math.abs(b.c - b.o) / (0.8 * so * b.o) : NaN, V3: Math.log((b.h - b.l) / (s1 * p.c)),
      V4: i + 4 < bars.length ? 1 - Math.abs(bars[i + 4].c - p.c) / (0.8 * s1 * Math.sqrt(5) * p.c) : NaN, V5: +(Math.abs(b.c - p.c) > s1 * p.c),
      V6: T === 'SPY' && v1o ? 1 - Math.abs(b.c - b.o) / (0.8 * (v1o / 100 / Math.sqrt(252)) * b.o) : NaN };
    const ctl = { V1: Math.log(s1), V3: Math.log(s1), V4: Math.log(s1), V5: Math.log(s1), V2: Math.log(so), V6: v1o ? Math.log(v1o) : NaN };
    rows.push({ T, d, i, f, o, ctl, end4: i + 4 < bars.length ? bars[i + 4].d : '9999' }); } }
// E01 needs the build median of B01 per ticker
const bMed = {}; for (const T of Object.keys(TICK)) { const a = rows.filter((r) => r.T === T && r.d <= BUILD_END && Number.isFinite(r.f.B01)).map((r) => r.f.B01).sort((x, y) => x - y); bMed[T] = a[a.length >> 1]; }
for (const r of rows) r.f.E01 = Number.isFinite(r.f.A05) && Number.isFinite(r.f.B01) ? r.f.A05 * +(r.f.B01 > bMed[r.T]) : NaN;
const dayIdx = new Map([...new Set(rows.map((r) => r.d))].sort().map((d, k) => [d, k]));
if (SMOKE) { const ks = Object.keys(rows[0].f); console.log(JSON.stringify({ rows: rows.length, perT: Object.fromEntries(Object.keys(TICK).map((T) => [T, rows.filter((r) => r.T === T).length])), first: rows[0].d, last: rows.at(-1).d, nan: Object.fromEntries(ks.map((k) => [k, +(rows.filter((r) => !Number.isFinite(r.f[k])).length / rows.length).toFixed(2)]).filter(([, v]) => v > 0)), outNaN: Object.fromEntries(['V1', 'V2', 'V3', 'V4', 'V5', 'V6'].map((k) => [k, rows.filter((r) => Number.isFinite(r.o[k])).length])) })); process.exit(0); }

// ---------- statistics (idea_factory.mjs) ----------
const solve = (A, b) => { const n = A.length, M = A.map((r, i) => [...r, b[i]]); for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; [M[c], M[p]] = [M[p], M[c]];
  for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; } } return M.map((r, i) => r[n] / r[i]); };
const inv = (A) => A.map((_, i) => solve(A, A.map((__, k) => (k === i ? 1 : 0)))).reduce((acc, col, i) => { col.forEach((v, r) => { (acc[r] ??= [])[i] = v; }); return acc; }, []);
function ols(R, lag = 5) { const k = R[0].x.length, XtX = Array.from({ length: k }, () => Array(k).fill(0)), Xty = Array(k).fill(0);
  for (const r of R) for (let a = 0; a < k; a++) { Xty[a] += r.x[a] * r.y; for (let b = a; b < k; b++) XtX[a][b] += r.x[a] * r.x[b]; } for (let a = 0; a < k; a++) for (let b = 0; b < a; b++) XtX[a][b] = XtX[b][a];
  const beta = solve(XtX, Xty), Ai = inv(XtX), h = new Map(); for (const r of R) { const e = r.y - r.x.reduce((s, v, a) => s + v * beta[a], 0); const v = h.get(r.t) ?? h.set(r.t, Array(k).fill(0)).get(r.t); for (let a = 0; a < k; a++) v[a] += r.x[a] * e; }
  const H = [...h.keys()].sort().map((t) => h.get(t)), S = Array.from({ length: k }, () => Array(k).fill(0));
  for (let L = 0; L <= lag; L++) { const w = 1 - L / (lag + 1); for (let t = L; t < H.length; t++) for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) S[a][b] += L === 0 ? H[t][a] * H[t][b] : w * (H[t][a] * H[t - L][b] + H[t - L][a] * H[t][b]); }
  const se = (a) => Math.sqrt(Ai[a].reduce((s, v, c) => s + v * S[c].reduce((q, w2, d2) => q + w2 * Ai[d2][a], 0), 0)); return { beta, se, n: R.length }; }
const Phi = (x) => { const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp(-x * x / 2), p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; };
const pval = (t, sign) => (!Number.isFinite(t) ? 1 : sign === '+' ? 1 - Phi(t) : sign === '-' ? Phi(t) : 2 * (1 - Phi(Math.abs(t))));
const bh = (ps, q) => { const o = ps.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0]); let kmax = -1; o.forEach(([p], r) => { if (p <= ((r + 1) / o.length) * q) kmax = r; }); const keep = new Set(o.slice(0, kmax + 1).map(([, i]) => i)); return ps.map((_, i) => keep.has(i)); };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))]; };
const buildRows = rows.filter((r) => r.d <= BUILD_END), holdRows = rows.filter((r) => r.d >= HOLD_START), prepC = new Map();
const NOCTL = new Set(['B01', 'B02', 'B07']); /* amendment 1: implied-vol level features are fitted without the ln σ control (B02 is the control itself) */
const okRow = (r, fk, ok) => Number.isFinite(r.f[fk]) && Number.isFinite(r.o[ok]) && (NOCTL.has(fk) || Number.isFinite(r.ctl[ok])) && (ok !== 'V4' || ((r.d > BUILD_END || r.end4 <= BUILD_END) && dayIdx.get(r.d) % 5 === 0));
function prep(fk, ok) { const key = fk + ok; if (prepC.has(key)) return prepC.get(key); const B = buildRows.filter((r) => okRow(r, fk, ok)), tick = {};
  for (const T of new Set(B.map((r) => r.T))) { const a = B.filter((r) => r.T === T).map((r) => r.f[fk]), bin = new Set(a).size <= 2, lo = bin ? -Infinity : pct(a, 0.01), hi = bin ? Infinity : pct(a, 0.99), w = a.map((x) => Math.min(hi, Math.max(lo, x))), s = sd(w); tick[T] = { lo, hi, m: mean(w), s: s > 0 ? s : NaN }; }
  const ys = B.map((r) => r.o[ok]); const P = { tick, ylo: ok === 'V5' ? -Infinity : pct(ys, 0.01), yhi: ok === 'V5' ? Infinity : pct(ys, 0.99) }; prepC.set(key, P); return P; }
function fit(fk, ok, set) { if (!set.length) return { b: NaN, t: NaN, n: 0 }; const P = prep(fk, ok), R = [];
  for (const r of set) { if (!okRow(r, fk, ok)) continue; const t = P.tick[r.T]; if (!t || !Number.isFinite(t.s)) continue; R.push({ t: r.d, T: r.T, y: Math.min(P.yhi, Math.max(P.ylo, r.o[ok])), x: [1, (Math.min(t.hi, Math.max(t.lo, r.f[fk])) - t.m) / t.s, ...(NOCTL.has(fk) ? [] : [r.ctl[ok]])] }); }
  const syms = Object.keys(TICK).filter((T) => R.some((r) => r.T === T)); for (const r of R) r.x.push(...syms.slice(1).map((s) => +(r.T === s)));
  if (R.length < 100) return { b: NaN, t: NaN, n: R.length }; const o = ols(R, 5); return { b: o.beta[1], t: o.beta[1] / o.se(1), n: o.n }; }
const S1 = REG.map((h) => { const r = fit(h.feature, h.outcome, buildRows); return { ...h, b1: r.b, t1: r.t, n1: r.n, p1: pval(r.t, h.sign) }; });
const k1 = bh(S1.map((h) => h.p1), 0.10); S1.forEach((h, i) => { h.stage1 = k1[i]; }); const surv = S1.filter((h) => h.stage1);
for (const h of surv) { const r = fit(h.feature, h.outcome, holdRows); h.b2 = r.b; h.t2 = r.t; h.n2 = r.n; h.p2 = pval(r.t, h.b1 > 0 ? '+' : '-'); }
const k2 = bh(surv.map((h) => h.p2), 0.10); surv.forEach((h, i) => { h.passBH = k2[i] && Math.sign(h.b2) === Math.sign(h.b1); });
const KS = [13, 29, 43, 59, 71, 89, 101, 113, 131, 149, 163, 179, 191, 211, 227, 239, 251, 269, 283, 293];
const holdShift = new Map(KS.map((K) => { const m = new Map(); for (const T of Object.keys(TICK)) { const rr = holdRows.filter((r) => r.T === T); rr.forEach((r, j) => m.set(r, rr[(j + K) % rr.length].f)); } return [K, holdRows.map((r) => ({ ...r, f: m.get(r) }))]; }));
for (const h of surv.filter((x) => x.passBH)) { const s = Math.sign(h.b1), real = s * h.t2, pl = KS.map((K) => s * fit(h.feature, h.outcome, holdShift.get(K)).t).filter(Number.isFinite); h.placeboBeat = pl.filter((x) => real > x).length; h.placeboN = pl.length;
  // plain units: holdout outcome in the top vs bottom third of the feature (pooled, per-ticker terciles)
  const tops = [], bots = []; for (const T of Object.keys(TICK)) { const rr = holdRows.filter((r) => r.T === T && okRow(r, h.feature, h.outcome)).sort((a, b) => a.f[h.feature] - b.f[h.feature]), n3 = Math.floor(rr.length / 3); if (n3 < 10) continue; bots.push(...rr.slice(0, n3).map((r) => r.o[h.outcome])); tops.push(...rr.slice(-n3).map((r) => r.o[h.outcome])); }
  h.top = mean(tops); h.bot = mean(bots); }
surv.forEach((h) => { h.validated = !!h.passBH && h.placeboBeat >= 19 && h.placeboN === 20; });
const val = surv.filter((h) => h.validated), fx = (x, d = 3) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(d) : '—'), byO = (o) => S1.filter((h) => h.outcome === o);
const avg = (o, set) => mean(set.filter((r) => Number.isFinite(r.o[o])).map((r) => r.o[o]));
const L = ['# Volatility-premium factory — results', `\nRun ${new Date().toISOString()} · design shadow/DESIGN_vol_factory.md · ${S1.length} hypotheses · ${rows.length} ticker-days (build ${buildRows.length}, holdout ${holdRows.length})\n`,
  `Average short-straddle proxy P&L (premium units), build / holdout: 1-day ${fx(avg('V1', buildRows))} / ${fx(avg('V1', holdRows))} · 0DTE ${fx(avg('V2', buildRows))} / ${fx(avg('V2', holdRows))} · SPY VIX1D 0DTE ${fx(avg('V6', buildRows))} / ${fx(avg('V6', holdRows))} (proxy levels — not interpreted)\n`,
  `**Build BH q = 0.10: ${surv.length} of ${S1.length} pass. Holdout (BH across survivors, same sign, beat ≥ 19/20 own placebos): ${val.length} validated.**\n`,
  '| outcome | hypotheses | pass build | validated |', '|---|---|---|---|', ...['V1', 'V2', 'V3', 'V4', 'V5', 'V6'].map((o) => `| ${o} | ${byO(o).length} | ${byO(o).filter((h) => h.stage1).length} | ${byO(o).filter((h) => h.validated).length} |`),
  '\n## Validated\n', '| idea | feature | outcome | predicted | build β (t) | holdout β (t) | placebos beaten | holdout outcome: top third / bottom third of feature | mechanism |', '|---|---|---|---|---|---|---|---|---|',
  ...val.sort((a, b) => a.outcome.localeCompare(b.outcome) || Math.abs(b.t2) - Math.abs(a.t2)).map((h) => `| ${h.id} | ${h.definition} | ${h.outcome} | ${h.sign} | ${fx(h.b1)} (${fx(h.t1, 2)}) | **${fx(h.b2)} (${fx(h.t2, 2)})** | ${h.placeboBeat}/20 | ${fx(h.top)} / ${fx(h.bot)} | ${h.mechanism} |`),
  '\n## Passed the holdout but not their own placebo\n', ...surv.filter((h) => h.passBH && !h.validated).map((h) => `- ${h.id} ${h.definition}: holdout t ${fx(h.t2, 2)}, placebos beaten ${h.placeboBeat}/20`),
  '\n## Passed build, failed holdout\n', ...surv.filter((h) => !h.passBH).map((h) => `- ${h.id} ${h.definition}: build ${fx(h.b1)} (${fx(h.t1, 2)}) → holdout ${fx(h.b2)} (${fx(h.t2, 2)})`)];
fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, 'all.json'), JSON.stringify(S1, null, 1)); fs.writeFileSync(path.join(OUT, 'summary.md'), L.join('\n') + '\n'); console.log(L.join('\n'));
