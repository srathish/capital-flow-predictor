#!/usr/bin/env node
// Wing-price collector for DESIGN_iron_fly.md: for every cached straddle day (.cache/straddle/{T}/{d}.json), the OTM call at
// round(entry × (1 + w)) and put at round(entry × (1 − w)), w ∈ {0.5%, 1%, 1.5%, 2%}, expiry d.
//   T1: entry = d−1 close; UW /option-contract/{id}/historic → keep the d−1 row (bid/ask).
//   T2: entry = 09:35 price; UW /option-contract/{id}/intraday?date=d → keep 09:30–10:00 one-minute rows.
// If the exact strike is not listed, the nearest listed strike further out (up to $5) is used (amendment 1).
// → .cache/straddle_wings/{T}/{d}.json { v: 2, d, t1: {key: {date,bid,ask,strike}|null}, t2: {key: [{m,c}]}, t2k: {key: strike} }
// key = 'C'/'P' + target strike. Resumable (v1 files are completed, not refetched); stops at the UW daily limit.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UW_API_KEY } from '../feeds/env.js';

const NIS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..'), C = path.join(NIS, '.cache'), IN = path.join(C, 'straddle'), OUT = path.join(C, 'straddle_wings');
const W = [0.005, 0.01, 0.015, 0.02];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = (s) => console.error(`${new Date().toISOString().slice(11, 19)} ${s}`);
let LIMIT = false, calls = 0;
async function uw(p) { for (let k = 0; k < 5 && !LIMIT; k++) { await sleep(130); calls++; const r = await fetch(`https://api.unusualwhales.com/api${p}`, { headers: { Authorization: `Bearer ${UW_API_KEY}` } }).catch(() => null);
  if (r?.status === 429) { const b = await r.text().catch(() => ''); if (b.includes('daily_request_limit_hit')) { LIMIT = true; log('UW daily limit — stopping'); return null; } await sleep(4000 * (k + 1)); continue; }
  if (r?.status === 404 || r?.status === 422) return null; if (!r?.ok) { await sleep(1500); continue; } return r.json().catch(() => null); } return null; }
const occ = (T, d, cp, k) => `${T}${d.slice(2, 4)}${d.slice(5, 7)}${d.slice(8, 10)}${cp}${String(Math.round(k * 1000)).padStart(8, '0')}`;
const etMin = (iso, d) => { const off = +new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(new Date(d + 'T16:00:00Z')) - 16; const t = new Date(iso); return ((t.getUTCHours() + off + 24) % 24) * 60 + t.getUTCMinutes(); };
export const wingStrikes = (px) => W.map((w) => ({ w, C: Math.round(px * (1 + w)), P: Math.round(px * (1 - w)) }));

async function t1Leg(T, d, pd, cp, k) { for (let x = 0; x <= 5 && !LIMIT; x++) { const kk = cp === 'C' ? k + x : k - x, j = await uw(`/option-contract/${occ(T, d, cp, kk)}/historic`);
  const r = (j?.chains ?? []).find((y) => y.date === pd); if (r) return { date: r.date, bid: +r.nbbo_bid, ask: +r.nbbo_ask, strike: kk }; if (j?.chains?.length) return null; } return null; }
async function t2Leg(T, d, cp, k) { for (let x = 0; x <= 5 && !LIMIT; x++) { const kk = cp === 'C' ? k + x : k - x, j = await uw(`/option-contract/${occ(T, d, cp, kk)}/intraday?date=${d}`);
  const rows = (j?.data ?? []).map((r) => ({ m: etMin(r.start_time, d), c: +r.close })).filter((r) => r.m >= 570 && r.m <= 600).sort((a, b) => a.m - b.m);
  if (rows.length) return { rows, k: kk }; if (j?.data?.length) return { rows: [], k }; } return { rows: [], k }; }

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const dry = process.argv.includes('--dry');
  for (const T of ['SPY', 'QQQ']) { fs.mkdirSync(path.join(OUT, T), { recursive: true }); const bars = JSON.parse(fs.readFileSync(path.join(C, 'uwgreeks', `${T}_ohlc.json`), 'utf8')), bi = new Map(bars.map((b, i) => [b.d, i]));
    for (const fn of fs.readdirSync(path.join(IN, T)).sort()) { if (LIMIT) break; const f = path.join(OUT, T, fn), prev = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; if (prev?.v === 2) continue;
      const S = JSON.parse(fs.readFileSync(path.join(IN, T, fn), 'utf8')), d = S.d, i = bi.get(d); if (i == null || i < 1) continue;
      const pd = bars[i - 1].d, out = { v: 2, d, t1: prev?.t1 ?? {}, t2: prev?.t2 ?? {}, t2k: prev?.t2k ?? {} };
      for (const s of wingStrikes(S.prevClose)) for (const cp of ['C', 'P']) { const k = s[cp], key = cp + k; if (out.t1[key]) continue; if (dry) { out.t1[key] = null; continue; } out.t1[key] = await t1Leg(T, d, pd, cp, k); }
      if (S.t2?.px935 && d >= '2025-04-01') for (const s of wingStrikes(S.t2.px935)) for (const cp of ['C', 'P']) { const k = s[cp], key = cp + k; if (out.t2[key]?.length) continue;
        if (dry) { out.t2[key] = []; continue; } const r = await t2Leg(T, d, cp, k); out.t2[key] = r.rows; out.t2k[key] = r.k; }
      if (LIMIT) break; if (dry) { console.log(T, d, JSON.stringify(out)); process.exit(0); } fs.writeFileSync(f, JSON.stringify(out)); if (calls % 400 < 16) log(`${T} ${d} (${calls} calls)`); }
    log(`${T} done`); }
  log(`run done: ${calls} calls${LIMIT ? ' (daily limit — re-run after 8pm ET)' : ''}`); }
