#!/usr/bin/env node
// Real-price straddle confirmation (shadow/DESIGN_real_straddle.md, amendments 1–2). Single run.
import fs from 'node:fs';
import path from 'node:path';

const SH = decodeURIComponent(new URL('.', import.meta.url).pathname), NIS = path.join(SH, '..'), C = path.join(NIS, '.cache'), OUT = path.join(SH, 'results_real_straddle');
if (fs.existsSync(path.join(OUT, 'summary.md')) && !process.argv.includes('--force') && !process.argv.includes('--smoke')) { console.error('already run'); process.exit(1); }
const BUILD_END = '2025-03-31', HOLD_START = '2025-04-01';
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length, sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const CB = Object.fromEntries(['VIX1D', 'VIX9D'].map((x) => [x, JSON.parse(fs.readFileSync(path.join(C, 'cboe', `${x}.json`), 'utf8'))]));
function bal1(s, S, p) { let A = 0, N = 0; for (const r of s) { const g = r[1] + r[2]; if (Math.abs(r[0] / S - 1) <= p) { A += Math.abs(g); N += g; } } return A > 0 ? N / A : NaN; }
const rows = [];
for (const T of ['SPY', 'QQQ']) { const bars = JSON.parse(fs.readFileSync(path.join(C, 'uwgreeks', `${T}_ohlc.json`), 'utf8')), bi = new Map(bars.map((b, i) => [b.d, i]));
  const GR = new Map(fs.readFileSync(path.join(C, 'uwgreeks', `${T}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => { const j = JSON.parse(l); return [j.d, j.s]; }));
  const b1 = (i) => { const s = GR.get(bars[i].d); return s ? bal1(s, bars[i].c, 0.01) : NaN; }, b2 = (i) => { const s = GR.get(bars[i].d); return s ? bal1(s, bars[i].c, 0.02) : NaN; };
  const dir = path.join(C, 'straddle', T); if (!fs.existsSync(dir)) continue;
  for (const fn of fs.readdirSync(dir).sort()) { const S = JSON.parse(fs.readFileSync(path.join(dir, fn), 'utf8')), i = bi.get(S.d); if (i == null || i < 70) continue; const p = bars[i - 1];
    const h = []; for (let q = i - 61; q < i - 1; q++) { const v = b2(q); if (Number.isFinite(v)) h.push(v); } const z = h.length >= 40 && sd(h) > 0 ? (b2(i - 1) - mean(h)) / sd(h) : NaN;
    let ma20 = 0; for (let q = i - 20; q < i; q++) ma20 += bars[q].c / 20;
    const v1 = CB.VIX1D[p.d]?.c, v9 = CB.VIX9D[p.d]?.c, f = { A01: b1(i - 1), A05: z, up: +(p.c > ma20), ev: v1 && v9 ? Math.log(v1 / v9) : NaN };
    // T1: sell at the d−1 closing bid, settle at intrinsic on d's close
    const cr = S.t1?.call?.find((r) => r.date === p.d), pr = S.t1?.put?.find((r) => r.date === p.d);
    if (cr && pr && cr.bid > 0 && pr.bid > 0) { const prem = cr.bid + pr.bid, pay = Math.abs(S.close - S.t1.strike); rows.push({ T, d: S.d, k: 'T1', f, prem, pnl: prem - pay, r: (prem - pay) / prem, lp: Math.log(prem / p.c) }); }
    // T2: sell at the 09:35 one-minute close − $0.01 per leg, settle at d's close
    const pick = (a) => (a ?? []).find((r) => r.m >= 574 && r.m <= 579);
    const c2 = pick(S.t2?.call), p2 = pick(S.t2?.put);
    if (c2 && p2 && c2.c > 0.02 && p2.c > 0.02) { const prem = c2.c + p2.c - 0.02, pay = Math.abs(S.close - S.t2.strike); rows.push({ T, d: S.d, k: 'T2', f, prem, pnl: prem - pay, r: (prem - pay) / prem, lp: Math.log(prem / S.t2.px935) }); } } }
// build thresholds for the H5/H6 filter (feature values on build days)
const th = {}; for (const T of ['SPY', 'QQQ']) { const b = rows.filter((x) => x.T === T && x.k === 'T1' && x.d <= BUILD_END), q = (a, p) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s[Math.floor(p * (s.length - 1))]; };
  th[T] = { a01: q(b.map((x) => x.f.A01), 2 / 3), ev: q(b.map((x) => x.f.ev), 0.5) }; }
for (const x of rows) x.f.filt = Number.isFinite(x.f.A01) && Number.isFinite(x.f.ev) ? +(x.f.A01 >= th[x.T].a01 && x.f.up === 1 && x.f.ev < th[x.T].ev) : NaN;
for (const k of ['T1', 'T2']) { const a = rows.filter((x) => x.k === k).map((x) => x.r).sort((x, y) => x - y); const lo = a[Math.floor(0.01 * (a.length - 1))], hi = a[Math.floor(0.99 * (a.length - 1))]; for (const x of rows) if (x.k === k) x.rw = Math.min(hi, Math.max(lo, x.r)); }
if (process.argv.includes('--smoke')) { console.log(JSON.stringify({ T1: rows.filter((x) => x.k === 'T1').length, T2: rows.filter((x) => x.k === 'T2').length, th })); process.exit(0); }
// ---- regression with Driscoll–Kraay SE (as in idea_factory) ----
const solve = (A, b) => { const n = A.length, M = A.map((r, i) => [...r, b[i]]); for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; [M[c], M[p]] = [M[p], M[c]]; for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; } } return M.map((r, i) => r[n] / r[i]); };
const inv = (A) => A.map((_, i) => solve(A, A.map((__, k) => (k === i ? 1 : 0)))).reduce((acc, col, i) => { col.forEach((v, r) => { (acc[r] ??= [])[i] = v; }); return acc; }, []);
function ols(R, lag = 5) { const k = R[0].x.length, XtX = Array.from({ length: k }, () => Array(k).fill(0)), Xty = Array(k).fill(0); for (const r of R) for (let a = 0; a < k; a++) { Xty[a] += r.x[a] * r.y; for (let b = 0; b < k; b++) XtX[a][b] += r.x[a] * r.x[b]; }
  const beta = solve(XtX, Xty), Ai = inv(XtX), h = new Map(); for (const r of R) { const e = r.y - r.x.reduce((s, v, a) => s + v * beta[a], 0); const v = h.get(r.t) ?? h.set(r.t, Array(k).fill(0)).get(r.t); for (let a = 0; a < k; a++) v[a] += r.x[a] * e; }
  const H = [...h.keys()].sort().map((t) => h.get(t)), S = Array.from({ length: k }, () => Array(k).fill(0)); for (let L = 0; L <= lag; L++) { const w = 1 - L / (lag + 1); for (let t = L; t < H.length; t++) for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) S[a][b] += L === 0 ? H[t][a] * H[t][b] : w * (H[t][a] * H[t - L][b] + H[t - L][a] * H[t][b]); }
  return { b: beta[1], t: beta[1] / Math.sqrt(Ai[1].reduce((s, v, c) => s + v * S[c].reduce((q, w2, d2) => q + w2 * Ai[d2][1], 0), 0)), n: R.length }; }
const Phi = (x) => { const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp(-x * x / 2), p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; };
function test(k, feat, set) { const a = rows.filter((x) => x.k === k && set(x.d) && Number.isFinite(x.f[feat])); if (a.length < 60) return { n: a.length, b: NaN, t: NaN }; const zs = (() => { if (feat === 'filt') return null; const v = a.map((x) => x.f[feat]); return { m: mean(v), s: sd(v) }; })();
  return ols(a.map((x) => ({ t: x.d, y: x.rw, x: [1, zs ? (x.f[feat] - zs.m) / zs.s : x.f[feat], x.lp, +(x.T === 'QQQ')] }))); }
const H = [['H1', 'T1', 'A01'], ['H2', 'T1', 'A05'], ['H3', 'T2', 'A01'], ['H4', 'T2', 'A05'], ['H5', 'T1', 'filt'], ['H6', 'T2', 'filt']].map(([id, k, f]) => ({ id, k, f, b: test(k, f, (d) => d <= BUILD_END), h: test(k, f, (d) => d >= HOLD_START) }));
const ps = H.map((x) => (Number.isFinite(x.h.t) ? 1 - Phi(x.h.t) : 1)), o = ps.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0]); let kmax = -1; o.forEach(([p], r) => { if (p <= ((r + 1) / o.length) * 0.10) kmax = r; }); const pass = new Set(o.slice(0, kmax + 1).map(([, i]) => i));
H.forEach((x, i) => { x.p = ps[i]; x.confirmed = pass.has(i) && x.h.b > 0; });
const fx = (x, d = 3) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(d) : '—');
const desc = (k, sel, name) => { const a = rows.filter((x) => x.k === k && sel(x)); if (!a.length) return `| ${name} | 0 | | | | | |`; const pn = a.map((x) => x.pnl), r = a.map((x) => x.r);
  return `| ${name} | ${a.length} | ${fx(mean(pn), 2)} | ${fx(mean(r))} | ${(a.filter((x) => x.pnl > 0).length / a.length * 100).toFixed(0)}% | ${fx(Math.min(...pn), 2)} | ${fx(r.reduce((s, x) => s + x, 0), 1)} |`; };
const L = ['# Real-price straddle confirmation — results', `\nRun ${new Date().toISOString()} · design shadow/DESIGN_real_straddle.md (amendments 1–2) · SPY + QQQ\n`,
  `**Confirmed on the holdout (BH q = 0.10 across H1–H6): ${H.filter((x) => x.confirmed).map((x) => x.id).join(', ') || 'none'}**\n`,
  '| hypothesis | trade | feature | build β (t, n) | holdout β (t, n) | holdout one-sided p | confirmed |', '|---|---|---|---|---|---|---|',
  ...H.map((x) => `| ${x.id} | ${x.k} | ${x.f === 'filt' ? 'filter (gamma top third + above 20-day avg + no event priced)' : x.f === 'A01' ? '±1% gamma balance' : '±2% gamma z-score (G23)'} | ${fx(x.b.b)} (${fx(x.b.t, 2)}, ${x.b.n}) | **${fx(x.h.b)} (${fx(x.h.t, 2)}, ${x.h.n})** | ${x.p.toFixed(4)} | ${x.confirmed ? 'yes' : 'no'} |`),
  '\n## Real P&L per straddle (one SPY/QQQ share each leg; unwinsorized)\n', '| sample | trades | mean $ | mean P&L ÷ premium | win rate | worst day $ | sum of P&L ÷ premium |', '|---|---|---|---|---|---|---|',
  desc('T1', (x) => x.d <= BUILD_END, 'T1 one-day, build — all days'), desc('T1', (x) => x.d >= HOLD_START, 'T1 one-day, holdout — all days'),
  desc('T1', (x) => x.d >= HOLD_START && x.f.filt === 1, 'T1 one-day, holdout — FILTER days'), desc('T1', (x) => x.d >= HOLD_START && x.f.filt === 0, 'T1 one-day, holdout — other days'),
  desc('T2', (x) => x.d >= HOLD_START, 'T2 0DTE, holdout — all days'), desc('T2', (x) => x.d >= HOLD_START && x.f.filt === 1, 'T2 0DTE, holdout — FILTER days'), desc('T2', (x) => x.d >= HOLD_START && x.f.filt === 0, 'T2 0DTE, holdout — other days'),
  '\nShort straddles carry large left tails; a positive mean with a 30–50% win rate is normal for this trade. Not sized, no compounding, no commissions.'];
fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, 'summary.md'), L.join('\n') + '\n'); console.log(L.join('\n'));
