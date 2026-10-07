#!/usr/bin/env node
// v5 year-by-year report: what the model said to buy each year and how each pick did (6-month hold from the month it was picked).
//   node world/v5_yearly.mjs hist wide_dev wide_holdout   → world/results_v5/yearly.md (+ .json)
// Reads the monthly top-20 lists in world/results_v5/<tag>.json; prices from .cache/wdaily_hist + .cache/wdaily; SPY from UW.
import fs from 'node:fs';
import path from 'node:path';
import { UW_API_KEY } from '../feeds/env.js';
import { cleanBars, inBad, gapsOf, blockedAt, crosses } from './prices_clean.mjs';

const ROOT = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), '..'), C = path.join(ROOT, '.cache'), RES = path.join(ROOT, 'world', 'results_v5');
const rd = (f, d = null) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d);
const addD = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const tags = process.argv.slice(2).length ? process.argv.slice(2) : ['hist', 'wide_dev', 'wide_holdout'];
const months = tags.flatMap((t) => rd(path.join(RES, `${t}.json`), [])).sort((a, b) => a.mo.localeCompare(b.mo));
if (!months.length) { console.error('no results yet for ' + tags.join(', ')); process.exit(1); }

const P = new Map(), BAD = new Map(), GAP = new Map(); const bars = (t) => { if (!P.has(t)) { const cb = cleanBars(t); P.set(t, cb.bars); BAD.set(t, cb.bad); GAP.set(t, gapsOf(cb.bars)); } return P.get(t); };
const spyF = path.join(C, 'wdaily_hist', 'SPY_full.json');
if (!fs.existsSync(spyF)) { const m = new Map();
  for (let y = 2026; y >= 2010; y--) { const r = await fetch(`https://api.unusualwhales.com/api/stock/SPY/ohlc/1d?end_date=${y}-10-03&limit=2500`, { headers: { Authorization: `Bearer ${UW_API_KEY}` } }); const j = await r.json().catch(() => null);
    for (const b of j?.data ?? []) if (b.market_time === 'r') m.set(b.date, { d: b.date, c: +b.close }); await new Promise((r) => setTimeout(r, 300)); }
  fs.mkdirSync(path.dirname(spyF), { recursive: true }); fs.writeFileSync(spyF, JSON.stringify([...m.values()].sort((a, b) => a.d.localeCompare(b.d)))); }
P.set('SPY', rd(spyF));
const at = (b, d) => { let lo = 0, hi = b.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (b[m].d <= d) { r = m; lo = m + 1; } else hi = m - 1; } return r; };
const fwd = (t, d) => { if (t !== 'SPY' && (bars(t), crosses(BAD.get(t) ?? [], GAP.get(t), d, addD(d, 182)))) return null; const b = bars(t), j = at(b, d) + 1, k = at(b, addD(d, 182)); return j > 0 && j < b.length && k > j && b[k].d >= addD(d, 172) ? b[k].c / b[j].c - 1 : null; };
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length, pc = (x) => (x == null ? '—' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(0)}%`);

const years = new Map();
for (const r of months) { const xs = r.picksA.map((p) => ({ t: p.t, mo: r.mo, ret: fwd(p.t, r.M) })).filter((x) => x.ret != null); if (!xs.length || r.A == null) continue;
  const med = mean(xs.map((x) => x.ret)) - r.A, spy = fwd('SPY', r.M); // implied eligible-universe median for that month
  const Y = years.get(r.mo.slice(0, 4)) ?? { picks: [], meds: [], spys: [] }; for (const x of xs) Y.picks.push({ ...x, ex: x.ret - med }); Y.meds.push(med); if (spy != null) Y.spys.push(spy); years.set(r.mo.slice(0, 4), Y); }

const out = ['# What the bottleneck model said to buy each year, and how it did', '',
  'Each month the model picks 20 stocks (fastest-growing revenue that is speeding up, with widening gross margins, from filings already public). Every pick is held 6 months. "Typical stock" = the median eligible US stock over the same 6 months.', '',
  '| Year | Avg pick, 6 months | Typical stock | SPY | Picks beat typical stock | Most-picked names |', '|---|---|---|---|---|---|'];
const detail = [], json = {};
for (const [y, Y] of [...years].sort()) { const by = new Map(); for (const p of Y.picks) { const o = by.get(p.t) ?? { t: p.t, n: 0, first: p.mo, rets: [] }; o.n++; o.rets.push(p.ret); by.set(p.t, o); }
  const names = [...by.values()].map((o) => ({ ...o, avg: mean(o.rets) })).sort((a, b) => b.n - a.n || b.avg - a.avg);
  const avg = mean(Y.picks.map((p) => p.ret)), beat = Y.picks.filter((p) => p.ex > 0).length / Y.picks.length;
  out.push(`| ${y} | **${pc(avg)}** | ${pc(mean(Y.meds))} | ${pc(Y.spys.length ? mean(Y.spys) : null)} | ${(beat * 100).toFixed(0)}% | ${names.slice(0, 6).map((o) => o.t).join(', ')} |`);
  const best = [...Y.picks].sort((a, b) => b.ret - a.ret), seen = new Set(), top = best.filter((p) => !seen.has(p.t) && seen.add(p.t)).slice(0, 3), seen2 = new Set(), worst = [...best].reverse().filter((p) => !seen2.has(p.t) && seen2.add(p.t)).slice(0, 3);
  detail.push(`\n## ${y}\n\nAvg pick **${pc(avg)}** vs typical stock ${pc(mean(Y.meds))} · ${names.length} different stocks · best: ${top.map((p) => `${p.t} ${pc(p.ret)} (picked ${p.mo})`).join(', ')} · worst: ${worst.map((p) => `${p.t} ${pc(p.ret)} (${p.mo})`).join(', ')}\n\n| Stock | Months picked | First picked | Avg 6-month return |\n|---|---|---|---|\n` +
    names.slice(0, 15).map((o) => `| ${o.t} | ${o.n} | ${o.first} | ${pc(o.avg)} |`).join('\n') + (names.length > 15 ? `\n\n…and ${names.length - 15} more.` : ''));
  json[y] = { avg, median: mean(Y.meds), spy: Y.spys.length ? mean(Y.spys) : null, beat, names }; }
const txt = out.join('\n') + '\n' + detail.join('\n') + '\n'; console.log(txt);
fs.writeFileSync(path.join(RES, 'yearly.md'), txt); fs.writeFileSync(path.join(RES, 'yearly.json'), JSON.stringify(json, null, 1));
