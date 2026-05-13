#!/usr/bin/env node
/**
 * Poll Heatseeker for each ticker, compute surface + structure with
 * --all-expirations, and upsert into skylit_structures (Postgres).
 *
 * Designed for the GitHub Actions data-refresh cron — runs every ~10 min
 * during RTH. The Python skylit_bridge reads the latest row per ticker
 * from this table; no shell-out to Node from the API container.
 *
 * Usage:
 *   node scripts/persist-snapshots.js --tickers SPY,QQQ,SPX
 *   node scripts/persist-snapshots.js --tickers SPY --quiet
 *
 * Exit codes:
 *   0  all tickers persisted (or empty list)
 *   1  fatal: auth failed / DB unreachable
 *   2  partial: some tickers failed but others succeeded
 */

import 'dotenv/config';
import { initAuth } from '../src/heatseeker/auth.js';
import { fetchSnapshot } from '../src/heatseeker/client.js';
import { computeSurface } from '../src/domain/significance.js';
import { deriveStructure } from '../src/domain/structure.js';
import { writeSkylitStructure, closePg } from '../src/store/pg.js';

const args = {};
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) args[m[1]] = m[2] ?? true;
}

const tickers = (args.tickers || 'SPY,QQQ,SPX')
  .split(',')
  .map((t) => t.trim().toUpperCase())
  .filter(Boolean);

const quiet = !!args.quiet;
function log(...x) { if (!quiet) console.log(...x); }

function nodeOut(n) {
  return n
    ? {
        strike: n.strike,
        gamma: n.gamma,
        sign: n.sign,
        relative_significance: n.relativeSignificance,
        distance_from_spot: n.distanceFromSpot,
      }
    : null;
}

function buildStructurePayload(ticker, snap) {
  // Primary (nearest) view
  const surface = computeSurface(snap.strikes, snap.spot);
  const structure = deriveStructure({ nodes: surface.nodes, spot: snap.spot });

  const out = {
    ticker,
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
    floor: nodeOut(structure.floor),
    ceiling: nodeOut(structure.ceiling),
    gatekeepers: (structure.gatekeepers || []).map(nodeOut),
    air_pockets: structure.airPockets || [],
    liquidity_vacuums: structure.liquidityVacuums || [],
  };

  // Per-expiration views (0DTE → weekly → LEAP). Same shape as
  // scripts/structure-snapshot.js --all-expirations so the Python bridge
  // can apply it via apply_structure_to_positioning() unchanged.
  if (Array.isArray(snap.allExpirations)) {
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
        floor: nodeOut(vStructure.floor),
        ceiling: nodeOut(vStructure.ceiling),
        air_pockets: vStructure.airPockets || [],
        liquidity_vacuums: vStructure.liquidityVacuums || [],
      };
    });
  }
  return out;
}

const ok = await initAuth();
if (!ok) {
  console.error('persist-snapshots: initAuth() returned false — no Clerk credentials available.');
  await closePg();
  process.exit(1);
}

const results = { ok: [], failed: [] };
for (const ticker of tickers) {
  try {
    const snap = await fetchSnapshot(ticker);
    const payload = buildStructurePayload(ticker, snap);
    const res = await writeSkylitStructure({
      ticker,
      fetchedAt: snap.fetchedAtMs,
      spot: snap.spot,
      expiration: snap.expiration,
      structure: payload,
    });
    if (res.ok) {
      results.ok.push(ticker);
      log(`  ✓ ${ticker} @ $${snap.spot} regime=${payload.regime_score?.toFixed?.(2) ?? '?'} ` +
          `expiries=${payload.expiry_views?.length ?? 0}`);
    } else {
      results.failed.push({ ticker, error: res.error });
      console.warn(`  ✗ ${ticker} write failed: ${res.error}`);
    }
  } catch (err) {
    results.failed.push({ ticker, error: err.message });
    console.warn(`  ✗ ${ticker} fetch failed: ${err.message}`);
  }
}

await closePg();
log(`persist-snapshots: ${results.ok.length} ok / ${results.failed.length} failed`);
if (results.failed.length > 0 && results.ok.length === 0) process.exit(1);
if (results.failed.length > 0) process.exit(2);
process.exit(0);
