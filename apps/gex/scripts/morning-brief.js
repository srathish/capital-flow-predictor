#!/usr/bin/env node
/**
 * Morning brief — operator-facing analysis of the trinity at a chosen point in time.
 *
 * Produces a Stewie-style writeup with:
 *   - Trinity verdict (alignment + size guidance)
 *   - Per-ticker section: regime, 0DTE concentration, king node, key floors/ceilings,
 *     active patterns, notable structural observations
 *   - Critical developments (regime flips, rainbow road, structural divergence)
 *
 * Modes:
 *   --date=YYYY-MM-DD               brief at end of that trading day (last snapshot)
 *   --date=YYYY-MM-DD --at-open     brief at first snapshot of the day (~9:30 ET)
 *
 * Usage:
 *   npm run brief -- --date=2026-03-31
 *   npm run brief -- --date=2026-03-31 --at-open
 */

import Database from 'better-sqlite3';
import { join } from 'path';
import { config } from '../src/utils/config.js';
import { postEmbed, COLORS } from '../src/discord/webhook.js';

const args = {};
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) args[m[1]] = m[2] ?? true;
}
if (!args.date) {
  console.error('Usage: --date=YYYY-MM-DD [--at-open]');
  process.exit(1);
}

const db = new Database(join(config.dataDir, 'gexester.db'), { readonly: true });

const TICKERS = ['SPXW', 'SPY', 'QQQ'];
const ZONE = { SPXW: 5, SPY: 0.5, QQQ: 0.5 };

// Pick the snapshot per ticker.
// at-open mode: pick the first snapshot AT OR AFTER 9:31 ET on the trading day.
//   Heatseeker's 9:30 frame is consistently stale (yesterday's value or pre-market quote);
//   validated on Feb 5 (SPXW 9:30 = 6882 stale, 9:31 = 6817 correct).
//   In LIVE mode, ingestion writes pre-market frames since whenever it booted, so we can't
//   just use OFFSET 1 — that would pick a pre-market snapshot. Instead, use wall-clock
//   9:31 ET as the floor. EDT = UTC-4, so 9:31 ET = 13:31 UTC during DST.
function pickSnapshot(ticker) {
  if (args['at-open']) {
    const open931Ms = new Date(`${args.date}T09:31:00-04:00`).getTime();
    return db.prepare(`
      SELECT * FROM snapshots
      WHERE ticker = ? AND trading_day = ? AND ts_ms >= ?
      ORDER BY ts_ms ASC LIMIT 1
    `).get(ticker, args.date, open931Ms);
  }
  return db.prepare(`
    SELECT * FROM snapshots
    WHERE ticker = ? AND trading_day = ?
    ORDER BY ts_ms DESC LIMIT 1
  `).get(ticker, args.date);
}

// Overnight-gap detection: compare yesterday's last spot to today's 9:31 spot.
// If gap > 1× deflection zone, flag explicitly so the operator knows the move
// was already committed by open and key levels may have been breached.
function detectGap(ticker, todayOpenSpot) {
  const priorClose = db.prepare(`
    SELECT spot FROM snapshots
    WHERE ticker = ? AND trading_day < ?
    ORDER BY ts_ms DESC LIMIT 1
  `).get(ticker, args.date);
  if (!priorClose) return null;
  const gap = todayOpenSpot - priorClose.spot;
  const gapBps = (gap / priorClose.spot) * 10000;
  return { priorClose: priorClose.spot, gap, gapBps };
}

function nodesAtSnapshot(snapshotId) {
  return db.prepare(`
    SELECT * FROM node_snapshots WHERE snapshot_id = ?
    ORDER BY ABS(gamma) DESC
  `).all(snapshotId);
}

function regimeLabel(score) {
  if (score == null) return 'unknown';
  if (score > 0.30) return 'POSITIVE';
  if (score < -0.30) return 'NEGATIVE';
  if (Math.abs(score) > 0.10) return score > 0 ? 'mildly positive' : 'mildly negative';
  return 'mixed/neutral';
}

function dollarsAt(price) {
  // For SPXW: $ per point on the index. For SPY/QQQ: just the spot price interpreted.
  return price.toFixed(2);
}

function ptsFromSpot(strike, spot) {
  const d = strike - spot;
  return `${d >= 0 ? '+' : ''}${d.toFixed(1)} pts`;
}

function fmtMillions(g) {
  const sign = g >= 0 ? '+' : '-';
  return `${sign}$${(Math.abs(g) / 1e6).toFixed(1)}M`;
}

