#!/usr/bin/env node
// CONVICTION SYSTEM — "the models keep pointing at it". Locked 2026-10-05 (designed AFTER seeing that IREN/SNDK/MU were persistent
// picks → 2024 is the clean test, 2025–26 is SEEN; the live log is the real test).
//   Conviction(stock, month M) = appearances in the top-20 of world models v1, v2, v3, v4 over the last 6 month-ends (max 24).
//   BUY LIST = stocks with conviction ≥ 4, top 10 by conviction (ties → more distinct models, then most recent). Hold 6 months.
//   node world/conviction.mjs   → backtest (2024 clean · 2025–26 seen) + first-flag dates for IREN/MU/WDC/SNDK + this month's list
import fs from 'node:fs';
import path from 'node:path';
import { worldUniverse } from './collect.mjs';

const ROOT = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), '..'), C = path.join(ROOT, '.cache'), W = path.join(ROOT, 'world');
const rd = (f, d = null) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d), ymd = (t) => new Date((t + 43200) * 1000).toISOString().slice(0, 10);
const addD = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const MODELS = { v1: ['results', 'picks11'], v2: ['results_v2', 'picks11'], v3: ['results_v3', 'picks'], v4: ['results_v4', 'picks'] };
const picks = new Map(); // month (YYYY-MM) → model → [tickers]
for (const [m, [dir, key]] of Object.entries(MODELS)) for (const f of ['dev.json', 'holdout.json', 'range_2026-04-01_2026-09-30.json']) {
  for (const r of rd(path.join(W, dir, f), []) || []) { const mo = (r.d ?? r.t).slice(0, 7); const P = picks.get(mo) ?? {}; P[m] = (r[key] ?? []).map((p) => p.t); picks.set(mo, P); } }
const months = [...picks.keys()].sort();
function conviction(mo) { const i = months.indexOf(mo), win = months.slice(Math.max(0, i - 5), i + 1), cnt = new Map();
  for (const w of win) for (const [m, ts] of Object.entries(picks.get(w))) for (const t of ts) { const o = cnt.get(t) ?? { n: 0, models: new Set(), last: '' }; o.n++; o.models.add(m); if (w > o.last) o.last = w; cnt.set(t, o); }
  return [...cnt.entries()].filter(([, o]) => o.n >= 4).sort((a, b) => b[1].n - a[1].n || b[1].models.size - a[1].models.size || b[1].last.localeCompare(a[1].last)).slice(0, 10).map(([t, o]) => ({ t, n: o.n, models: [...o.models] })); }
// prices (same loader as v3) and 6-month excess vs universe median, entry = next session close after month-end
const P = new Map(); for (const { t } of worldUniverse()) { let b = rd(path.join(C, 'wdaily', `${t}.json`), []); if (!b.length) b = (rd(path.join(C, 'daily', `${t}.json`), []) || []).map((x) => ({ d: ymd(x.t), c: x.c })); if (b.length > 70) P.set(t, { d: b.map((x) => x.d), c: b.map((x) => x.c) }); }
const at = (t, d) => { const p = P.get(t); let lo = 0, hi = p.d.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (p.d[m] <= d) { r = m; lo = m + 1; } else hi = m - 1; } return r; };
const fwd = (t, d) => { const p = P.get(t); if (!p) return null; const j = at(t, d) + 1, k = at(t, addD(d, 182)); return j > 0 && j < p.c.length && k > j && p.d[k] >= addD(d, 172) ? p.c[k] / p.c[j] - 1 : null; };
const medC = new Map(); const med = (d) => { if (medC.has(d)) return medC.get(d); const v = [...P.keys()].map((t) => fwd(t, d)).filter((x) => x != null).sort((a, b) => a - b); const m = v.length > 100 ? v[v.length >> 1] : null; medC.set(d, m); return m; };
const me = (mo) => new Date(Date.UTC(+mo.slice(0, 4), +mo.slice(5, 7), 0)).toISOString().slice(0, 10);
const pc = (x) => (x == null || !Number.isFinite(x) ? '—' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`);
const rows = [];
for (const mo of months) { if (mo < '2024-01') continue; const d = me(mo), list = conviction(mo), m = med(d);
  const ex = (t) => { const r = fwd(t, d); return r == null || m == null ? null : r - m; }, avg = (ts) => { const v = ts.map(ex).filter((x) => x != null); return v.length ? v.reduce((a, x) => a + x, 0) / v.length : null; };
  const singles = Object.fromEntries(Object.keys(MODELS).map((k) => [k, avg((picks.get(mo)[k] ?? []).slice(0, 10))]));
  const mom = [...P.keys()].map((t) => { const i = at(t, addD(d, -365)), j = at(t, addD(d, -30)); return [t, i >= 0 && j > i ? P.get(t).c[j] / P.get(t).c[i] - 1 : -9]; }).sort((a, b) => b[1] - a[1]).slice(0, 10).map((x) => x[0]);
  rows.push({ mo, list, conv: avg(list.map((x) => x.t)), mom: avg(mom), ...singles, set: mo < '2025-01' ? 'CLEAN 2024' : 'SEEN 2025–26' }); }
console.log('# Conviction system — stocks the four world models keep pointing at (≥4 appearances in 6 months)\n');
console.log('| month | buy list (appearances) | next 6m vs median | momentum top-10 | v1 | v2 | v3 | v4 |\n|---|---|---|---|---|---|---|---|');
for (const r of rows) console.log(`| ${r.mo} | ${r.list.map((x) => `${x.t}(${x.n})`).join(' ') || '—'} | **${pc(r.conv)}** | ${pc(r.mom)} | ${pc(r.v1)} | ${pc(r.v2)} | ${pc(r.v3)} | ${pc(r.v4)} |`);
for (const set of ['CLEAN 2024', 'SEEN 2025–26']) { const R = rows.filter((r) => r.set === set && r.conv != null), mean = (k) => { const v = R.map((r) => r[k]).filter((x) => x != null); return v.length ? v.reduce((a, x) => a + x, 0) / v.length : null; };
  console.log(`\n**${set}** (${R.length} months): conviction ${pc(mean('conv'))} · momentum ${pc(mean('mom'))} · v1 ${pc(mean('v1'))} · v2 ${pc(mean('v2'))} · v3 ${pc(mean('v3'))} · v4 ${pc(mean('v4'))}`); }
console.log('\n**First month on the buy list:** ' + ['IREN', 'MU', 'WDC', 'SNDK', 'CORZ', 'APLD', 'LITE', 'BE'].map((t) => { const r = rows.find((x) => x.list.some((y) => y.t === t)); return `${t} ${r ? r.mo : 'never'}`; }).join(' · '));
const last = months.at(-1), L = conviction(last);
console.log(`\n## BUY LIST for ${last} (live — log it, score it in 6 months)\n` + L.map((x) => `- **${x.t}** — ${x.n} appearances, models ${x.models.join('+')}`).join('\n'));
fs.mkdirSync(path.join(W, 'conviction'), { recursive: true }); fs.writeFileSync(path.join(W, 'conviction', `${last}.json`), JSON.stringify({ month: last, list: L, generatedAt: new Date().toISOString() }, null, 1));
fs.writeFileSync(path.join(W, 'conviction', 'backtest.json'), JSON.stringify(rows, null, 1));
