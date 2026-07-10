/**
 * Cohort-backtest step 3: fetch real daily option price history for every
 * unique target contract in cohorts.json (one UW /historic call each), cache
 * it. The analysis then prices each leg's entry (cohort date) -> +10d/+20d and
 * the in-window MAX (spike) from these series. Paced, 429-aware, idempotent.
 */
import '../../../scripts/_env-bootstrap.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'price_cache');
fs.mkdirSync(OUT, { recursive: true });
const KEY = process.env.UNUSUAL_WHALES_API_KEY || process.env.UW_API_KEY;
if (!KEY) { console.error('no UW key'); process.exit(1); }

const cohorts = JSON.parse(fs.readFileSync(path.join(__dirname, 'cohorts.json'), 'utf-8'));
const occs = [...new Set(cohorts.map(c => c.occ))];
console.log(`${occs.length} unique contracts to price`);

const SPACING = 550;
let last = 0, backoff = 0, done = 0, errs = 0, cached = 0;
async function fetchHist(occ) {
  for (;;) {
    const wait = Math.max(0, last + SPACING - Date.now());
    if (wait) await new Promise(r => setTimeout(r, wait));
    last = Date.now();
    let r;
    try {
      r = await fetch(`https://api.unusualwhales.com/api/option-contract/${occ}/historic`,
        { headers: { Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(15_000) });
    } catch (e) { return { error: e.message }; }
    if (r.status === 429) {
      backoff = backoff ? Math.min(backoff * 2, 120_000) : 15_000;
      await new Promise(rr => setTimeout(rr, backoff)); continue;
    }
    backoff = 0;
    if (!r.ok) return { error: `HTTP ${r.status}` };
    const j = await r.json();
    return { rows: j.chains || j.data || [] };
  }
}

for (const occ of occs) {
  const dest = path.join(OUT, `${occ}.json`);
  if (fs.existsSync(dest)) { cached++; done++; continue; }
  const { rows, error } = await fetchHist(occ);
  if (error) { errs++; fs.writeFileSync(dest, JSON.stringify({ error })); }
  else {
    // keep only what we need: date + avg/high/last price
    const slim = (rows || []).map(r => ({
      date: r.date,
      px: parseFloat(r.avg_price || r.last_price || 0),
      hi: parseFloat(r.high_price || r.last_price || 0),
    })).filter(r => r.px > 0 && r.date);
    fs.writeFileSync(dest, JSON.stringify(slim));
  }
  done++;
  if (done % 50 === 0) console.log(`  ${done}/${occs.length}  errs=${errs} cached=${cached}`);
}
console.log(`price cache done: ${done} contracts, ${errs} errors, ${cached} preexisting -> ${OUT}`);