// Per-ticker character — DESCRIPTIVE (where the king is + structural role).
// NOT a directional prediction. Just labels structure for the operator.
function classifyTickerCharacter(b) {
  const ZONE_PCT = 0.005;
  if (!b.king) return { type: 'NO_STRUCTURE', label: 'no king node' };
  if (b.patterns.includes('rainbow_road')) return { type: 'RAINBOW', label: 'rainbow road — no clean structure' };

  const kingDistPct = (b.king.strike - b.spot) / b.spot;
  const kingDistBps = Math.abs(kingDistPct) * 10000;
  const isPika = b.king.gamma > 0;

  if (Math.abs(kingDistPct) < ZONE_PCT) {
    return { type: 'PIN_ZONE', label: `${isPika ? 'pika' : 'barney'} king at ${b.king.strike} sits within ${kingDistBps.toFixed(0)} bps of spot` };
  }
  if (kingDistPct > ZONE_PCT && isPika) {
    return { type: 'PIKA_ABOVE', label: `pika king at ${b.king.strike} (${kingDistBps.toFixed(0)} bps above) — possible upside target IF price drives` };
  }
  if (kingDistPct < -ZONE_PCT && isPika) {
    return { type: 'PIKA_BELOW', label: `pika king at ${b.king.strike} (${kingDistBps.toFixed(0)} bps below) — support IF price tests; broken support IF it breaks` };
  }
  if (kingDistPct < 0) {
    return { type: 'BARNEY_BELOW', label: `barney king at ${b.king.strike} (${kingDistBps.toFixed(0)} bps below) — trapdoor IF regime breaks; magnet IF spot drifts down` };
  }
  return { type: 'BARNEY_ABOVE', label: `barney king at ${b.king.strike} (${kingDistBps.toFixed(0)} bps above) — resistance IF price reaches; spike-fade target IF broken` };
}

// Verdict — describes the ENVIRONMENT, not direction. Operator interprets the trade triggers.
function classifyVerdict(briefs) {
  const tickers = Object.values(briefs);
  if (tickers.length < 3) return { label: 'INSUFFICIENT DATA', detail: 'Need all 3 tickers', perTicker: {} };

  const perTicker = {};
  for (const b of tickers) perTicker[b.ticker] = classifyTickerCharacter(b);

  const regimes = tickers.map(b => b.regimeScore);
  const allPositive = regimes.every(r => r > 0.30);
  const allNegative = regimes.every(r => r < -0.30);
  const mostlyPositive = regimes.filter(r => r > 0.30).length >= 2;
  const mostlyNegative = regimes.filter(r => r < -0.30).length >= 2;
  const mostlyMixed = regimes.filter(r => Math.abs(r) <= 0.30).length >= 2;

  const sitoutTickers = Object.entries(perTicker).filter(([, c]) => c.type === 'RAINBOW' || c.type === 'NO_STRUCTURE').map(([t]) => t);
  if (sitoutTickers.length > 0) {
    return { label: `RAINBOW ROAD on ${sitoutTickers.join(', ')} — limited tradeable structure`, detail: 'At least one ticker has no clean read; size accordingly.', perTicker };
  }

  if (allPositive) return {
    label: 'TRINITY POSITIVE REGIME — pinning environment',
    detail: 'All 3 in positive gamma. Expect chop/range. Fade extremes; do NOT chase breakouts; wider targets unlikely to reach.',
    perTicker,
  };
  if (allNegative) return {
    label: 'TRINITY NEGATIVE REGIME — trapdoor environment',
    detail: 'All 3 in negative gamma. Expect overshoots and air pockets. Trade with structural pressure; assume any test of a level is a break.',
    perTicker,
  };
  if (mostlyPositive) return {
    label: '2/3 POSITIVE — partial pinning',
    detail: 'Two tickers pinning, one diverging. Pinning behavior less reliable; outlier ticker is the risk factor.',
    perTicker,
  };
  if (mostlyNegative) return {
    label: '2/3 NEGATIVE — partial trapdoor',
    detail: 'Two tickers in negative gamma. Watch for confirmed breakdowns (close + 60s hold) before entering shorts.',
    perTicker,
  };
  if (mostlyMixed) return {
    label: 'MIXED REGIME — no clean environment',
    detail: 'No regime conviction. Conditional plans only — wait for triggers to fire intraday.',
    perTicker,
  };
  return {
    label: 'DIVERGENT REGIMES — split trinity',
    detail: 'Tickers in opposing regimes. Informational only — no auto-trade.',
    perTicker,
  };
}

