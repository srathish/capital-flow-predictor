/**
 * Refresh loop — polls current option marks for every live tracked play
 * every 60s, updates best_mark, and closes plays at end of session.
 *
 * Orchestration only. Quote fetching is in uw/quotes.js; mark updates are
 * in tracker/plays.js.
 *
 * Cadence:
 *   - 60s refresh tick (default) — tunable via REFRESH_LOOP_INTERVAL_MS
 *   - 5-min EOD check — closes any status='live' rows once market closes
 *   - Skips if the previous tick is still in flight
 */

import { refreshLivePlays, closePlays } from './plays.js';
import { getOptionQuote } from '../uw/quotes.js';
import { openDb } from '../store/db.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('RefreshLoop');

const INTERVAL_MS = Number(process.env.REFRESH_LOOP_INTERVAL_MS || 60_000);
const EOD_CHECK_MS = 5 * 60_000;

let refreshInFlight = false;
let refreshHandle = null;
let eodHandle = null;

function marketPhase(now = new Date()) {
  // Returns 'premarket' | 'open' | 'closed' | 'weekend' in ET.
  if (process.env.REFRESH_LOOP_247 === '1') return 'open';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(now);
  const weekday = parts.find(p => p.type === 'weekday')?.value;
  if (weekday === 'Sat' || weekday === 'Sun') return 'weekend';
  const hour = Number(parts.find(p => p.type === 'hour')?.value);
  const minute = Number(parts.find(p => p.type === 'minute')?.value);
  const minutes = hour * 60 + minute;
  if (minutes < 9 * 60 + 30) return 'premarket';
  if (minutes < 16 * 60) return 'open';
  return 'closed';
}

async function refreshTick() {
  if (refreshInFlight) {
    log.info('previous refresh still running, skipping');
    return;
  }
  const phase = marketPhase();
  // Only refresh while the market is open — the whole point is a live mark.
  // (Best-mark carries through the close so we can render "closed at $X" later.)
  if (phase !== 'open') return;
  refreshInFlight = true;
  try {
    const db = openDb();
    const quoteFetcher = (sym) => getOptionQuote(sym);
    const { refreshed, trailClosed } = await refreshLivePlays({ db, quoteFetcher });
    if (refreshed > 0) {
      const suffix = trailClosed > 0 ? ` (trail-stopped ${trailClosed})` : '';
      log.info(`refreshed ${refreshed} live plays${suffix}`);
    }
  } catch (err) {
    log.error(`refresh error: ${err.message}`);
  } finally {
    refreshInFlight = false;
  }
}

async function eodTick() {
  const phase = marketPhase();
  if (phase !== 'closed') return;
  try {
    const db = openDb();
    // Only close plays that expired today or belong to today's session.
    const { closed } = closePlays({ db, reason: 'closed_eod' });
    if (closed > 0) log.info(`EOD: closed ${closed} plays`);
  } catch (err) {
    log.error(`eod error: ${err.message}`);
  }
}

export function startRefreshLoop() {
  if (refreshHandle) return;
  log.info(`starting (interval=${INTERVAL_MS}ms, eod_check=${EOD_CHECK_MS}ms)`);
  refreshHandle = setInterval(() => {
    refreshTick().catch(err => log.error(`refresh tick error: ${err.message}`));
  }, INTERVAL_MS);
  eodHandle = setInterval(() => {
    eodTick().catch(err => log.error(`eod tick error: ${err.message}`));
  }, EOD_CHECK_MS);
}

export function stopRefreshLoop() {
  if (refreshHandle) {
    clearInterval(refreshHandle);
    refreshHandle = null;
  }
  if (eodHandle) {
    clearInterval(eodHandle);
    eodHandle = null;
  }
}
