#!/usr/bin/env node
// Community batch part P — post-breach premium selling (shadow/DESIGN_community_batch.md). Prices/features as
// iron_fly.mjs / real_straddle.mjs (audited). Writes results_community/P.json; --smoke prints counts.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { wingStrikes } from './iron_fly_collect.mjs';

const SH = path.dirname(fileURLToPath(import.meta.url)), C = path.join(SH, '..', '.cache'), OUT = path.join(SH, 'results_community'), SMOKE = process.argv.includes('--smoke');
if (!SMOKE && fs.existsSync(path.join(OUT, 'P.json')) && !process.argv.includes('--force')) { console.error('already run'); process.exit(1); }
const BUILD_END = '2025-03-31', HOLD_START = '2025-04-01', VOL = { SPY: 'VIX', QQQ: 'VXN' };
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const CB = Object.fromEntries(['VIX', 'VXN'].map((x) => [x, JSON.parse(fs.readFileSync(path.join(C, 'cboe', `${x}.json`), 'utf8'))]));
function bal1(s, S, p) { let A = 0, N = 0; for (const r of s) { const g = r[1] + r[2]; if (Math.abs(r[0] / S - 1) <= p) { A += Math.abs(g); N += g; } } return A > 0 ? N / A : NaN; }
const rows = [], drop = { S: 0, F: 0, K: 0, early: 0 };
for (const T of ['SPY', 'QQQ']) { const bars = JSON.parse(fs.readFileSync(path.join(C, 'uwgreeks', `${T}_ohlc.json`), 'utf8')), bi = new Map(bars.map((b, i) => [b.d, i]));
  const GR = new Map(fs.readFileSync(path.join(C, 'uwgreeks', `${T}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => { const j = JSON.parse(l); return [j.d, j.s]; }));
  // Wilder ATR14 per bar index (through that bar)
  const atr = new Array(bars.length).fill(NaN); { let a = NaN, s = 0; for (let i = 1; i < bars.length; i++) { const b = bars[i], pc = bars[i - 1].c, tr = Math.max(b.h - b.l, Math.abs(b.h - pc), Math.abs(b.l - pc));
    if (i <= 14) { s += tr; if (i === 14) a = s / 14; } else a = (a * 13 + tr) / 14; atr[i] = a; } }
  const dir = path.join(C, 'straddle', T);
  for (const fn of fs.readdirSync(dir).sort()) { const S = JSON.parse(fs.readFileSync(path.join(dir, fn), 'utf8')), i = bi.get(S.d); if (i == null || i < 70) { drop.early++; continue; } const p = bars[i - 1], p2 = bars[i - 2];
    const WG = JSON.parse(fs.readFileSync(path.join(C, 'straddle_wings', T, fn), 'utf8'));
    const iv = CB[VOL[T]][p2.d]?.c, sig = iv ? iv / 100 / Math.sqrt(252) : NaN;
    let vm = 0; for (let q = i - 21; q <= i - 2; q++) vm += bars[q].v / 20;
    const B1 = Number.isFinite(sig) ? +(Math.abs(Math.log(p.c / p2.c)) >= 2 * sig) : NaN, B2 = Number.isFinite(atr[i - 2]) ? +(p.h - p.l >= atr[i - 2] && p.v >= vm) : NaN;
    const gs = GR.get(p.d), A01 = gs ? bal1(gs, p.c, 0.01) : NaN;
    const cr = S.t1?.call?.find((r) => r.date === p.d), pr = S.t1?.put?.find((r) => r.date === p.d); const atm = !!(cr && pr && cr.bid > 0 && pr.bid > 0), K = S.t1.strike, prem = atm ? cr.bid + pr.bid : NaN, pay = Math.abs(S.close - K), base = { T, d: S.d, B1, B2, A01 };
    if (atm) rows.push({ ...base, st: 'S', r: (prem - pay) / prem }); else drop.S++;
    const ws = Object.fromEntries(wingStrikes(S.prevClose).map((s) => [s.w, s])), leg = (cp, k) => WG.t1?.[cp + k];
    { const s = ws[0.01], c = leg('C', s.C), q = leg('P', s.P); if (atm && c?.ask > 0 && q?.ask > 0) { const kc = c.strike ?? s.C, kp = q.strike ?? s.P, credit = prem - c.ask - q.ask, risk = Math.max(kc - K, K - kp) - credit, pnl = credit - pay + Math.max(0, S.close - kc) + Math.max(0, kp - S.close);
      if (risk > 0) rows.push({ ...base, st: 'F', r: pnl / risk }); else drop.F++; } else drop.F++; }
    { const a = ws[0.01], b = ws[0.02], c1 = leg('C', a.C), p1 = leg('P', a.P), c2 = leg('C', b.C), p2b = leg('P', b.P);
      if (c1?.bid > 0 && p1?.bid > 0 && c2?.ask > 0 && p2b?.ask > 0) { const k1c = c1.strike ?? a.C, k1p = p1.strike ?? a.P, k2c = c2.strike ?? b.C, k2p = p2b.strike ?? b.P;
        const credit = c1.bid + p1.bid - c2.ask - p2b.ask, risk = Math.max(k2c - k1c, k1p - k2p) - credit, pnl = credit - Math.max(0, S.close - k1c) - Math.max(0, k1p - S.close) + Math.max(0, S.close - k2c) + Math.max(0, k2p - S.close);
        if (risk > 0 && k2c > k1c && k1p > k2p) rows.push({ ...base, st: 'K', r: pnl / risk }); else drop.K++; } else drop.K++; } } }
for (const st of ['S', 'F', 'K']) { const a = rows.filter((x) => x.st === st).map((x) => x.r).sort((x, y) => x - y), lo = a[Math.floor(0.01 * (a.length - 1))], hi = a[Math.floor(0.99 * (a.length - 1))]; for (const x of rows) if (x.st === st) x.rw = Math.min(hi, Math.max(lo, x.r)); }
if (SMOKE) { const c = (st, f) => rows.filter((x) => x.st === st && x[f] === 1).length; console.log(JSON.stringify({ drop, n: { S: rows.filter((x) => x.st === 'S').length, F: rows.filter((x) => x.st === 'F').length, K: rows.filter((x) => x.st === 'K').length }, B1: c('S', 'B1'), B2: c('S', 'B2') })); process.exit(0); }
// ---- regression, Driscoll–Kraay (copied from real_straddle.mjs) ----
const solve = (A, b) => { const n = A.length, M = A.map((r, i) => [...r, b[i]]); for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; [M[c], M[p]] = [M[p], M[c]]; for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; } } return M.map((r, i) => r[n] / r[i]); };
const inv = (A) => A.map((_, i) => solve(A, A.map((__, k) => (k === i ? 1 : 0)))).reduce((acc, col, i) => { col.forEach((v, r) => { (acc[r] ??= [])[i] = v; }); return acc; }, []);
function ols(R, lag = 5) { const k = R[0].x.length, XtX = Array.from({ length: k }, () => Array(k).fill(0)), Xty = Array(k).fill(0); for (const r of R) for (let a = 0; a < k; a++) { Xty[a] += r.x[a] * r.y; for (let b = 0; b < k; b++) XtX[a][b] += r.x[a] * r.x[b]; }
  const beta = solve(XtX, Xty), Ai = inv(XtX), h = new Map(); for (const r of R) { const e = r.y - r.x.reduce((s, v, a) => s + v * beta[a], 0); const v = h.get(r.t) ?? h.set(r.t, Array(k).fill(0)).get(r.t); for (let a = 0; a < k; a++) v[a] += r.x[a] * e; }
  const H = [...h.keys()].sort().map((t) => h.get(t)), S = Array.from({ length: k }, () => Array(k).fill(0)); for (let L = 0; L <= lag; L++) { const w = 1 - L / (lag + 1); for (let t = L; t < H.length; t++) for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) S[a][b] += L === 0 ? H[t][a] * H[t][b] : w * (H[t][a] * H[t - L][b] + H[t - L][a] * H[t][b]); }
  return { b: beta[1], t: beta[1] / Math.sqrt(Ai[1].reduce((s, v, c) => s + v * S[c].reduce((q, w2, d2) => q + w2 * Ai[d2][1], 0), 0)), n: R.length }; }
function test(st, f, per, ctrl) { const a = rows.filter((x) => x.st === st && per(x.d) && Number.isFinite(x[f]) && (!ctrl || Number.isFinite(x.A01))); const nb = a.filter((x) => x[f] === 1).length; if (a.length < 60 || nb < 10) return { n: a.length, nb, b: NaN, t: NaN };
  const r = ols(a.map((x) => ({ t: x.d, y: x.rw, x: ctrl ? [1, x[f], x.A01, +(x.T === 'QQQ')] : [1, x[f], +(x.T === 'QQQ')] })));
  const on = a.filter((x) => x[f] === 1).map((x) => x.r), off = a.filter((x) => x[f] === 0).map((x) => x.r);
  return { ...r, nb, mOn: mean(on), mOff: mean(off), winOn: on.filter((v) => v > 0).length / on.length, worstOn: Math.min(...on) }; }
const B = (d) => d <= BUILD_END, Hd = (d) => d >= HOLD_START;
const H = [['P1', 'S', 'B1'], ['P2', 'F', 'B1'], ['P3', 'K', 'B1'], ['P4', 'S', 'B2'], ['P5', 'F', 'B2'], ['P6', 'K', 'B2'], ['P7', 'S', 'B1', 1], ['P8', 'S', 'B2', 1]].map(([id, st, f, c]) => ({ id, st, f, ctrl: !!c, build: test(st, f, B, c), hold: test(st, f, Hd, c) }));
fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, 'P.json'), JSON.stringify({ run: new Date().toISOString(), drop, H }, null, 1)); console.log(JSON.stringify(H.map((x) => [x.id, x.hold.b, x.hold.t, x.hold.nb])));
