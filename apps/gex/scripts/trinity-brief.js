#!/usr/bin/env node
/**
 * Trinity-confluence morning brief.
 *
 * Pulls live Skylit Trinity (SPY + QQQ + SPXW), computes the 0-100 bullishness
 * score per ticker, the combined Trinity score, and surfaces divergences
 * between tickers.
 *
 * Validated edge per sniper/validation/backtest_trinity_regime.py (64.1% win
 * rate across 39 setups over 71 days): trade ONLY the extremes (score <20 or
 * >80) and skip divergence >30.
 */

import 'dotenv/config';
import { initAuth } from '../src/heatseeker/auth.js';
import { fetchSnapshot } from '../src/heatseeker/client.js';
import { computeSurface } from '../src/domain/significance.js';
import { deriveStructure } from '../src/domain/structure.js';
import { postEmbed } from '../src/discord/webhook.js';

const args = {};
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) args[m[1]] = m[2] ?? true;
}
const POST_TO_FEED = !!args.discord || !!args.feed;  // mirror to gex_feed + Discord

const TICKERS = ['SPY', 'QQQ', 'SPXW'];

function deriveFull(snap) {
  const surface = computeSurface(snap.strikes, snap.spot);
  const structure = deriveStructure({ nodes: surface.nodes, spot: snap.spot });
  return {
    spot: snap.spot,
    king: structure.king?.strike ?? null,
    floor: structure.floor?.strike ?? null,
    ceiling: structure.ceiling?.strike ?? null,
    netVex: surface.nodes?.reduce((acc, n) => acc + (n.vanna || 0), 0) || 0,
  };
}

function bullishness(struct) {
  const { spot, king, floor, ceiling, netVex } = struct;
  // Handle missing structural elements with fallbacks
  let effectiveFloor = floor;
  let effectiveCeiling = ceiling;
  if (effectiveFloor == null && king != null) effectiveFloor = king * 0.97;
  if (effectiveCeiling == null && king != null) effectiveCeiling = king * 1.03;
  if (effectiveFloor == null || effectiveCeiling == null) return 50;
  let pos;
  if (spot <= effectiveFloor) pos = 0;
  else if (spot >= effectiveCeiling) pos = 100;
  else if (king == null || king === effectiveFloor || king === effectiveCeiling) {
    pos = 100 * (spot - effectiveFloor) / (effectiveCeiling - effectiveFloor);
  } else if (spot <= king) {
    const d = king - effectiveFloor;
    pos = d > 0 ? 50 * (spot - effectiveFloor) / d : 50;
  } else {
    const d = effectiveCeiling - king;
    pos = d > 0 ? 50 + 50 * (spot - king) / d : 50;
  }
  pos += netVex > 0 ? 5 : -5;
  return Math.max(0, Math.min(100, pos));
}

function regimeLabel(score) {
  if (score < 20) return 'MAX_BEARISH';
  if (score < 40) return 'BEARISH';
  if (score < 60) return 'BALANCED';
  if (score < 80) return 'BULLISH';
  return 'MAX_BULLISH';
}

function actionForScore(score, divergence, spyStruct) {
  if (divergence > 30) return { action: 'SKIP', reason: 'Trinity divergence > 30 (tickers disagree)' };
  const band = 0.5;
  if (score < 20) {
    if (spyStruct.floor != null && Math.abs(spyStruct.spot - spyStruct.floor) <= band) {
      return {
        action: 'CALLS at SPY floor',
        entry: `near ${spyStruct.floor.toFixed(2)}`,
        target: `+${(spyStruct.spot + 0.35).toFixed(2)} (+0.35)`,
        stop: `${(spyStruct.spot - 0.60).toFixed(2)} (-0.60)`,
        reason: 'V-bounce setup: trinity score < 20, SPY at floor',
      };
    }
    return { action: 'WAIT', reason: 'Score bearish but SPY not at floor yet' };
  }
  if (score > 80) {
    if (spyStruct.ceiling != null && Math.abs(spyStruct.spot - spyStruct.ceiling) <= band) {
      return {
        action: 'PUTS at SPY ceiling',
        entry: `near ${spyStruct.ceiling.toFixed(2)}`,
        target: `${(spyStruct.spot - 0.35).toFixed(2)} (-0.35)`,
        stop: `${(spyStruct.spot + 0.60).toFixed(2)} (+0.60)`,
        reason: 'Ceiling rejection: trinity score > 80, SPY at ceiling',
      };
    }
    return { action: 'WAIT', reason: 'Score bullish but SPY not at ceiling yet' };
  }
  return { action: 'NO TRADE', reason: `Score ${score.toFixed(0)} in middle range — skip per validated rules` };
}

