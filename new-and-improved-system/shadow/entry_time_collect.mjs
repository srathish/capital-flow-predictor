#!/usr/bin/env node
// 0DTE entry-time collector (vol program 2): for SPY / QQQ, each day d ≥ 2025-04-01 with a cached straddle file, the ATM
// (nearest the price at the entry time) call + put expiring d at entry times 10:30, 12:00, 14:00 ET → UW
// /option-contract/{id}/intraday?date=d; keeps one-minute closes in [time, time + 5]. → .cache/straddle_times/{T}/{d}.json
// { px: {630, 720, 840}, legs: {time: {strike, C: [{m,c}], P: [{m,c}]}} }. Resumable; stops at the UW daily limit.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UW_API_KEY } from '../feeds/env.js';

const C = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.cache'), OUT = path.join(C, 'straddle_times'), TIMES = [630, 720, 840];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = (s) => console.error(`${new Date().toISOString().slice(11, 19)} ${s}`);
let LIMIT = false, calls = 0;
async function uw(p) { for (let k = 0; k < 5 && !LIMIT; k++) { await sleep(130); calls++; const r = await fetch(`https://api.unusualwhales.com/api${p}`, { headers: { Authorization: `Bearer ${UW_API_KEY}` } }).catch(() => null);
  if (r?.status === 429) { const b = await r.text().catch(() => ''); if (b.includes('daily_request_limit_hit')) { LIMIT = true; log('UW daily limit — stopping'); return null; } await sleep(4000 * (k + 1)); continue; }
  if (r?.status === 404 || r?.status === 422) return { data: [] }; if (!r?.ok) { await sleep(1500); continue; } return r.json().catch(() => null); } return null; }
const occ = (T, d, cp, k) => `${T}${d.slice(2, 4)}${d.slice(5, 7)}${d.slice(8, 10)}${cp}${String(Math.round(k * 1000)).padStart(8, '0')}`;
const etMin = (iso, d) => { const off = +new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(new Date(d + 'T16:00:00Z')) - 16; const t = new Date(iso); return ((t.getUTCHours() + off + 24) % 24) * 60 + t.getUTCMinutes(); };
const etMinU = (t, d) => etMin(new Date(t * 1000).toISOString(), d);
for (const T of ['SPY', 'QQQ']) { fs.mkdirSync(path.join(OUT, T), { recursive: true });
  for (const fn of fs.readdirSync(path.join(C, 'straddle', T)).sort()) { const d = fn.slice(0, 10); if (d < '2025-04-01' || LIMIT) continue; const f = path.join(OUT, T, fn); if (fs.existsSync(f)) continue;
    const m1f = path.join(C, 'uw', 'm1', T, fn); if (!fs.existsSync(m1f)) continue; const m = JSON.parse(fs.readFileSync(m1f, 'utf8')).filter((b) => b.m === 'r').map((b) => ({ m: etMinU(b.t, d), c: b.c }));
    const out = { d, px: {}, legs: {} }, cache = new Map();
    for (const tm of TIMES) { const b = m.filter((x) => x.m <= tm - 1).at(-1); if (!b || b.m < tm - 5) continue; const px = b.c, k = Math.round(px); out.px[tm] = px; const leg = { strike: k };
      for (const cp of ['C', 'P']) { const id = occ(T, d, cp, k); if (!cache.has(id)) { const j = await uw(`/option-contract/${id}/intraday?date=${d}`); if (!j) break; cache.set(id, (j.data ?? []).map((r) => ({ m: etMin(r.start_time, d), c: +r.close }))); }
        leg[cp] = cache.get(id).filter((r) => r.m >= tm && r.m <= tm + 5).sort((a, b) => a.m - b.m); }
      out.legs[tm] = leg; }
    if (LIMIT) break; fs.writeFileSync(f, JSON.stringify(out)); if (calls % 200 < 6) log(`${T} ${d} (${calls} calls)`); }
  log(`${T} done`); }
log(`run done: ${calls} calls${LIMIT ? ' (daily limit — re-run after 8pm ET)' : ''}`);
