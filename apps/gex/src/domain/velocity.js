/**
 * Multi-horizon velocity tracking per Operator Overlay #5.
 *
 * For each (ticker, strike, trading_day) we keep a rolling buffer of recent
 * relative_significance samples. At each snapshot we compute Δrelative_significance
 * across six windows: 30s, 1m, 5m, 15m, 30m, session-open.
 *
 * Velocity is reported in "relative_significance percentage points per minute"
 * (matches spec §9.4 thresholds).
 *
 * Buffer kept in memory only — Sprint 1 does not persist velocity, since velocity
 * is recomputable from node_snapshots after the fact. Persisting is a Sprint 2+
 * concern when calibration notebooks need fast access.
 */

import { thresholds } from '../utils/config.js';

const WINDOWS_SEC = thresholds.velocity_windows_seconds;

// Map<key, Array<{tsMs, value}>>  where key = `${ticker}|${strike}|${tradingDay}`
const buffers = new Map();
// Map<`${ticker}|${tradingDay}`, sessionOpenMs>
const sessionOpens = new Map();

const PRUNE_HORIZON_MS = 31 * 60 * 1000; // longest non-session window is 30m, keep a bit more

function key(ticker, strike, tradingDay) {
  return `${ticker}|${strike}|${tradingDay}`;
}

export function recordSample({ ticker, strike, tradingDay, tsMs, relativeSignificance }) {
  const k = key(ticker, strike, tradingDay);
  let buf = buffers.get(k);
  if (!buf) {
    buf = [];
    buffers.set(k, buf);
  }
  buf.push({ tsMs, value: relativeSignificance });

  // Prune anything older than horizon (keep session-open separately via sessionOpens map)
  const cutoff = tsMs - PRUNE_HORIZON_MS;
  while (buf.length && buf[0].tsMs < cutoff) buf.shift();

  // Track session open per (ticker, day)
  const sk = `${ticker}|${tradingDay}`;
  if (!sessionOpens.has(sk)) {
    sessionOpens.set(sk, { tsMs, value: relativeSignificance });
  }
}

/**
 * Compute velocity for a node across all six windows.
 * Returns: { window_30s: { delta, deltaPerMin, direction }, ... , window_session: {...} }
 * delta is Δrelative_significance in percentage points (0-100 scale, matching threshold config).
 */
export function computeVelocity({ ticker, strike, tradingDay, tsMs, relativeSignificance }) {
  const buf = buffers.get(key(ticker, strike, tradingDay)) || [];
  const sessionOpen = sessionOpens.get(`${ticker}|${tradingDay}`);
  const result = {};

  for (const [windowName, secs] of Object.entries(WINDOWS_SEC)) {
    let pastValue;
    let elapsedMs;

    if (windowName === 'window_session' || secs == null) {
      if (!sessionOpen) {
        result[windowName] = { delta: 0, deltaPerMin: 0, direction: 'flat' };
        continue;
      }
      pastValue = sessionOpen.value;
      elapsedMs = tsMs - sessionOpen.tsMs;
    } else {
      const cutoffMs = tsMs - secs * 1000;
      // Find oldest sample at or after cutoff (i.e. closest to "secs ago")
      let chosen = null;
      for (const s of buf) {
        if (s.tsMs >= cutoffMs) { chosen = s; break; }
      }
      if (!chosen) {
        result[windowName] = { delta: 0, deltaPerMin: 0, direction: 'flat' };
        continue;
      }
      pastValue = chosen.value;
      elapsedMs = tsMs - chosen.tsMs;
    }

    // Spec thresholds expressed in percentage-points per minute (e.g. 0.10 pp/min for 5m).
    // relativeSignificance values are 0-1, so multiply by 100 to get percentage points.
    const deltaPp = (relativeSignificance - pastValue) * 100;
    const deltaPerMin = elapsedMs > 0 ? deltaPp / (elapsedMs / 60000) : 0;
    const direction = classify(windowName, deltaPerMin);

    result[windowName] = { delta: deltaPp, deltaPerMin, direction };
  }

  return result;
}

function classify(windowName, deltaPerMin) {
  const t = thresholds.velocity_thresholds[windowName];
  if (!t) return 'flat';
  if (deltaPerMin >= t.growing) return 'growing';
  if (deltaPerMin <= t.decaying) return 'decaying';
  return 'stable';
}

export function clearVelocityState() {
  buffers.clear();
  sessionOpens.clear();
}