function detectDivergences(subScores, structs) {
  const flags = [];
  const entries = Object.entries(subScores);
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const [a, sa] = entries[i];
      const [b, sb] = entries[j];
      const diff = Math.abs(sa - sb);
      if (diff > 30) {
        flags.push(`Score gap: ${a} ${sa.toFixed(0)} (${regimeLabel(sa)}) vs ${b} ${sb.toFixed(0)} (${regimeLabel(sb)}) — diff ${diff.toFixed(0)}`);
      }
    }
  }
  // STRUCTURAL divergence — King position. One ticker King-above + another King-below
  // is a meaningful disagreement even when scores look similar.
  const kingPositions = {};
  for (const [ticker, struct] of Object.entries(structs)) {
    const delta = (struct.spot - struct.king) / struct.king;
    if (delta < -0.001) kingPositions[ticker] = 'KING_ABOVE';
    else if (delta > 0.001) kingPositions[ticker] = 'KING_BELOW';
    else kingPositions[ticker] = 'AT_KING';
  }
  const above = Object.entries(kingPositions).filter(([_, p]) => p === 'KING_ABOVE').map(([t]) => t);
  const below = Object.entries(kingPositions).filter(([_, p]) => p === 'KING_BELOW').map(([t]) => t);
  if (above.length > 0 && below.length > 0) {
    flags.push(`STRUCTURAL: ${above.join('+')} has King above (bearish) BUT ${below.join('+')} has King below (bullish) — DIVERGENT regime`);
  }

  const notes = [];
  for (const [ticker, struct] of Object.entries(structs)) {
    const buffer = ticker === 'SPXW' ? 5 : (ticker === 'QQQ' ? 1.0 : 0.5);
    if (struct.spot < struct.king && struct.king - struct.spot > buffer) {
      const distPct = ((struct.king - struct.spot) / struct.spot * 100).toFixed(2);
      notes.push(`${ticker} has King above at ${struct.king} (spot ${struct.spot.toFixed(2)}, ${distPct}% below)`);
    } else if (struct.spot > struct.king && struct.spot - struct.king > buffer) {
      const distPct = ((struct.spot - struct.king) / struct.spot * 100).toFixed(2);
      notes.push(`${ticker} has King below at ${struct.king} (spot ${struct.spot.toFixed(2)}, ${distPct}% above)`);
    }
    if (struct.netVex < 0) notes.push(`${ticker} VEX net negative — vol-controlled regime, fade risk on breaks`);
  }
  return { flags, notes };
}

