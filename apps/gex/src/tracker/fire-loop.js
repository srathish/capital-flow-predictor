/**
 * Fire loop — polls Skylit every 5 minutes for SPXW/SPY/QQQ, runs pattern
 * detectors, feeds the fire-state machine, and opens tracked plays on state
 * entry. On state clear, closes live plays for that ticker.
 *
 * Orchestration only. All signal logic lives in patterns/ + fire-state.js +
 * tracker/plays.js.
 *
 * Cadence:
 *   - 5-min tick (default) — tunable via FIRE_LOOP_INTERVAL_MS
 *   - Only ticks during US market hours (9:30-16:00 ET) unless FIRE_LOOP_247=1
 *   - Skips if the previous tick is still in flight (no overlap)
 */

import { fetchSnapshot } from '../heatseeker/client.js';
import { runPerTickerPatterns } from '../domain/patterns/index.js';
import { createFireStateMachine, State } from '../domain/fire-state.js';
import { openPlaysForFire, closePlays } from './plays.js';
import { publishSurface, getSurfaceHistory } from './surface-cache.js';
import { classifyRegimes, regimeStrip } from '../domain/regime.js';
import { getOptionQuote } from '../uw/quotes.js';
import { openDb } from '../store/db.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('FireLoop');

const TICKERS = ['SPXW', 'SPY', 'QQQ'];
// 1-min polling by default. The state machine's per-state cooldowns
// (30 min BEAR_RUG, 20 min BEAR_TRAPDOOR, 15 min BEAR_CONTINUE) prevent
// spam — a persistent state polled 30 times still fires exactly once.
// Bump to 5-min if you're rate-limit-conscious: FIRE_LOOP_INTERVAL_MS=300000
const INTERVAL_MS = Number(process.env.FIRE_LOOP_INTERVAL_MS || 60_000);
const HISTORY_WINDOW_MS = 60 * 60_000; // 60 min rolling spot history

const machines = Object.fromEntries(
  TICKERS.map(t => [t, createFireStateMachine({ ticker: t })])
);
const spotHistory = Object.fromEntries(TICKERS.map(t => [t, []]));
// Session open spot per ticker (first snapshot of the trading day) — feeds
// the tape gate. Reset when the trading day rolls.
const sessionOpen = {};
let tickInFlight = false;
let intervalHandle = null;

// ---- Entry gate "G7" (validated on 64 archived days, 2026-07-08) ----
//
//   BEAR fires require spot < session open (never short an up-tape).
//   BULL fires are never gated — counter-tape bull reversals are the
//   highest-EV bucket in the dataset (+196% opt EV on V-days); the
//   reverse-rug structure IS the map's reversal signature, so gating
//   them by tape direction would cut exactly the plays that pay.
//   No new fires after 15:15 ET (late fires won 33% and bled into EOD).
//
// Evidence: scripts/out/VALIDATION_REPORT.md. Config B (30m-classifier
// bear gate) was REJECTED — the classifier read CHOP on down days and
// the gate silently became "no bears ever". G7 is symmetric-tape-based
// and stays positive on hard-down days (+15% opt EV) and big-up days.
// Set GATE_DISABLED=1 to run ungated (observation mode).
const LAST_FIRE_ET_MINUTES = 15 * 60 + 15; // 15:15 ET

function etMinutes(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(now);
  return Number(parts.find(p => p.type === 'hour')?.value) * 60 +
         Number(parts.find(p => p.type === 'minute')?.value);
}

function gateVerdict({ state, spot, ticker }) {
  if (process.env.GATE_DISABLED === '1') return { allowed: true, reason: 'gate_disabled' };
  if (etMinutes() >= LAST_FIRE_ET_MINUTES) {
    return { allowed: false, reason: 'after_15:15_ET' };
  }
  if (state.startsWith('BEAR')) {
    const open = sessionOpen[ticker]?.open;
    if (open == null) return { allowed: false, reason: 'no_session_open_yet' };
    if (spot >= open) {
      return { allowed: false, reason: `bear_above_open ($${spot.toFixed(2)} >= $${open.toFixed(2)})` };
    }
  }
  return { allowed: true, reason: 'ok' };
}

function isMarketHours(now = new Date()) {
  if (process.env.FIRE_LOOP_247 === '1') return true;
  // Rough ET check: convert to America/New_York via Intl (avoids TZ deps).
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(now);
  const weekday = parts.find(p => p.type === 'weekday')?.value;
  const hour = Number(parts.find(p => p.type === 'hour')?.value);
  const minute = Number(parts.find(p => p.type === 'minute')?.value);
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  const minutes = hour * 60 + minute;
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}

function todayExpiration(now = new Date()) {
  // 0DTE expiration for the current session — YYYY-MM-DD in ET.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const y = parts.find(p => p.type === 'year')?.value;
  const m = parts.find(p => p.type === 'month')?.value;
  const d = parts.find(p => p.type === 'day')?.value;
  return `${y}-${m}-${d}`;
}

function computeNodesFromSnapshot(snap) {
  // Convert Skylit strikes[] with per-strike gamma/vanna into the
  // { strike, gamma, vanna, sign, relativeSignificance } shape patterns expect.
  const strikes = snap.strikes || [];
  if (!strikes.length) return [];
  const totalAbs = strikes.reduce((s, r) => s + Math.abs(r.gamma || 0), 0) || 1;
  return strikes.map(r => {
    const g = Number(r.gamma) || 0;
    const v = Number(r.vanna) || 0;
    return {
      strike: Number(r.strike),
      gamma: g,
      vanna: v,
      sign: g > 0 ? 'pika' : g < 0 ? 'barney' : 'zero',
      relativeSignificance: Math.abs(g) / totalAbs,
    };
  });
}

