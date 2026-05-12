/**
 * gex service entry point — cloud-deployed (Railway).
 *
 * One process does it all:
 *   - Boot Clerk auth (load cookies from Postgres → .env fallback)
 *   - Open the local SQLite snapshot store
 *   - Start the Heatseeker SSE snapshot poller (writes to SQLite + JSONL)
 *   - Start the scheduler (fires morning-brief at 09:31 ET and intraday-monitor
 *     at fixed checkpoints — each runs as a child node process for clean
 *     process isolation; both auto-mirror to gex_feed via webhook.postEmbed)
 *
 * SIGTERM / SIGINT: drain Postgres pool, stop poller, close SQLite + JSONL.
 *
 * Disable the scheduler with DISABLE_SCHEDULER=1 — useful in dev when you
 * want to ingest snapshots without firing Discord messages.
 */

import { initAuth } from './heatseeker/auth.js';
import { openDb, closeDb } from './store/db.js';
import { closeAll as closeJsonl } from './store/jsonl-events.js';
import { closePg } from './store/pg.js';
import { startPoller, stopPoller } from './ingest/snapshot-poller.js';
import { runScheduler } from '../scripts/schedule.js';
import { createLogger } from './utils/logger.js';

const log = createLogger('Boot');


async function main() {
  log.info('gex service booting | Railway-deployed, monorepo (apps/gex)');

  // Auth is now async — Postgres lookup happens here.
  const authOk = await initAuth();
  if (!authOk) {
    log.warn(
      'Auth not configured — poller will fail until cookies land in Postgres ' +
      '(via skylit-watch + the /gex Re-auth button) OR CLERK_* env vars are ' +
      'set in this service.',
    );
  }

  openDb();
  startPoller();

  // Scheduler: fires brief at 09:31 ET + monitor at checkpoints. Runs in the
  // background; tick loop is internal. Errors are caught + logged inside.
  if (process.env.DISABLE_SCHEDULER === '1') {
    log.info('Scheduler disabled (DISABLE_SCHEDULER=1) — poller only.');
  } else {
    runScheduler().catch(err => {
      log.error(`Scheduler crashed (continuing without it): ${err.message}`);
    });
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}


async function shutdown() {
  log.info('Shutting down...');
  try { stopPoller(); } catch (e) { log.warn(`stopPoller: ${e.message}`); }
  try { closeJsonl(); } catch (e) { log.warn(`closeJsonl: ${e.message}`); }
  try { closeDb(); } catch (e) { log.warn(`closeDb: ${e.message}`); }
  await closePg();
  process.exit(0);
}


main().catch(err => {
  log.error('Fatal boot error:', err);
  process.exit(1);
});
