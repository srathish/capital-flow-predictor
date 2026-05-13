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

export async function fetchSnapshot(ticker) {
  const token = await getFreshToken();
  const url = STREAM_URL(ticker, token);

  const resp = await fetch(url, {
    headers: {
      'Origin': 'https://app.skylit.ai',
      'Referer': 'https://app.skylit.ai/',
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
        if (eventType === 'snapshot_update' && parsed.data?.CurrentSpot) {
          snapshot = parsed.data;
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

  let strikes = raw.Strikes;
  if (!Array.isArray(strikes)) {
    // Fallback: derive from spot at $5 intervals (SPXW); SPY/QQQ should always send Strikes.
    const step = ticker === 'SPY' || ticker === 'QQQ' ? 1 : 5;
    const half = Math.floor(gammaRows.length / 2);
    const start = Math.round((spot - half * step) / step) * step;
    strikes = gammaRows.map((_, i) => start + i * step);
    log.warn(`${ticker}: no Strikes array, derived ${strikes.length} from spot at step ${step}`);
  }

  // Primary view: nearest expiration (gammaRows[i][0]). Preserves legacy callers
  // that read `snapshot.strikes` and `snapshot.expiration` unchanged.
  const nodes = [];
  for (let i = 0; i < gammaRows.length; i++) {
    const row = gammaRows[i];
    const gamma = (row && row[0]) || 0;
    if (strikes[i] == null) continue;
    nodes.push({ strike: strikes[i], gamma });
  }

  // Multi-expiration view: every expiration in raw.Expirations gets its own
  // strike → gamma map. Consumers can pick any horizon (0DTE, weekly, LEAP)
  // and run the same surface/structure derivation against it.
  const allExpirations = [];
  for (let ei = 0; ei < expirations.length; ei++) {
    const expNodes = [];
    for (let si = 0; si < gammaRows.length; si++) {
      const row = gammaRows[si];
      const gamma = (row && row[ei]) || 0;
      if (strikes[si] == null) continue;
      expNodes.push({ strike: strikes[si], gamma });
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