const briefs = {};
for (const ticker of TICKERS) {
  const snap = pickSnapshot(ticker);
  if (!snap) continue;
  const nodes = nodesAtSnapshot(snap.snapshot_id);

  // 0DTE concentration breakdown
  const totalAbs = nodes.reduce((s, n) => s + Math.abs(n.gamma), 0);
  const pikaTotal = nodes.filter(n => n.gamma > 0).reduce((s, n) => s + n.gamma, 0);
  const barneyTotal = nodes.filter(n => n.gamma < 0).reduce((s, n) => s + Math.abs(n.gamma), 0);
  const pikaPct = totalAbs ? pikaTotal / totalAbs * 100 : 0;
  const barneyPct = totalAbs ? barneyTotal / totalAbs * 100 : 0;

  // Top king node (already flagged in node_snapshots)
  const king = nodes.find(n => n.is_king === 1) || nodes[0];

  // Largest pika above + largest pika below + largest barney near spot
  const pikaCeiling = nodes
    .filter(n => n.sign === 'pika' && n.strike > snap.spot)
    .sort((a, b) => b.relative_significance - a.relative_significance)[0];
  const pikaFloor = nodes
    .filter(n => n.sign === 'pika' && n.strike < snap.spot)
    .sort((a, b) => b.relative_significance - a.relative_significance)[0];
  const barneyAbove = nodes
    .filter(n => n.sign === 'barney' && n.strike > snap.spot)
    .sort((a, b) => Math.abs(b.gamma) - Math.abs(a.gamma))[0];
  const barneyBelow = nodes
    .filter(n => n.sign === 'barney' && n.strike < snap.spot)
    .sort((a, b) => Math.abs(b.gamma) - Math.abs(a.gamma))[0];

  // Mega-target: any node with rel_sig > 30%
  const megaTargets = nodes.filter(n => n.relative_significance > 0.30 && n.gamma > 0);

  // Patterns active at this timestamp
  const patterns = db.prepare(`
    SELECT pattern, detected, confidence FROM pattern_detections
    WHERE snapshot_id = ? AND detected = 1
    ORDER BY confidence DESC
  `).all(snap.snapshot_id);

  // Bias score
  const bias = db.prepare(`
    SELECT bias_score, flags, supporting_state FROM bias_scores
    WHERE snapshot_id = ?
  `).get(snap.snapshot_id);

  briefs[ticker] = {
    ticker,
    spot: snap.spot,
    regimeScore: snap.regime_score,
    regimeLabel: regimeLabel(snap.regime_score),
    pikaPct, barneyPct,
    king,
    pikaCeiling, pikaFloor, barneyAbove, barneyBelow,
    megaTargets,
    patterns: patterns.map(p => p.pattern),
    biasScore: bias?.bias_score,
    snapshotId: snap.snapshot_id,
    timestamp: new Date(snap.ts_ms).toISOString(),
    allNodes: nodes, // full chain for trigger target lookups
  };
}

// ─── Render brief ────────────────────────────────────────────────────────────
const phase = args['at-open'] ? 'PRE-MARKET / OPEN' : 'EOD ANALYSIS';
console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`  ${phase} BRIEF — ${args.date}`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

// Verdict
const align = classifyVerdict(briefs);
console.log(`\n• Environment: ${align.label}`);
console.log(`  ${align.detail}`);

// Overnight gap report — flag if any ticker gapped through key levels overnight
if (args['at-open']) {
  const gaps = {};
  let anyGap = false;
  for (const ticker of TICKERS) {
    const b = briefs[ticker];
    if (!b) continue;
    const g = detectGap(ticker, b.spot);
    if (!g) continue;
    gaps[ticker] = g;
    const zone = ZONE[ticker];
    if (Math.abs(g.gap) > zone) anyGap = true;
  }
  if (anyGap) {
    console.log(`\n  ⚠ OVERNIGHT GAPS DETECTED (key levels may have been breached premarket):`);
    for (const [t, g] of Object.entries(gaps)) {
      const dir = g.gap > 0 ? 'UP' : 'DOWN';
      const sig = Math.abs(g.gap) > ZONE[t] ? ' ← significant' : '';
      console.log(`    ${t}: ${g.priorClose.toFixed(2)} → ${(g.priorClose + g.gap).toFixed(2)}  GAP ${dir} ${Math.abs(g.gap).toFixed(2)} pts (${g.gapBps >= 0 ? '+' : ''}${g.gapBps.toFixed(0)} bps)${sig}`);
    }
  }
}

// Per-ticker character — describes WHERE the structure is, not where price will go
console.log(`\n  Ticker structure:`);
for (const [t, c] of Object.entries(align.perTicker)) {
  console.log(`    ${t.padEnd(5)} → ${c.type.padEnd(13)} | ${c.label}`);
}

console.log(`\n\nCritical Overnight Developments:`);

