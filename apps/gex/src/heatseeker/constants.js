export const HEATSEEKER_BASE = 'https://app.skylit.ai';
export const CLERK_BASE = 'https://clerk.skylit.ai';
export const CLERK_API_VERSION = '2025-11-10';
export const CLERK_JS_VERSION = '5.124.0';

// max_expirations=10 covers 0DTE → ~6 months out so the multi-expiration
// GexAnalyst has real term-structure data to reason across (near vs LEAP).
// max_strikes=200 is generous; SPX in particular has a long chain.
export const STREAM_URL = (symbol, token) =>
  `${HEATSEEKER_BASE}/api/stream?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(token)}&max_strikes=200&max_expirations=10`;

// SPX has the largest strike chain and takes the longest to stream; bump
// both timeouts so the SSE connect (FETCH_TIMEOUT_MS) and the snapshot wait
// (SSE_TIMEOUT_MS) both have headroom. Still well under the 5-min job timeout.
export const SSE_TIMEOUT_MS = 30_000;
export const FETCH_TIMEOUT_MS = 30_000;
