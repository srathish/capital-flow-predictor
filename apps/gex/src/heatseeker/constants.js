export const HEATSEEKER_BASE = 'https://app.skylit.ai';
export const CLERK_BASE = 'https://clerk.skylit.ai';
export const CLERK_API_VERSION = '2025-11-10';
export const CLERK_JS_VERSION = '5.124.0';

export const STREAM_URL = (symbol, token) =>
  `${HEATSEEKER_BASE}/api/stream?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(token)}&max_strikes=200&max_expirations=1`;

export const SSE_TIMEOUT_MS = 10_000;
export const FETCH_TIMEOUT_MS = 15_000;
