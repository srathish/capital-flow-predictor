/**
 * plays-tracker — standalone Falcon-style plays tracker.
 *
 * Runs the fire-loop + refresh-loop with LOCAL storage (SQLite in ./data),
 * without needing Postgres, the API service, or the web UI. Point at a .env
 * that has your Skylit Clerk cookies and UW API key, then let it run in the
 * background. Fires and closes print to stdout as they happen.
 *
 * Usage:
 *   node scripts/plays-tracker.js                 # uses ./data/gexester.sqlite
 *   node scripts/plays-tracker.js --data=~/Data   # custom SQLite dir
 *   node scripts/plays-tracker.js --tail          # also tail plays log on stdout
 *
 * Required env (loaded from apps/gex/.env or the invocation CWD .env):
 *   CLERK_SESSION_ID       (from cfp-jobs skylit-login)
 *   CLERK_CLIENT_COOKIE
 *   CLERK_CLIENT_UAT
 *   UNUSUAL_WHALES_API_KEY (or UW_API_KEY)
 *
 * Optional env:
 *   FIRE_LOOP_INTERVAL_MS     override 5-min cadence
 *   REFRESH_LOOP_INTERVAL_MS  override 60s cadence
 *   FIRE_LOOP_247=1           run outside US market hours (dev/testing)
 *   TICKERS                   comma list (default SPXW,SPY,QQQ)
 */

import './_env-bootstrap.js';   // multi-location .env loader — MUST be first import
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { initAuth } from '../src/heatseeker/auth.js';
import { openDb, closeDb } from '../src/store/db.js';
import { startFireLoop, stopFireLoop } from '../src/tracker/fire-loop.js';
import { startRefreshLoop, stopRefreshLoop } from '../src/tracker/refresh-loop.js';
import { getTodaysPlays } from '../src/tracker/plays.js';
import { printMorningBrief, printEodSummary } from '../src/tracker/briefing.js';
import { createLogger } from '../src/utils/logger.js';

const log = createLogger('PlaysTracker');
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------- CLI args ----------

function parseArgs() {
  const args = {
    dataDir: null,
    tail: true,        // default ON — showing fires as they happen is the whole point
    brief: true,       // default ON — morning brief runs on startup
    eod: true,         // default ON — EOD summary prints when market closes
  };
  for (const a of process.argv.slice(2)) {
    if (a === '--tail') args.tail = true;
    else if (a === '--no-tail') args.tail = false;
    else if (a === '--no-brief') args.brief = false;
    else if (a === '--no-eod') args.eod = false;
    else if (a === '--brief-only') { args.tail = false; args.eod = false; args.briefOnly = true; }
    else if (a.startsWith('--data=')) args.dataDir = a.slice(7);
  }
  return args;
}

function resolveDataDir(cliDir) {
  if (cliDir) {
    return cliDir.replace(/^~/, process.env.HOME || '~');
  }
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  // Default: apps/gex/data — same as the smoke tests
  return path.join(__dirname, '..', 'data');
}

// ---------- Startup banner ----------

function banner(dataDir) {
  const key = process.env.UNUSUAL_WHALES_API_KEY || process.env.UW_API_KEY;
  const clerkOk = !!(process.env.CLERK_SESSION_ID && process.env.CLERK_CLIENT_COOKIE);
  const uwOk = !!key;
  const rows = [
    ['data dir', dataDir],
    ['skylit auth', clerkOk ? 'OK (.env)' : '⚠ MISSING — run `cfp-jobs skylit-login`'],
    ['unusual-whales key', uwOk ? 'OK' : '⚠ MISSING — plays will open but not refresh'],
    ['fire-loop interval', `${Number(process.env.FIRE_LOOP_INTERVAL_MS || 60_000) / 1000}s (state cooldowns prevent spam)`],
    ['refresh-loop interval', `${Number(process.env.REFRESH_LOOP_INTERVAL_MS || 60_000) / 1000}s`],
    ['247 mode', process.env.FIRE_LOOP_247 === '1' ? 'ON (ignores market hours)' : 'OFF'],
  ];
  console.log('\n  Bellwether · Plays Tracker (standalone)');
  console.log('  ─────────────────────────────────────────');
  for (const [k, v] of rows) console.log(`  ${k.padEnd(22)} ${v}`);
  console.log('  ─────────────────────────────────────────\n');
}

// ---------- Tail: print any fires + closes as they land ----------

