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
import {
  TAPE_TICKERS, bullTapeGateMode, evaluateBullTapeGate,
  recordBullTapeGateFire, formatBullTapeGateStats,
} from './bull-tape-gate.js';

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

// ---- Entry gate "G7-PC" (validated on 64 archived days, 2026-07-08) ----
//
//   BEAR fires require spot < PRIOR SESSION CLOSE (never short a tape
//   trading above yesterday). Validated split: bears below prior close
//   +9% opt EV (n=280); bears above prior close −1% EV, −2,206bps (n=438).
//   BULL fires are never gated — counter-tape bull reversals are the
//   highest-EV bucket in the dataset (+196% opt EV on V-days); the
//   reverse-rug structure IS the map's reversal signature, so gating
//   them by tape direction would cut exactly the plays that pay.
//   No new fires after 15:15 ET (late fires won 33% and bled into EOD).
//
// Anchor note: "session open" was tested and is WEAKER (+10% vs +17% EV)
// — the edge is gap-aware. Prior close comes from Skylit's historical
// endpoint at boot (one call per ticker); session open is the fallback.
//
// Evidence: scripts/out/VALIDATION_REPORT.md (incl. addendum). Config B
// (30m-classifier bear gate) was REJECTED — the classifier read CHOP on
// down days and the gate silently became "no bears ever".
// Set GATE_DISABLED=1 to run ungated (observation mode).
const LAST_FIRE_ET_MINUTES = 15 * 60 + 15; // 15:15 ET
const priorClose = {}; // ticker -> { day, close }

// Flip-flop cooldown — TESTED AND REJECTED (2026-07-08 loss study).
// Blocking opposite-direction fires within 20 min looked good in points
// (+113bps) but failed the option-EV test: the blocked bucket is +6% EV
// (weaker but positive), and on 7/08 it would have blocked the +$1,980
// morning put along with the −$1,348 loser. A fuel-skew veto (2:1/3:1/4:1)
// was also tested — vetoed fires were +14-24% EV, i.e. fine in aggregate.
// The −96% loser was a loss, not a pattern. Left configurable for future
// study: set FLIP_FLOP_COOLDOWN_MIN>0 to enable.
const FLIP_FLOP_COOLDOWN_MS = Number(process.env.FLIP_FLOP_COOLDOWN_MIN || 0) * 60_000;
const lastOpened = {}; // ticker -> { dir: +1|-1, tsMs }

function etMinutes(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(now);
  return Number(parts.find(p => p.type === 'hour')?.value) * 60 +
         Number(parts.find(p => p.type === 'minute')?.value);
}

function prevBusinessDay(dayStr) {
  const d = new Date(`${dayStr}T12:00:00Z`);
  do { d.setUTCDate(d.getUTCDate() - 1); } while ([0, 6].includes(d.getUTCDay()));
  return d.toISOString().slice(0, 10);
}

async function ensurePriorClose(ticker, day) {
  if (priorClose[ticker]?.day === day) return priorClose[ticker].close;
  try {
    const { fetchHistoricalSnapshot } = await import('../heatseeker/client.js');
    const prev = prevBusinessDay(day);
    const snap = await fetchHistoricalSnapshot(ticker, `${prev}T19:55:00Z`);
    if (snap?.spot != null) {
      priorClose[ticker] = { day, close: snap.spot };
      log.info(`${ticker} prior close (${prev}): $${snap.spot.toFixed(2)}`);
      return snap.spot;
    }
  } catch (err) {
    log.warn(`${ticker} prior-close fetch failed: ${err.message}`);
  }
  return null;
}