// Compare to yesterday's regime if possible (regime flip detection)
function priorRegime(ticker) {
  const prior = db.prepare(`
    SELECT s.regime_score
    FROM snapshots s
    WHERE s.ticker = ? AND s.trading_day < ?
    ORDER BY s.ts_ms DESC LIMIT 1
  `).get(ticker, args.date);
  return prior?.regime_score;
}

let sectionNum = 1;
for (const ticker of TICKERS) {
  const b = briefs[ticker];
  if (!b) continue;
  const prior = priorRegime(ticker);

  let title = '';
  let bullets = [];

  // Regime change detection
  if (prior != null && (prior > 0.30) !== (b.regimeScore > 0.30) && b.regimeScore < 0.30) {
    title = `${ticker} Regime Destruction:`;
    bullets.push(`Positive → ${b.regimeLabel.toUpperCase()} gamma flip`);
  } else if (b.patterns.includes('rainbow_road')) {
    title = `${ticker} Regime Breakdown:`;
    bullets.push(`Rainbow road topology with competing nodes`);
    bullets.push(`No clear directional bias — sit out`);
  } else if (b.regimeScore > 0.30) {
    title = `${ticker} Institutional Conviction:`;
    bullets.push(`POSITIVE regime — pinning conditions favored`);
  } else if (b.regimeScore < -0.30) {
    title = `${ticker} Negative Gamma:`;
    bullets.push(`NEGATIVE regime — trapdoor / overshoot risk`);
  } else {
    title = `${ticker} Mixed Regime:`;
    bullets.push(`Mixed gamma (regime score ${b.regimeScore.toFixed(2)}) — wait for resolution`);
  }

  // Concentration breakdown
  if (b.barneyPct > 70) {
    bullets.push(`${b.barneyPct.toFixed(0)}% 0DTE concentration in negative regime = EXTREME acceleration risk`);
  } else if (b.pikaPct > 70) {
    bullets.push(`${b.pikaPct.toFixed(0)}% 0DTE concentration in positive regime = strong pinning`);
  } else {
    bullets.push(`Mix: ${b.pikaPct.toFixed(0)}% pika / ${b.barneyPct.toFixed(0)}% barney`);
  }

  // King node
  if (b.king) {
    const sign = b.king.gamma > 0 ? 'Pika' : 'Barney';
    bullets.push(`${b.king.strike} ${sign} King (${fmtMillions(b.king.gamma)} at ${ptsFromSpot(b.king.strike, b.spot)}) — ${b.king.gamma > 0 ? 'pin target' : 'gravitational target'}`);
  }

  // Mega-target if any
  for (const m of b.megaTargets) {
    bullets.push(`${m.strike} mega-target (${fmtMillions(m.gamma)} at ${ptsFromSpot(m.strike, b.spot)}) = institutional conviction`);
  }

  // Active patterns
  if (b.patterns.length > 0 && !b.patterns.includes('rainbow_road')) {
    bullets.push(`Active patterns: ${b.patterns.join(', ')}`);
  }

  console.log(`\n#### ${sectionNum}. ${title}`);
  for (const bul of bullets) console.log(`  • ${bul}`);
  sectionNum++;
}

