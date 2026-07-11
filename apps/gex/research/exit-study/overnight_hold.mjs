// Overnight study Phase 2b — OVERNIGHT / MULTI-DAY HOLD (research only).
// The real swing test: enter the 1-DTE / 2-DTE contract at the BULL_REVERSE fire
// on day D, HOLD past the close, exit next day(s). Tests whether letting the
// directional move develop (without 0DTE terminal decay) converts the catch —
// vs the 0DTE same-day EOD baseline (+12%). Train/test split preserved.
import '../../scripts/_env-bootstrap.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, 'cache'), ALT = path.join(HERE, 'cache_alt');
const KEY = process.env.UNUSUAL_WHALES_API_KEY || process.env.UW_API_KEY;
const load = f => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : []);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const occ = (t, day, dir, K) => `${t}${day.slice(2, 4)}${day.slice(5, 7)}${day.slice(8, 10)}${dir > 0 ? 'C' : 'P'}${String(Math.round(K * 1000)).padStart(8, '0')}`;
function ntd(day, n) { const d = new Date(day + 'T00:00:00Z'); let a = 0; while (a < n) { d.setUTCDate(d.getUTCDate() + 1); const w = d.getUTCDay(); if (w && w !== 6) a++; } return d.toISOString().slice(0, 10); }
async function pull(sym, day) {
  const file = path.join(ALT, `${sym}_${day}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  for (let a = 0; a < 3; a++) { try {
    const r = await fetch(`https://api.unusualwhales.com/api/option-contract/${sym}/intraday?date=${day}`, { headers: { Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(15000) });
    if (r.status === 429) { await sleep(2000); continue; }
    if (!r.ok) { fs.writeFileSync(file, '[]'); return []; }
    const rows = (await r.json())?.data || []; fs.writeFileSync(file, JSON.stringify(rows)); await sleep(370); return rows;
  } catch { await sleep(800); } }
  fs.writeFileSync(file, '[]'); return [];
}
const bars = rows => rows.map(c => ({ ts: Date.parse(c.start_time), close: +c.close })).filter(c => c.close > 0).sort((a, b) => a.ts - b.ts);
const entryOf = (dayBars, fireTs) => { const i = dayBars.findIndex(o => o.ts >= fireTs + 60000); return i < 0 ? null : dayBars[i].close; };
// walk a concatenated multi-day path from entry; return {eod (last close), tgtStop (+100/-60 whichever first)}
function walk(pathBars, entry) {
  let out = { eod: (pathBars.at(-1).close - entry) / entry, ts: null };
  for (const b of pathBars) { const g = (b.close - entry) / entry; if (g >= 1.0 || g <= -0.6) { out.tgtStop = g; break; } }
  if (out.tgtStop == null) out.tgtStop = out.eod;
  return out;
}

const fires = load(path.join(HERE, 'fires_index.json')).filter(f => f.state === 'BULL_REVERSE');
const days = [...new Set(fires.map(f => f.day))].sort();
const split = days[Math.floor(days.length / 2)];
const recs = []; let n = 0;
for (const f of fires) {
  const D = f.day, e1 = ntd(D, 1), e2 = ntd(D, 2);
  const s1 = occ(f.ticker, e1, f.dir, f.K), s2 = occ(f.ticker, e2, f.dir, f.K);
  // day-D bars (already cached from instrument test) for entry + intraday
  const d1D = bars(load(path.join(ALT, `${s1}_${D}.json`))), d2D = bars(load(path.join(ALT, `${s2}_${D}.json`)));
  const en1 = d1D.length >= 4 ? entryOf(d1D, f.fireTsMs) : null;
  const en2 = d2D.length >= 4 ? entryOf(d2D, f.fireTsMs) : null;
  const rec = { isTest: D >= split };
  // 0DTE same-day EOD baseline
  const d0 = bars(load(path.join(CACHE, `${f.sym}_${D}.json`))); const en0 = d0.length >= 4 ? entryOf(d0, f.fireTsMs) : null;
  if (en0) rec.zeroEod = (d0.at(-1).close - en0) / en0;
  // 1-DTE: hold D (from fire) + D+1 (expiry)
  if (en1) {
    const d1N = bars(await pull(s1, e1));
    const p = [...d1D.filter(b => b.ts >= f.fireTsMs), ...d1N];
    if (p.length) { const w = walk(p, en1); rec.oneNight = w.eod; rec.oneTgt = w.tgtStop; }
  }
  // 2-DTE: hold to D+1 EOD (1 night) and D+2 (expiry, 2 nights)
  if (en2) {
    const d2n1 = bars(await pull(s2, e1)), d2n2 = bars(await pull(s2, e2));
    if (d2n1.length) rec.two1night = (d2n1.at(-1).close - en2) / en2;
    const p = [...d2D.filter(b => b.ts >= f.fireTsMs), ...d2n1, ...d2n2];
    if (p.length) { const w = walk(p, en2); rec.twoExpiry = w.eod; rec.twoTgt = w.tgtStop; }
  }
  recs.push(rec);
  if (++n % 100 === 0) console.log(`  ${n}/${fires.length}`);
}
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
const pct = x => Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${(x * 100).toFixed(0)}%` : '  -';
function row(label, key) {
  const all = recs.map(r => r[key]).filter(Number.isFinite);
  const tr = recs.filter(r => !r.isTest).map(r => r[key]).filter(Number.isFinite), te = recs.filter(r => r.isTest).map(r => r[key]).filter(Number.isFinite);
  console.log(label.padEnd(26) + `n=${String(all.length).padStart(4)}  avg ${pct(mean(all)).padStart(6)}  (train ${pct(mean(tr)).padStart(6)} / test ${pct(mean(te)).padStart(6)})  win ${(all.filter(x => x > 0).length / all.length * 100).toFixed(0)}%`);
}
console.log(`\nOVERNIGHT-HOLD TEST — BULL_REVERSE, ${recs.length} fires (split ${split})\n`);
row('0DTE same-day EOD (base)', 'zeroEod');
row('1-DTE hold to expiry(+1)', 'oneNight');
row('1-DTE +100/-60 tgt-stop', 'oneTgt');
row('2-DTE hold 1 night', 'two1night');
row('2-DTE hold to expiry(+2)', 'twoExpiry');
row('2-DTE +100/-60 tgt-stop', 'twoTgt');
