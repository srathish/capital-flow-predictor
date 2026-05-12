#!/usr/bin/env node
/**
 * One-shot structural snapshot for an arbitrary Heatseeker ticker.
 *
 * Bridge for the_final_plan agents (option 2 of the integration plan).
 * Fetches a fresh SSE snapshot, runs computeSurface + deriveStructure, and
 * prints a single JSON blob to stdout. No SQLite writes, no lifecycle, no
 * velocity (those need running history) — just the immediate dealer-level
 * structural picture suitable for inlining into a persona prompt.
 *
 * Usage:
 *   node scripts/structure-snapshot.js --ticker SPY
 *
 * Exit codes:
 *   0  ok, JSON on stdout
 *   1  fetch / auth error (message on stderr, "{}" on stdout for parser sanity)
 */

import 'dotenv/config';
import { initAuth } from '../src/heatseeker/auth.js';
import { fetchSnapshot } from '../src/heatseeker/client.js';
import { computeSurface } from '../src/domain/significance.js';
import { deriveStructure } from '../src/domain/structure.js';

const args = {};
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) args[m[1]] = m[2] ?? true;
}
if (!args.ticker) {
  console.error('Usage: --ticker SYMBOL');
  process.stdout.write('{}\n');
  process.exit(1);
}

try {
  await initAuth();
  const snap = await fetchSnapshot(args.ticker);
  const surface = computeSurface(snap.strikes, snap.spot);
  const structure = deriveStructure({ nodes: surface.nodes, spot: snap.spot });

  const node = (n) => n
    ? {
        strike: n.strike,
        gamma: n.gamma,
        sign: n.sign,
        relative_significance: n.relativeSignificance,
        distance_from_spot: n.distanceFromSpot,
      }
    : null;

  const out = {
    ticker: args.ticker,
    fetched_at_ms: snap.fetchedAtMs,
    spot: snap.spot,
    expiration: snap.expiration,
    num_strikes: surface.nodes.length,
    total_abs_gamma: surface.totalAbs,
    signed_total_gamma: surface.signedTotal,
    regime_score: surface.regimeScore,
    king: surface.kingStrike != null
      ? { strike: surface.kingStrike, gamma: surface.kingGamma }
      : null,
    floor: node(structure.floor),
    ceiling: node(structure.ceiling),
    gatekeepers: (structure.gatekeepers || []).map(node),
    air_pockets: structure.airPockets || [],
    liquidity_vacuums: structure.liquidityVacuums || [],
  };
  process.stdout.write(JSON.stringify(out) + '\n');
  process.exit(0);
} catch (err) {
  console.error(`structure-snapshot failed for ${args.ticker}: ${err.message}`);
  process.stdout.write('{}\n');
  process.exit(1);
}
