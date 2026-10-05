#!/usr/bin/env node
// World-model universe v2 (DESIGN §1, neutral): the first 1,000 operating companies in SEC's company_tickers.json (ordered roughly by
// current size). The rule is the same for every sector; a stock is only eligible in a month if it passed price ≥ $5 and 50-day
// dollar volume ≥ $20M AT THAT DATE. Daily bars from UW (paged by end_date, 252 sessions per call, 2022→now) → .cache/wdaily/<T>.json.
// UW quota only — 0 Skylit credits. Known bias: today's 1,000 largest = survivorship (stated in DESIGN §8).
import fs from 'node:fs';
import path from 'node:path';
import { UW_API_KEY } from '../feeds/env.js';

const ROOT = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), '..'), OUT = path.join(ROOT, '.cache', 'wdaily');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export function universeV2(n = 1000) {
  const all = Object.values(JSON.parse(fs.readFileSync(path.join(ROOT, '.cache', 'edgar', 'company_tickers.json'), 'utf8')));
  const seen = new Set(), out = [];
  for (const v of all) { if (out.length >= n) break; if (seen.has(v.cik_str)) continue; if (/[-.]/.test(v.ticker) || v.ticker.length > 5) continue; seen.add(v.cik_str); out.push({ t: v.ticker, cik: String(v.cik_str).padStart(10, '0'), name: v.title }); }
  return out;
}
async function uw(p) { for (let k = 0; k < 4; k++) { await sleep(260); const r = await fetch(`https://api.unusualwhales.com/api${p}`, { headers: { Authorization: `Bearer ${UW_API_KEY}`, Accept: 'application/json' } }).catch(() => null);
  if (r?.status === 429) { await sleep(5000 * (k + 1)); continue; } return r?.ok ? r.json().catch(() => null) : null; } return null; }
export const loadW = (t) => { const f = path.join(OUT, `${t}.json`); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : []; };
if (decodeURIComponent(new URL(import.meta.url).pathname) === process.argv[1]) {
  const U = universeV2(); fs.mkdirSync(OUT, { recursive: true }); let n = 0, empty = 0;
  for (const { t } of U) {
    const f = path.join(OUT, `${t}.json`); if (fs.existsSync(f)) { n++; continue; }
    const m = new Map();
    for (const end of ['2026-10-03', '2025-10-03', '2024-10-03', '2023-10-03']) { const j = await uw(`/stock/${t}/ohlc/1d?end_date=${end}&limit=2500`);
      for (const b of j?.data ?? []) if (b.market_time === 'r') m.set(b.date, { d: b.date, o: +b.open, h: +b.high, l: +b.low, c: +b.close, v: +b.volume }); }
    const bars = [...m.values()].sort((a, b) => a.d.localeCompare(b.d)); if (!bars.length) empty++;
    fs.writeFileSync(f, JSON.stringify(bars)); n++;
    if (n % 50 === 0) console.error(`… ${n}/${U.length} (${empty} empty)`);
  }
  console.error(`done ${n} · empty ${empty}`);
}
