#!/usr/bin/env node
// Caches UW 1-minute prices for every 0DTE call and put within the day's price range (±2 strikes) for each session in the file.
// Same cache/format as user_checklist.mjs (.cache/uwopt_intraday/<id>_<date>.json). Usage: node opt_prefetch.mjs [file] [monthPrefix|all]
import fs from 'node:fs';
import { UW_API_KEY } from '../../feeds/env.js';
const D = JSON.parse(fs.readFileSync(new URL('./' + (process.argv[2] ?? 'skylit_all.json'), import.meta.url), 'utf8')), PFX = process.argv[3] ?? 'all';
const CACHE = new URL('../../.cache/uwopt_intraday/', import.meta.url); fs.mkdirSync(CACHE, { recursive: true });
const et = (iso) => { const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(iso)); return +p.find((x) => x.type === 'hour').value * 60 + +p.find((x) => x.type === 'minute').value; };
let got = 0, had = 0, miss = 0;
for (const s of D.sessions) {
  if (PFX !== 'all' && !s.d.startsWith(PFX)) continue;
  const lo = Math.floor(Math.min(...s.bars.map((b) => b[3]))) - 2, hi = Math.ceil(Math.max(...s.bars.map((b) => b[2]))) + 2;
  for (let K = lo; K <= hi; K++) for (const cp of ['C', 'P']) {
    const d = s.d, id = `${s.T}${d.slice(2, 4)}${d.slice(5, 7)}${d.slice(8, 10)}${cp}${String(K * 1000).padStart(8, '0')}`, f = new URL(`${id}_${d}.json`, CACHE);
    if (fs.existsSync(f)) { had++; continue; }
    await new Promise((r) => setTimeout(r, 120));
    let r = null; for (let a = 0; a < 3 && !r?.ok; a++) { r = await fetch(`https://api.unusualwhales.com/api/option-contract/${id}/intraday?date=${d}`, { headers: { Authorization: `Bearer ${UW_API_KEY}` } }).catch(() => null); if (!r?.ok) await new Promise((x) => setTimeout(x, 2000)); }
    if (!r?.ok) { miss++; continue; }
    const rows = ((await r.json()).data ?? []).map((q) => ({ m: et(q.start_time), c: +q.close, h: +q.high, l: +q.low })).filter((q) => q.c > 0).sort((a, b) => a.m - b.m);
    fs.writeFileSync(f, JSON.stringify(rows)); got++;
  }
  console.log(s.d, s.T, 'fetched', got, 'cached', had, 'failed', miss);
}
console.log('done fetched', got, 'cached', had, 'failed', miss);
