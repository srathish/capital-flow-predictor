#!/usr/bin/env node
// ideas200 part B collector: for every (stock, week) pick, the ATM call + put on the first standard monthly expiry ≥ 28
// days out → UW /option-contract/{id}/historic (whole life, daily rows) cached per contract in .cache/bigmover/contracts/.
// Resumable; stops at the UW daily limit. node shadow/bigmover_collect.mjs [--max=N]
import fs from 'node:fs';
import path from 'node:path';
import { UW_API_KEY } from '../feeds/env.js';
import { isTradingDay } from '../world/prices_clean.mjs';

const NIS = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), '..'), D = path.join(NIS, '.cache', 'bigmover'), CC = path.join(D, 'contracts'); fs.mkdirSync(CC, { recursive: true });
const MAX = +(process.argv.find((a) => a.startsWith('--max='))?.split('=')[1] ?? 36000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = (s) => console.error(`${new Date().toISOString().slice(11, 19)} ${s}`);
let LIMIT = false, calls = 0;
async function uw(p) { for (let k = 0; k < 5 && !LIMIT; k++) { await sleep(120); calls++; const r = await fetch(`https://api.unusualwhales.com/api${p}`, { headers: { Authorization: `Bearer ${UW_API_KEY}` } }).catch(() => null);
  if (r?.status === 429) { const b = await r.text().catch(() => ''); if (b.includes('daily_request_limit_hit')) { LIMIT = true; log('UW daily limit — stopping'); return null; } await sleep(4000 * (k + 1)); continue; }
  if (r?.status === 404 || r?.status === 422) return { chains: [] }; if (!r?.ok) { await sleep(1500); continue; } return r.json().catch(() => null); } return null; }
const addD = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
export function monthlyExpiry(d) { for (let k = 0; k < 4; k++) { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(1); x.setUTCMonth(x.getUTCMonth() + k); const off = (5 - x.getUTCDay() + 7) % 7; let f = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), 1 + off + 14)).toISOString().slice(0, 10); while (!isTradingDay(f)) f = addD(f, -1); if ((Date.parse(f) - Date.parse(d)) / 864e5 >= 28) return f; } return null; }
export const occ = (T, e, cp, k) => `${T.replace(/[.\-]/g, '')}${e.slice(2, 4)}${e.slice(5, 7)}${e.slice(8, 10)}${cp}${String(Math.round(k * 1000)).padStart(8, '0')}`;
export const atmStrike = (raw, strikes) => strikes.reduce((b, k) => (Math.abs(k - raw) < Math.abs(b - raw) ? k : b), strikes[0]);
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const weeks = JSON.parse(fs.readFileSync(path.join(D, 'picks.json'), 'utf8')), want = new Set();
  for (const w of weeks) { const e = monthlyExpiry(w.d); if (!e) continue; for (const p of w.picks) { const k = atmStrike(p.raw, p.strikes); for (const cp of ['C', 'P']) want.add(occ(p.t, e, cp, k)); } }
  const todo = [...want].filter((id) => !fs.existsSync(path.join(CC, `${id}.json`))); log(`${want.size} contracts, ${todo.length} to fetch (cap ${MAX})`);
  let n = 0; for (const id of todo) { if (LIMIT || calls >= MAX) break; const j = await uw(`/option-contract/${id}/historic`); if (!j) continue;
    fs.writeFileSync(path.join(CC, `${id}.json`), JSON.stringify((j.chains ?? []).map((r) => ({ d: r.date, bid: +r.nbbo_bid, ask: +r.nbbo_ask, last: +r.last_price, oi: +r.open_interest, vol: +r.volume })))); if (++n % 1000 === 0) log(`${n}/${todo.length}`); }
  log(`run done: ${n} fetched, ${calls} calls, ${todo.length - n} left${LIMIT ? ' (daily limit)' : ''}`); }