// ─── TRADE TRIGGERS — actionable IF/THEN plans per ticker ───────────────────
//
// Trigger set per ticker (max 4 triggers + skip):
//   1. LONG bounce  — spot tests pika floor and holds → calls toward ceiling
//   2. SHORT reject — spot tests pika ceiling and rejects → puts toward floor
//   3. LONG break   — spot breaks barney resistance with velocity → calls toward upside target
//   4. SHORT break  — spot breaks pika floor with conviction → puts toward downside target
//   5. SKIP zone    — chop in midpoint without velocity = no trade
//
// PRIMARY designation combines two signals:
//   - Character (BULL_TARGET, GRAV_DOWN, etc.) → directional bias
//   - Spot position in floor↔ceiling range:
//       <30% (near floor)  → bounce-style triggers most likely to fire
//       >70% (near ceiling)→ reject-style triggers most likely to fire
//       30–70% (mid-range) → break-style triggers most likely to fire
// The trigger with the highest combined relevance score = PRIMARY.
//
// Targets for each trigger are validated to be on the CORRECT side of the trigger level
// (e.g. breakdown target must be BELOW the floor that broke, not between floor and spot).
// Trigger likelihood — POSITION-ONLY. Tells the operator which trigger conditions are
// structurally most likely to fire given where spot sits in the floor↔ceiling range.
// We do NOT predict which DIRECTION the day will go — the operator uses these as a
// watch-list and acts on whichever trigger actually fires.
function triggerLikelihood(trigger, positionPct) {
  if (trigger.side === 'SKIP') return 'INFO';
  const isBounce = trigger.side === 'LONG' && trigger.condition.includes('tests');
  const isReject = trigger.side === 'SHORT' && trigger.condition.includes('tests');
  const isBreakUp = trigger.side === 'LONG' && trigger.condition.includes('breaks');
  const isBreakDn = trigger.side === 'SHORT' && trigger.condition.includes('breaks');

  if (positionPct < 0.30) {
    // Near floor: bounce or breakdown most likely (both directions live)
    if (isBounce || isBreakDn) return 'LIKELY';
    return 'WATCH'; // breakup / reject possible but distant
  }
  if (positionPct > 0.70) {
    // Near ceiling: reject or breakup most likely
    if (isReject || isBreakUp) return 'LIKELY';
    return 'WATCH';
  }
  // Mid-range: break triggers most likely (price has room to develop momentum)
  if (isBreakUp || isBreakDn) return 'LIKELY';
  return 'WATCH';
}
function buildTradeTriggers(b, character, allNodes) {
  const triggers = [];
  const zone = ZONE[b.ticker];

  // Helper: find largest node beyond a given strike in the trade direction
  function targetAbove(fromStrike, minSig = 0.03, sign = null) {
    return allNodes
      .filter(n => n.strike > fromStrike && n.relative_significance >= minSig && (!sign || n.sign === sign))
      .sort((a, b) => Math.abs(b.gamma) - Math.abs(a.gamma))[0];
  }
  function targetBelow(fromStrike, minSig = 0.03, sign = null) {
    return allNodes
      .filter(n => n.strike < fromStrike && n.relative_significance >= minSig && (!sign || n.sign === sign))
      .sort((a, b) => Math.abs(b.gamma) - Math.abs(a.gamma))[0];
  }

  // 1. LONG bounce — pika floor deflection toward pika ceiling
  if (b.pikaFloor && b.pikaFloor.strike < b.spot && b.pikaCeiling) {
    const tgt = b.pikaCeiling.strike;
    const stopAt = b.pikaFloor.strike - 2 * zone;
    const reward = tgt - b.pikaFloor.strike;
    const risk = b.pikaFloor.strike - stopAt;
    if (reward > 0 && risk > 0) {
      triggers.push({
        side: 'LONG', icon: '🟢',
        condition: `spot tests ${b.pikaFloor.strike} and holds (1st deflection)`,
        action: `BUY CALLS at ${b.pikaFloor.strike}`,
        target: `${tgt}`, stop: stopAt.toFixed(2),
        rr: (reward / risk).toFixed(1),
      });
    }
  }

  // 2. SHORT reject — pika ceiling rejection toward pika floor
  if (b.pikaCeiling && b.pikaCeiling.strike > b.spot && b.pikaFloor) {
    const tgt = b.pikaFloor.strike;
    const stopAt = b.pikaCeiling.strike + 2 * zone;
    const reward = b.pikaCeiling.strike - tgt;
    const risk = stopAt - b.pikaCeiling.strike;
    if (reward > 0 && risk > 0) {
      triggers.push({
        side: 'SHORT', icon: '🔴',
        condition: `spot tests ${b.pikaCeiling.strike} and rejects (1st deflection)`,
        action: `BUY PUTS at ${b.pikaCeiling.strike}`,
        target: `${tgt}`, stop: stopAt.toFixed(2),
        rr: (reward / risk).toFixed(1),
      });
    }
  }

  // 3. LONG break — break of barney/ceiling with velocity toward upside target ABOVE
  if (b.barneyAbove && b.barneyAbove.strike > b.spot) {
    const tgt = targetAbove(b.barneyAbove.strike, 0.05);
    if (tgt) {
      const reward = tgt.strike - b.barneyAbove.strike;
      const risk = 2 * zone;
      if (reward > 0) {
        triggers.push({
          side: 'LONG', icon: '🟢',
          condition: `spot breaks ${b.barneyAbove.strike} with velocity (5m+15m growing)`,
          action: 'BUY CALLS on the break',
          target: `${tgt.strike}`, stop: b.barneyAbove.strike.toFixed(2),
          rr: (reward / risk).toFixed(1),
        });
      }
    }
  }

  // 4. SHORT break — breakdown through pika floor toward downside target BELOW the floor
  if (b.pikaFloor && b.pikaFloor.strike < b.spot) {
    const tgt = targetBelow(b.pikaFloor.strike, 0.03);
    if (tgt) {
      const reward = b.pikaFloor.strike - tgt.strike;
      const risk = 2 * zone;
      if (reward > 0) {
        triggers.push({
          side: 'SHORT', icon: '🔴',
          condition: `spot breaks ${b.pikaFloor.strike} with conviction (close beyond + 60s hold)`,
          action: 'BUY PUTS on the break',
          target: `${tgt.strike}`, stop: b.pikaFloor.strike.toFixed(2),
          rr: (reward / risk).toFixed(1),
        });
      }
    }
  }

  // 5. SKIP zone
  if (b.pikaFloor && b.pikaCeiling) {
    triggers.push({
      side: 'SKIP', icon: '🚫',
      condition: `spot drifts ${b.pikaFloor.strike}–${b.pikaCeiling.strike} without velocity`,
      action: 'NO TRADE — wait for a tap',
    });
  }

  // Compute spot position in the floor↔ceiling range (0 = at floor, 1 = at ceiling)
  let positionPct = 0.5;
  if (b.pikaFloor && b.pikaCeiling && b.pikaCeiling.strike > b.pikaFloor.strike) {
    positionPct = (b.spot - b.pikaFloor.strike) / (b.pikaCeiling.strike - b.pikaFloor.strike);
    positionPct = Math.max(0, Math.min(1, positionPct));
  }

  // Tag each trigger with likelihood (LIKELY / WATCH / INFO) based on spot position only
  for (const t of triggers) {
    t.likelihood = triggerLikelihood(t, positionPct);
    t._positionPct = positionPct;
  }

  // Sort: LIKELY first, then WATCH, then INFO/SKIP last
  const order = { LIKELY: 0, WATCH: 1, INFO: 2 };
  triggers.sort((a, b) => (order[a.likelihood] ?? 9) - (order[b.likelihood] ?? 9));
  return triggers;
}

