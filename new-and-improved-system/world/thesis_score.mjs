#!/usr/bin/env node
// Score every logged thesis run (world/theses/*.json) — LIVE ONLY. Weighted pick return from the first close AFTER the run date to
// +6 months (or today = interim mark), vs: the median stock in the universe · copying SA LP's latest 13F public on the run date ·
// momentum 12-1 top 20. Prices from UW daily bars (free, refreshed here). 0 Skylit credits.
import fs from 'node:fs';
import path from 'node:path';
import { UW_API_KEY } from '../feeds/env.js';

const ROOT = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), '..'), C = path.join(ROOT, '.cache'), DIR = path.join(ROOT, 'world', 'theses');
const rd = (f, d = null) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d), sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const addD = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10), today = new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 10);
const cache = new Map();
async function bars(t) { if (cache.has(t)) return cache.get(t); await sleep(260);
  const j = await (await fetch(`https://api.unusualwhales.com/api/stock/${t}/ohlc/1d?timeframe=1Y`, { headers: { Authorization: `Bearer ${UW_API_KEY}` } }).catch(() => null))?.json().catch(() => null);
  let b = (j?.data ?? []).filter((x) => x.market_time === 'r').map((x) => ({ d: x.date, c: +x.close })).sort((a, b) => a.d.localeCompare(b.d));
  if (!b.length) b = rd(path.join(C, 'wdaily', `${t}.json`), []).map((x) => ({ d: x.d, c: x.c })); cache.set(t, b); return b; }
async function ret(t, a, z) { const b = await bars(t), i = b.findIndex((x) => x.d > a); if (i < 0) return null; const j = [...b.keys()].filter((k) => b[k].d <= z).at(-1); return j > i ? b[j].c / b[i].c - 1 : null; }
const pc = (x) => (x == null || !Number.isFinite(x) ? '—' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`);
const runs = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort() : [];
console.log(`# Thesis engine scorecard (${today})\n`);
for (const f of runs) {
  const r = rd(path.join(DIR, f)); if (!r?.result?.picks?.length) continue; const a = r.asOf, z = addD(a, 182) <= today ? addD(a, 182) : today, matured = addD(a, 182) <= today;
  let wsum = 0, rsum = 0; const per = []; for (const p of r.result.picks) { const x = await ret(p.ticker, a, z); if (x == null) continue; wsum += p.weight; rsum += p.weight * x; per.push(`${p.ticker} ${pc(x)}`); }
  const model = wsum ? rsum / wsum : null;
  const sa = (rd(path.join(C, 'edgar', 'sa_13f.json'), []) || []).filter((q) => q.filed <= a).at(-1); let saR = null;
  if (sa) { const longs = sa.holdings.filter((h) => !h.putCall && h.ticker), tot = longs.reduce((x, h) => x + h.value, 0); let s = 0, w = 0; for (const h of longs) { const x = await ret(h.ticker, a, z); if (x == null) continue; s += h.value * x; w += h.value; } saR = w ? s / w : null; }
  const spy = await ret('SPY', a, z);
  console.log(`## ${f.replace('.json', '')} — ${matured ? 'MATURED' : `interim mark at ${z}`}\n- thesis picks (weighted): **${pc(model)}** · copy SA LP (value-weighted, 13F filed ${sa?.filed ?? '—'}): ${pc(saR)} · SPY: ${pc(spy)}\n- picks: ${per.join(' · ')}\n`);
}
