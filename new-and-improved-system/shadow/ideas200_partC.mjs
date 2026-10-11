#!/usr/bin/env node
// ideas200 part C — 22 straddle-selling day filters × {T1 one-day, T2 0DTE} on real SPY/QQQ prices
// (data and trade definitions from real_straddle.mjs; DESIGN_ideas200.md part C, incl. its caveat about the holdout).
import fs from 'node:fs';
import path from 'node:path';
import { isTradingDay } from '../world/prices_clean.mjs';

const SH = decodeURIComponent(new URL('.', import.meta.url).pathname), C = path.join(SH, '..', '.cache'), OUT = path.join(SH, 'results_ideas200');
if (fs.existsSync(path.join(OUT, 'partC.md')) && !process.argv.includes('--force')) { console.error('already run'); process.exit(1); }
const IDEAS = JSON.parse(fs.readFileSync(path.join(SH, 'ideas200.json'), 'utf8')).ideas.filter((x) => x.part === 'C');
const BUILD_END = '2025-03-31', HOLD_START = '2025-04-01';
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length, sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const CB = Object.fromEntries(['VIX1D', 'VIX9D', 'VIX', 'VIX3M'].map((x) => [x, JSON.parse(fs.readFileSync(path.join(C, 'cboe', `${x}.json`), 'utf8'))]));
const addD = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const thirdFri = (d) => { const x = new Date(d.slice(0, 8) + '01T12:00:00Z'); const off = (5 - x.getUTCDay() + 7) % 7; let f = addD(d.slice(0, 8) + '01', off + 14); while (!isTradingDay(f)) f = addD(f, -1); return f; };
const prevTD = (d) => { let t = addD(d, -1); while (!isTradingDay(t)) t = addD(t, -1); return t; };
const rows = [];
for (const T of ['SPY', 'QQQ']) { const bars = JSON.parse(fs.readFileSync(path.join(C, 'uwgreeks', `${T}_ohlc.json`), 'utf8')), bi = new Map(bars.map((b, i) => [b.d, i]));
  const GR = new Map(fs.readFileSync(path.join(C, 'uwgreeks', `${T}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => { const j = JSON.parse(l); return [j.d, j.s]; }));
  const gs = (i) => { const s = GR.get(bars[i].d), S = bars[i].c; if (!s) return null; let A1 = 0, N1 = 0, A2 = 0, N2 = 0, AA = 0, NA = 0, king = null; for (const r of s) { const g = r[1] + r[2], x = Math.abs(r[0] / S - 1); AA += Math.abs(g); NA += g; if (x <= 0.01) { A1 += Math.abs(g); N1 += g; } if (x <= 0.02) { A2 += Math.abs(g); N2 += g; } if (!king || Math.abs(g) > Math.abs(king[1])) king = [r[0], g]; }
    return { b1: A1 > 0 ? N1 / A1 : NaN, b2: A2 > 0 ? N2 / A2 : NaN, ba: AA > 0 ? NA / AA : NaN, net: NA, kd: king ? Math.abs(king[0] / S - 1) : NaN }; };
  const IV = { SPY: 'VIX', QQQ: 'VIX' }[T];
  for (const fn of fs.readdirSync(path.join(C, 'straddle', T)).sort()) { const S = JSON.parse(fs.readFileSync(path.join(C, 'straddle', T, fn), 'utf8')), i = bi.get(S.d); if (i == null || i < 70) continue; const p = bars[i - 1], g = gs(i - 1); if (!g) continue;
    const h = []; for (let q = i - 61; q < i - 1; q++) { const x = gs(q); if (x && Number.isFinite(x.b2)) h.push(x.b2); } const z = h.length >= 40 && sd(h) > 0 ? (g.b2 - mean(h)) / sd(h) : NaN;
    let ma20 = 0; const lr = []; for (let q = i - 20; q < i; q++) { ma20 += bars[q].c / 20; lr.push(Math.log(bars[q].c / bars[q - 1].c)); } const rv = sd(lr) * Math.sqrt(252) * 100;
    const v1 = CB.VIX1D[p.d]?.c, v9 = CB.VIX9D[p.d]?.c, vx = CB[IV][p.d]?.c, v3 = CB.VIX3M[p.d]?.c, w = new Date(S.d + 'T12:00:00Z').getUTCDay();
    const F = { b1: g.b1, z, ba: g.ba, net: g.net, kd: g.kd, ev: v1 && v9 ? Math.log(v1 / v9) : NaN, contango: vx && v3 ? +(vx < v3) : NaN, vrp: vx ? Math.log(vx / rv) : NaN, up: +(p.c > ma20), r5: p.c / bars[i - 6].c - 1,
      mon: +(w === 1), fri: +(w === 5), opex: +(S.d === thirdFri(S.d)), first: +(prevTD(S.d).slice(0, 7) !== S.d.slice(0, 7)) };
    const cr = S.t1?.call?.find((r) => r.date === p.d), pr = S.t1?.put?.find((r) => r.date === p.d);
    if (cr && pr && cr.bid > 0 && pr.bid > 0) { const prem = cr.bid + pr.bid; rows.push({ T, d: S.d, k: 'T1', F, r: (prem - Math.abs(S.close - S.t1.strike)) / prem }); }
    const pick = (a) => (a ?? []).find((r) => r.m >= 574 && r.m <= 579), c2 = pick(S.t2?.call), p2 = pick(S.t2?.put);
    if (c2 && p2 && c2.c > 0.02 && p2.c > 0.02) { const prem = c2.c + p2.c - 0.02; rows.push({ T, d: S.d, k: 'T2', F, r: (prem - Math.abs(S.close - S.t2.strike)) / prem }); } } }
// thresholds from build-period features (T1 rows ≤ build end), per symbol
const th = {}; for (const T of ['SPY', 'QQQ']) { const b = rows.filter((x) => x.T === T && x.k === 'T1' && x.d <= BUILD_END), q = (k, p) => { const s = b.map((x) => x.F[k]).filter(Number.isFinite).sort((a, c) => a - c); return s[Math.floor(p * (s.length - 1))]; };
  th[T] = { b1: q('b1', 2 / 3), z: q('z', 2 / 3), ba: q('ba', 2 / 3), ev: q('ev', 0.5), vrp: q('vrp', 2 / 3) }; }
const FILT = { G1: (x, t) => x.b1 >= t.b1, G2: (x, t) => x.z >= t.z, G3: (x, t) => x.ba >= t.ba, G4: (x) => x.net >= 0, G5: (x) => x.kd <= 0.005, E1: (x, t) => x.ev < t.ev, E2: (x) => x.contango === 1, V1: (x, t) => x.vrp >= t.vrp, P1: (x) => x.up === 1, P2: (x) => x.r5 > 0,
  K1: (x) => x.mon === 0, K2: (x) => x.opex === 1, K3: (x) => x.first === 0, K4: (x) => x.fri === 1 };
Object.assign(FILT, { C1: (x, t) => FILT.G1(x, t) && FILT.P1(x), C2: (x, t) => FILT.G1(x, t) && FILT.E1(x, t), C3: (x, t) => FILT.G1(x, t) && FILT.V1(x, t), C4: (x, t) => FILT.G1(x, t) && FILT.E2(x), C5: (x, t) => FILT.G1(x, t) && FILT.P1(x) && FILT.E1(x, t),
  C6: (x, t) => FILT.V1(x, t) && FILT.E2(x), C7: (x, t) => FILT.P1(x) && FILT.E1(x, t), C8: (x, t) => FILT.G2(x, t) && FILT.E2(x) && FILT.P1(x) });
for (const k of ['T1', 'T2']) { const a = rows.filter((x) => x.k === k).map((x) => x.r).sort((x, y) => x - y), lo = a[Math.floor(0.01 * (a.length - 1))], hi = a[Math.floor(0.99 * (a.length - 1))]; for (const x of rows) if (x.k === k) x.rw = Math.min(hi, Math.max(lo, x.r)); }
// difference in means (filter − other), day-clustered, with a ticker effect via within-ticker demeaning
function test(k, f, sel) { const a = rows.filter((x) => x.k === k && sel(x.d)); const on = [], off = []; for (const x of a) { const v = FILT[f](x.F, th[x.T]); (v ? on : off).push(x); }
  if (on.length < 30 || off.length < 30) return { n: on.length, diff: NaN, t: NaN }; const se = (s) => { const m = mean(s.map((x) => x.rw)), by = new Map(); for (const x of s) by.set(x.d, (by.get(x.d) ?? 0) + (x.rw - m)); const G = by.size; return Math.sqrt(([...by.values()].reduce((q, v) => q + v * v, 0) * G) / Math.max(1, G - 1)) / s.length; };
  const diff = mean(on.map((x) => x.rw)) - mean(off.map((x) => x.rw)); return { n: on.length, on: mean(on.map((x) => x.r)), off: mean(off.map((x) => x.r)), diff, t: diff / Math.sqrt(se(on) ** 2 + se(off) ** 2) }; }
const Phi = (x) => { const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp(-x * x / 2), p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; };
const res = IDEAS.map((idea) => ({ ...idea, b: test(idea.trade, idea.filter, (d) => d <= BUILD_END), h: test(idea.trade, idea.filter, (d) => d >= HOLD_START) })); res.forEach((r) => { r.p = Number.isFinite(r.h.t) ? 1 - Phi(r.h.t) : 1; });
const o = res.map((r, i) => [r.p, i]).sort((a, b) => a[0] - b[0]); let kmax = -1; o.forEach(([p], r) => { if (p <= ((r + 1) / o.length) * 0.10) kmax = r; }); const pass = new Set(o.slice(0, kmax + 1).map(([, i]) => i)); res.forEach((r, i) => { r.ok = pass.has(i) && r.h.diff > 0 && r.h.on > 0; });
const fx = (x, d = 3) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(d) : '—');
const L = ['# Ideas200 — Part C: straddle-selling day filters on real SPY/QQQ prices', `\nRun ${new Date().toISOString()} · 44 ideas · **caveat: the 2025-04 → 2026-10 holdout was already looked at for 6 related hypotheses; treat as weaker evidence — the forward ledger is the real test.**\n`,
  `**Pass (holdout BH within C, filter days beat other days, filter days profitable): ${res.filter((r) => r.ok).map((r) => r.id).join(', ') || 'none'}**\n`,
  '| idea | filter | build: filter days n, P&L÷prem on / off, diff t | holdout: n, P&L÷prem on / off, diff t | pass |', '|---|---|---|---|---|',
  ...res.slice().sort((a, b) => (b.h.t || -9) - (a.h.t || -9)).map((r) => `| ${r.id} | ${r.text.replace(/^sell .*? only on days with /, '')} | ${r.b.n}, ${fx(r.b.on)} / ${fx(r.b.off)}, ${fx(r.b.t, 2)} | ${r.h.n}, **${fx(r.h.on)} / ${fx(r.h.off)}**, ${fx(r.h.t, 2)} | ${r.ok ? 'yes' : ''} |`)];
fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, 'partC.md'), L.join('\n') + '\n'); console.log(L.join('\n'));
