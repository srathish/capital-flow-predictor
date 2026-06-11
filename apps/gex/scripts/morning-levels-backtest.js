#!/usr/bin/env node
/**
 * Morning-Levels Prediction Backtest.
 *
 * Models exactly what a trader does: at 9:30 ET, look at the heatmap, identify
 * the day's KEY LEVELS (floor / ceiling / king node / secondary gatekeepers),
 * commit to them. Then watch the day play out. Score:
 *   • Hit-rate per level type per ticker (did price actually touch the level?)
 *   • Time-to-hit (how long after open did the level get tagged?)
 *   • Direction-of-day resolution (did spot close above ceiling? below floor?
 *     between them? Pinned to king?)
 *
 * Floor = biggest positive-gamma node BELOW spot (support).
 * Ceiling = biggest positive-gamma node ABOVE spot (resistance).
 * King = biggest abs-gamma node anywhere (dominant magnet).
 * Gatekeepers = secondary positive-gamma nodes between floor/king/ceiling.
 *
 * Uses 0DTE column (the row a heatmap trader scans for intraday).
 *
 * Output:
 *   apps/gex/scripts/out/morning-levels.csv (per day per ticker)
 *   stdout summary: hit-rate per level type
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPLAY_DIR = '/Users/saiyeeshrathish/gex-data-replay-reader/data';
const OUT_DIR = join(__dirname, 'out');
const TICKERS = ['SPXW', 'SPY', 'QQQ'];

// Tolerance for "touched" detection — half the typical strike spacing.
const TOUCH_TOLERANCE = { SPXW: 2.5, SPY: 0.5, QQQ: 0.5 };
// Significance gates (rel_significance = abs_gamma / sum_abs_gamma)
const MIN_FLOOR_CEIL_REL = 0.02;
const MIN_GATEKEEPER_REL = 0.015;
// Use frame 5 (≈ 5 minutes after open) as the "morning observation" — gives a
// stable surface read post-open auction.
const MORNING_FRAME_IDX = 5;

function loadReplay(path) {
  const raw = JSON.parse(readFileSync(path, 'utf-8'));
  const out = {};
  for (const ticker of TICKERS) {
    const frames = [];
    for (const f of raw.frames) {
      const t = f.tickers[ticker];
      if (!t || !t.spotPrice || !Array.isArray(t.gammaValues)) continue;
      frames.push({
        ts: f.timestamp,
        spot: t.spotPrice,
        strikes: t.strikes,
        gamma: t.gammaValues,
      });
    }
    out[ticker] = frames;
  }
  return out;
}

/**
 * Compute morning levels from a single frame using the 0DTE column.
 *
 * Returns:
 *   { spot, floor, ceiling, king, gatekeepers[], rangeWidth }
 *   Each level is { strike, gamma, relSig } or null if not found.
 */
function computeMorningLevels(frame, expIdx = 0) {
  const { spot, strikes, gamma } = frame;
  const nodes = strikes.map((s, i) => ({
    strike: s,
    gamma: gamma[i]?.[expIdx] ?? 0,
  }));

  let totalAbs = 0;
  for (const n of nodes) totalAbs += Math.abs(n.gamma);
  if (totalAbs === 0) return null;

  for (const n of nodes) n.relSig = Math.abs(n.gamma) / totalAbs;

  // King = biggest abs anywhere
  let king = null;
  for (const n of nodes) {
    if (!king || Math.abs(n.gamma) > Math.abs(king.gamma)) king = n;
  }

  // Floor / Ceiling: biggest positive-gamma below / above spot, with min rel_sig gate
  let floor = null, ceiling = null;
  for (const n of nodes) {
    if (n.gamma <= 0) continue;
    if (n.relSig < MIN_FLOOR_CEIL_REL) continue;
    if (n.strike < spot) {
      if (!floor || n.gamma > floor.gamma) floor = n;
    } else if (n.strike > spot) {
      if (!ceiling || n.gamma > ceiling.gamma) ceiling = n;
    }
  }

  // Gatekeepers = positive-gamma nodes between floor and ceiling above the gatekeeper threshold,
  // excluding king/floor/ceiling themselves
  const anchors = new Set([king?.strike, floor?.strike, ceiling?.strike].filter(s => s != null));
  const lo = floor?.strike ?? spot - spot * 0.02;
  const hi = ceiling?.strike ?? spot + spot * 0.02;
  const gatekeepers = nodes
    .filter(n => n.gamma > 0 && n.relSig >= MIN_GATEKEEPER_REL && !anchors.has(n.strike) && n.strike > lo && n.strike < hi)
    .sort((a, b) => b.gamma - a.gamma)
    .slice(0, 3); // top 3 gatekeepers

  return {
    spot,
    floor,
    ceiling,
    king,
    gatekeepers,
    rangeWidth: floor && ceiling ? ceiling.strike - floor.strike : null,
  };
}

/**
 * Did spot path touch a level (within tolerance) at any point in remaining frames?
 * Returns { hit: bool, hitFrameIdx, hitTs } or null if no hit.
 */
