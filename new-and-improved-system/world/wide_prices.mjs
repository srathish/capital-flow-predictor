#!/usr/bin/env node
// v5 wide-universe retest (DESIGN_v5 addendum): UW daily bars 2022-10 → now for every SEC operating company that has XBRL revenue
// facts (.cache/edgar/facts) and no cached bars yet → .cache/wdaily/<T>.json (same format as universe_prices.mjs). UW quota only.
import fs from 'node:fs';
import path from 'node:path';
import { UW_API_KEY } from '../feeds/env.js';
import { universeV2 } from './universe_prices.mjs';

const ROOT = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), '..'), C = path.join(ROOT, '.cache'), OUT = path.join(C, 'wdaily');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let next = 0; const gate = async () => { const now = Date.now(), t = Math.max(now, next); next = t + 110; if (t > now) await sleep(t - now); };
async function uw(p) { for (let k = 0; k < 6; k++) { await gate(); const r = await fetch(`https://api.unusualwhales.com/api${p}`, { headers: { Authorization: `Bearer ${UW_API_KEY}`, Accept: 'application/json' } }).catch(() => null);
  if (r?.status === 429) { next = Date.now() + 8000 * (k + 1); continue; } return r?.ok ? r.json().catch(() => null) : null; } return null; }
const hasRev = (t) => { const f = path.join(C, 'edgar', 'facts', `${t}.json`); return fs.existsSync(f) && !!JSON.parse(fs.readFileSync(f, 'utf8')).rev; };
const L = universeV2(1e9).map((x) => x.t).filter((t) => !fs.existsSync(path.join(OUT, `${t}.json`)) && hasRev(t));
console.error(`${L.length} tickers to fetch`); let n = 0, empty = 0;
async function worker() { while (L.length) { const t = L.shift(), m = new Map();
  for (const end of ['2026-10-03', '2025-10-03', '2024-10-03', '2023-10-03']) { const j = await uw(`/stock/${t}/ohlc/1d?end_date=${end}&limit=2500`);
    for (const b of j?.data ?? []) if (b.market_time === 'r') m.set(b.date, { d: b.date, o: +b.open, h: +b.high, l: +b.low, c: +b.close, v: +b.volume }); }
  const bars = [...m.values()].sort((a, b) => a.d.localeCompare(b.d)); if (!bars.length) empty++;
  fs.writeFileSync(path.join(OUT, `${t}.json`), JSON.stringify(bars)); if (++n % 200 === 0) console.error(`… ${n} (${empty} empty)`); } }
await Promise.all(Array.from({ length: 4 }, worker)); console.error(`done ${n} · empty ${empty}`);
