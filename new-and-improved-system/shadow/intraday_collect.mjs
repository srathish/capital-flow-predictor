#!/usr/bin/env node
// Amendment 4 collector: UW 5-minute RTH bars per stock per session → compact {o930, c1030, c1100, close}. Resumable.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UW_API_KEY } from '../feeds/env.js';
const W = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.cache', 'winners'), OUT = path.join(W, '_intraday'); fs.mkdirSync(OUT, { recursive: true });
const ETF = new Set(['SPY', 'QQQ', 'XLK', 'XLF', 'XLE', 'XLV', 'XLY', 'XLP', 'XLI', 'XLU', 'XLB', 'XLRE', 'XLC', 'SMH', 'IGV']);
const T = fs.readdirSync(W).filter((f) => f.endsWith('.json') && !f.startsWith('_')).map((f) => f.replace('.json', '')).filter((t) => !ETF.has(t));
const days = JSON.parse(fs.readFileSync(path.join(W, 'NOW.json'), 'utf8')).ohlc.map((b) => b.d).filter((d) => d >= '2026-07-01' && d <= '2026-10-15').sort();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); let LIMIT = false, calls = 0;
async function uw(p) { for (let k = 0; k < 5 && !LIMIT; k++) { await sleep(110); calls++; const r = await fetch(`https://api.unusualwhales.com/api${p}`, { headers: { Authorization: `Bearer ${UW_API_KEY}` } }).catch(() => null);
  if (r?.status === 429) { const b = await r.text().catch(() => ''); if (b.includes('daily_request_limit_hit')) { LIMIT = true; console.error('UW daily limit'); return null; } await sleep(4000 * (k + 1)); continue; } if (!r?.ok) { await sleep(1500); continue; } return r.json().catch(() => null); } return null; }
const etm = (iso, d) => { const off = +new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(new Date(d + 'T16:00:00Z')) - 16; const t = new Date(iso); return ((t.getUTCHours() + off + 24) % 24) * 60 + t.getUTCMinutes(); };
for (const d of days) { const f = path.join(OUT, `${d}.json`); const have = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
  for (const t of T) { if (LIMIT) break; if (t in have) continue; const j = await uw(`/stock/${t}/ohlc/5m?date=${d}&limit=200`); if (!j) continue;
    const b = (j.data ?? []).filter((x) => x.market_time === 'r').map((x) => ({ m: etm(x.start_time, d), o: +x.open, c: +x.close })).sort((a, c) => a.m - c.m);
    const at = (m) => b.filter((x) => x.m <= m).at(-1); const a = b.find((x) => x.m === 570), x1 = at(625), x2 = at(655), z = b.at(-1);
    have[t] = a && x1 && x2 && z && x1.m >= 615 && z.m >= 955 ? [a.o, x1.c, x2.c, z.c] : null; }
  fs.writeFileSync(f, JSON.stringify(have)); console.error(`${d} (${calls} calls)`); if (LIMIT) break; }
console.error(`done ${calls}`);
