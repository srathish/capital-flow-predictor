// PAIRED MONEYNESS EXPERIMENT — data pull (RESEARCH ONLY, Clause 0).
// The replay set is ATM-ONLY BY CONSTRUCTION (replay-fires.js atmStrike()), so it
// carries no moneyness variation and CANNOT test the moneyness hypothesis as-is.
// Fix: for every replay fire, also pull the option marks for the SAME fire at
// +0.5% / +1.0% / +2.0% OTM. Same signal, same direction, same timestamp — the ONLY
// thing that varies is moneyness. This is the clean causal design.
import '../../scripts/_env-bootstrap.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, 'cache_otm');
fs.mkdirSync(CACHE, { recursive: true });
const KEY = process.env.UNUSUAL_WHALES_API_KEY || process.env.UW_API_KEY;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const occ = (t, day, dir, K) =>
  `${t}${day.slice(2, 4)}${day.slice(5, 7)}${day.slice(8, 10)}${dir > 0 ? 'C' : 'P'}${String(Math.round(K * 1000)).padStart(8, '0')}`;

async function pull(url, file) {
  if (fs.existsSync(file)) return true;
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(15000) });
      if (r.status === 429) { await sleep(2000 * (a + 1)); continue; }
      if (!r.ok) { fs.writeFileSync(file, '[]'); return false; }
      const rows = (await r.json())?.data || [];
      fs.writeFileSync(file, JSON.stringify(rows));
      await sleep(340);
      return rows.length > 0;
    } catch { await sleep(1000); }
  }
  fs.writeFileSync(file, '[]'); return false;
}

const replay = JSON.parse(fs.readFileSync(path.join(HERE, '..', '..', 'scripts', 'out', 'replay-fires-2026-04-10_2026-07-08.json'), 'utf8'));
// strike grid: SPXW = $5, SPY/QQQ = $1  (matches replay-fires.js atmStrike())
const snap = (t, x) => (t === 'SPXW' || t === 'SPX') ? Math.round(x / 5) * 5 : Math.round(x);
const OFFSETS = [0.005, 0.010, 0.020];   // OTM fraction

const jobs = [];
for (const f of replay) {
  for (const off of OFFSETS) {
    // OTM direction: call -> strike above spot; put -> strike below spot
    const K = snap(f.ticker, f.entrySpot * (1 + f.dir * off));
    if (K === f.K) continue;                       // no distinct strike at this offset
    const sym = occ(f.ticker, f.day, f.dir, K);
    jobs.push({ day: f.day, ticker: f.ticker, fireTsMs: f.fireTsMs, dir: f.dir,
      Katm: f.K, K, off, sym, entrySpot: f.entrySpot });
  }
}
// de-dup identical contract pulls (many fires share a day+strike)
const uniq = [...new Map(jobs.map(j => [`${j.sym}|${j.day}`, j])).values()];
console.log(`fires ${replay.length} -> jobs ${jobs.length}, unique contracts ${uniq.length}`);

let n = 0, ok = 0;
for (const j of uniq) {
  if (await pull(`https://api.unusualwhales.com/api/option-contract/${j.sym}/intraday?date=${j.day}`,
    path.join(CACHE, `${j.sym}_${j.day}.json`))) ok++;
  if (++n % 100 === 0) console.log(`  ${n}/${uniq.length}  withData=${ok}`);
}
fs.writeFileSync(path.join(HERE, 'otm_jobs.json'), JSON.stringify(jobs));
console.log(`DONE. ${ok}/${uniq.length} contracts with data. otm_jobs.json written (${jobs.length} fire-legs).`);
