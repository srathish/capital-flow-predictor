// Pull UW option-contract intraday marks for the detected fires (RESEARCH ONLY).
// Reuses the exit-study cache; pulls misses into index-selection/cache.
import '../../scripts/_env-bootstrap.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MYCACHE = path.join(HERE, 'cache');
const EXITCACHE = path.join(HERE, '..', 'exit-study', 'cache');
const KEY = process.env.UNUSUAL_WHALES_API_KEY || process.env.UW_API_KEY;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const need = JSON.parse(fs.readFileSync(path.join(HERE, 'need_symbols.json'), 'utf8'));

async function pull(url, file) {
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(15000) });
      if (r.status === 429) { await sleep(2000 * (a + 1)); continue; }
      if (!r.ok) { fs.writeFileSync(file, '[]'); return 0; }
      const rows = (await r.json())?.data || [];
      fs.writeFileSync(file, JSON.stringify(rows));
      await sleep(360);
      return rows.length;
    } catch { await sleep(1000); }
  }
  fs.writeFileSync(file, '[]'); return 0;
}

let pulled = 0, cached = 0, withData = 0, n = 0;
for (const { sym, day } of need) {
  const fn = `${sym}_${day}.json`;
  n++;
  if (fs.existsSync(path.join(EXITCACHE, fn)) || fs.existsSync(path.join(MYCACHE, fn))) { cached++; continue; }
  const cnt = await pull(`https://api.unusualwhales.com/api/option-contract/${sym}/intraday?date=${day}`, path.join(MYCACHE, fn));
  pulled++; if (cnt) withData++;
  if (pulled % 40 === 0) console.log(`  pulled ${pulled}  withData ${withData}  (progress ${n}/${need.length})`);
}
console.log(`DONE. cached-hit ${cached}  newly-pulled ${pulled}  withData ${withData}`);
