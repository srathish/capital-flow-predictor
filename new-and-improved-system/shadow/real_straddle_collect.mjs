#!/usr/bin/env node
// Real-price straddle collector (shadow/DESIGN_real_straddle.md): for SPY and QQQ, each day d in the sample —
//   T1: the ATM (nearest the d−1 close) call + put expiring d → UW /option-contract/{id}/historic (whole life, daily rows)
//   T2: the ATM (nearest the 09:35 price on d) call + put expiring d → UW /option-contract/{id}/intraday?date=d
// → .cache/straddle/{T}/{d}.json { t1: {strike, call, put}, t2: {strike, call, put} }. Resumable; stops at the UW daily limit.
import fs from 'node:fs';
import path from 'node:path';
import { UW_API_KEY } from '../feeds/env.js';

const NIS = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), '..'), C = path.join(NIS, '.cache'), OUT = path.join(C, 'straddle');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = (s) => console.error(`${new Date().toISOString().slice(11, 19)} ${s}`);
let LIMIT = false, calls = 0;
async function uw(p) { for (let k = 0; k < 5 && !LIMIT; k++) { await sleep(130); calls++; const r = await fetch(`https://api.unusualwhales.com/api${p}`, { headers: { Authorization: `Bearer ${UW_API_KEY}` } }).catch(() => null);
  if (r?.status === 429) { const b = await r.text().catch(() => ''); if (b.includes('daily_request_limit_hit')) { LIMIT = true; log('UW daily limit — stopping'); return null; } await sleep(4000 * (k + 1)); continue; }
  if (r?.status === 404 || r?.status === 422) return null; if (!r?.ok) { await sleep(1500); continue; } return r.json().catch(() => null); } return null; }
const occ = (T, d, cp, k) => `${T}${d.slice(2, 4)}${d.slice(5, 7)}${d.slice(8, 10)}${cp}${String(Math.round(k * 1000)).padStart(8, '0')}`;
const etMin = (iso, d) => { const off = +new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(new Date(d + 'T16:00:00Z')) - 16; const t = new Date(iso); return ((t.getUTCHours() + off + 24) % 24) * 60 + t.getUTCMinutes(); };
for (const T of ['SPY', 'QQQ']) { fs.mkdirSync(path.join(OUT, T), { recursive: true });
  const bars = JSON.parse(fs.readFileSync(path.join(C, 'uwgreeks', `${T}_ohlc.json`), 'utf8')).filter((b) => b.d >= '2024-01-05' && b.d <= '2026-10-02');
  for (let i = 1; i < bars.length && !LIMIT; i++) { const d = bars[i].d, prev = bars[i - 1], f = path.join(OUT, T, `${d}.json`); if (fs.existsSync(f)) continue;
    const out = { d, prevClose: prev.c, close: bars[i].c };
    // T1 — strike nearest the d−1 close; whole-life daily rows; keep the d−1 row (entry) and d row
    { const k = Math.round(prev.c), legs = {}; for (const cp of ['C', 'P']) { const j = await uw(`/option-contract/${occ(T, d, cp, k)}/historic`); const rows = j?.chains ?? []; legs[cp] = rows.filter((r) => r.date === prev.d || r.date === d).map((r) => ({ date: r.date, bid: +r.nbbo_bid, ask: +r.nbbo_ask, last: +r.last_price, oi: +r.open_interest, vol: +r.volume })); }
      out.t1 = { strike: k, call: legs.C, put: legs.P }; }
    // T2 — strike nearest the 09:35 price (from the 1-minute underlying file)
    { const m1f = path.join(C, 'uw', 'm1', T, `${d}.json`); let px = null; if (fs.existsSync(m1f)) { const m = JSON.parse(fs.readFileSync(m1f, 'utf8')).filter((b) => b.m === 'r'); const b935 = m.find((b) => etMin(new Date(b.t * 1000).toISOString(), d) >= 574); px = b935?.c ?? null; }
      if (px) { const k = Math.round(px), legs = {}; for (const cp of ['C', 'P']) { const j = await uw(`/option-contract/${occ(T, d, cp, k)}/intraday?date=${d}`); const rows = (j?.data ?? []).map((r) => ({ m: etMin(r.start_time, d), o: +r.open, h: +r.high, l: +r.low, c: +r.close })).filter((r) => r.m >= 570 && r.m <= 600).sort((a, b) => a.m - b.m); legs[cp] = rows; }
        out.t2 = { strike: k, px935: px, call: legs.C, put: legs.P }; } }
    if (LIMIT) break; fs.writeFileSync(f, JSON.stringify(out)); if (i % 100 === 0) log(`${T} ${d} (${calls} calls)`); }
  log(`${T} done`); }
log(`run done: ${calls} calls${LIMIT ? ' (daily limit — re-run after 8pm ET)' : ''}`);