function gateVerdict({ state, spot, ticker }) {
  if (process.env.GATE_DISABLED === '1') return { allowed: true, reason: 'gate_disabled' };
  if (etMinutes() >= LAST_FIRE_ET_MINUTES) {
    return { allowed: false, reason: 'after_15:15_ET' };
  }
  const dir = state.startsWith('BEAR') ? -1 : +1;
  const last = lastOpened[ticker];
  if (FLIP_FLOP_COOLDOWN_MS > 0 &&
      last && last.dir === -dir && Date.now() - last.tsMs < FLIP_FLOP_COOLDOWN_MS) {
    const mins = Math.round((Date.now() - last.tsMs) / 60_000);
    return { allowed: false, reason: `flip_flop_cooldown (opposite fire ${mins}m ago)` };
  }
  if (state.startsWith('BEAR')) {
    // Anchor: prior close; fallback session open if the fetch failed.
    const anchor = priorClose[ticker]?.close ?? sessionOpen[ticker]?.open;
    const anchorName = priorClose[ticker]?.close != null ? 'prior_close' : 'session_open';
    if (anchor == null) return { allowed: false, reason: 'no_anchor_yet' };
    if (spot >= anchor) {
      return { allowed: false, reason: `bear_above_${anchorName} ($${spot.toFixed(2)} >= $${anchor.toFixed(2)})` };
    }
  }
  // ---- Bull tape gate (ENABLE_BULL_TAPE_GATE) — see src/tracker/bull-tape-gate.js
  // Bulls only; bears exit above. Uses in-memory spots + prior closes already
  // fetched for the bear gate — zero extra network calls, so a quote failure
  // can only ever mean 'unknown' (allow), never a crash or a block.
  const tapeMode = bullTapeGateMode();
  if (tapeMode !== 'off' && dir > 0) {
    const tape = {};
    for (const t of TAPE_TICKERS) {
      const latest = t === ticker ? spot : spotHistory[t]?.at(-1)?.spot;
      tape[t] = { spot: latest ?? null, priorClose: priorClose[t]?.close ?? null };
    }
    const verdict = evaluateBullTapeGate(tape);
    recordBullTapeGateFire({ dir, verdict, mode: tapeMode });
    if (verdict.pass === 'unknown') {
      log.warn(`[BullTapeGate] missing tape-gate data (${verdict.missing.join(',')}) — allowing ${ticker} ${state}`);
    }
    if (verdict.pass === false) {
      const detail = JSON.stringify({
        gate_name: 'bull_tape_gate', reason: verdict.reason, ...verdict.data,
        timestamp: new Date().toISOString(), fire_direction: 'bullish',
        original_fire_metadata: { ticker, state },
      });
      if (tapeMode === 'on') {
        log.info(`[BullTapeGate] ⛔ BLOCKED ${detail}`);
        log.info(formatBullTapeGateStats());
        return { allowed: false, reason: 'bull_tape_gate (SPY_QQQ_SPX_BELOW_PRIOR_CLOSE)', tape: verdict };
      }
      log.info(`[BullTapeGate] DRY would-block ${detail}`);
    }
    log.info(formatBullTapeGateStats());
    return { allowed: true, reason: 'ok', tape: verdict };
  }
  if (tapeMode !== 'off' && dir < 0) {
    recordBullTapeGateFire({ dir, verdict: { pass: true }, mode: tapeMode });
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

      // Record session open (first snapshot of the trading day) — fallback
      // anchor for the tape gate — and fetch prior close (primary anchor).
      const day = todayExpiration();
      if (!sessionOpen[ticker] || sessionOpen[ticker].day !== day) {
        sessionOpen[ticker] = { day, open: snap.spot };
        log.info(`${ticker} session open recorded: $${snap.spot.toFixed(2)}`);
        ensurePriorClose(ticker, day).catch(() => {});
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
        // UW forward-validation observation logging (research/uw/live_logging).
        // OBSERVATION ONLY — behind ENABLE_UW_OBSERVATION_LOGGING=true, dynamic
        // import (zero cost when off), fire-and-forget, exception-proof inside
        // the logger. Records every fire (including gate-blocked) so live
        // sessions extend the out-of-sample record for the policy simulator.
        // Bull-tape-gate fields ride into notes_json via execNote (the logger
        // stringifies it verbatim — logger itself unchanged). Plain string
        // when the gate is off → byte-identical rows to pre-gate behavior.
        const execNote = gate.tape
          ? {
              note: gate.reason,
              execution_status: gate.allowed ? 'executed' : 'gate_blocked',
              ...(gate.allowed ? {} : { blocked_by: 'bull_tape_gate' }),
              bull_tape_gate_pass: gate.tape.pass,
              ...(gate.tape.pass === false ? { bull_tape_gate_reason: gate.tape.reason } : {}),
              ...(gate.tape.pass === 'unknown' ? { bull_tape_gate_missing_data: true } : {}),
            }
          : gate.reason;
        if (process.env.ENABLE_UW_OBSERVATION_LOGGING === 'true') {
          import('../../research/uw/live_logging/observation-logger.js')
            .then(m => m.logFireObservation({
              ticker, state: fire.state,
              dir: fire.state.startsWith('BEAR') ? -1 : 1,
              spot: snap.spot, fireTsMs: now, surfaceNodes: nodes,
              executed: gate.allowed, execNote,
              quoteFetcher: (sym) => getOptionQuote(sym)
                .then(q => q ? { bid: q.bid, ask: q.ask, mid: q.mid } : null),
              vixFetcher: () => fetchSnapshot('VIX')
                .then(s => s?.spot ?? null).catch(() => null),
            }))
            .catch(() => { /* observation must never affect the fire loop */ });
        }
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
          if (result.opened === 0 && result.skipped) {
            log.info(`  skipped — ${result.skipped}`);
          } else {
            log.info(`  opened ${result.opened} plays`);
            if (result.opened > 0) {
              lastOpened[ticker] = { dir: fire.state.startsWith('BEAR') ? -1 : +1, tsMs: Date.now() };
            }
          }
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
