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
 *   node scripts/structure-snapshot.js --ticker SPY --all-expirations
 *
 * With --all-expirations: returns the legacy single-expiration shape with an
 * extra `expiry_views` array containing the full {surface + structure} for
 * every expiration the feed exposes (0DTE → LEAP). Backward-compatible: the
 * top-level fields still describe the nearest expiry.
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

  // Multi-expiration: derive surface + structure for every expiry the feed
  // exposed. Each entry has the same shape as `out` but scoped to one expiry.
  // Inexpensive: we already have the gamma matrix, computeSurface is local.
  if (args['all-expirations'] && Array.isArray(snap.allExpirations)) {
    out.expiry_views = snap.allExpirations.map((view) => {
      const vSurface = computeSurface(view.strikes, snap.spot);
      const vStructure = deriveStructure({ nodes: vSurface.nodes, spot: snap.spot });
      return {
        expiration: view.expiration,
        expiration_index: view.expirationIndex,
        num_strikes: vSurface.nodes.length,
        total_abs_gamma: vSurface.totalAbs,
        signed_total_gamma: vSurface.signedTotal,
        regime_score: vSurface.regimeScore,
        king: vSurface.kingStrike != null
          ? { strike: vSurface.kingStrike, gamma: vSurface.kingGamma }
          : null,
        floor: node(vStructure.floor),
        ceiling: node(vStructure.ceiling),
        air_pockets: vStructure.airPockets || [],
        liquidity_vacuums: vStructure.liquidityVacuums || [],
      };
    });
  }

  process.stdout.write(JSON.stringify(out) + '\n');
  process.exit(0);
} catch (err) {
  console.error(`structure-snapshot failed for ${args.ticker}: ${err.message}`);
  process.stdout.write('{}\n');
  process.exit(1);
}
