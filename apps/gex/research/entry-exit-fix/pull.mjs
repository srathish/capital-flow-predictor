// Pull SPXW ATM option-contract intraday for detected reversal events (research only).
// Reuses exit-study/cache when present; writes new pulls to ./optcache.
import '../../scripts/_env-bootstrap.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'optcache');
const EX = path.join(HERE, '..', 'exit-study', 'cache');
fs.mkdirSync(OUT, { recursive: true });
const KEY = process.env.UNUSUAL_WHALES_API_KEY || process.env.UW_API_KEY;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const cons = JSON.parse(fs.readFileSync(path.join(HERE, 'contracts.json'), 'utf8'));

async function pull(url, file) {
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(20000) });
      if (r.status === 429) { await sleep(2000 * (a + 1)); continue; }
      if (!r.ok) { return null; }
      const rows = (await r.json())?.data || [];
      fs.writeFileSync(file, JSON.stringify(rows));
      await sleep(360);
      return rows;
    } catch { await sleep(1000); }
  }
  return null;
}

let reused = 0, pulled = 0, withData = 0, empty = 0, fail = 0;
let n = 0;
for (const c of cons) {
  const fn = `${c.sym}_${c.day}.json`;
  const out = path.join(OUT, fn);
  // reuse exit-study cache if non-empty
  const exf = path.join(EX, fn);
  if (fs.existsSync(exf)) {
    try {
      const d = JSON.parse(fs.readFileSync(exf, 'utf8'));
      if (d.length) { fs.copyFileSync(exf, out); reused++; withData++; n++; continue; }
    } catch {}
  }
  if (fs.existsSync(out)) {
    try { const d = JSON.parse(fs.readFileSync(out, 'utf8')); if (d.length) { withData++; n++; continue; } } catch {}
  }
  const rows = await pull(`https://api.unusualwhales.com/api/option-contract/${c.sym}/intraday?date=${c.day}`, out);
  if (rows === null) { fail++; }
  else { pulled++; if (rows.length) withData++; else empty++; }
  if (++n % 20 === 0) console.log(`  ${n}/${cons.length}  reused=${reused} pulled=${pulled} withData=${withData} empty=${empty} fail=${fail}`);
}
console.log(`DONE. total=${cons.length} reused=${reused} pulled=${pulled} withData=${withData} empty=${empty} fail=${fail}`);
