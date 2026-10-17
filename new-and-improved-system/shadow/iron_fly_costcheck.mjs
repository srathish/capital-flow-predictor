#!/usr/bin/env node
// Diagnostic for iron_fly.mjs's T1 result (same rows, same frozen F1/F2): adds commissions and a day-clustered t. Read-only; writes nothing.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { wingStrikes } from './iron_fly_collect.mjs';

const SH = path.dirname(fileURLToPath(import.meta.url)), NIS = path.join(SH, '..'), C = path.join(NIS, '.cache'), OUT = path.join(SH, 'results_iron_fly');
const SMOKE = process.argv.includes('--smoke');

const BUILD_END = '2025-03-31', HOLD_START = '2025-04-01', WS = [0.005, 0.01, 0.015, 0.02], RISK = [0.01, 0.02, 0.03];
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length, sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const CB = Object.fromEntries(['VIX1D', 'VIX9D'].map((x) => [x, JSON.parse(fs.readFileSync(path.join(C, 'cboe', `${x}.json`), 'utf8'))]));
/* features and filter: copied from real_straddle.mjs so filter days match the frozen ones */
function bal1(s, S, p) { let A = 0, N = 0; for (const r of s) { const g = r[1] + r[2]; if (Math.abs(r[0] / S - 1) <= p) { A += Math.abs(g); N += g; } } return A > 0 ? N / A : NaN; }
const rows = [], miss = { T1: 0, T2: 0 }, nonpos = { T1: 0, T2: 0 }, gap = [];
for (const T of ['SPY', 'QQQ']) { const bars = JSON.parse(fs.readFileSync(path.join(C, 'uwgreeks', `${T}_ohlc.json`), 'utf8')), bi = new Map(bars.map((b, i) => [b.d, i]));
  const GR = new Map(fs.readFileSync(path.join(C, 'uwgreeks', `${T}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => { const j = JSON.parse(l); return [j.d, j.s]; }));
  const b1 = (i) => { const s = GR.get(bars[i].d); return s ? bal1(s, bars[i].c, 0.01) : NaN; };
  const dir = path.join(C, 'straddle', T);
  for (const fn of fs.readdirSync(dir).sort()) { const S = JSON.parse(fs.readFileSync(path.join(dir, fn), 'utf8')), i = bi.get(S.d); if (i == null || i < 70) continue; const p = bars[i - 1];
    const wf = path.join(C, 'straddle_wings', T, fn), WG = fs.existsSync(wf) ? JSON.parse(fs.readFileSync(wf, 'utf8')) : null;
    let ma20 = 0; for (let q = i - 20; q < i; q++) ma20 += bars[q].c / 20;
    const v1 = CB.VIX1D[p.d]?.c, v9 = CB.VIX9D[p.d]?.c, f = { A01: b1(i - 1), up: +(p.c > ma20), ev: v1 && v9 ? Math.log(v1 / v9) : NaN };
    const fly = (k, K, px, prem, wingCost) => { const pay = Math.abs(S.close - K), o = { T, d: S.d, k, f, prem, pnl: prem - pay, r: (prem - pay) / prem, w: {} };
      for (const s0 of wingStrikes(px)) { const q = wingCost(s0); if (!(q?.c > 0)) { o.w[s0.w] = null; continue; } const c = q.c, s = { C: q.kc, P: q.kp }, credit = prem - c, wpay = Math.max(0, S.close - s.C) + Math.max(0, s.P - S.close), risk = Math.max(s.C - K, K - s.P) - credit;
        if (!(risk > 0)) nonpos[k]++; o.w[s0.w] = risk > 0 ? { credit, pnl: credit - pay + wpay, risk, ror: (credit - pay + wpay) / risk, paid: wpay > 0 } : null; } return o; };
    const cr = S.t1?.call?.find((r) => r.date === p.d), pr = S.t1?.put?.find((r) => r.date === p.d);
    if (cr && pr && cr.bid > 0 && pr.bid > 0) { const o = fly('T1', S.t1.strike, S.prevClose, cr.bid + pr.bid, (s) => { const a = WG?.t1?.['C' + s.C], b = WG?.t1?.['P' + s.P]; return a && b && a.ask > 0 && b.ask > 0 ? { c: a.ask + b.ask, kc: a.strike ?? s.C, kp: b.strike ?? s.P } : null; }); if (WS.some((w) => !o.w[w])) miss.T1++; rows.push(o); }
    const pick = (a) => (a ?? []).find((r) => r.m >= 574 && r.m <= 579), c2 = pick(S.t2?.call), p2 = pick(S.t2?.put);
    if (c2 && p2 && c2.c > 0.02 && p2.c > 0.02) { const o = fly('T2', S.t2.strike, S.t2.px935, c2.c + p2.c - 0.02, (s) => { const a = pick(WG?.t2?.['C' + s.C]), b = pick(WG?.t2?.['P' + s.P]); if (a && b && c2 && p2) gap.push(Math.max(a.m, b.m, c2.m, p2.m) - Math.min(a.m, b.m, c2.m, p2.m)); return a && b && a.c > 0 && b.c > 0 ? { c: a.c + b.c + 0.02, kc: WG.t2k?.['C' + s.C] ?? s.C, kp: WG.t2k?.['P' + s.P] ?? s.P } : null; }); if (WS.some((w) => !o.w[w])) miss.T2++; rows.push(o); } } }
const th = {}; for (const T of ['SPY', 'QQQ']) { const b = rows.filter((x) => x.T === T && x.k === 'T1' && x.d <= BUILD_END), q = (a, p) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s[Math.floor(p * (s.length - 1))]; };
  th[T] = { a01: q(b.map((x) => x.f.A01), 2 / 3), ev: q(b.map((x) => x.f.ev), 0.5) }; }
for (const x of rows) { x.F1 = Number.isFinite(x.f.A01) && Number.isFinite(x.f.ev) ? +(x.f.A01 >= th[x.T].a01 && x.f.up === 1 && x.f.ev < th[x.T].ev) : NaN; x.F2 = Number.isFinite(x.f.A01) ? +(x.f.A01 >= th[x.T].a01) : NaN; }
const allW = (x) => WS.every((w) => x.w[w]);

// commission: $0.65/contract × 4 legs per fly = $2.60 per fly = $0.026 in per-share units
const COMM = 0.026, HO = (x) => x.d >= HOLD_START;
function stat(sel, w, comm) {
  const tr = rows.filter((x) => x.k === 'T1' && sel(x) && x.w[w]).map((x) => ({ d: x.d, T: x.T, r: (x.w[w].pnl - comm) / (x.w[w].risk + comm) }));
  const byD = new Map(); for (const x of tr) { const a = byD.get(x.d) ?? []; a.push(x.r); byD.set(x.d, a); }
  const dm = [...byD.values()].map(mean), t = dm.length > 2 ? (mean(dm) / sd(dm)) * Math.sqrt(dm.length) : NaN;
  const yr = {}; for (const x of tr) (yr[x.d.slice(0, 4)] ??= []).push(x.r);
  return `n ${tr.length} (${dm.length} days) mean ${(mean(tr.map((x) => x.r)) * 100).toFixed(1)}% t ${t.toFixed(2)} | by year ${Object.entries(yr).map(([k, a]) => k + ' ' + (mean(a) * 100).toFixed(1) + '%/' + a.length).join(' · ')}`;
}
for (const [lab, sel] of [['F1 build', (x) => x.F1 === 1 && !HO(x)], ['F1 holdout', (x) => x.F1 === 1 && HO(x)], ['F2 holdout', (x) => x.F2 === 1 && HO(x)], ['not-F1 holdout', (x) => x.F1 === 0 && HO(x)]])
  for (const w of [0.005, 0.01]) for (const c of [0, COMM]) console.log(`${lab.padEnd(15)} ±${w * 100}% ${c ? 'with commission' : 'no commission  '}: ${stat(sel, w, c)}`);
const last = rows.filter((x) => x.k === 'T1').map((x) => x.d).sort().at(-1); console.log('last T1 date', last);
