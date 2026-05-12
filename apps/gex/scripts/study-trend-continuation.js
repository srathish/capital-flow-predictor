#!/usr/bin/env node
/**
 * Trend continuation / gatekeeper break study.
 *
 * Scans all 60 days for "impulse signatures" — 5-min spot moves ≥30 bps in one direction —
 * and classifies each:
 *   - GATEKEEPER_BREAK: a node with rel_sig ≥3% sat in the path of the move (spot crossed it)
 *   - PURE_TREND:       no significant node in the path (air-pocket move)
 *
 * For each signature, we ask:
 *   1. Did our system fire a trade at that moment? (decision_log)
 *   2. What did the system think? (bias score, trinity, rejection reason)
 *   3. Did the move CONTINUE 30 min later? (would the trade have won?)
 *
 * Outputs per-day breakdown + how many we could have caught.
 *
 * Usage: npm run study-trend
 */

import Database from 'better-sqlite3';
import { join } from 'path';
import { config } from '../src/utils/config.js';

const dbPath = join(config.dataDir, 'gexester.db');
const db = new Database(dbPath, { readonly: true });

const fmt = (n, d = 1) => n == null ? '—' : Number(n).toFixed(d);
const pad = (s, w) => String(s).padEnd(w);
function header(t) {
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n  ${t}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
}

// ─── 1. Find all impulse signatures ──────────────────────────────────────────
// 5-min |Δspot|/spot ≥ 30 bps, in either direction
header('1. Impulse signature inventory (5-min moves ≥30 bps)');

const impulses = db.prepare(`
  WITH ordered AS (
    SELECT trading_day, ticker, ts_ms, spot,
      LAG(spot, 5) OVER (PARTITION BY trading_day, ticker ORDER BY ts_ms) prev5_spot
    FROM snapshots
  )
  SELECT trading_day, ticker, ts_ms, spot, prev5_spot,
    (spot - prev5_spot) AS delta,
    (spot - prev5_spot) / prev5_spot AS move_pct,
    CASE WHEN spot > prev5_spot THEN 'up' ELSE 'down' END AS direction
  FROM ordered
  WHERE prev5_spot IS NOT NULL
    AND ABS((spot - prev5_spot) / prev5_spot) >= 0.0030
  ORDER BY trading_day, ts_ms
`).all();

console.log(`  Total impulse events: ${impulses.length.toLocaleString()}`);
const byTicker = {};
for (const i of impulses) byTicker[i.ticker] = (byTicker[i.ticker] || 0) + 1;
console.log(`  By ticker:`, byTicker);

// ─── 2. Classify each impulse: gatekeeper_break vs pure_trend ────────────────
// gatekeeper_break: a node with rel_sig ≥ 3% existed in the path between prev5_spot and current spot
header('2. Classify each impulse + measure forward 30-min continuation');

const classify = db.prepare(`
  -- Was there a node strike with rel_sig ≥ 3% between prev5_spot and current spot?
  -- We check the snapshot at start of impulse for the strike count in that range.
  SELECT COUNT(*) gatekeepers_in_path
  FROM node_snapshots ns
  WHERE ns.ticker = ? AND ns.trading_day = ?
    AND ns.ts_ms = ?  -- snapshot at end of impulse
    AND ns.relative_significance >= 0.03
    AND ns.strike >= MIN(?, ?) AND ns.strike <= MAX(?, ?)
`);

const continuation = db.prepare(`
  -- Spot 30 min after the impulse end
  SELECT spot AS spot_30m
  FROM snapshots
  WHERE ticker = ? AND trading_day = ?
    AND ts_ms >= ? + 30*60*1000
  ORDER BY ts_ms ASC LIMIT 1
`);

const decisionAt = db.prepare(`
  -- Did our system fire / what did it think within 5 min of impulse end?
  SELECT decision, step_failed, reject_reason, direction, bias_score, trinity_classification
  FROM decision_log
  WHERE ticker = ? AND trading_day = ?
    AND ts_ms BETWEEN ? - 5*60*1000 AND ? + 1*60*1000
  ORDER BY ts_ms DESC LIMIT 1
`);

const stats = {
  gatekeeper_break: { total: 0, continued: 0, our_correct: 0, our_wrong: 0, our_missed: 0, missed_step: {} },
  pure_trend:      { total: 0, continued: 0, our_correct: 0, our_wrong: 0, our_missed: 0, missed_step: {} },
};

const perDay = {};

