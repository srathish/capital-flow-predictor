#!/usr/bin/env node
/**
 * Sniper morning brief generator.
 *
 * Pulls a live Skylit Trinity snapshot for SPY + QQQ + SPXW and outputs a
 * concrete trade brief in the format the operator asked for: explicit price
 * triggers with directional bias.
 *
 * Output respects the empirical findings in sniper/validation/REPORT_SKYLIT.md:
 *   - King = magnet, not divider. Mean reversion to King dominates.
 *   - True directional trades come from breaks through floor / ceiling into
 *     liquidity vacuums.
 *   - Lunch + afternoon (12:00 - 15:30 ET) are pin windows — sell premium,
 *     don't chase direction.
 *
 * Usage:   node apps/gex/scripts/sniper-brief.js
 * Output:  markdown to stdout (also writes scripts/out/brief-<date>.md)
 */

import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'fs';
import { initAuth } from '../src/heatseeker/auth.js';
import { fetchSnapshot } from '../src/heatseeker/client.js';
import { computeSurface } from '../src/domain/significance.js';
import { deriveStructure } from '../src/domain/structure.js';

const TICKERS = ['SPY', 'QQQ', 'SPX'];
const THRESHOLDS = { SPY: 0.5, QQQ: 1.0, SPX: 5.0 };

function relPos(spot, king, threshold) {
  if (Math.abs(spot - king) <= threshold) return 'AT';
  return spot > king ? 'ABOVE' : 'BELOW';
}

function fmt(n, p = 2) {
  return n == null ? 'n/a' : Number(n).toFixed(p);
}

function fmtMag(g) {
  if (g == null) return 'n/a';
  const abs = Math.abs(g);
  if (abs >= 1e9) return `${(g / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(g / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(g / 1e3).toFixed(1)}K`;
  return String(g);
}

function nearestVacuumAbove(spot, vacuums) {
  const above = vacuums.filter(v => v.low > spot).sort((a, b) => a.low - b.low);
  return above[0] || null;
}
function nearestVacuumBelow(spot, vacuums) {
  const below = vacuums.filter(v => v.high < spot).sort((a, b) => b.high - a.high);
  return below[0] || null;
}

function buildBrief(ticker, snap, surface, structure) {
  const spot = snap.spot;
  const king = structure.king || {};
  const floor = structure.floor || {};
  const ceiling = structure.ceiling || {};
  const gatekeepers = structure.gatekeepers || [];
  const vacuums = structure.liquidity_vacuums || [];

  const threshold = THRESHOLDS[ticker] || 0.5;
  const pos = relPos(spot, king.strike, threshold);
  const distKing = king.strike != null ? (spot - king.strike).toFixed(2) : 'n/a';

  // Empirical bias based on position vs King (per REPORT_SKYLIT.md):
  // BELOW King → mean revert UP to King (buy calls to King)
  // ABOVE King → mean revert DOWN to King (buy puts to King)
  // AT King   → pin, sell premium
  let primaryBias, primaryTarget, primaryAction;
  if (pos === 'BELOW') {
    primaryBias = 'BULLISH REVERSION';
    primaryTarget = king.strike;
    primaryAction = `CALLS toward ${fmt(king.strike)} (King magnet)`;
  } else if (pos === 'ABOVE') {
    primaryBias = 'BEARISH REVERSION';
    primaryTarget = king.strike;
    primaryAction = `PUTS toward ${fmt(king.strike)} (King magnet)`;
  } else {
    primaryBias = 'PIN';
    primaryTarget = king.strike;
    primaryAction = `Sell premium at ${fmt(king.strike)} (iron butterfly / credit spreads). 12:00-15:30 ET strongest window.`;
  }

  // Breakout cases — directional trades come from breaks through floor/ceiling into vacuums
  const upVacuum = nearestVacuumAbove(spot, vacuums);
  const downVacuum = nearestVacuumBelow(spot, vacuums);
  const breakAbove = ceiling.strike != null ? ceiling.strike + threshold : null;
  const breakBelow = floor.strike != null ? floor.strike - threshold : null;

  return {
    ticker,
    spot,
    king: king.strike,
    king_size: king.gamma,
    floor: floor.strike,
    ceiling: ceiling.strike,
    distance_to_king: distKing,
    position: pos,
    primary_bias: primaryBias,
    primary_target: primaryTarget,
    primary_action: primaryAction,
    breakout_above: breakAbove,
    breakout_above_target: upVacuum ? upVacuum.high : null,
    breakout_below: breakBelow,
    breakout_below_target: downVacuum ? downVacuum.low : null,
    gatekeepers: gatekeepers.map(g => g.strike),
    expiration: snap.expiration,
  };
}

