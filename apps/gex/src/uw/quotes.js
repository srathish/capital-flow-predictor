/**
 * Minimal Unusual Whales option-chain quote fetcher.
 *
 * The rest of Bellwether uses UW indirectly via cfp-api (Python). The tracker
 * refresh loop needs a JS-side quote for a single OCC symbol every 60s, so
 * this is a small direct client. Reads UNUSUAL_WHALES_API_KEY from env.
 *
 * Endpoint: /api/option-contract/{sym}/flow?limit=1 — same one already used
 * in the Skylit scan scripts. Returns bid / ask / mid or null on error.
 */

import { createLogger } from '../utils/logger.js';

const log = createLogger('UwQuotes');
const BASE = 'https://api.unusualwhales.com/api';

function apiKey() {
  return process.env.UNUSUAL_WHALES_API_KEY || process.env.UW_API_KEY || '';
}

/**
 * Fetch a single option quote by OCC symbol.
 * Returns { bid, ask, mid, last, iv } or null.
 */
export async function getOptionQuote(symbol, { timeoutMs = 8_000 } = {}) {
  const key = apiKey();
  if (!key) {
    log.warn('UNUSUAL_WHALES_API_KEY not set — quote fetches will fail');
    return null;
  }
  const url = `${BASE}/option-contract/${symbol}/flow?limit=1`;
  try {
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) {
      log.warn(`quote ${symbol}: HTTP ${r.status}`);
      return null;
    }
    const j = await r.json();
    const row = Array.isArray(j?.data) ? j.data[0] : null;
    if (!row) return null;
    // /flow returns nbbo_bid / nbbo_ask on each trade record.
    const bid = Number(row.nbbo_bid ?? row.bid ?? 0) || null;
    const ask = Number(row.nbbo_ask ?? row.ask ?? 0) || null;
    const last = Number(row.price ?? row.last ?? 0) || null;
    const mid = bid != null && ask != null && bid > 0 && ask > 0
      ? (bid + ask) / 2
      : last;
    return {
      bid, ask, mid, last,
      iv: Number(row.implied_volatility ?? 0) || null,
    };
  } catch (err) {
    if (err.name === 'AbortError' || err.name === 'TimeoutError') {
      log.warn(`quote ${symbol} timeout`);
    } else {
      log.warn(`quote ${symbol}: ${err.message}`);
    }
    return null;
  }
}
