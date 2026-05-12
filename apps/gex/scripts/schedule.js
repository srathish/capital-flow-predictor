#!/usr/bin/env node
/**
 * Scheduler — fires the morning brief at 9:31 ET on each NYSE trading day, and
 * the intraday monitor at fixed checkpoints through the session. Runs inside
 * the gexester process (started from src/index.js) so a single `npm start`
 * gives you poller + brief + monitor with no extra terminals.
 *
 * Why 9:31 ET (not 9:30): Heatseeker's 9:30 frame is consistently the prior
 * session's last value or a pre-market quote (validated on multiple sample
 * days). 9:31 is the earliest reliable snapshot of the new session — same
 * floor the morning-brief script uses internally.
 *
 * Material level-change alerts (king flips, regime flips, structural breaks,
 * trinity alignment shifts, new significant nodes) are handled by the existing
 * intraday-monitor.js — we just fire that script on the checkpoint cadence
 * and it emits an embed ONLY when something material changed since the last
 * checkpoint. No alert noise on quiet windows.
 *
 * Both scripts auto-mirror to Bellwether's /v1/gex/feed when BELLWETHER_API_URL
 * and BELLWETHER_API_KEY are set in .env (handled by webhook.postEmbed).
 *
 * Disable: set DISABLE_SCHEDULER=1 in .env to keep only the poller running.
 *
 * Operationally: gexester must be running by 9:31 ET each trading day for the
 * brief to fire. If you can't keep your laptop on overnight, launch gexester
 * before market open; the scheduler tolerates late starts and will fire the
 * brief on the first tick after 9:31 ET that catches a fresh restart.
 */

import { spawn } from 'child_process';
import { DateTime } from 'luxon';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { createLogger } from '../src/utils/logger.js';

const log = createLogger('Scheduler');

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

// NYSE holiday calendar — equity market is closed; gexester has nothing useful
// to say on these days. Update annually. Source: nyse.com / fed reserve calendar.
const NYSE_HOLIDAYS = new Set([
  // 2026
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03',
  '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07',
  '2026-11-26', '2026-12-25',
  // 2027 (add when we cross the boundary; this list is small enough to extend
  // by hand once a year rather than pulling a heavy holiday library).
]);

// Intraday-monitor checkpoint cadence. 30-min slots through the regular session,
// with 15:55 as a near-close pulse since the last 5 minutes often see major
// position-squaring moves the standard half-hour grid would miss.
const MONITOR_CHECKPOINTS_ET = [
  '09:31',  // session open + first material-change baseline
  '10:00', '10:30', '11:00', '11:30',
  '12:00', '12:30', '13:00', '13:30',
  '14:00', '14:30', '15:00', '15:30',
  '15:55',  // pre-close pulse
];

// How long after each checkpoint slot the scheduler will still fire it on a
// fresh start. Five minutes is generous enough to absorb laptop wake-up lag
// without firing an out-of-date alert later in the session.
const SLOT_WINDOW_MIN = 5;

// Tick cadence — every 30s is plenty since slot resolution is in minutes.
const TICK_INTERVAL_MS = 30_000;


function isTradingDay(dt) {
  const iso = dt.toISODate();
  if (NYSE_HOLIDAYS.has(iso)) return false;
  // luxon weekday: 1=Mon, 7=Sun
  return dt.weekday >= 1 && dt.weekday <= 5;
}

function slotPlusN(slot, minutes) {
  const [h, m] = slot.split(':').map(Number);
  const total = h * 60 + m + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}


/**
 * Spawn `node <script> --date=<today> [...extra]`. Inherits stdout/stderr so
 * the brief/monitor output is visible in the gexester terminal. Awaits exit.
 */
function spawnScript(relPath, extraArgs = []) {
  return new Promise((resolveP, rejectP) => {
    const proc = spawn(process.execPath, [join(REPO_ROOT, relPath), ...extraArgs], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'inherit', 'inherit'],
      env: process.env,  // pass through DISCORD_BRIEF_WEBHOOK_URL + BELLWETHER_API_*
    });
    proc.on('exit', code => {
      if (code === 0) resolveP();
      else rejectP(new Error(`${relPath} exit code ${code}`));
    });
    proc.on('error', rejectP);
  });
}


// Tracks (date,event) keys already fired so a tick-loop restart or a slow
// child process can't double-fire. Map values are timestamps for debugging.
const firedToday = new Map();
const firedKey = (date, event) => `${date}:${event}`;
const markFired = (date, event) => firedToday.set(firedKey(date, event), Date.now());
const alreadyFired = (date, event) => firedToday.has(firedKey(date, event));


