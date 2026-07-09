/**
 * UW intraday net-premium (flow) collector — research module.
 * GET /api/stock/{ticker}/net-prem-ticks?date=YYYY-MM-DD
 * → per-minute net call/put premium for the ticker. Used to test "flow
 * agrees with fire direction" as an entry-quality feature.
 *
 * Output: research/uw/flow/<ticker>_<day>.json
 */
import '../../scripts/_env-bootstrap.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GEX = path.resolve(__dirname, '..', '..');
const ARCHIVE = path.join(GEX, 'data', 'skylit-archive', 'intraday');
const OUT = path.join(__dirname, 'flow');
fs.mkdirSync(OUT, { recursive: true });

const KEY = process.env.UNUSUAL_WHALES_API_KEY || process.env.UW_API_KEY;
const SPACING_MS = 550;
let last = 0, backoff = 0;

async function get(url) {
  for (;;) {
    const wait = Math.max(0, last + SPACING_MS - Date.now());
    if (wait) await new Promise(r => setTimeout(r, wait));
    last = Date.now();
    const r = await fetch(url, { headers: { Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(15_000) });
    if (r.status === 429) {
      backoff = backoff ? Math.min(backoff * 2, 120_000) : 15_000;
      await new Promise(rr => setTimeout(rr, backoff)); continue;
    }
    backoff = 0;
    if (!r.ok) return { error: `HTTP ${r.status}` };
    return { data: await r.json() };
  }
}

const days = fs.readdirSync(ARCHIVE).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
let wrote = 0, skipped = 0, errored = 0;
for (const day of days) {
  for (const ticker of ['SPY', 'QQQ', 'SPX']) {
    const file = path.join(OUT, `${ticker}_${day}.json`);
    if (fs.existsSync(file)) { skipped++; continue; }
    const r = await get(`https://api.unusualwhales.com/api/stock/${ticker}/net-prem-ticks?date=${day}`);
    if (r.error) { errored++; if (errored <= 3) console.log(`${ticker} ${day}: ${r.error}`); continue; }
    fs.writeFileSync(file, JSON.stringify(r.data?.data ?? r.data ?? []));
    wrote++;
  }
}
console.log(`flow done: wrote=${wrote} skipped=${skipped} errored=${errored}`);