function renderMarkdown(briefs) {
  const today = new Date().toISOString().slice(0, 10);
  let md = `# Sniper Brief — ${today}\n\n`;
  md += `*Generated from live Skylit Trinity at ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })} ET.*\n\n`;
  md += `*Empirical rules per [validation/REPORT_SKYLIT.md](../sniper/validation/REPORT_SKYLIT.md): King is magnet (not divider). Mean reversion dominates near King; directional trades come from vacuum breaks.*\n\n`;
  md += `---\n\n`;
  for (const b of briefs) {
    md += `## ${b.ticker}\n\n`;
    md += `**Spot:** $${fmt(b.spot)} · **King:** $${fmt(b.king)} (${fmtMag(b.king_size)}) · **Position:** ${b.position} (${b.distance_to_king} from King)\n\n`;
    md += `**Floor:** $${fmt(b.floor)} · **Ceiling:** $${fmt(b.ceiling)}\n\n`;
    md += `### Primary play (mean reversion to King)\n\n`;
    md += `**Bias:** ${b.primary_bias}\n\n`;
    md += `**Action:** ${b.primary_action}\n\n`;
    md += `### Directional breakout (only if structure breaks)\n\n`;
    md += `- **Above $${fmt(b.breakout_above)}** (ceiling + buffer) with body close + retest hold → vacuum target **$${fmt(b.breakout_above_target)}**. Buy CALLS.\n`;
    md += `- **Below $${fmt(b.breakout_below)}** (floor − buffer) with body close + retest hold → vacuum target **$${fmt(b.breakout_below_target)}**. Buy PUTS.\n\n`;
    md += `### Time-of-day modulation\n\n`;
    md += `- **09:35 – 10:30 ET**: directional zone — pin weak; trade breakouts.\n`;
    md += `- **10:30 – 12:00 ET**: chop zone — wait or take only A+ confluence.\n`;
    md += `- **12:00 – 15:30 ET**: pin zone — sell premium at King (54% SPY / 66% QQQ pin rate empirically).\n\n`;
    md += `*Expiration: ${b.expiration}*\n\n`;
    md += `---\n\n`;
  }
  return md;
}

async function main() {
  await initAuth();
  const briefs = [];
  for (const ticker of TICKERS) {
    process.stderr.write(`Fetching ${ticker}... `);
    try {
      const snap = await fetchSnapshot(ticker);
      const surface = computeSurface(snap.strikes, snap.spot);
      const structure = deriveStructure({ nodes: surface.nodes, spot: snap.spot });
      const flat = {
        king: structure.king,
        floor: structure.floor,
        ceiling: structure.ceiling,
        gatekeepers: structure.gatekeepers || [],
        liquidity_vacuums: structure.liquidityVacuums || structure.liquidity_vacuums || [],
      };
      briefs.push(buildBrief(ticker, snap, surface, flat));
      process.stderr.write(`ok (spot ${snap.spot}, king ${flat.king?.strike})\n`);
    } catch (e) {
      process.stderr.write(`ERR ${e.message}\n`);
    }
  }
  const md = renderMarkdown(briefs);
  process.stdout.write(md);
  // Also persist to disk
  mkdirSync('scripts/out', { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const out = `scripts/out/brief-${today}.md`;
  writeFileSync(out, md);
  process.stderr.write(`\nWrote ${out}\n`);
  process.exit(0);
}

main().catch(e => { process.stderr.write(`fatal: ${e.message}\n`); process.exit(1); });
