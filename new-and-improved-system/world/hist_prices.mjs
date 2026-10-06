#!/usr/bin/env node
// v5 2012–2022 test (DESIGN_v5 addendum 2): UW daily bars 2009-10 → 2022-10 for every ticker with cached recent bars
// (.cache/wdaily, non-empty) → .cache/wdaily_hist/<T>.json. 13 yearly pages per ticker. UW quota only, 0 Skylit credits.
import fs from 'node:fs';
import path from 'node:path';
import { UW_API_KEY } from '../feeds/env.js';

const ROOT = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), '..'), C = path.join(ROOT, '.cache'), OUT = path.join(C, 'wdaily_hist');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let next = 0; const gate = async () => { const now = Date.now(), t = Math.max(now, next); next = t + 110; if (t > now) await sleep(t - now); };
async function uw(p) { for (let k = 0; k < 6; k++) { await gate(); const r = await fetch(`https://api.unusualwhales.com/api${p}`, { headers: { Authorization: `Bearer ${UW_API_KEY}`, Accept: 'application/json' } }).catch(() => null);
  if (r?.status === 429) { next = Date.now() + 8000 * (k + 1); continue; } return r?.ok ? r.json().catch(() => null) : null; } return null; }
fs.mkdirSync(OUT, { recursive: true });
const L = fs.readdirSync(path.join(C, 'wdaily')).filter((f) => !fs.existsSync(path.join(OUT, f)) && fs.statSync(path.join(C, 'wdaily', f)).size > 2).map((f) => f.replace('.json', ''));
console.error(`${L.length} tickers to fetch`); let n = 0, empty = 0;
async function worker() { while (L.length) { const t = L.shift(), m = new Map();
  for (let y = 2022; y >= 2010; y--) { const j = await uw(`/stock/${t}/ohlc/1d?end_date=${y}-10-03&limit=2500`); const d = j?.data ?? [];
    for (const b of d) if (b.market_time === 'r' && b.date < '2022-10-03') m.set(b.date, { d: b.date, o: +b.open, h: +b.high, l: +b.low, c: +b.close, v: +b.volume });
    if (!d.length) break; } // listed later than this year — stop paging back
  const bars = [...m.values()].sort((a, b) => a.d.localeCompare(b.d)); if (!bars.length) empty++;
  fs.writeFileSync(path.join(OUT, `${t}.json`), JSON.stringify(bars)); if (++n % 200 === 0) console.error(`… ${n} (${empty} empty)`); } }
await Promise.all(Array.from({ length: 4 }, worker)); console.error(`done ${n} · empty ${empty}`);
