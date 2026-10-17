#!/usr/bin/env node
// Adds the real ATM 0DTE option leg (UW minute prices) to every break in skylit_replay_data.json: entry, exit, peak while held, peak by close.
import fs from 'node:fs';
import { UW_API_KEY } from '../../feeds/env.js';
const F = new URL('./' + (process.argv[2] ?? 'skylit_replay_data.json'), import.meta.url), D = JSON.parse(fs.readFileSync(F, 'utf8'));
const et = (iso) => { const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(iso)); return +p.find((x) => x.type === 'hour').value * 60 + +p.find((x) => x.type === 'minute').value; };
let n = 0, ok = 0;
for (const s of D.sessions) for (const x of s.breaks) { n++; const K = Math.round(x.entry), cp = x.dir > 0 ? 'C' : 'P', d = s.d, id = `${s.T}${d.slice(2, 4)}${d.slice(5, 7)}${d.slice(8, 10)}${cp}${String(K * 1000).padStart(8, '0')}`;
  await new Promise((r) => setTimeout(r, 130)); const r = await fetch(`https://api.unusualwhales.com/api/option-contract/${id}/intraday?date=${d}`, { headers: { Authorization: `Bearer ${UW_API_KEY}` } }).catch(() => null);
  const rows = r?.ok ? ((await r.json()).data ?? []).map((q) => ({ m: et(q.start_time), c: +q.close, h: +q.high, l: +q.low })).filter((q) => q.c > 0).sort((a, b) => a.m - b.m) : [];
  const en = rows.find((q) => q.m >= x.m), ex = rows.filter((q) => q.m <= x.exitM).at(-1); if (!en || !ex) { x.opt = null; continue; }
  const peak = (lo, hi) => { const w = rows.filter((q) => q.m > lo && q.m <= hi); if (!w.length) return null; const t = w.reduce((a, q) => ((q.h || q.c) > (a.h || a.c) ? q : a)); const px = t.h || t.c; return { px, m: t.m, pct: Math.round((px / en.c - 1) * 100) }; };
  x.optPath = rows.filter((q) => q.m >= en.m && q.m <= 955).map((q) => [q.m, q.l ?? q.c, q.h ?? q.c, q.c]);
  x.opt = { contract: `${s.T} ${K}${cp}`, strike: K, type: cp === 'C' ? 'call' : 'put', entryPx: en.c, exitPx: ex.c, pct: Math.round((ex.c / en.c - 1) * 100), peakHeld: peak(en.m, x.exitM), peakDay: peak(en.m, 959) }; ok++; }
fs.writeFileSync(F, JSON.stringify(D)); console.log('breaks', n, 'with option prices', ok);
