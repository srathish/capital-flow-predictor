// PIKA CREDIT SPREADS — leg price fetcher (RESEARCH ONLY, Clause 0).
// Pulls UW option-contract intraday (per-minute OHLC) for every needed contract.
// Cache-first + skip-existing so it is fully resumable. Empty pulls cached as [] too.
import '../../scripts/_env-bootstrap.js';
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, 'cache_ladder'); fs.mkdirSync(CACHE, { recursive: true });
const KEY = process.env.UNUSUAL_WHALES_API_KEY || process.env.UW_API_KEY;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const occ = (t, day, cp, K) => `${t}${day.slice(2, 4)}${day.slice(5, 7)}${day.slice(8, 10)}${cp}${String(Math.round(K * 1000)).padStart(8, '0')}`;

async function pull(url, file) {
  if (fs.existsSync(file)) return 'cache';
  for (let a = 0; a < 5; a++) {
    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${KEY}`, 'User-Agent': 'bellwether-research' }, signal: AbortSignal.timeout(20000) });
      if (r.status === 429) { await sleep(2500 * (a + 1)); continue; }
      if (r.status === 422) { fs.writeFileSync(file, '[]'); return 'bad'; }   // invalid strike
      if (!r.ok) { await sleep(800 * (a + 1)); continue; }
      const rows = (await r.json())?.data || [];
      fs.writeFileSync(file, JSON.stringify(rows));
      await sleep(330);
      return rows.length ? 'data' : 'empty';
    } catch { await sleep(1000 * (a + 1)); }
  }
  return 'fail';   // do NOT cache failures -> retried next run
}

const jobs = JSON.parse(fs.readFileSync(path.join(HERE, 'needed_contracts.json'), 'utf8'));
console.log(`fetching ${jobs.length} contracts...`);
const tally = { cache: 0, data: 0, empty: 0, bad: 0, fail: 0 };
let n = 0;
for (const j of jobs) {
  const sym = occ(j.ticker, j.day, j.cp, j.strike);
  const res = await pull(`https://api.unusualwhales.com/api/option-contract/${sym}/intraday?date=${j.day}`, path.join(CACHE, `${sym}_${j.day}.json`));
  tally[res]++;
  if (++n % 100 === 0) console.log(`  ${n}/${jobs.length}  ${JSON.stringify(tally)}`);
}
console.log(`DONE ${n}/${jobs.length}  ${JSON.stringify(tally)}`);