// ---------- Phase 4: EOD summary scheduler ----------
//
// Every 5 minutes, check if it's past 16:05 ET on a weekday. If yes and we
// haven't already printed today's summary, print it. The 5-min buffer after
// 16:00 lets the refresh-loop's EOD-close tick land first so the summary
// reflects final marks, not mid-session marks.

function isEodWindow(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(now);
  const weekday = parts.find(p => p.type === 'weekday')?.value;
  const hour = Number(parts.find(p => p.type === 'hour')?.value);
  const minute = Number(parts.find(p => p.type === 'minute')?.value);
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  const minutes = hour * 60 + minute;
  return minutes >= 16 * 60 + 5 && minutes < 20 * 60; // 16:05 → 20:00 ET
}

function scheduleEodSummary() {
  let printedForDay = null; // trading_day string once printed
  const check = () => {
    const day = new Date().toISOString().slice(0, 10);
    if (printedForDay === day) return;
    if (!isEodWindow()) return;
    printedForDay = day;  // set first — the summary is idempotent-enough and async now
    printEodSummary({ tradingDay: day }).catch(err => {
      log.warn(`EOD summary failed: ${err.message}`);
    });
  };
  setInterval(check, 5 * 60_000);
  // Also fire once immediately in case the tracker was started AFTER close.
  setTimeout(check, 30_000);
}

function startTail() {
  let lastSeenPlayId = 0;
  const check = () => {
    try {
      const rows = getTodaysPlays({
        db: openDb(),
        tradingDay: new Date().toISOString().slice(0, 10),
      });
      for (const r of rows) {
        if (r.play_id <= lastSeenPlayId) continue;
        lastSeenPlayId = Math.max(lastSeenPlayId, r.play_id);
        const t = new Date(r.fire_ts_ms).toLocaleTimeString('en-US', { hour12: false });
        const emoji = r.state.startsWith('BEAR') ? '🐻' : r.state.startsWith('BULL') ? '🐂' : '·';
        console.log(
          `  ${t}  ${emoji} ${r.state.padEnd(15)} ${r.ticker.padEnd(6)} ` +
          `${r.option_type === 'put' ? 'PUT' : 'CALL'} $${r.strike} @ $${r.entry_mark.toFixed(2)}  ` +
          `[${r.option_symbol}]`
        );
      }
    } catch {
      // tail can lag behind concurrent writes; ignore
    }
  };
  setInterval(check, 5_000);
}

// ---------- Boot ----------

async function main() {
  const args = parseArgs();
  const dataDir = resolveDataDir(args.dataDir);

  // Ensure data dir exists so SQLite can create the file.
  fs.mkdirSync(dataDir, { recursive: true });
  process.env.DATA_DIR = dataDir;

  banner(dataDir);

  // Boot Clerk auth (works with .env when DATABASE_URL isn't set — see auth.js)
  const authOk = await initAuth();
  if (!authOk) {
    log.error('Auth not configured. Run `cfp-jobs skylit-login` first, then retry.');
    process.exit(1);
  }

  // Open local SQLite — this creates ./data/gexester.sqlite on first run
  // and applies the schema (see src/store/db.js + schema.sql).
  openDb();

  // Phase 1 — Morning brief. Compares last night's stored snapshot to a
  // fresh Skylit pull for SPXW/SPY/QQQ. Prints the overnight positioning
  // delta so you see what the tape looks like before market open.
  if (args.brief) {
    try { await printMorningBrief(); } catch (err) {
      log.warn(`morning brief failed: ${err.message}`);
    }
  }

  // If --brief-only, exit after the brief prints (no loops, no tail, no EOD).
  if (args.briefOnly) {
    closeDb();
    return;
  }

  // Phase 2 — Intraday. Start the loops (5-min fire + 60s refresh).
  // Both self-throttle to market hours by default; before 9:30 ET they no-op.
  startFireLoop();
  startRefreshLoop();

  // Phase 3 — Live tail: print every new tracked-play row to stdout as it lands.
  if (args.tail) startTail();

  // Phase 4 — EOD summary. Watches the clock and fires the summary printer
  // once, ~5 min after 16:00 ET (giving the tracker time to close all live plays).
  if (args.eod) scheduleEodSummary();

  const shutdown = () => {
    console.log('\n  Shutting down...');
    try { stopFireLoop(); } catch (_) {}
    try { stopRefreshLoop(); } catch (_) {}
    try { closeDb(); } catch (_) {}
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Keep the event loop alive.
  log.info('running — Ctrl-C to stop');
}

main().catch(err => {
  log.error('fatal:', err);
  process.exit(1);
});
