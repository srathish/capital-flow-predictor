/**
 * Cohort-backtest step 1: cache 90-day options-volume flow history for the
 * whole Skylit universe (one UW call per ticker). The backtest then slices
 * 20-day windows as-of any past formation date from this cache — no per-cohort
 * flow calls. Research-only; paced; 429-aware; idempotent (skips cached).
 */
import '../../../scripts/_env-bootstrap.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GEX = path.resolve(__dirname, '..', '..', '..');
const OUT = path.join(__dirname, 'flow_cache');
fs.mkdirSync(OUT, { recursive: true });
const KEY = process.env.UNUSUAL_WHALES_API_KEY || process.env.UW_API_KEY;
if (!KEY) { console.error('no UW key'); process.exit(1); }

// universe = tickers present in the latest archive day
const dailyDir = path.join(GEX, 'data/skylit-archive/daily');
const days = fs.readdirSync(dailyDir).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
const latest = days[days.length - 1];
const tickers = fs.readdirSync(path.join(dailyDir, latest))
  .filter(f => f.endsWith('.json.gz')).map(f => f.replace('.json.gz', ''));
console.log(`universe: ${tickers.length} tickers, archive ${days[0]}..${latest}`);

const SPACING = 550;
let last = 0, backoff = 0, done = 0, errs = 0;
async function fetchFlow(t) {
  for (;;) {
    const wait = Math.max(0, last + SPACING - Date.now());
    if (wait) await new Promise(r => setTimeout(r, wait));
    last = Date.now();
    let r;
    try {
      r = await fetch(`https://api.unusualwhales.com/api/stock/${t}/options-volume?limit=90`,
        { headers: { Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(15_000) });
    } catch (e) { return { error: e.message }; }
    if (r.status === 429) {
      backoff = backoff ? Math.min(backoff * 2, 120_000) : 15_000;
      await new Promise(rr => setTimeout(rr, backoff)); continue;
    }
    backoff = 0;
    if (!r.ok) return { error: `HTTP ${r.status}` };
    const j = await r.json();
    return { rows: j.data || j.chains || (Array.isArray(j) ? j : []) };
  }
}

const FORCE = process.env.FLOW_FORCE === '1';   // daily re-pull overwrites cache
for (const t of tickers) {
  const dest = path.join(OUT, `${t}.json`);
  if (!FORCE && fs.existsSync(dest)) { done++; continue; }
  const { rows, error } = await fetchFlow(t);
  if (error || !rows?.length) { errs++; fs.writeFileSync(dest, JSON.stringify({ error: error || 'empty' })); }
  else fs.writeFileSync(dest, JSON.stringify(rows));
  done++;
  if (done % 40 === 0) console.log(`  ${done}/${tickers.length}  errs=${errs}`);
}
console.log(`flow cache done: ${done} tickers, ${errs} errors -> ${OUT}`);
