/**
 * Pre-open auth preflight for the plays-tracker.
 *
 * Run this AFTER refreshing the Clerk cookie (cfp-jobs skylit-login) and
 * BEFORE launching the tracker, to confirm the Skylit auth + data path is
 * actually alive — so we never eat another dead-cookie outage through the
 * 9:30 open (as happened 2026-07-13, 9:30–9:57).
 *
 * Uses the SAME env bootstrap + initAuth + fetchSnapshot path the tracker
 * uses, so a green result means the tracker will start clean.
 *
 *   node scripts/auth-preflight.js       (or)   pnpm auth:check
 *
 * Exits 0 = HEALTHY (safe to launch), 1 = BROKEN (refresh the cookie first).
 * Report-only: touches no trading logic and opens no plays.
 */
import './_env-bootstrap.js'; // multi-location .env loader — MUST be first import
import { initAuth } from '../src/heatseeker/auth.js';
import { fetchSnapshot } from '../src/heatseeker/client.js';

const RED = '\x1b[31m', GRN = '\x1b[32m', DIM = '\x1b[2m', RST = '\x1b[0m';
const fail = (msg, hint) => {
  console.error(`\n${RED}✗ ${msg}${RST}`);
  if (hint) console.error(hint);
  console.error('  Fix the cookie:  cd apps/jobs && uv run cfp-jobs skylit-login');
  console.error('  Then re-run:      pnpm auth:check\n');
  process.exit(1);
};

async function main() {
  process.stdout.write('[auth-preflight] initializing Skylit auth… ');
  let ok = false;
  try { ok = await initAuth(); } catch { ok = false; }
  if (!ok) { console.log(`${RED}FAIL${RST}`); fail('auth init failed — the Clerk session is missing/expired.'); }
  console.log(`${GRN}ok${RST}`);

  // End-to-end: one real snapshot fetch — exactly what FireLoop does at 9:30.
  process.stdout.write('[auth-preflight] test snapshot SPY… ');
  let snap = null;
  try { snap = await fetchSnapshot('SPY'); }
  catch (e) {
    console.log(`${RED}FAIL${RST}`);
    fail(`snapshot fetch failed: ${e.message}`,
      '  A 401 / AUTH_EXPIRED here means the cookie is stale.');
  }
  if (!snap || !Number.isFinite(snap.spot)) { console.log(`${RED}FAIL${RST}`); fail('snapshot returned no spot.'); }

  console.log(`${GRN}ok${RST}  spot=${snap.spot}  strikes=${(snap.strikes || []).length}`);
  console.log(`\n${GRN}✓ HEALTHY — auth + data path live. Safe to launch the tracker.${RST}`);
  console.log(`${DIM}  reminder: launch with ENABLE_BULL_TAPE_GATE=true to arm the gate.${RST}\n`);
  process.exit(0);
}
main();