function checkHit(framesAfterMorning, strike, tolerance) {
  if (strike == null) return { hit: false, hitFrameIdx: null, hitTs: null };
  for (let i = 0; i < framesAfterMorning.length; i++) {
    if (Math.abs(framesAfterMorning[i].spot - strike) <= tolerance) {
      return { hit: true, hitFrameIdx: i, hitTs: framesAfterMorning[i].ts };
    }
  }
  return { hit: false, hitFrameIdx: null, hitTs: null };
}

/** Closing position relative to levels: above_ceiling | at_ceiling | inside | at_floor | below_floor | at_king */
function classifyClose(closeSpot, levels, tol) {
  const { floor, ceiling, king } = levels;
  if (king && Math.abs(closeSpot - king.strike) <= tol) return 'pinned_to_king';
  if (ceiling && closeSpot > ceiling.strike + tol) return 'above_ceiling';
  if (floor && closeSpot < floor.strike - tol) return 'below_floor';
  if (floor && ceiling && closeSpot >= floor.strike - tol && closeSpot <= ceiling.strike + tol) return 'inside_range';
  if (ceiling && Math.abs(closeSpot - ceiling.strike) <= tol) return 'at_ceiling';
  if (floor && Math.abs(closeSpot - floor.strike) <= tol) return 'at_floor';
  return 'unclassified';
}

function runDay(date, results) {
  const path = join(REPLAY_DIR, `gex-replay-${date}.json`);
  if (!existsSync(path)) return;
  const byTicker = loadReplay(path);

  for (const ticker of TICKERS) {
    const frames = byTicker[ticker];
    if (!frames || frames.length <= MORNING_FRAME_IDX + 30) continue;
    const tol = TOUCH_TOLERANCE[ticker];

    const morningFrame = frames[MORNING_FRAME_IDX];
    const levels = computeMorningLevels(morningFrame, 0);
    if (!levels) continue;

    const after = frames.slice(MORNING_FRAME_IDX + 1);
    const eodFrame = frames[frames.length - 1];

    const floorCheck = checkHit(after, levels.floor?.strike, tol);
    const ceilingCheck = checkHit(after, levels.ceiling?.strike, tol);
    const kingCheck = checkHit(after, levels.king?.strike, tol);
    const gkChecks = levels.gatekeepers.map(g => ({
      strike: g.strike,
      gamma: g.gamma,
      ...checkHit(after, g.strike, tol),
    }));

    // Pick the "first hit" of any level for time-to-first-hit metric
    const allHits = [
      floorCheck.hit ? { type: 'floor', frame: floorCheck.hitFrameIdx } : null,
      ceilingCheck.hit ? { type: 'ceiling', frame: ceilingCheck.hitFrameIdx } : null,
      kingCheck.hit ? { type: 'king', frame: kingCheck.hitFrameIdx } : null,
      ...gkChecks.filter(g => g.hit).map(g => ({ type: 'gk', frame: g.hitFrameIdx, strike: g.strike })),
    ].filter(Boolean).sort((a, b) => a.frame - b.frame);
    const firstHit = allHits[0] || null;

    const closeClass = classifyClose(eodFrame.spot, levels, tol);

    results.push({
      date, ticker,
      morningSpot: levels.spot,
      morningTs: morningFrame.ts,
      floor: levels.floor?.strike ?? null,
      floorGamma: levels.floor?.gamma ?? null,
      ceiling: levels.ceiling?.strike ?? null,
      ceilingGamma: levels.ceiling?.gamma ?? null,
      king: levels.king?.strike ?? null,
      kingGamma: levels.king?.gamma ?? null,
      kingSign: levels.king && levels.king.gamma > 0 ? 'positive' : 'negative',
      gatekeepers: levels.gatekeepers.map(g => g.strike).join('|'),
      rangeWidthPct: levels.rangeWidth ? (levels.rangeWidth / levels.spot * 100) : null,
      eodSpot: eodFrame.spot,
      eodMovePct: (eodFrame.spot - levels.spot) / levels.spot * 100,
      floorHit: floorCheck.hit,
      floorMinAfter: floorCheck.hitFrameIdx,
      ceilingHit: ceilingCheck.hit,
      ceilingMinAfter: ceilingCheck.hitFrameIdx,
      kingHit: kingCheck.hit,
      kingMinAfter: kingCheck.hitFrameIdx,
      gatekeeperHitCount: gkChecks.filter(g => g.hit).length,
      gatekeeperCount: gkChecks.length,
      firstHitType: firstHit?.type ?? 'none',
      firstHitMinAfter: firstHit?.frame ?? null,
      closeClass,
    });
  }
}

function pct(num, den) {
  return den > 0 ? `${(num / den * 100).toFixed(1)}%` : '—';
}

