/**
 * Heatseeker stream client.
 *
 * Returns a normalized snapshot for a given ticker:
 *   { ticker, fetchedAtMs, spot, expiration, strikes: [{ strike, gamma }, ...], apiVelocity }
 *
 * Ignores the ticker's strike grid scaling (SPX vs SPY vs QQQ); just relays what the API
 * gives back. 0DTE only — column 0 of GammaValues.
 */

import { getFreshToken, authStatus } from './auth.js';
import { STREAM_URL, SSE_TIMEOUT_MS, FETCH_TIMEOUT_MS } from './constants.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('HSClient');

export async function fetchSnapshot(ticker, maxExpirations = 10) {
  const token = await getFreshToken();
  const url = STREAM_URL(ticker, token, maxExpirations);

  const resp = await fetch(url, {
    headers: {
      'Origin': 'https://app.skylit.ai',
      'Referer': 'https://app.skylit.ai/',
      'Authorization': `Bearer ${token}`,
      'Accept': 'text/event-stream',
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (resp.status === 401 || resp.status === 403) {
    const auth = authStatus();
    throw new Error(
      `AUTH_EXPIRED: HTTP ${resp.status} for ${ticker}. ` +
      (auth.method === 'clerk-auto-refresh'
        ? 'Re-login at app.skylit.ai and refresh CLERK_CLIENT_COOKIE in .env'
        : 'Static JWT expired — refresh HEATSEEKER_JWT')
    );
  }
  if (!resp.ok) throw new Error(`Heatseeker HTTP ${resp.status} for ${ticker}`);

  const contentType = resp.headers.get('content-type') || '';
  let raw;
  if (contentType.includes('text/event-stream')) {
    raw = await readSseStream(resp, ticker);
  } else {
    raw = await resp.json();
  }

  return normalize(ticker, raw);
}

/**
 * Historical snapshot for a specific point in time. Uses Skylit's internal
 * /api/data endpoint (discovered from webpack chunk 6571) which accepts a
 * `timestamp` ISO string and returns a synchronous JSON payload — no SSE.
 *
 * Retention window is ~90 calendar days back from today (empirically probed
 * 2026-07-08: 2026-04-15 works, 2026-04-01 returns HTTP 400). Timestamps
 * outside market hours snap to the nearest available frame server-side.
 *
 * Returns the same normalized shape as fetchSnapshot() so grader/backtester
 * code paths are identical.
 */
export async function fetchHistoricalSnapshot(ticker, timestampIso, maxExpirations = 10) {
  const token = await getFreshToken();
  const url = new URL('https://app.skylit.ai/api/data');
  url.searchParams.set('symbol', ticker);
  url.searchParams.set('nocache', Math.random().toString());
  url.searchParams.set('max_strikes', '200');
  // Default 10 (0DTE tracker only ever reads expiration[0], so it's unaffected).
  // Swing scans pass a higher value to reach the further-out monthly OPEX
  // (8/21, 9/18, LEAPS) where the biggest dealer magnets — the true King — sit.
  url.searchParams.set('max_expirations', String(maxExpirations));
  url.searchParams.set('timestamp', timestampIso);

  const resp = await fetch(url.toString(), {
    headers: {
      'Origin': 'https://app.skylit.ai',
      'Referer': 'https://app.skylit.ai/',
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (resp.status === 401 || resp.status === 403) {
    throw new Error(`AUTH_EXPIRED: HTTP ${resp.status} for ${ticker}@${timestampIso}`);
  }
  if (resp.status === 400) {
    // Out-of-retention window or malformed timestamp — a valid "no data here" signal.
    return null;
  }
  if (!resp.ok) throw new Error(`Heatseeker HTTP ${resp.status} for ${ticker}@${timestampIso}`);

  const raw = await resp.json();
  if (!raw || raw.CurrentSpot == null) return null;

  const snap = normalize(ticker, raw);
  snap.fetchedAtMs = Date.parse(timestampIso);
  return snap;
}

async function readSseStream(resp, ticker) {
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let snapshot = null;
  let velocity = null;
  const start = Date.now();

  while (Date.now() - start < SSE_TIMEOUT_MS) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const events = buffer.split('\n\n');
    buffer = events.pop() || '';

    for (const event of events) {
      const lines = event.trim().split('\n');
      const eventType = lines.find(l => l.startsWith('event:'))?.slice(6).trim();
      const dataLine = lines.find(l => l.startsWith('data:'))?.slice(5).trim();
      if (!dataLine) continue;

      try {
        const parsed = JSON.parse(dataLine);
        // Skylit rotates event names; accept any that carry the canonical
        // CurrentSpot payload. 'initial_data' is the current name as of
        // 2026-06-25; 'snapshot_update' was the older one.
        const payload = parsed.data?.data ?? parsed.data;
        if ((eventType === 'snapshot_update' || eventType === 'initial_data' || eventType === 'snapshot') && payload?.CurrentSpot) {
          snapshot = payload;
        } else if (eventType === 'velocity_update' && parsed.data?.topRisers) {
          velocity = parsed.data;
        }
      } catch {
        // partial frame, skip
      }
    }

    if (snapshot) break;
  }
  reader.cancel();

  if (!snapshot) throw new Error(`No snapshot_update in ${SSE_TIMEOUT_MS}ms for ${ticker}`);
  if (velocity) snapshot._velocity = velocity;
  return snapshot;
}

function normalize(ticker, raw) {
  const spot = raw.CurrentSpot;
  const expirations = raw.Expirations || [];
  const expiration = expirations[0] || null;
  const gammaRows = raw.GammaValues || [];
  const vannaRows = raw.VannaValues || [];  // parallel-indexed with gammaRows

  let strikes = raw.Strikes;
  if (!Array.isArray(strikes)) {
    // Fallback: derive from spot at $5 intervals (SPXW); SPY/QQQ should always send Strikes.
    const step = ticker === 'SPY' || ticker === 'QQQ' ? 1 : 5;
    const half = Math.floor(gammaRows.length / 2);
    const start = Math.round((spot - half * step) / step) * step;
    strikes = gammaRows.map((_, i) => start + i * step);
    log.warn(`${ticker}: no Strikes array, derived ${strikes.length} from spot at step ${step}`);
  }

  // Primary view: nearest expiration (index 0). Preserves legacy callers that
  // read snapshot.strikes[].gamma unchanged, and adds .vanna for consumers
  // that grade against GEX+VEX together (Giul's rules — magnet vs rejection).
  const nodes = [];
  for (let i = 0; i < gammaRows.length; i++) {
    const gRow = gammaRows[i];
    const vRow = vannaRows[i];
    const gamma = (gRow && gRow[0]) || 0;
    const vanna = (vRow && vRow[0]) || 0;
    if (strikes[i] == null) continue;
    nodes.push({ strike: strikes[i], gamma, vanna });
  }

  // Multi-expiration view: every expiration gets its own strike → {gamma, vanna}
  // map. Consumers can pick any horizon (0DTE, weekly, LEAP) and grade with
  // both surfaces per Giul's rules.
  const allExpirations = [];
  for (let ei = 0; ei < expirations.length; ei++) {
    const expNodes = [];
    for (let si = 0; si < gammaRows.length; si++) {
      const gRow = gammaRows[si];
      const vRow = vannaRows[si];
      const gamma = (gRow && gRow[ei]) || 0;
      const vanna = (vRow && vRow[ei]) || 0;
      if (strikes[si] == null) continue;
      expNodes.push({ strike: strikes[si], gamma, vanna });
    }
    allExpirations.push({
      expiration: expirations[ei],
      expirationIndex: ei,
      strikes: expNodes,
    });
  }

  return {
    ticker,
    fetchedAtMs: Date.now(),
    spot,
    expiration,
    strikes: nodes,
    allExpirations,
    apiVelocity: raw._velocity || null,
  };
}
