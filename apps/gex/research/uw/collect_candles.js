/**
 * UW option-candle collector — research module (isolated; see research/vix
 * and research/darkpool for the contract: nothing under src/ imports this,
 * revert = rm -rf research/uw).
 *
 * For every play in the 64-day replay (all 1,339 fires — so ANY gate config
 * can later be priced in dollars), fetch the 1-min intraday candles of the
 * exact 0DTE ATM contract from Unusual Whales:
 *   GET /api/option-contract/{OCC}/intraday?date=YYYY-MM-DD
 *
 * Output: research/uw/candles/<OCC>_<day>.json (raw UW response)
 * Idempotent; paced; 429-aware backoff.
 */
import '../../scripts/_env-bootstrap.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GEX = path.resolve(__dirname, '..', '..');
const OUT = path.join(__dirname, 'candles');
fs.mkdirSync(OUT, { recursive: true });

const KEY = process.env.UNUSUAL_WHALES_API_KEY || process.env.UW_API_KEY;
if (!KEY) { console.error('no UW key'); process.exit(1); }

const SPACING_MS = 550;   // ~110 req/min, under UW's 120/min
let last = 0, backoff = 0;

function occSymbol(underlying, day, dir, strike) {
  const [y, m, d] = day.split('-');
  return `${underlying}${y.slice(2)}${m}${d}${dir > 0 ? 'C' : 'P'}` +
    `${Math.round(strike * 1000).toString().padStart(8, '0')}`;
}

async function fetchCandles(occ, day) {
  for (;;) {
    const wait = Math.max(0, last + SPACING_MS - Date.now());
    if (wait) await new Promise(r => setTimeout(r, wait));
    last = Date.now();
    const r = await fetch(`https://api.unusualwhales.com/api/option-contract/${occ}/intraday?date=${day}`, {
      headers: { Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(15_000),
    });
    if (r.status === 429) {
      backoff = backoff ? Math.min(backoff * 2, 120_000) : 15_000;
      console.log(`429 — backoff ${backoff / 1000}s`);
      await new Promise(rr => setTimeout(rr, backoff));
      continue;
    }
    backoff = 0;
    if (!r.ok) return { error: `HTTP ${r.status}` };
    return { data: await r.json() };
  }
}

const cands = fs.readdirSync(path.join(GEX, 'scripts', 'out'))
  .filter(f => f.startsWith('replay-fires-') && f.endsWith('.json'))
  .map(f => path.join(GEX, 'scripts', 'out', f));
const repPath = cands.reduce((a, b) => fs.statSync(a).size > fs.statSync(b).size ? a : b);
const plays = JSON.parse(fs.readFileSync(repPath, 'utf-8'));

const jobs = new Map();
for (const p of plays) {
  const occ = occSymbol(p.ticker, p.day, p.dir, p.K);
  jobs.set(`${occ}_${p.day}`, { occ, day: p.day });
}
console.log(`plays=${plays.length} unique contracts=${jobs.size}`);

let done = 0, wrote = 0, skipped = 0, errored = 0, empty = 0;
for (const { occ, day } of jobs.values()) {
  done++;
  const file = path.join(OUT, `${occ}_${day}.json`);
  if (fs.existsSync(file)) { skipped++; continue; }
  const r = await fetchCandles(occ, day);
  if (r.error) { errored++; if (errored <= 5 || errored % 50 === 0) console.log(`${occ} ${day}: ${r.error}`); continue; }
  const rows = r.data?.data || [];
  if (!rows.length) { empty++; continue; }
  fs.writeFileSync(file, JSON.stringify(rows));
  wrote++;
  if (done % 100 === 0) console.log(`${done}/${jobs.size} wrote=${wrote} skipped=${skipped} empty=${empty} errored=${errored}`);
}
console.log(`done: wrote=${wrote} skipped=${skipped} empty=${empty} errored=${errored}`);