// ─── BREAK LEVELS HEADLINE — the simplest possible operator playbook ────────
// "If price breaks above X, buy calls. If price breaks below Y, buy puts." That's it.
// The bounce/reject triggers in the detailed section are bonus reads — these 6 break
// levels (2 per ticker) are the cleanest react-to-what-actually-happens plan.
console.log(`\n\n━━━ BREAK LEVELS — watch these 6, react to whichever fires first ━━━`);
for (const ticker of TICKERS) {
  const b = briefs[ticker];
  if (!b) continue;
  const character = align.perTicker[ticker];
  const triggers = buildTradeTriggers(b, character, b.allNodes);
  const upBreak = triggers.find(t => t.side === 'LONG' && t.condition.includes('breaks'));
  const downBreak = triggers.find(t => t.side === 'SHORT' && t.condition.includes('breaks'));
  console.log(`\n  ${ticker}  spot=${b.spot.toFixed(2)}`);
  if (upBreak) {
    const lvl = upBreak.condition.match(/breaks (\d+\.?\d*)/)?.[1];
    console.log(`    ⬆  ABOVE ${lvl}  → BUY CALLS  (target ${upBreak.target}, stop ${upBreak.stop}, R:R ${upBreak.rr})`);
  } else {
    console.log(`    ⬆  no clean upside break level (no major target above)`);
  }
  if (downBreak) {
    const lvl = downBreak.condition.match(/breaks (\d+\.?\d*)/)?.[1];
    console.log(`    ⬇  BELOW ${lvl}  → BUY PUTS   (target ${downBreak.target}, stop ${downBreak.stop}, R:R ${downBreak.rr})`);
  } else {
    console.log(`    ⬇  no clean downside break level (no major target below)`);
  }
}

console.log(`\n\n━━━ FULL TRIGGER SET — bounce/reject + break detail ━━━`);
for (const ticker of TICKERS) {
  const b = briefs[ticker];
  if (!b) continue;
  const character = align.perTicker[ticker];
  const triggers = buildTradeTriggers(b, character, b.allNodes);

  const positionPct = triggers[0]?._positionPct ?? null;
  const positionLabel = positionPct == null ? '—' :
    positionPct < 0.30 ? `near floor (${(positionPct*100).toFixed(0)}%)` :
    positionPct > 0.70 ? `near ceiling (${(positionPct*100).toFixed(0)}%)` :
    `mid-range (${(positionPct*100).toFixed(0)}%)`;
  console.log(`\n${ticker}  spot=${b.spot.toFixed(2)}  character=${character.type}  position=${positionLabel}  bias=${b.biasScore?.toFixed(0) ?? '—'}`);

  for (const t of triggers) {
    const rr = t.rr ? ` [R:R ${t.rr}]` : '';
    const lhBadge =
      t.likelihood === 'LIKELY' ? ' [LIKELY given spot position]' :
      t.likelihood === 'WATCH' ? ' [WATCH]' : '';
    console.log(`  ${t.icon} ${t.side}${lhBadge}`);
    console.log(`     IF:  ${t.condition}`);
    console.log(`     DO:  ${t.action}`);
    if (t.target) console.log(`     -->  target ${t.target}, stop ${t.stop}${rr}`);
  }
}