async function main() {
  await initAuth();
  const structs = {};
  const subScores = {};
  for (const ticker of TICKERS) {
    process.stderr.write(`Fetching ${ticker}... `);
    try {
      const snap = await fetchSnapshot(ticker);
      const s = deriveFull(snap);
      structs[ticker] = s;
      subScores[ticker] = bullishness(s);
      process.stderr.write(`ok (spot ${s.spot}, score ${subScores[ticker].toFixed(0)})\n`);
    } catch (e) {
      process.stderr.write(`ERR ${e.message}\n`);
    }
  }

  const validScores = Object.values(subScores).filter(s => s != null);
  if (validScores.length < 3) {
    process.stdout.write('# Trinity Brief — INCOMPLETE\n\nCould not fetch all three tickers.\n');
    process.exit(1);
  }
  const trinityScore = validScores.reduce((a, b) => a + b, 0) / validScores.length;
  const divergence = Math.max(...validScores) - Math.min(...validScores);
  const regime = regimeLabel(trinityScore);
  const action = actionForScore(trinityScore, divergence, structs.SPY);
  const div = detectDivergences(subScores, structs);

  const today = new Date().toISOString().slice(0, 10);
  let md = `# Trinity Brief — ${today}\n\n`;
  md += `*Live Skylit Trinity at ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })} ET*\n\n`;
  md += `## Trinity score: **${trinityScore.toFixed(0)} / 100** — ${regime}\n\n`;
  md += `*Divergence: ${divergence.toFixed(0)} ${divergence > 30 ? '⚠️ (skip — tickers disagree)' : '✓ (aligned)'}*\n\n`;
  md += `## Per-ticker structure\n\n`;
  md += `| Ticker | Spot | Floor | King | Ceiling | VEX | Score | Regime |\n`;
  md += `|---|---:|---:|---:|---:|---:|---:|---|\n`;
  for (const ticker of TICKERS) {
    const s = structs[ticker];
    if (!s) { md += `| ${ticker} | n/a | | | | | | |\n`; continue; }
    md += `| ${ticker} | ${s.spot?.toFixed(2)} | ${s.floor?.toFixed(2) ?? '—'} | ${s.king?.toFixed(2) ?? '—'} | ${s.ceiling?.toFixed(2) ?? '—'} | ${s.netVex > 0 ? '+' : ''}${(s.netVex / 1e6).toFixed(1)}M | **${subScores[ticker].toFixed(0)}** | ${regimeLabel(subScores[ticker])} |\n`;
  }
  md += `\n`;
  if (div.flags.length) {
    md += `## ⚠️ Cross-ticker divergences\n\n`;
    for (const f of div.flags) md += `- ${f}\n`;
    md += `\n`;
  }
  if (div.notes.length) {
    md += `## Structural notes\n\n`;
    for (const n of div.notes) md += `- ${n}\n`;
    md += `\n`;
  }
  md += `## Action: **${action.action}**\n\n`;
  if (action.entry) {
    md += `- Entry: ${action.entry}\n`;
    md += `- Target: ${action.target}\n`;
    md += `- Stop: ${action.stop}\n`;
  }
  md += `\n**Reason:** ${action.reason}\n\n`;
  md += `## Validation context\n\n`;
  md += `Per [backtest_trinity_regime.py](../sniper/validation/backtest_trinity_regime.py) across 71 days:\n`;
  md += `- **64.1% win rate** when score < 20 or > 80\n`;
  md += `- PUTS_REJECT (score > 80): **67.7% win, +4.1 pts total**\n`;
  md += `- CALLS_VBOUNCE (score < 20): 50% win, breakeven\n`;
  md += `- WHIPSAW days perform best (+2.5 pts), TREND_UP +0.7, TREND_DOWN breakeven\n\n`;

  process.stdout.write(md);

  if (POST_TO_FEED) {
    // Color: green for actionable bullish (PUTS_REJECT setup), red for bearish (V-bounce setup),
    // gray for skip/middle, amber for divergence
    let color;
    if (action.action === 'SKIP') color = 0xf59e0b;          // amber
    else if (action.action?.includes('CALLS')) color = 0x22c55e; // green
    else if (action.action?.includes('PUTS')) color = 0xef4444;  // red
    else color = 0x6b7280;  // gray

    const fields = [];
    for (const ticker of TICKERS) {
      const s = structs[ticker];
      if (!s) continue;
      fields.push({
        name: `${ticker} — score ${subScores[ticker].toFixed(0)} (${regimeLabel(subScores[ticker])})`,
        value: `spot ${s.spot?.toFixed(2)} | floor ${s.floor?.toFixed(2) ?? '—'} | King ${s.king?.toFixed(2) ?? '—'} | ceil ${s.ceiling?.toFixed(2) ?? '—'} | VEX ${s.netVex > 0 ? '+' : ''}${(s.netVex / 1e6).toFixed(1)}M`,
      });
    }
    if (div.flags.length) {
      fields.push({ name: '⚠️ Divergences', value: div.flags.slice(0, 3).join('\n').slice(0, 1024) });
    }
    if (div.notes.length) {
      fields.push({ name: 'Structural notes', value: div.notes.slice(0, 5).join('\n').slice(0, 1024) });
    }
    fields.push({ name: 'Action', value: `**${action.action}**\n${action.reason}${action.entry ? `\nEntry: ${action.entry}, Target: ${action.target}, Stop: ${action.stop}` : ''}`.slice(0, 1024) });

    try {
      await postEmbed({
        title: `Trinity Brief — ${trinityScore.toFixed(0)}/100 ${regime}${divergence > 30 ? ' ⚠ DIVERGENT' : ''}`,
        description: `SPY ${structs.SPY?.spot?.toFixed(2)} | QQQ ${structs.QQQ?.spot?.toFixed(2)} | SPXW ${structs.SPXW?.spot?.toFixed(2)}`,
        fields,
        color,
        footer: `Validated 64.1% win rate at score extremes (sniper/validation/REPORT_SKYLIT.md)`,
        source: 'brief',
      });
      process.stderr.write('Posted to gex_feed (and Discord if configured).\n');
    } catch (e) {
      process.stderr.write(`postEmbed failed: ${e.message}\n`);
    }
  }
  process.exit(0);
}

main().catch(e => { process.stderr.write(`fatal: ${e.message}\n`); process.exit(1); });
