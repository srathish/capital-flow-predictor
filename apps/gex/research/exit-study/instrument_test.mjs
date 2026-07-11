// Overnight study Phase 2 — INSTRUMENT test (research only).
// Same BULL_REVERSE signal, same strike, same entry time — but 1-DTE / 2-DTE
// expiries instead of 0DTE. Isolates the theta/gamma tradeoff: does less decay
// convert the huge MFE (+100%+) into better realized P&L?
// Same-day exits (30m + EOD) on the fire day, so it's an apples-to-apples
// intraday comparison. Train/test split preserved.
import '../../scripts/_env-bootstrap.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, 'cache');           // 0DTE (already built)
const ALT = path.join(HERE, 'cache_alt');         // 1/2-DTE
fs.mkdirSync(ALT, { recursive: true });
const KEY = process.env.UNUSUAL_WHALES_API_KEY || process.env.UW_API_KEY;
const load = f => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : []);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const occ = (t, day, dir, K) => `${t}${day.slice(2, 4)}${day.slice(5, 7)}${day.slice(8, 10)}${dir > 0 ? 'C' : 'P'}${String(Math.round(K * 1000)).padStart(8, '0')}`;
function nextTradingDay(day, n) {
  const d = new Date(day + 'T00:00:00Z'); let added = 0;
  while (added < n) { d.setUTCDate(d.getUTCDate() + 1); const wd = d.getUTCDay(); if (wd !== 0 && wd !== 6) added++; }
  return d.toISOString().slice(0, 10);
}
async function pull(sym, day, dir) {
  const file = path.join(dir, `${sym}_${day}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch(`https://api.unusualwhales.com/api/option-contract/${sym}/intraday?date=${day}`, { headers: { Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(15000) });
      if (r.status === 429) { await sleep(2000); continue; }
      if (!r.ok) { fs.writeFileSync(file, '[]'); return []; }
      const rows = (await r.json())?.data || []; fs.writeFileSync(file, JSON.stringify(rows)); await sleep(370); return rows;
    } catch { await sleep(800); }
  }
  fs.writeFileSync(file, '[]'); return [];
}
function outcome(rows, fireTsMs) {
  const opt = rows.map(c => ({ ts: Date.parse(c.start_time), close: +c.close })).filter(c => c.close > 0).sort((a, b) => a.ts - b.ts);
  if (opt.length < 4) return null;
  const ei = opt.findIndex(o => o.ts >= fireTsMs + 60000); if (ei < 0 || ei >= opt.length - 2) return null;
  const entry = opt[ei].close, steps = opt.slice(ei), t0 = steps[0].ts;
  let mfe = -1, e30 = null;
  for (const s of steps) { const g = (s.close - entry) / entry; if (g > mfe) mfe = g; if (e30 == null && s.ts - t0 >= 30 * 60000) e30 = g; }
  if (e30 == null) e30 = (steps.at(-1).close - entry) / entry;
  return { mfe, e30, eod: (steps.at(-1).close - entry) / entry };
}

const fires = load(path.join(HERE, 'fires_index.json')).filter(f => f.state === 'BULL_REVERSE');
const days = [...new Set(fires.map(f => f.day))].sort();
const split = days[Math.floor(days.length / 2)];
const recs = [];
let n = 0;
for (const f of fires) {
  const o0 = outcome(load(path.join(CACHE, `${f.sym}_${f.day}.json`)), f.fireTsMs);
  if (!o0) continue;
  const s1 = occ(f.ticker, nextTradingDay(f.day, 1), f.dir, f.K);
  const s2 = occ(f.ticker, nextTradingDay(f.day, 2), f.dir, f.K);
  const o1 = outcome(await pull(s1, f.day, ALT), f.fireTsMs);
  const o2 = outcome(await pull(s2, f.day, ALT), f.fireTsMs);
  recs.push({ isTest: f.day >= split, o0, o1, o2 });
  if (++n % 100 === 0) console.log(`  ${n}/${fires.length}`);
}
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
const pct = x => Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${(x * 100).toFixed(0)}%` : '  -';
function row(label, sel) {
  const all = recs.map(sel).filter(Boolean);
  const tr = recs.filter(r => !r.isTest).map(sel).filter(Boolean), te = recs.filter(r => r.isTest).map(sel).filter(Boolean);
  console.log(label.padEnd(12) +
    `  n=${String(all.length).padStart(4)}  MFE ${pct(mean(all.map(o => o.mfe))).padStart(6)}` +
    `  exit30 ${pct(mean(all.map(o => o.e30))).padStart(6)} (tr ${pct(mean(tr.map(o => o.e30)))}/te ${pct(mean(te.map(o => o.e30)))})` +
    `  EOD ${pct(mean(all.map(o => o.eod))).padStart(6)}`);
}
console.log(`\nINSTRUMENT TEST — BULL_REVERSE, same strike/entry, ${recs.length} fires (split ${split})\n`);
row('0DTE', r => r.o0);
row('1-DTE', r => r.o1);
row('2-DTE', r => r.o2);
console.log('\n(exit30/EOD on the fire day; 1-2DTE would ALSO allow an overnight hold — not tested here)');
