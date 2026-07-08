/**
 * archive-skylit — pull Skylit's historical GEX+VEX snapshots to local disk
 * before they age out of the ~85-day retention window.
 *
 * Two modes:
 *   --mode=index-intraday   SPXW/SPY/QQQ every 5 min, 09:30-16:00 ET, for
 *                           every business day in retention. Feeds exact
 *                           fire/exit replays (structural rules need the
 *                           full surface at minute resolution).
 *   --mode=universe-daily   All 378 tickers at 09:35 ET per business day.
 *                           Feeds grader/scanner backtests.
 *
 * Storage layout (gzipped raw normalized snapshots, one JSON per line):
 *   data/skylit-archive/intraday/<YYYY-MM-DD>/<TICKER>.jsonl.gz
 *   data/skylit-archive/daily/<YYYY-MM-DD>/<TICKER>.json.gz
 *
 * Idempotent: existing files are skipped, so re-running resumes where a
 * crash or rate-limit stopped it. Run nightly (post-close) to keep the
 * archive rolling forward as retention rolls off the back.
 *
 * Usage:
 *   node scripts/archive-skylit.js --mode=index-intraday
 *   node scripts/archive-skylit.js --mode=universe-daily
 *   node scripts/archive-skylit.js --mode=universe-daily --days-back=10
 *   node scripts/archive-skylit.js --mode=index-intraday --date=2026-07-08
 */

import './_env-bootstrap.js';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { initAuth } from '../src/heatseeker/auth.js';
import { fetchHistoricalSnapshot } from '../src/heatseeker/client.js';
import { createLogger } from '../src/utils/logger.js';

const log = createLogger('ArchiveSkylit');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARCHIVE_ROOT = path.join(__dirname, '..', 'data', 'skylit-archive');

const INDEX_TICKERS = ['SPXW', 'SPY', 'QQQ'];
const CONCURRENCY = Number(process.env.ARCHIVE_CONCURRENCY || 5);

function parseArgs() {
  const a = { mode: null, daysBack: 85, date: null };
  for (const x of process.argv.slice(2)) {
    if (x.startsWith('--mode=')) a.mode = x.slice(7);
    else if (x.startsWith('--days-back=')) a.daysBack = Number(x.slice(12));
    else if (x.startsWith('--date=')) a.date = x.slice(7);
  }
  return a;
}

function loadUniverse() {
  const p = path.join(__dirname, '..', 'scanner', 'data', 'symbols.json');
  const j = JSON.parse(fs.readFileSync(p, 'utf-8'));
  const syms = j.symbols || j;
  return syms.map(s => (typeof s === 'string' ? s : s.name || s.symbol)).filter(Boolean);
}

function isWeekend(d) { const w = d.getUTCDay(); return w === 0 || w === 6; }

function businessDays(daysBack, onlyDate) {
  if (onlyDate) return [onlyDate];
  const out = [];
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1); // start yesterday — today may be mid-session
  while (out.length < daysBack) {
    if (!isWeekend(d)) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out.reverse();
}

// 09:30-16:00 ET at 5-min steps. July = EDT = UTC-4. For dates when EST
// applies (Nov+), Skylit snaps timestamps to nearest frame server-side, so
// a 1-hour skew still lands inside the session — acceptable for an archive.
function intradayTimestamps(dateStr) {
  const out = [];
  for (let min = 13 * 60 + 30; min <= 20 * 60; min += 5) {
    const h = String(Math.floor(min / 60)).padStart(2, '0');
    const m = String(min % 60).padStart(2, '0');
    out.push(`${dateStr}T${h}:${m}:00Z`);
  }
  return out;
}

async function pMap(items, mapper, concurrency) {
  const results = new Array(items.length);
  let idx = 0;
  await Promise.all(new Array(concurrency).fill(0).map(async () => {
    while (idx < items.length) {
      const my = idx++;
      try { results[my] = await mapper(items[my], my); }
      catch (err) { results[my] = { error: err.message }; }
    }
  }));
  return results;
}