// Trade plan / structure summary
console.log(`\n\n━━━ STRUCTURE MAP ━━━`);
for (const ticker of TICKERS) {
  const b = briefs[ticker];
  if (!b) continue;
  console.log(`\n${ticker}  spot=${dollarsAt(b.spot)}  regime=${b.regimeLabel}  bias=${b.biasScore?.toFixed(0) ?? '—'}`);
  if (b.pikaCeiling) console.log(`  ceiling   : ${b.pikaCeiling.strike}  ${fmtMillions(b.pikaCeiling.gamma)}  ${(b.pikaCeiling.relative_significance*100).toFixed(1)}%   ${ptsFromSpot(b.pikaCeiling.strike, b.spot)}`);
  if (b.pikaFloor)   console.log(`  floor     : ${b.pikaFloor.strike}  ${fmtMillions(b.pikaFloor.gamma)}  ${(b.pikaFloor.relative_significance*100).toFixed(1)}%   ${ptsFromSpot(b.pikaFloor.strike, b.spot)}`);
  if (b.barneyAbove) console.log(`  barney↑   : ${b.barneyAbove.strike}  ${fmtMillions(b.barneyAbove.gamma)}  ${(b.barneyAbove.relative_significance*100).toFixed(1)}%   ${ptsFromSpot(b.barneyAbove.strike, b.spot)}`);
  if (b.barneyBelow) console.log(`  barney↓   : ${b.barneyBelow.strike}  ${fmtMillions(b.barneyBelow.gamma)}  ${(b.barneyBelow.relative_significance*100).toFixed(1)}%   ${ptsFromSpot(b.barneyBelow.strike, b.spot)}`);
}

// ─── VERIFICATION — trigger-level (operational) check ────────────────────────
//
// Honest test: for each trigger surfaced in the brief, did its CONDITIONS fire intraday,
// and IF they fired, did the trade direction work over the next 30 minutes?
// We don't test "did the brief predict direction" anymore — we test "when our
// conditional plans fired, did the operator have a profitable read."
if (args.verify) {
  console.log(`\n━━━ TRIGGER-LEVEL VERIFICATION: did each trigger fire? did it work? ━━━`);

  const sessionStream = db.prepare(`
    SELECT ts_ms, spot FROM snapshots WHERE ticker = ? AND trading_day = ?
    ORDER BY ts_ms ASC
  `);

  let firedTotal = 0, workedTotal = 0;

  for (const ticker of TICKERS) {
    const b = briefs[ticker];
    if (!b) continue;
    const stream = sessionStream.all(ticker, args.date);
    if (stream.length < 6) continue;
    const open = stream[0].spot;
    const close = stream[stream.length - 1].spot;
    const ocBps = (close - open) / open * 10000;
    const high = Math.max(...stream.map(s => s.spot));
    const low = Math.min(...stream.map(s => s.spot));

    console.log(`\n${ticker}: open=${dollarsAt(open)} → close=${dollarsAt(close)}  (${ocBps >= 0 ? '+' : ''}${ocBps.toFixed(0)} bps), range ${dollarsAt(low)}–${dollarsAt(high)}`);

    const triggers = buildTradeTriggers(b, align.perTicker[ticker], b.allNodes);
    const tradable = triggers.filter(t => t.side !== 'SKIP');
    const zone = ZONE[ticker];

    for (const t of tradable) {
      // Parse the trigger to find the level
      let level = null, type = null;
      const testM = t.condition.match(/tests (\d+\.?\d*)/);
      const breakM = t.condition.match(/breaks (\d+\.?\d*)/);
      if (testM) { level = parseFloat(testM[1]); type = 'test'; }
      else if (breakM) { level = parseFloat(breakM[1]); type = 'break'; }
      if (level == null) continue;

      // Find the first frame where the trigger condition fires
      let fireIdx = -1;
      for (let i = 1; i < stream.length; i++) {
        const cur = stream[i].spot;
        const prev = stream[i-1].spot;
        if (type === 'test' && Math.abs(cur - level) <= zone) { fireIdx = i; break; }
        if (type === 'break' && t.side === 'SHORT' && prev >= level && cur < level - zone) { fireIdx = i; break; }
        if (type === 'break' && t.side === 'LONG' && prev <= level && cur > level + zone) { fireIdx = i; break; }
      }

      if (fireIdx < 0) {
        console.log(`  ${t.icon} ${t.side} (${t.likelihood}): IF "${t.condition}"  → did NOT fire`);
        continue;
      }

      // Trigger fired — check forward 30 min for whether the trade direction worked
      firedTotal++;
      const fireSpot = stream[fireIdx].spot;
      const horizonIdx = Math.min(fireIdx + 30, stream.length - 1);
      const fwdSpot = stream[horizonIdx].spot;
      const fwdMove = (fwdSpot - fireSpot) / fireSpot * 10000;
      const worked = (t.side === 'LONG' && fwdMove > 0) || (t.side === 'SHORT' && fwdMove < 0);
      if (worked) workedTotal++;

      const fmt = (n) => `${n >= 0 ? '+' : ''}${n.toFixed(0)} bps`;
      console.log(`  ${t.icon} ${t.side} (${t.likelihood}): fired @ spot=${fireSpot.toFixed(2)}  → +30m: ${fmt(fwdMove)} ${worked ? '✓' : '✗'}`);
    }
  }

  if (firedTotal > 0) {
    console.log(`\n  Trigger-level: ${workedTotal}/${firedTotal} fired triggers had the trade direction work over +30m (${(workedTotal/firedTotal*100).toFixed(0)}%)`);
  } else {
    console.log(`\n  No triggers fired this day.`);
  }
}

