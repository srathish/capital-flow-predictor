/**
 * Surface cache — the fire loop already pulls the full Skylit GEX+VEX
 * surface for every ticker each tick. This module shares that surface with
 * the refresh loop so exit decisions read the ENTIRE strike map, not just
 * the option mark. One fetch, two consumers.
 *
 * Shape per ticker: { tsMs, spot, nodes } where nodes carry
 * { strike, gamma, vanna, sign, relativeSignificance }.
 */

const surfaces = new Map();

// A surface older than this is stale — refresh-loop skips structural checks
// rather than acting on a map that no longer reflects dealer positioning.
const MAX_SURFACE_AGE_MS = 3 * 60_000;

export function publishSurface(ticker, { tsMs, spot, nodes }) {
  surfaces.set(ticker, { tsMs, spot, nodes });
}

export function getSurface(ticker, { maxAgeMs = MAX_SURFACE_AGE_MS } = {}) {
  const s = surfaces.get(ticker);
  if (!s) return null;
  if (Date.now() - s.tsMs > maxAgeMs) return null;
  return s;
}