async function archiveIndexIntraday(days) {
  const jobs = [];
  for (const day of days) for (const ticker of INDEX_TICKERS) jobs.push({ day, ticker });
  log.info(`index-intraday: ${jobs.length} ticker-days (${days.length} days × ${INDEX_TICKERS.length})`);

  let done = 0, skipped = 0, wrote = 0, empty = 0;
  const start = Date.now();
  await pMap(jobs, async ({ day, ticker }) => {
    done++;
    const dir = path.join(ARCHIVE_ROOT, 'intraday', day);
    const file = path.join(dir, `${ticker}.jsonl.gz`);
    if (fs.existsSync(file)) { skipped++; return; }

    const lines = [];
    for (const ts of intradayTimestamps(day)) {
      let snap = null;
      try { snap = await fetchHistoricalSnapshot(ticker, ts); }
      catch (err) {
        if (String(err.message).includes('AUTH_EXPIRED')) throw err;
      }
      if (snap && snap.spot != null) {
        lines.push(JSON.stringify({ requestedTs: ts, ...snap }));
      }
    }
    if (!lines.length) { empty++; return; }
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, zlib.gzipSync(lines.join('\n') + '\n'));
    wrote++;
    if (done % 10 === 0) {
      const rate = done / ((Date.now() - start) / 1000);
      log.info(`${done}/${jobs.length}  wrote=${wrote} skipped=${skipped} empty=${empty}  eta=${Math.round((jobs.length - done) / rate)}s`);
    }
  }, CONCURRENCY);
  log.info(`index-intraday done: wrote=${wrote} skipped=${skipped} empty=${empty}`);
}

async function archiveUniverseDaily(days) {
  const universe = loadUniverse();
  const jobs = [];
  for (const day of days) for (const ticker of universe) jobs.push({ day, ticker });
  log.info(`universe-daily: ${jobs.length} snapshots (${days.length} days × ${universe.length} tickers)`);

  let done = 0, skipped = 0, wrote = 0, empty = 0;
  const start = Date.now();
  await pMap(jobs, async ({ day, ticker }) => {
    done++;
    const dir = path.join(ARCHIVE_ROOT, 'daily', day);
    const file = path.join(dir, `${ticker}.json.gz`);
    if (fs.existsSync(file)) { skipped++; return; }

    let snap = null;
    try { snap = await fetchHistoricalSnapshot(ticker, `${day}T13:35:00Z`); }
    catch (err) {
      if (String(err.message).includes('AUTH_EXPIRED')) throw err;
    }
    if (!snap || snap.spot == null) { empty++; return; }
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, zlib.gzipSync(JSON.stringify({ requestedTs: `${day}T13:35:00Z`, ...snap })));
    wrote++;
    if (done % 100 === 0) {
      const rate = done / ((Date.now() - start) / 1000);
      log.info(`${done}/${jobs.length}  wrote=${wrote} skipped=${skipped} empty=${empty}  eta=${Math.round((jobs.length - done) / rate)}s`);
    }
  }, CONCURRENCY);
  log.info(`universe-daily done: wrote=${wrote} skipped=${skipped} empty=${empty}`);
}

async function main() {
  const args = parseArgs();
  if (!['index-intraday', 'universe-daily'].includes(args.mode)) {
    console.error('usage: node scripts/archive-skylit.js --mode=index-intraday|universe-daily [--days-back=N] [--date=YYYY-MM-DD]');
    process.exit(1);
  }
  const authOk = await initAuth();
  if (!authOk) { log.error('Skylit auth failed. Run cfp-jobs skylit-login.'); process.exit(1); }

  const days = businessDays(args.daysBack, args.date);
  log.info(`window: ${days[0]} → ${days[days.length - 1]}`);

  if (args.mode === 'index-intraday') await archiveIndexIntraday(days);
  else await archiveUniverseDaily(days);
}

main().catch(err => { log.error('fatal:', err); process.exit(1); });