for (const imp of impulses) {
  // Was there a structural node in the path?
  const stmt = db.prepare(`
    SELECT COUNT(*) c FROM node_snapshots
    WHERE ticker = ? AND trading_day = ? AND ts_ms = ?
      AND relative_significance >= 0.03
      AND strike >= ? AND strike <= ?
  `);
  const lo = Math.min(imp.spot, imp.prev5_spot);
  const hi = Math.max(imp.spot, imp.prev5_spot);
  const r = stmt.get(imp.ticker, imp.trading_day, imp.ts_ms, lo, hi);
  const isGatekeeperBreak = r.c > 0;
  const cls = isGatekeeperBreak ? 'gatekeeper_break' : 'pure_trend';

  // Forward 30 min — did the move continue in same direction?
  const fwd = continuation.get(imp.ticker, imp.trading_day, imp.ts_ms);
  const continued = fwd && (
    (imp.direction === 'up'   && fwd.spot_30m > imp.spot) ||
    (imp.direction === 'down' && fwd.spot_30m < imp.spot)
  );

  stats[cls].total++;
  if (continued) stats[cls].continued++;

  // Did we fire a trade?
  const dec = decisionAt.get(imp.ticker, imp.trading_day, imp.ts_ms, imp.ts_ms);
  const expectedDirection = imp.direction === 'up' ? 'calls' : 'puts';
  if (dec) {
    if (dec.decision === 'would_enter' && dec.direction === expectedDirection) stats[cls].our_correct++;
    else if (dec.decision === 'would_enter' && dec.direction !== expectedDirection) stats[cls].our_wrong++;
    else if (dec.decision === 'reject') {
      stats[cls].our_missed++;
      stats[cls].missed_step[dec.reject_reason] = (stats[cls].missed_step[dec.reject_reason] || 0) + 1;
    }
  } else {
    stats[cls].our_missed++;
    stats[cls].missed_step['no_decision_logged'] = (stats[cls].missed_step['no_decision_logged'] || 0) + 1;
  }

  // Per-day rollup
  if (!perDay[imp.trading_day]) perDay[imp.trading_day] = { gatekeeper: 0, pure: 0, caught: 0 };
  perDay[imp.trading_day][cls === 'gatekeeper_break' ? 'gatekeeper' : 'pure']++;
  if (dec && dec.decision === 'would_enter' && dec.direction === expectedDirection) perDay[imp.trading_day].caught++;
}

console.log('  category         | total | continued | continued_% | system_caught | system_wrong | missed');
console.log('  ─────────────────┼───────┼───────────┼─────────────┼───────────────┼──────────────┼───────');
for (const cls of ['gatekeeper_break', 'pure_trend']) {
  const s = stats[cls];
  const continuedPct = s.total ? (s.continued / s.total * 100).toFixed(1) : '—';
  console.log(`  ${pad(cls,16)} | ${pad(s.total,5)} | ${pad(s.continued,9)} | ${pad(continuedPct + '%',11)} | ${pad(s.our_correct,13)} | ${pad(s.our_wrong,12)} | ${s.our_missed}`);
}

// ─── 3. Why we missed gatekeeper-break events ───────────────────────────────
header('3. Why our system MISSED gatekeeper breaks (top reject reasons)');
{
  const arr = Object.entries(stats.gatekeeper_break.missed_step).sort((a, b) => b[1] - a[1]);
  console.log('  reject_reason                                   | count');
  console.log('  ────────────────────────────────────────────────┼──────');
  for (const [reason, cnt] of arr.slice(0, 12)) {
    console.log(`  ${pad(reason,47)} | ${cnt}`);
  }
}

// ─── 4. Per-day breakdown for the worst missed-opportunity days ──────────────
header('4. Top 15 highest-impulse days vs caught count');
{
  const ranked = Object.entries(perDay)
    .map(([day, p]) => ({ day, ...p, total: p.gatekeeper + p.pure }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 15);
  console.log('  day         | gatekeeper | pure_trend | total | caught | catch_%');
  console.log('  ────────────┼────────────┼────────────┼───────┼────────┼────────');
  for (const r of ranked) {
    const pct = r.total ? (r.caught / r.total * 100).toFixed(1) : '—';
    console.log(`  ${pad(r.day,11)} | ${pad(r.gatekeeper,10)} | ${pad(r.pure,10)} | ${pad(r.total,5)} | ${pad(r.caught,6)} | ${pct}%`);
  }
}

// ─── 5. The bottom-line opportunity calculation ──────────────────────────────
header('5. Bottom line — what fraction is catchable vs what we caught');
{
  const totalImpulses = stats.gatekeeper_break.total + stats.pure_trend.total;
  const totalContinued = stats.gatekeeper_break.continued + stats.pure_trend.continued;
  const totalCaught = stats.gatekeeper_break.our_correct + stats.pure_trend.our_correct;
  const totalWrong  = stats.gatekeeper_break.our_wrong + stats.pure_trend.our_wrong;
  console.log(`  Total impulse events (≥30bps over 5min):        ${totalImpulses.toLocaleString()}`);
  console.log(`  Of which continued forward 30m:                  ${totalContinued.toLocaleString()} (${(totalContinued/totalImpulses*100).toFixed(1)}%)`);
  console.log(`  Caught by current system (correct direction):    ${totalCaught}`);
  console.log(`  Wrong direction:                                  ${totalWrong}`);
  console.log(`  Catch rate of all impulses:                       ${(totalCaught/totalImpulses*100).toFixed(2)}%`);
  console.log(`  Catch rate of continued impulses (real edge):     ${(totalCaught/totalContinued*100).toFixed(2)}%`);
  console.log();
  console.log(`  GATEKEEPER_BREAK alone:`);
  const gk = stats.gatekeeper_break;
  console.log(`    total events:        ${gk.total.toLocaleString()}`);
  console.log(`    continued forward:   ${gk.continued} (${(gk.continued/gk.total*100).toFixed(1)}%)`);
  console.log(`    avg per day:         ${(gk.total/60).toFixed(1)} events/day`);
  console.log(`    upside if pattern works: catch ~${(gk.continued).toLocaleString()} out of ${gk.total} = ${(gk.continued/gk.total*100).toFixed(0)}% win rate ceiling`);
}

console.log();
db.close();
