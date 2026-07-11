// Overnight exit-study — DATA FOUNDATION (research only).
// Builds a consolidated fire dataset with REAL option-mark paths + underlying
// 1-min bars, so exit strategies (trailing / EMA / VWAP / ATR / time / technical)
// can be backtested on true P&L rather than spot-approximation.
//
// Sources:
//   - scripts/out/replay-fires-*.json : 1339 engine fires (Apr10-Jul08), spot-based
//   - data/gexester.db tracked_plays  : live fires (Jul09-10), de-duped 1/fire
// For each fire: pull UW /option-contract/{occ}/intraday (real marks, cached),
// and per (day,ticker) pull UW /stock/{t}/ohlc/1m (underlying, cached).
// SPXW underlying technicals proxy to SPY (same index, ~0.99 intraday corr).
import '../../scripts/_env-bootstrap.js';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, 'cache');
const UND = path.join(HERE, 'cache_underlying');
fs.mkdirSync(UND, { recursive: true });
const KEY = process.env.UNUSUAL_WHALES_API_KEY || process.env.UW_API_KEY;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const occ = (t, day, dir, K) =>
  `${t}${day.slice(2, 4)}${day.slice(5, 7)}${day.slice(8, 10)}${dir > 0 ? 'C' : 'P'}${String(Math.round(K * 1000)).padStart(8, '0')}`;

async function pull(url, file) {
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(15000) });
      if (r.status === 429) { await sleep(2000 * (a + 1)); continue; }
      if (!r.ok) { fs.writeFileSync(file, '[]'); return []; }
      const rows = (await r.json())?.data || [];
      fs.writeFileSync(file, JSON.stringify(rows));
      await sleep(380);
      return rows;
    } catch { await sleep(1000); }
  }
  fs.writeFileSync(file, '[]'); return [];
}

// ---- gather fires ----
const replay = JSON.parse(fs.readFileSync(path.join(HERE, '..', '..', 'scripts', 'out', 'replay-fires-2026-04-10_2026-07-08.json'), 'utf8'));
const fires = replay.map(f => ({
  src: 'replay', day: f.day, ticker: f.ticker, state: f.state, dir: f.dir, K: f.K,
  fireTsMs: f.fireTsMs, sym: occ(f.ticker, f.day, f.dir, f.K),
}));
// live fires (de-duped: 1 row per fire event = pick the actually-entered contract)
const db = new Database(path.join(HERE, '..', '..', 'data', 'gexester.db'), { readonly: true });
const live = db.prepare(`SELECT trading_day day, ticker, state, option_symbol sym, strike K, option_type,
    fire_ts_ms fireTsMs, entry_mark FROM tracked_plays WHERE entry_mark>0 AND trading_day>='2026-07-09'`).all();
// collapse any multi-strike live dupes: one per (fireTsMs,ticker,state) nearest ATM already entered
for (const l of live) fires.push({ src: 'live', day: l.day, ticker: l.ticker, state: l.state,
  dir: l.option_type === 'call' ? 1 : -1, K: l.K, fireTsMs: l.fireTsMs, sym: l.sym, entry_mark: l.entry_mark });

console.log(`fires: ${fires.length} (replay ${replay.length} + live ${live.length})`);

// ---- pull underlying 1m per (day,ticker) ----
const undKey = t => (t === 'SPXW' ? 'SPY' : t);   // SPXW proxied to SPY
const dayTk = [...new Set(fires.map(f => `${f.day}|${undKey(f.ticker)}`))];
console.log(`underlying pulls: ${dayTk.length}`);
let u = 0;
for (const dt of dayTk) {
  const [day, t] = dt.split('|');
  await pull(`https://api.unusualwhales.com/api/stock/${t}/ohlc/1m?date=${day}`, path.join(UND, `${t}_${day}.json`));
  if (++u % 25 === 0) console.log(`  underlying ${u}/${dayTk.length}`);
}

// ---- pull option marks per fire ----
console.log(`option pulls: ${fires.length}`);
let n = 0, ok = 0;
for (const f of fires) {
  const rows = await pull(`https://api.unusualwhales.com/api/option-contract/${f.sym}/intraday?date=${f.day}`,
    path.join(CACHE, `${f.sym}_${f.day}.json`));
  if (rows.length) ok++;
  if (++n % 100 === 0) console.log(`  option ${n}/${fires.length}  withData=${ok}`);
}
fs.writeFileSync(path.join(HERE, 'fires_index.json'), JSON.stringify(fires));
console.log(`DONE. fires_index.json written. option series withData: ${ok}/${fires.length}`);
