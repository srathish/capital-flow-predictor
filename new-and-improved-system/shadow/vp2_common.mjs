// Vol program 2 shared loader (shadow/DESIGN_vol_program2.md). T1/T2 straddle rows with features known at entry.
// Trade definitions copied from real_straddle.mjs (audited); regression from the same file.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SH = path.dirname(fileURLToPath(import.meta.url)), C = path.join(SH, '..', '.cache'), OUT = path.join(SH, 'results_vp2');
export const T1_BUILD_END = '2025-03-31', T1_HOLD_START = '2025-04-01', T2_BUILD_END = '2025-12-31', T2_HOLD_START = '2026-01-02';
export const IVX = { SPY: 'VIX', QQQ: 'VXN', IWM: 'RVX', DIA: 'VXD' };
export const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN), sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const CB = Object.fromEntries(['VIX', 'VXN', 'RVX', 'VXD', 'VIX1D', 'VIX3M', 'VIX9D'].map((x) => [x, JSON.parse(fs.readFileSync(path.join(C, 'cboe', `${x}.json`), 'utf8'))]));
export const cb = (x, d) => CB[x][d]?.c;
export const EV = JSON.parse(fs.readFileSync(path.join(SH, 'data', 'macro_events.json'), 'utf8')), CPI = new Set(EV.CPI), FOMC = new Set(EV.FOMC);
function bal1(s, S, p) { let A = 0, N = 0; for (const r of s) { const g = r[1] + r[2]; if (Math.abs(r[0] / S - 1) <= p) { A += Math.abs(g); N += g; } } return A > 0 ? N / A : NaN; }
export function loadBars(T) { const bars = JSON.parse(fs.readFileSync(path.join(C, 'uwgreeks', `${T}_ohlc.json`), 'utf8')); return { bars, bi: new Map(bars.map((b, i) => [b.d, i])) }; }
export function greeks(T) { return new Map(fs.readFileSync(path.join(C, 'uwgreeks', `${T}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => { const j = JSON.parse(l); return [j.d, j.s]; })); }
// monthly OPEX session: third Friday, or the prior session if it is not a trading day (sessions = dates present in bars)
export function opexSet(bars) { const have = new Set(bars.map((b) => b.d)), out = new Set(), months = new Set(bars.map((b) => b.d.slice(0, 7)));
  for (const ym of months) { const x = new Date(ym + '-01T12:00:00Z'), off = (5 - x.getUTCDay() + 7) % 7; let d = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), 1 + off + 14));
    for (let k = 0; k < 4; k++) { const s = d.toISOString().slice(0, 10); if (have.has(s)) { out.add(s); break; } d = new Date(d.getTime() - 864e5); } } return out; }
// rows: one per straddle file day; T1 and T2 (when priced) with features as of d−1 (T1) / d−1 + 09:35 price (T2)
export function loadRows(T) { const { bars, bi } = loadBars(T), GR = greeks(T), OPEX = opexSet(bars), rows = [];
  for (const fn of fs.readdirSync(path.join(C, 'straddle', T)).sort()) { const S = JSON.parse(fs.readFileSync(path.join(C, 'straddle', T, fn), 'utf8')), i = bi.get(S.d); if (i == null || i < 70) continue; const p = bars[i - 1];
    const s = GR.get(p.d), A01 = s ? bal1(s, p.c, 0.01) : NaN;
    const lr = []; for (let q = i - 5; q < i; q++) lr.push(Math.log(bars[q].c / bars[q - 1].c)); const rv5 = Math.sqrt(mean(lr.map((x) => x * x)) * 252);
    const rng5 = mean(bars.slice(i - 5, i).map((b) => (b.h - b.l) / b.c));
    const f = { A01, gap: (Date.parse(S.d) - Date.parse(p.d)) / 864e5 > 1 ? 1 : 0, ivx: cb(IVX[T], p.d), vix: cb('VIX', p.d), vix3m: cb('VIX3M', p.d), vix1d: cb('VIX1D', p.d), rv5, rng5, cpi: +CPI.has(S.d), fomc: +FOMC.has(S.d), opex: +OPEX.has(S.d), range: (bars[i].h - bars[i].l) / p.c };
    const base = { T, d: S.d, f, prevC: p.c, close: S.close };
    const cr = S.t1?.call?.find((r) => r.date === p.d), pr = S.t1?.put?.find((r) => r.date === p.d);
    if (cr && pr && cr.bid > 0 && pr.bid > 0) { const prem = cr.bid + pr.bid, pay = Math.abs(S.close - S.t1.strike); rows.push({ ...base, k: 'T1', prem, px: p.c, strike: S.t1.strike, pnl: prem - pay, r: (prem - pay) / prem }); }
    const pick = (a) => (a ?? []).find((r) => r.m >= 574 && r.m <= 579), c2 = pick(S.t2?.call), p2 = pick(S.t2?.put);
    if (c2 && p2 && c2.c > 0.02 && p2.c > 0.02) { const prem = c2.c + p2.c - 0.02, K = S.t2.strike, pay = Math.abs(S.close - K), cP = c2.c - 0.01, pP = p2.c - 0.01;
      rows.push({ ...base, k: 'T2', prem, px: S.t2.px935, strike: K, pnl: prem - pay, r: (prem - pay) / prem, rc: (cP - Math.max(0, S.close - K)) / cP, rp: (pP - Math.max(0, K - S.close)) / pP }); } }
  // F2 thresholds: build top third of A01 on T1 build days
  const b = rows.filter((x) => x.k === 'T1' && x.d <= T1_BUILD_END).map((x) => x.f.A01).filter(Number.isFinite).sort((x, y) => x - y), th = b[Math.floor((2 / 3) * (b.length - 1))];
  for (const x of rows) x.f.F2 = Number.isFinite(x.f.A01) ? +(x.f.A01 >= th) : NaN;
  return { rows, th, bars, bi }; }
export function winsor(rows, key = 'r', out = 'rw') { for (const k of ['T1', 'T2']) { const a = rows.filter((x) => x.k === k && Number.isFinite(x[key])).map((x) => x[key]).sort((x, y) => x - y); if (!a.length) continue; const lo = a[Math.floor(0.01 * (a.length - 1))], hi = a[Math.floor(0.99 * (a.length - 1))]; for (const x of rows) if (x.k === k && Number.isFinite(x[key])) x[out] = Math.min(hi, Math.max(lo, x[key])); } }
// ---- regression with Driscoll–Kraay SE (copied from real_straddle.mjs); returns coefficient 1 ----
const solve = (A, b) => { const n = A.length, M = A.map((r, i) => [...r, b[i]]); for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; [M[c], M[p]] = [M[p], M[c]]; for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; } } return M.map((r, i) => r[n] / r[i]); };
const inv = (A) => A.map((_, i) => solve(A, A.map((__, k) => (k === i ? 1 : 0)))).reduce((acc, col, i) => { col.forEach((v, r) => { (acc[r] ??= [])[i] = v; }); return acc; }, []);
export function ols(R, lag = 5, j = 1) { const k = R[0].x.length, XtX = Array.from({ length: k }, () => Array(k).fill(0)), Xty = Array(k).fill(0); for (const r of R) for (let a = 0; a < k; a++) { Xty[a] += r.x[a] * r.y; for (let b = 0; b < k; b++) XtX[a][b] += r.x[a] * r.x[b]; }
  const beta = solve(XtX, Xty), Ai = inv(XtX), h = new Map(); for (const r of R) { const e = r.y - r.x.reduce((s, v, a) => s + v * beta[a], 0); const v = h.get(r.t) ?? h.set(r.t, Array(k).fill(0)).get(r.t); for (let a = 0; a < k; a++) v[a] += r.x[a] * e; }
  const H = [...h.keys()].sort().map((t) => h.get(t)), S = Array.from({ length: k }, () => Array(k).fill(0)); for (let L = 0; L <= lag; L++) { const w = 1 - L / (lag + 1); for (let t = L; t < H.length; t++) for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) S[a][b] += L === 0 ? H[t][a] * H[t][b] : w * (H[t][a] * H[t - L][b] + H[t - L][a] * H[t][b]); }
  return { b: beta[j], t: beta[j] / Math.sqrt(Ai[j].reduce((s, v, c) => s + v * S[c].reduce((q, w2, d2) => q + w2 * Ai[d2][j], 0), 0)), n: R.length, beta }; }
export const Phi = (x) => { const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp(-x * x / 2), p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; };
// standardized continuous regressor or raw dummy as coefficient 1, with ticker effects
export function regTest(rows, feat, { dummy = false, sign = 1 } = {}) { const a = rows.filter((x) => Number.isFinite(x.rw) && Number.isFinite(feat(x))); const Ts = [...new Set(a.map((x) => x.T))];
  if (a.length < 60 || (dummy && a.filter((x) => feat(x) === 1).length < 8)) return { n: a.length, b: NaN, t: NaN, n1: dummy ? a.filter((x) => feat(x) === 1).length : undefined };
  const v = a.map(feat), m = dummy ? 0 : mean(v), s = dummy ? 1 : sd(v);
  const r = ols(a.map((x, i) => ({ t: x.d, y: x.rw, x: [1, (v[i] - m) / s, ...Ts.slice(1).map((T) => +(x.T === T))] })));
  const out = { n: a.length, b: sign * r.b, t: sign * r.t }; if (dummy) { const on = a.filter((x) => feat(x) === 1), off = a.filter((x) => feat(x) === 0); Object.assign(out, { n1: on.length, mOn: mean(on.map((x) => x.r)), mOff: mean(off.map((x) => x.r)) }); } return out; }
