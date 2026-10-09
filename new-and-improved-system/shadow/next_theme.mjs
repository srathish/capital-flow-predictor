#!/usr/bin/env node
// NEXT-THEME detectors — find what's about to become a theme BEFORE price. Locked 2026-10-05 BEFORE running. 0 Skylit credits
// (cached daily bars + cached UW analyst actions). Month-ends 2022-07 → 2026-06; forward = next 3 months minus universe equal-weight.
//   N1 REVISION LEAD   a theme's analyst price-target RAISES over the last 60 days ≥ 2× its own trailing-12-month 60-day average
//                      AND the theme's 3-month price percentile (vs 10,000 random baskets) ≤ 60 → theme forward excess.
//                      Control: all other theme-months.
//   N2 THEME MIGRATION for each HOT theme (≥ 90th percentile) and each universe stock NOT in it: 60-day daily-return correlation with
//                      the theme basket rose by ≥ 0.25 vs the prior 60 days AND is now ≥ 0.5, AND the stock's own 3-month return is
//                      ≤ the universe 60th percentile ("hasn't run") → stock forward excess.
//                      Control: stocks already correlated ≥ 0.5 with that hot theme in BOTH windows (no migration), same "hasn't run" filter.
// CORRECTED RERUN (2026-10-05, after the first run exposed a measurement flaw, disclosed): correlations use returns with the
//   market (SPY, beta-scaled over the window) removed, so a market-wide crash no longer looks like 'migration'; excess is vs the
//   universe MEDIAN, not the mean (a few 10× stocks skewed the mean). Rules otherwise unchanged.
// PASS = beats control in BOTH halves (2022-07…2024-06 / 2024-07…2026-06) and t ≥ 2.
import fs from 'node:fs';
import path from 'node:path';
import { universe, loadDaily } from '../desk/common.mjs';