function reportSummary(results) {
  console.log(`\nDays × tickers analyzed: ${results.length}`);

  // Per-ticker hit rates
  console.log('\n════════════ HIT RATE BY LEVEL TYPE ════════════');
  console.log(`  ${'ticker'.padEnd(6)} ${'days'.padStart(5)}  ${'floor hit'.padStart(11)}  ${'ceiling hit'.padStart(11)}  ${'king hit'.padStart(11)}  ${'≥1 gk hit'.padStart(11)}`);
  for (const ticker of TICKERS) {
    const arr = results.filter(r => r.ticker === ticker);
    const floorHits = arr.filter(r => r.floorHit).length;
    const floorAvail = arr.filter(r => r.floor != null).length;
    const ceilingHits = arr.filter(r => r.ceilingHit).length;
    const ceilingAvail = arr.filter(r => r.ceiling != null).length;
    const kingHits = arr.filter(r => r.kingHit).length;
    const kingAvail = arr.filter(r => r.king != null).length;
    const gkHits = arr.filter(r => r.gatekeeperHitCount > 0).length;
    const gkAvail = arr.filter(r => r.gatekeeperCount > 0).length;
    console.log(
      `  ${ticker.padEnd(6)} ${String(arr.length).padStart(5)}  ` +
      `${pct(floorHits, floorAvail).padStart(6)} (${floorHits}/${floorAvail})`.padStart(11) + '  ' +
      `${pct(ceilingHits, ceilingAvail).padStart(6)} (${ceilingHits}/${ceilingAvail})`.padStart(11) + '  ' +
      `${pct(kingHits, kingAvail).padStart(6)} (${kingHits}/${kingAvail})`.padStart(11) + '  ' +
      `${pct(gkHits, gkAvail).padStart(6)} (${gkHits}/${gkAvail})`.padStart(11)
    );
  }

  // ANY level hit per day (was at least one prediction "useful"?)
  console.log('\n════════════ AT LEAST ONE LEVEL HIT PER DAY ════════════');
  for (const ticker of TICKERS) {
    const arr = results.filter(r => r.ticker === ticker);
    const anyHit = arr.filter(r => r.floorHit || r.ceilingHit || r.kingHit || r.gatekeeperHitCount > 0).length;
    console.log(`  ${ticker.padEnd(6)}  ${pct(anyHit, arr.length)} (${anyHit}/${arr.length})`);
  }

  // Time-to-first-hit
  console.log('\n════════════ TIME-TO-FIRST-HIT (minutes after morning frame) ════════════');
  console.log(`  ${'ticker'.padEnd(6)} ${'first-hit type counts'.padEnd(50)}  ${'med min'.padStart(8)}  ${'max min'.padStart(8)}`);
  for (const ticker of TICKERS) {
    const arr = results.filter(r => r.ticker === ticker && r.firstHitType !== 'none');
    const types = arr.reduce((m, r) => ((m[r.firstHitType] = (m[r.firstHitType] || 0) + 1), m), {});
    const mins = arr.map(r => r.firstHitMinAfter).sort((a, b) => a - b);
    const med = mins.length ? mins[Math.floor(mins.length / 2)] : null;
    const max = mins.length ? mins[mins.length - 1] : null;
    console.log(`  ${ticker.padEnd(6)} ${JSON.stringify(types).padEnd(50)}  ${String(med ?? '—').padStart(8)}  ${String(max ?? '—').padStart(8)}`);
  }

  // Close classification
  console.log('\n════════════ EOD POSITION VS MORNING LEVELS ════════════');
  for (const ticker of TICKERS) {
    const arr = results.filter(r => r.ticker === ticker);
    const counts = arr.reduce((m, r) => ((m[r.closeClass] = (m[r.closeClass] || 0) + 1), m), {});
    console.log(`  ${ticker.padEnd(6)} ${JSON.stringify(counts)}`);
  }
}

function main() {
  const nDays = parseInt(process.argv[2] || '10', 10);
  mkdirSync(OUT_DIR, { recursive: true });
  const files = readdirSync(REPLAY_DIR)
    .filter(f => /^gex-replay-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  const recent = files.slice(-nDays).map(f => f.match(/(\d{4}-\d{2}-\d{2})/)[1]);

  console.log(`\n▶ Morning-Levels Prediction Backtest`);
  console.log(`  Predict at frame ${MORNING_FRAME_IDX} (≈9:35 ET) using 0DTE row of heatmap.`);
  console.log(`  Score: hits within ±${TOUCH_TOLERANCE.SPXW}/${TOUCH_TOLERANCE.SPY}/${TOUCH_TOLERANCE.QQQ} for SPX/SPY/QQQ.`);
  console.log(`  Days: ${recent[0]} → ${recent[recent.length - 1]} (${recent.length} files)\n`);

  const results = [];
  for (const date of recent) runDay(date, results);

  // Write CSV
  const csvPath = join(OUT_DIR, 'morning-levels.csv');
  const headers = Object.keys(results[0] || {});
  const lines = [headers.join(',')];
  for (const r of results) lines.push(headers.map(h => r[h] ?? '').join(','));
  writeFileSync(csvPath, lines.join('\n'));

  reportSummary(results);
  console.log(`\nPer-day-per-ticker CSV: ${csvPath}\n`);
}

main();
