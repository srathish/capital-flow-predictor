/**
 * surface-json — print one Skylit GEX/VEX snapshot as JSON on stdout.
 *
 * Read-only bridge for external consumers (Athena's perception layer) so they
 * ride the existing heatseeker client + Clerk auth instead of reimplementing
 * the cookie/JWT dance. Emits the fetchSnapshot() normalized shape verbatim:
 *   { ticker, fetchedAtMs, spot, expiration, strikes: [{strike, gamma, vanna}], allExpirations }
 *
 * Usage: node scripts/surface-json.js SPXW [maxExpirations]
 */
import './_env-bootstrap.js';   // multi-location .env loader — MUST be first import

import { fetchSnapshot } from '../src/heatseeker/client.js';
import { initAuth } from '../src/heatseeker/auth.js';

const ticker = (process.argv[2] || '').toUpperCase();
const maxExpirations = Number(process.argv[3] || 10);

if (!ticker) {
  console.error('usage: node scripts/surface-json.js <TICKER> [maxExpirations]');
  process.exit(2);
}

try {
  const ok = await initAuth();
  if (!ok) {
    console.error('AUTH_UNAVAILABLE: no Clerk credentials (Postgres empty, .env empty)');
    process.exit(1);
  }
  const snap = await fetchSnapshot(ticker, maxExpirations);
  // Sentinel line: the logger shares stdout, so consumers split on this marker.
  process.stdout.write('\n__SURFACE_JSON__' + JSON.stringify(snap));
} catch (err) {
  console.error(String(err?.message || err));
  process.exit(1);
}
