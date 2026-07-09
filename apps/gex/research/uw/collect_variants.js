/**
 * Contract-variant collector — study #1 (contract selection).
 *
 * For every FINAL-SYSTEM play (G7-PC + dedupe, same logic as the studies),
 * pull UW 1-min candles for the contracts we COULD have bought instead of
 * the ATM 0DTE:
 *   - 1 and 2 strikes ITM
 *   - 1 and 2 strikes OTM
 *   - next-expiry ATM (next business day — SPY/QQQ/SPXW all have dailies)
 *
 * Output: same research/uw/candles/ pool (idempotent, shared with base).
 */
import '../../scripts/_env-bootstrap.js';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GEX = path.resolve(__dirname, '..', '..');
const ARCHIVE = path.join(GEX, 'data', 'skylit-archive', 'intraday');
const OUT = path.join(__dirname, 'candles');
fs.mkdirSync(OUT, { recursive: true });

const KEY = process.env.UNUSUAL_WHALES_API_KEY || process.env.UW_API_KEY;
const SPACING_MS = 550;
let last = 0, backoff = 0;

const ET_OFFSET = -4;
function hourET(tsMs) {
  const d = new Date(tsMs + ET_OFFSET * 3600_000);
  return d.getUTCHours() + d.getUTCMinutes() / 60;
}
function lastSpot(day, t) {
  const p = path.join(ARCHIVE, day, `${t}.jsonl.gz`);
  if (!fs.existsSync(p)) return null;
  const lines = zlib.gunzipSync(fs.readFileSync(p)).toString().trim().split('\n');
  return JSON.parse(lines[lines.length - 1]).spot;
}
function nextBusinessDay(dayStr) {
  const d = new Date(`${dayStr}T12:00:00Z`);
  do { d.setUTCDate(d.getUTCDate() + 1); } while ([0, 6].includes(d.getUTCDay()));
  return d.toISOString().slice(0, 10);
}
function occ(t, day, dir, K) {
  const [y, m, dd] = day.split('-');
  return `${t}${y.slice(2)}${m}${dd}${dir > 0 ? 'C' : 'P'}${Math.round(K * 1000).toString().padStart(8, '0')}`;
}

// --- final-system play selection (mirror of the studies) ---
const days = fs.readdirSync(ARCHIVE).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
const prior = {};
for (let i = 1; i < days.length; i++) {
  for (const t of ['SPY', 'QQQ', 'SPXW']) {
    const s = lastSpot(days[i - 1], t);
    if (s != null) prior[`${days[i]}:${t}`] = s;
  }
}
const repFiles = fs.readdirSync(path.join(GEX, 'scripts', 'out'))
  .filter(f => f.startsWith('replay-fires-') && f.endsWith('.json'))
  .map(f => path.join(GEX, 'scripts', 'out', f));
const repPath = repFiles.reduce((a, b) => fs.statSync(a).size > fs.statSync(b).size ? a : b);
const plays = JSON.parse(fs.readFileSync(repPath, 'utf-8'))
  .sort((a, b) => a.fireTsMs - b.fireTsMs);
const openUntil = {};
const finalPlays = [];
for (const p of plays) {
  if (hourET(p.fireTsMs) >= 15.25) continue;
  if (p.dir < 0) {
    const pc = prior[`${p.day}:${p.ticker}`];
    if (pc == null || p.entrySpot >= pc) continue;
  }
  const k = `${p.day}:${p.ticker}:${p.dir}`;
  if (p.fireTsMs < (openUntil[k] ?? 0)) continue;
  openUntil[k] = p.exitTsMs;
  finalPlays.push(p);
}
console.log(`final-system plays: ${finalPlays.length}`);

// --- build variant job list ---
const jobs = new Map();
for (const p of finalPlays) {
  const step = p.ticker === 'SPXW' ? 5 : 1;
  // ITM = strike in the money for the direction (calls: lower K; puts: higher K)
  const variants = [
    ['itm1', p.K - p.dir * step], ['itm2', p.K - p.dir * 2 * step],
    ['otm1', p.K + p.dir * step], ['otm2', p.K + p.dir * 2 * step],
  ];
  for (const [, K] of variants) {
    const o = occ(p.ticker, p.day, p.dir, K);
    jobs.set(`${o}_${p.day}`, { occ: o, day: p.day });
  }
  const nd = nextBusinessDay(p.day);
  const o2 = occ(p.ticker, nd, p.dir, p.K); // next-expiry ATM, priced on fire day
  jobs.set(`${o2}_${p.day}`, { occ: o2, day: p.day });
}
console.log(`variant contracts to fetch: ${jobs.size}`);

async function fetchCandles(o, day) {
  for (;;) {
    const wait = Math.max(0, last + SPACING_MS - Date.now());
    if (wait) await new Promise(r => setTimeout(r, wait));
    last = Date.now();
    const r = await fetch(`https://api.unusualwhales.com/api/option-contract/${o}/intraday?date=${day}`, {
      headers: { Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(15_000),
    });
    if (r.status === 429) {
      backoff = backoff ? Math.min(backoff * 2, 120_000) : 15_000;
      console.log(`429 — backoff ${backoff / 1000}s`);
      await new Promise(rr => setTimeout(rr, backoff)); continue;
    }
    backoff = 0;
    if (!r.ok) return { error: `HTTP ${r.status}` };
    return { data: await r.json() };
  }
}

let done = 0, wrote = 0, skipped = 0, errored = 0, empty = 0;
for (const { occ: o, day } of jobs.values()) {
  done++;
  const file = path.join(OUT, `${o}_${day}.json`);
  if (fs.existsSync(file)) { skipped++; continue; }
  const r = await fetchCandles(o, day);
  if (r.error) { errored++; continue; }
  const rows = r.data?.data || [];
  if (!rows.length) { empty++; continue; }
  fs.writeFileSync(file, JSON.stringify(rows));
  wrote++;
  if (done % 200 === 0) console.log(`${done}/${jobs.size} wrote=${wrote} skipped=${skipped} empty=${empty} errored=${errored}`);
}
console.log(`variants done: wrote=${wrote} skipped=${skipped} empty=${empty} errored=${errored}`);