async function fireBrief(date) {
  log.info(`[brief] firing for ${date} (--at-open)`);
  try {
    await spawnScript('scripts/morning-brief.js', [`--date=${date}`, '--at-open']);
    log.info(`[brief] OK ${date}`);
  } catch (e) {
    log.error(`[brief] failed ${date}: ${e.message}`);
  }
}


async function fireMonitor(date, slot) {
  log.info(`[monitor] firing for ${date} (slot ${slot} ET)`);
  try {
    await spawnScript('scripts/intraday-monitor.js', [`--date=${date}`]);
    log.info(`[monitor] OK ${date} slot=${slot}`);
  } catch (e) {
    log.error(`[monitor] failed ${date} slot=${slot}: ${e.message}`);
  }
}


/**
 * One pass of the tick loop. Cheap when nothing fires (a couple of date math
 * ops + Map lookups), so we can run it every 30s without any concern.
 */
async function tick() {
  const now = DateTime.now().setZone('America/New_York');
  if (!isTradingDay(now)) return;

  const today = now.toISODate();
  const hhmm = now.toFormat('HH:mm');

  // ---- Morning brief ----
  // Fires once per day at the FIRST tick on or after 09:31 ET. If the user
  // starts gexester mid-session, the brief still fires for that day so
  // they don't miss it; if they start AFTER 16:00 the brief is skipped
  // (post-close brief would be stale).
  if (!alreadyFired(today, 'brief') && hhmm >= '09:31' && hhmm < '16:00') {
    markFired(today, 'brief');
    // Fire-and-forget: don't await, otherwise the next monitor checkpoint
    // could be delayed by a slow brief. Failures are logged by fireBrief.
    fireBrief(today);
  }

  // ---- Intraday monitor ----
  // Walk checkpoints in reverse: a late start should fire the MOST RECENT
  // missed checkpoint (the one closest to "now"), not the earliest. Older
  // checkpoints are then marked fired so we don't backfill them out of order.
  for (let i = MONITOR_CHECKPOINTS_ET.length - 1; i >= 0; i--) {
    const slot = MONITOR_CHECKPOINTS_ET[i];
    const windowEnd = slotPlusN(slot, SLOT_WINDOW_MIN);
    if (hhmm >= slot && hhmm < windowEnd) {
      const key = `monitor:${slot}`;
      if (!alreadyFired(today, key)) {
        // Mark all earlier slots fired too — late start shouldn't backfire
        // checkpoints from earlier in the session.
        for (let j = 0; j <= i; j++) {
          markFired(today, `monitor:${MONITOR_CHECKPOINTS_ET[j]}`);
        }
        fireMonitor(today, slot);
      }
      break;
    }
  }
}


/**
 * Run the scheduler tick loop forever. Exported so src/index.js can call this
 * alongside the poller; also runnable standalone via `node scripts/schedule.js`
 * for testing / one-off use.
 */
export async function runScheduler({ tickIntervalMs = TICK_INTERVAL_MS } = {}) {
  log.info(
    `Scheduler started | brief at 09:31 ET, monitor at [${MONITOR_CHECKPOINTS_ET.join(', ')}] ET | ` +
    `weekdays only, NYSE holidays skipped.`
  );

  // Clean stale day entries hourly so the firedToday map doesn't grow forever
  // on a long-running process. Today's entries are kept; older ones dropped.
  setInterval(() => {
    const today = DateTime.now().setZone('America/New_York').toISODate();
    for (const k of [...firedToday.keys()]) {
      if (!k.startsWith(`${today}:`)) firedToday.delete(k);
    }
  }, 60 * 60 * 1000);

  // Run forever. Internal `tick` catches its own errors so this loop never throws.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await tick();
    } catch (e) {
      log.error(`tick threw (continuing): ${e.message}`);
    }
    await new Promise(r => setTimeout(r, tickIntervalMs));
  }
}


// ---- Standalone entrypoint ----
// Allows `node scripts/schedule.js` and `npm run schedule` for testing without
// running the poller. When started from src/index.js (`npm start`), this block
// doesn't fire — runScheduler is called directly.
const __filename = fileURLToPath(import.meta.url);
const isMain = process.argv[1] && resolve(process.argv[1]) === __filename;
if (isMain) {
  runScheduler().catch(err => {
    log.error(`Scheduler crashed: ${err.message}`);
    process.exit(1);
  });
}
