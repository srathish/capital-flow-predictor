#!/usr/bin/env node
// Vol program 2 part F — intraday momentum × dealer gamma (shadow/DESIGN_vol_program2.md). Minute handling as vwap_node.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { C, OUT, loadBars, greeks, ols, T1_BUILD_END, T1_HOLD_START } from './vp2_common.mjs';
const SMOKE = process.argv.includes('--smoke'); if (!SMOKE && fs.existsSync(path.join(OUT, 'F.json')) && !process.argv.includes('--force')) { console.error('already run'); process.exit(1); }
const offC = new Map(), etMin = (t, d) => { if (!offC.has(d)) { const h = +new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(new Date(d + 'T16:00:00Z')); offC.set(d, (h - 16) * 60); } return (((Math.floor(t / 60) + offC.get(d)) % 1440) + 1440) % 1440; };
function bal1(s, S, p) { let A = 0, N = 0; for (const r of s) { const g = r[1] + r[2]; if (Math.abs(r[0] / S - 1) <= p) { A += Math.abs(g); N += g; } } return A > 0 ? N / A : NaN; }
const obs = [], SY = ['SPY', 'QQQ', 'IWM', 'DIA'];
for (const T of SY) { const { bars, bi } = loadBars(T), GR = greeks(T);
  for (const fn of fs.readdirSync(path.join(C, 'uw', 'm1', T)).sort()) { const d = fn.slice(0, 10); if (d < '2023-11-09' || d > '2026-10-02') continue; const i = bi.get(d); if (i == null || i < 1) continue; const p = bars[i - 1];
    const m = JSON.parse(fs.readFileSync(path.join(C, 'uw', 'm1', T, fn), 'utf8')).filter((b) => b.m === 'r').map((b) => ({ e: etMin(b.t, d), c: b.c })); if (m.length < 200) continue;
    const at = (e) => m.filter((b) => b.e <= e).at(-1); const a = at(929), z = at(959); if (!a || !z || a.e < 925 || z.e < 955) continue; /* full sessions only */
    const s = GR.get(p.d), A01 = s ? bal1(s, p.c, 0.01) : NaN; if (!Number.isFinite(A01)) continue;
    obs.push({ T, d, early: a.c / p.c - 1, late: z.c / a.c - 1, neg: +(A01 < 0) }); } }
if (SMOKE) { console.log(JSON.stringify({ n: obs.length, neg: obs.filter((x) => x.neg).length })); process.exit(0); }
const fx = (x) => SY.slice(1).map((T) => +(x.T === T));
const run = (a) => { if (a.length < 100) return [{ n: a.length, b: NaN, t: NaN }, { n: a.length, b: NaN, t: NaN }]; const r1 = ols(a.map((x) => ({ t: x.d, y: x.late * 1e4, x: [1, x.early * 1e4, ...fx(x)] })), 5, 1);
  const r2 = ols(a.map((x) => ({ t: x.d, y: x.late * 1e4, x: [1, x.early * x.neg * 1e4, x.early * 1e4, x.neg, ...fx(x)] })), 5, 1); return [{ n: a.length, b: r1.b, t: r1.t }, { n: a.length, b: r2.b, t: r2.t, nNeg: a.filter((x) => x.neg).length }]; };
const [b1, b2] = run(obs.filter((x) => x.d <= T1_BUILD_END)), [h1, h2] = run(obs.filter((x) => x.d >= T1_HOLD_START));
fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, 'F.json'), JSON.stringify({ run: new Date().toISOString(), H: [{ id: 'F1', build: b1, hold: h1 }, { id: 'F2', build: b2, hold: h2 }] }, null, 1)); console.error('F done');