async function loadPreviousClose(ticker) {
  // Placeholder: overnight-carryover is optional. Return null → pattern
  // rejects gracefully with `no_previous_close_snapshot`. The prior-close
  // snapshotter would populate this before the next-day open.
  try {
    const db = openDb();
    const row = db.prepare(`
      SELECT spot, ts_ms FROM snapshots
      WHERE ticker = ?
        AND trading_day < date('now', 'localtime')
      ORDER BY ts_ms DESC LIMIT 1
    `).get(ticker);
    if (!row) return null;
    const nodes = db.prepare(`
      SELECT strike, gamma, sign, relative_significance
      FROM node_snapshots
      WHERE ticker = ? AND ts_ms = ?
    `).all(ticker, row.ts_ms);
    return {
      spot: Number(row.spot),
      nodes: nodes.map(n => ({
        strike: Number(n.strike),
        gamma: Number(n.gamma),
        sign: n.sign,
        relativeSignificance: Number(n.relative_significance),
      })),
    };
  } catch {
    return null;
  }
}

async function tickOnce() {
  if (tickInFlight) {
    log.info('previous tick still running, skipping');
    return;
  }
  if (!isMarketHours()) return;
  tickInFlight = true;
  const now = Date.now();
  const expiration = todayExpiration();

  try {
    const db = openDb();
    const quoteFetcher = (sym) => getOptionQuote(sym);

    for (const ticker of TICKERS) {
      let snap;
      try {
        snap = await fetchSnapshot(ticker);
      } catch (err) {
        log.warn(`${ticker} fetchSnapshot failed: ${err.message}`);
        continue;
      }
      if (!snap || !snap.spot) continue;

      // Record session open (first snapshot of the trading day) for the tape gate.
      const day = todayExpiration();
      if (!sessionOpen[ticker] || sessionOpen[ticker].day !== day) {
        sessionOpen[ticker] = { day, open: snap.spot };
        log.info(`${ticker} session open recorded: $${snap.spot.toFixed(2)}`);
      }

      // Update rolling spot history for pattern detectors that need it.
      spotHistory[ticker].push({ tsMs: now, spot: snap.spot });
      spotHistory[ticker] = spotHistory[ticker].filter(s => now - s.tsMs <= HISTORY_WINDOW_MS);

      const nodes = computeNodesFromSnapshot(snap);
      // Share the full surface with the refresh loop — exit decisions read
      // the entire strike map (floor hardening, barney fuel), not just the
      // option mark. One Skylit fetch, two consumers.
      publishSurface(ticker, { tsMs: now, spot: snap.spot, nodes });
      const previousClose = await loadPreviousClose(ticker);

      const detections = runPerTickerPatterns({
        ticker,
        nodes,
        spot: snap.spot,
        spotHistory: spotHistory[ticker],
        previousClose,
      });

      const fire = machines[ticker].ingest({ detections, tsMs: now });
      if (!fire) continue;

      if (fire.fired) {
        // Multi-timeframe regime context — computed from the rolling surface
        // history so every fire carries "what was the map doing on the 1/5/
        // 10/15/30m frames" for live display and post-hoc alignment analysis.
        const regimes = classifyRegimes(getSurfaceHistory(ticker));
        // G7 entry gate — bears need spot < open; nothing fires after 15:15 ET.
        const gate = gateVerdict({ state: fire.state, spot: snap.spot, ticker });
        if (!gate.allowed) {
          log.info(`GATE ⛔ ${ticker} ${fire.state} blocked — ${gate.reason}  [${regimeStrip(regimes)}]`);
          continue;
        }
        log.info(`FIRE ${ticker} ${fire.state} (from ${fire.prevState})  [${regimeStrip(regimes)}]`);
        try {
          const result = await openPlaysForFire(
            { ...fire, spot: snap.spot, surfaceNodes: nodes, regimes },
            { db, quoteFetcher, expiration }
          );
          log.info(`  opened ${result.opened} plays`);
        } catch (err) {
          log.error(`openPlaysForFire failed for ${ticker}: ${err.message}`);
        }
      } else if (
        fire.state === State.IDLE &&
        fire.prevState !== State.IDLE &&
        fire.prevState !== State.PIN
      ) {
        // State exited a fireable state without re-entering another one — close live plays.
        try {
          const result = closePlays({ db, ticker, reason: 'closed_state_clear' });
          if (result.closed > 0) log.info(`CLEAR ${ticker}: closed ${result.closed} plays`);
        } catch (err) {
          log.error(`closePlays failed for ${ticker}: ${err.message}`);
        }
      }
    }
  } finally {
    tickInFlight = false;
  }
}

export function startFireLoop() {
  if (intervalHandle) return;
  log.info(`starting (interval=${INTERVAL_MS}ms, tickers=${TICKERS.join(',')})`);
  // Kick off one immediate tick so we don't wait 5 min for the first fire.
  tickOnce().catch(err => log.error(`initial tick error: ${err.message}`));
  intervalHandle = setInterval(() => {
    tickOnce().catch(err => log.error(`tick error: ${err.message}`));
  }, INTERVAL_MS);
}

export function stopFireLoop() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