console.log(`\n${'━'.repeat(75)}\n`);

// ─── DISCORD POST ────────────────────────────────────────────────────────────
if (args.discord) {
  const phaseLabel = args['at-open'] ? '🔔 9:31 ET — OPEN BRIEF' : '🌙 EOD BRIEF';
  const color = align.label.includes('POSITIVE') ? COLORS.positive
              : align.label.includes('NEGATIVE') ? COLORS.negative
              : align.label.includes('DIVERGENT') || align.label.includes('RAINBOW') ? COLORS.warning
              : COLORS.neutral;

  // Verdict block — short
  const verdict = `**${align.label}**\n${align.detail}`;

  // Gap block — only include if any significant gaps
  let gapText = '';
  if (args['at-open']) {
    const gapLines = [];
    for (const ticker of TICKERS) {
      const b = briefs[ticker];
      if (!b) continue;
      const g = detectGap(ticker, b.spot);
      if (!g) continue;
      const zone = ZONE[ticker];
      if (Math.abs(g.gap) > zone) {
        const dir = g.gap > 0 ? '↑' : '↓';
        gapLines.push(`${ticker}: ${dir} ${Math.abs(g.gap).toFixed(2)} pts (${g.gapBps >= 0 ? '+' : ''}${g.gapBps.toFixed(0)} bps)`);
      }
    }
    if (gapLines.length > 0) gapText = `\n**⚠ Overnight gaps:**\n` + gapLines.map(l => `• ${l}`).join('\n');
  }

  // Build per-ticker break level fields
  const fields = [];
  for (const ticker of TICKERS) {
    const b = briefs[ticker];
    if (!b) continue;
    const character = align.perTicker[ticker];
    const triggers = buildTradeTriggers(b, character, b.allNodes);
    const upBreak = triggers.find(t => t.side === 'LONG' && t.condition.includes('breaks'));
    const downBreak = triggers.find(t => t.side === 'SHORT' && t.condition.includes('breaks'));

    const lines = [`spot **${b.spot.toFixed(2)}**`];
    if (upBreak) {
      const lvl = upBreak.condition.match(/breaks (\d+\.?\d*)/)?.[1];
      lines.push(`⬆ ABOVE \`${lvl}\` → CALLS  →  target ${upBreak.target}, stop ${upBreak.stop}, R:R ${upBreak.rr}`);
    } else {
      lines.push(`⬆ no clean upside break`);
    }
    if (downBreak) {
      const lvl = downBreak.condition.match(/breaks (\d+\.?\d*)/)?.[1];
      lines.push(`⬇ BELOW \`${lvl}\` → PUTS   →  target ${downBreak.target}, stop ${downBreak.stop}, R:R ${downBreak.rr}`);
    } else {
      lines.push(`⬇ no clean downside break`);
    }
    fields.push({
      name: `${ticker}  •  ${character.type}`,
      value: lines.join('\n'),
      inline: false,
    });
  }

  try {
    await postEmbed({
      source: 'brief',
      title: `📊 ${phaseLabel} — ${args.date}`,
      description: verdict + gapText,
      fields,
      color,
      footer: 'gexester-vexster · break-level playbook',
    });
    console.log('[Discord] Brief posted.');
  } catch (err) {
    console.error('[Discord] Failed:', err.message);
  }
}

db.close();
