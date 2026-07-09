/**
 * Dark pool print collector — research module (see README).
 *
 * For every archived session day D, pulls the top dark pool prints for
 * SPY + QQQ as of the PRIOR business day (no lookahead: levels are known
 * before D's open) from Skylit's Flowseeker service, at two lookbacks
 * (1 day = fresh prints, 5 days = persistent levels).
 *
 * Output: research/darkpool/data/<D>_<TICKER>.json
 *   { asOf, lookback1: [...prints], lookback5: [...prints] }
 *
 * Idempotent — existing files are skipped.
 */
import '../../scripts/_env-bootstrap.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initAuth, getFreshToken } from '../../src/heatseeker/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GEX = path.resolve(__dirname, '..', '..');
const ARCHIVE = path.join(GEX, 'data', 'skylit-archive', 'intraday');
const OUT = path.join(__dirname, 'data');
fs.mkdirSync(OUT, { recursive: true });

const TICKERS = ['SPY', 'QQQ'];
const TOP_N = 40;
const SPACING_MS = 300;

function prevBusinessDay(dayStr) {
  const d = new Date(`${dayStr}T12:00:00Z`);
  do { d.setUTCDate(d.getUTCDate() - 1); } while ([0, 6].includes(d.getUTCDay()));
  return d.toISOString().slice(0, 10);
}

let last = 0;
async function fetchPrints(token, ticker, asOf, lookback) {
  const wait = Math.max(0, last + SPACING_MS - Date.now());
  if (wait) await new Promise(r => setTimeout(r, wait));
  last = Date.now();
  const url = `https://fs-ws.skylit.ai/api/dark-pool/top-prints?ticker=${ticker}&top_n=${TOP_N}&as_of_date=${asOf}&lookback_days=${lookback}`;
  const r = await fetch(url, {
    headers: {
      Origin: 'https://app.skylit.ai', Referer: 'https://app.skylit.ai/',
      Authorization: `Bearer ${token}`,
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${ticker} ${asOf} lb=${lookback}`);
  return r.json();
}

const authOk = await initAuth();
if (!authOk) { console.error('auth failed'); process.exit(1); }
const token = await getFreshToken();

const days = fs.readdirSync(ARCHIVE).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
let wrote = 0, skipped = 0, errored = 0;
for (const day of days) {
  for (const ticker of TICKERS) {
    const file = path.join(OUT, `${day}_${ticker}.json`);
    if (fs.existsSync(file)) { skipped++; continue; }
    const asOf = prevBusinessDay(day);
    try {
      const [lb1, lb5] = [await fetchPrints(token, ticker, asOf, 1), await fetchPrints(token, ticker, asOf, 5)];
      fs.writeFileSync(file, JSON.stringify({ day, ticker, asOf, lookback1: lb1, lookback5: lb5 }));
      wrote++;
    } catch (e) {
      errored++;
      console.error(`${day} ${ticker}: ${e.message}`);
    }
  }
  if ((wrote + skipped) % 20 === 0) console.log(`progress: wrote=${wrote} skipped=${skipped} errored=${errored}`);
}
console.log(`done: wrote=${wrote} skipped=${skipped} errored=${errored} → ${OUT}`);