const HERE = decodeURIComponent(new URL('.', import.meta.url).pathname);
const THEMES = {
  aiCompute: 'NVDA AMD AVGO MRVL ARM', memory: 'MU SNDK WDC STX', semiEquip: 'AMAT LRCX ASML KLAC TER', foundry: 'TSM INTC GFS',
  optical: 'ANET CIEN COHR LITE CRDO AAOI GLW', servers: 'DELL SMCI HPE', neocloud: 'CRWV NBIS IREN APLD CORZ WULF CIFR',
  power: 'CEG VST NRG GEV', nuclear: 'OKLO SMR CCJ NNE LEU UEC', aiSoftware: 'PLTR NOW CRM SNOW DDOG', cyber: 'PANW CRWD ZS NET FTNT OKTA',
  crypto: 'COIN MSTR HOOD', miners: 'MARA RIOT CLSK HUT', space: 'RKLB ASTS LUNR PL', quantum: 'IONQ RGTI QBTS', ev: 'TSLA RIVN LCID',
  banks: 'JPM BAC WFC C GS MS', oil: 'XOM CVX COP OXY HAL', pharma: 'LLY NVO MRK JNJ', consumer: 'WMT COST TGT HD',
};
const U = universe(), D = new Map(); for (const s of new Set([...U, ...Object.values(THEMES).flatMap((v) => v.split(' '))])) { const b = loadDaily(s); if (b.length > 150) D.set(s, { b, ix: new Map(b.map((x, i) => [x.d, i])) }); }
const spyDays = loadDaily('SPY').map((b) => b.d);
const idxOn = (s, d) => { const o = D.get(s); if (!o) return -1; let lo = 0, hi = o.b.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (o.b[m].d <= d) { r = m; lo = m + 1; } else hi = m - 1; } return r; };
const ret = (s, a, b) => { const o = D.get(s); if (!o) return null; const i = idxOn(s, a), j = idxOn(s, b); return i >= 0 && j > i ? o.b[j].c / o.b[i].c - 1 : null; };
const dailyRets = (s, endD, n) => { const o = D.get(s); if (!o) return null; const j = idxOn(s, endD); if (j < n + 1) return null; const m = new Map(); for (let k = j - n + 1; k <= j; k++) m.set(o.b[k].d, o.b[k].c / o.b[k - 1].c - 1); return m; };
const SPYD = loadDaily('SPY'); const spyR = new Map(SPYD.slice(1).map((x, i) => [x.d, x.c / SPYD[i].c - 1]));
const resid = (m) => { if (!m) return m; const ks = [...m.keys()].filter((k) => spyR.has(k)); const x = ks.map((k) => spyR.get(k)), y = ks.map((k) => m.get(k)); const mx = x.reduce((a, v) => a + v, 0) / x.length, my = y.reduce((a, v) => a + v, 0) / y.length; let c = 0, v2 = 0; for (let i = 0; i < x.length; i++) { c += (x[i] - mx) * (y[i] - my); v2 += (x[i] - mx) ** 2; } const beta = c / v2; return new Map(ks.map((k) => [k, m.get(k) - beta * spyR.get(k)])); };
const corr = (a, b) => { const ks = [...a.keys()].filter((k) => b.has(k)); if (ks.length < 40) return null; const x = ks.map((k) => a.get(k)), y = ks.map((k) => b.get(k)); const mx = x.reduce((p, q) => p + q, 0) / x.length, my = y.reduce((p, q) => p + q, 0) / y.length; let n = 0, dx = 0, dy = 0; for (let i = 0; i < x.length; i++) { n += (x[i] - mx) * (y[i] - my); dx += (x[i] - mx) ** 2; dy += (y[i] - my) ** 2; } return n / Math.sqrt(dx * dy); };
const back = (d, n) => spyDays[Math.max(0, spyDays.findIndex((x) => x >= d) - n)];
const an = {}; for (const s of new Set(Object.values(THEMES).flatMap((v) => v.split(' ')))) { const f = path.join(HERE, '..', '.cache', 'uw', 'analyst', `${s}.json`); an[s] = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : []; }
const raises = (s, a, b) => { const r = an[s].filter((x) => x.ts.slice(0, 10) > a && x.ts.slice(0, 10) <= b && x.target).sort((p, q) => p.ts.localeCompare(q.ts)); return r.length; };
const raisesUp = (s, a, b) => { const all = an[s].filter((x) => x.target).sort((p, q) => p.ts.localeCompare(q.ts)); const prev = {}; let n = 0; for (const x of all) { const d = x.ts.slice(0, 10); if (d > b) break; const pt = prev[x.firm]; if (d > a && pt && x.target > pt) n++; prev[x.firm] = x.target; } return n; };
const monthEnd = (y, m) => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
const months = []; for (let y = 2022; y <= 2026; y++) for (let m = 1; m <= 12; m++) { const d = monthEnd(y, m); if (d >= '2022-07-31' && d <= '2026-06-30') months.push(d); }
const fwdOf = (d) => { const t = new Date(Date.parse(d) + 92 * 864e5).toISOString().slice(0, 10); return t; };
let seed = 17; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const N1 = [], N2 = [];
for (const d of months) {
  const d3 = back(d, 63), fw = fwdOf(d), half = d < '2024-07-01' ? 'H1' : 'H2';
  const uni3 = U.map((s) => [s, ret(s, d3, d)]).filter(([, x]) => x != null && Number.isFinite(x)), pool = uni3.map(([, x]) => x); if (pool.length < 100) continue;
  const sorted = [...pool].sort((a, b) => a - b), p60 = sorted[Math.floor(sorted.length * 0.6)];
  const uf = (() => { const v = U.map((s) => ret(s, d, fw)).filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b); return v[v.length >> 1]; })();
  const th = {};
  for (const [k, v] of Object.entries(THEMES)) { const mem = v.split(' ').filter((s) => ret(s, d3, d) != null); if (mem.length < 3) continue;
    const r3 = mem.reduce((a, s) => a + ret(s, d3, d), 0) / mem.length; let below = 0; for (let i = 0; i < 10000; i++) { let t = 0; for (let j = 0; j < mem.length; j++) t += pool[Math.floor(rnd() * pool.length)]; if (t / mem.length < r3) below++; }
    const fwv = mem.map((s) => ret(s, d, fw)).filter((x) => x != null); const fex = fwv.length ? fwv.reduce((a, x) => a + x, 0) / fwv.length - uf : null;
    // N1 revisions: raises in last 60 days vs the average 60-day count over the prior 12 months
    const r60 = mem.reduce((a, s) => a + raisesUp(s, back(d, 42), d), 0); let base = 0; for (let k = 1; k <= 6; k++) base += mem.reduce((a, s) => a + raisesUp(s, back(d, 42 * (k + 1)), back(d, 42 * k)), 0); base /= 6;
    const fire = base >= 1 && r60 >= 2 * base && below / 100 <= 60;
    if (fex != null) N1.push({ d, k, half, fire, fex, r60, base: +base.toFixed(1), pct: below / 100 });
    // basket daily returns for N2
    const rs = mem.map((s) => [dailyRets(s, d, 120), s]).filter(([m]) => m); const basket = new Map(); for (const day of rs[0]?.[0]?.keys() ?? []) { const v = rs.map(([m]) => m.get(day)).filter((x) => x != null); if (v.length >= 3) basket.set(day, v.reduce((a, x) => a + x, 0) / v.length); }
    th[k] = { pct: below / 100, basket, mem }; }
  for (const [k, t] of Object.entries(th)) { if (t.pct < 90) continue;
    const rb = resid(t.basket), keys = [...rb.keys()].sort(), recent = new Map(keys.slice(-60).map((x) => [x, rb.get(x)])), prior = new Map(keys.slice(-120, -60).map((x) => [x, rb.get(x)]));
    for (const [s, r3] of uni3) { if (t.mem.includes(s) || r3 > p60) continue; const dr = resid(dailyRets(s, d, 120)); if (!dr) continue;
      const c1 = corr(dr, recent), c0 = corr(dr, prior); if (c1 == null || c0 == null) continue; const f = ret(s, d, fw); if (f == null) continue;
      const mig = c1 - c0 >= 0.25 && c1 >= 0.5, stable = c0 >= 0.5 && c1 >= 0.5 && !mig;
      if (mig || stable) N2.push({ d, s, theme: k, half, mig, c0: +c0.toFixed(2), c1: +c1.toFixed(2), fex: f - uf }); } }
}
fs.writeFileSync(path.join(HERE, 'journal', 'next_theme.json'), JSON.stringify({ N1, N2 }));
const st = (v) => { v = v.filter(Number.isFinite); if (v.length < 2) return { n: v.length, m: NaN, sd: NaN }; const m = v.reduce((a, x) => a + x, 0) / v.length; return { n: v.length, m, sd: Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / (v.length - 1)) }; };
const pc = (x) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + '%' : '-');
const judge = (name, R, sel, ctl) => { let ok = true; const parts = []; for (const h of ['H1', 'H2']) { const a = st(R.filter((r) => r.half === h && sel(r)).map((r) => r.fex)), c = st(R.filter((r) => r.half === h && ctl(r)).map((r) => r.fex)); if (!(a.m > c.m)) ok = false; parts.push(`${h === 'H1' ? '2022–24' : '2024–26'} ${pc(a.m)} (n ${a.n}) vs ${pc(c.m)} (n ${c.n})`); }
  const a = st(R.filter(sel).map((r) => r.fex)), c = st(R.filter(ctl).map((r) => r.fex)), t = (a.m - c.m) / Math.sqrt(a.sd ** 2 / a.n + c.sd ** 2 / c.n); if (!(t >= 2)) ok = false;
  console.log(`${ok ? '✓ PASS' : '  FAIL'} ${name}\n    all ${pc(a.m)} (n ${a.n}) vs control ${pc(c.m)} (n ${c.n}) · t ${t.toFixed(2)}\n    ${parts.join(' · ')}\n`); };
console.log(`NEXT-THEME DETECTORS · ${Object.keys(THEMES).length} themes · ${months.length} month-ends · forward 3 months vs universe\n`);
judge('N1 REVISION LEAD — analyst PT raises ≥2× normal while price ≤60th pct', N1, (r) => r.fire, (r) => !r.fire);
judge('N2 THEME MIGRATION — stock\'s correlation jumps into a hot theme, stock hasn\'t run', N2, (r) => r.mig, (r) => !r.mig);
console.log('N1 fires:'); for (const r of N1.filter((x) => x.fire)) console.log(`  ${r.d.slice(0, 7)} ${r.k.padEnd(10)} raises ${r.r60} vs normal ${r.base} · price pct ${r.pct.toFixed(0)} → next 3m ${pc(r.fex)}`);
console.log('\nN2 biggest migrations:'); for (const r of N2.filter((x) => x.mig).sort((a, b) => (b.c1 - b.c0) - (a.c1 - a.c0)).slice(0, 15)) console.log(`  ${r.d.slice(0, 7)} ${r.s.padEnd(5)} → ${r.theme.padEnd(10)} corr ${r.c0} → ${r.c1} · next 3m ${pc(r.fex)}`);
