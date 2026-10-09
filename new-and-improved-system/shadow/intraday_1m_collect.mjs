#!/usr/bin/env node
// Trade-rule factory data: UW 1-minute bars WITH volume (pre-market / regular / post) for SPY QQQ IWM DIA, every trading
// day 2023-01-03 → 2026-10-02 → .cache/uw/m1/{T}/{d}.json [{t, o, h, l, c, v, m}]. Resumable; stops at the UW daily limit.
//   node shadow/intraday_1m_collect.mjs
import fs from 'node:fs';
import path from 'node:path';
import { UW_API_KEY } from '../feeds/env.js';
import { isTradingDay } from '../world/prices_clean.mjs';

const NIS = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), '..'), OUT = path.join(NIS, '.cache', 'uw', 'm1');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = (s) => console.error(`${new Date().toISOString().slice(11, 19)} ${s}`);
const DAYS = []; for (let d = '2023-01-03'; d <= '2026-10-02'; d = new Date(Date.parse(d + 'T12:00:00Z') + 864e5).toISOString().slice(0, 10)) if (isTradingDay(d)) DAYS.push(d);
let LIMIT = false, n = 0;
for (const T of ['SPY', 'QQQ', 'IWM', 'DIA']) { fs.mkdirSync(path.join(OUT, T), { recursive: true });
  for (const d of DAYS) { if (LIMIT) break; const f = path.join(OUT, T, `${d}.json`); if (fs.existsSync(f)) continue;
    for (let k = 0; k < 5; k++) { await sleep(150); const r = await fetch(`https://api.unusualwhales.com/api/stock/${T}/ohlc/1m?date=${d}&limit=1000`, { headers: { Authorization: `Bearer ${UW_API_KEY}` } }).catch(() => null);
      if (r?.status === 429) { const b = await r.text().catch(() => ''); if (b.includes('daily_request_limit_hit')) { LIMIT = true; log('UW daily limit — stopping'); break; } await sleep(4000 * (k + 1)); continue; }
      if (!r?.ok) { await sleep(1500); continue; } const j = await r.json().catch(() => null); if (!j) break;
      const bars = (j.data ?? []).map((b) => ({ t: Math.floor(Date.parse(b.start_time) / 1000), o: +b.open, h: +b.high, l: +b.low, c: +b.close, v: +b.volume, m: b.market_time })).sort((a, b) => a.t - b.t);
      fs.writeFileSync(f, JSON.stringify(bars)); if (++n % 500 === 0) log(`${n} day-files`); break; } }
  log(`${T} done`); }
log(`run done: ${n} new day-files${LIMIT ? ' (daily limit — re-run after 8pm ET)' : ''}`);
