#!/usr/bin/env node
/**
 * Calibration summary — read the replay DB and surface distributions that inform
 * threshold tuning. Pure SQL queries — does not modify state.
 *
 * Sections:
 *   1. Coverage     — how much data, how many days
 *   2. Decision funnel — where evaluations die step-by-step
 *   3. Step 1 (unstructured_price) — actual 5-min spot range distribution
 *   4. Step 4 (tap_4plus) — tap-count distribution + tap velocity
 *   5. Step 4 (no_directional_bias) — bias score distribution per ticker
 *   6. Trinity classification rates — per-day frequency
 *   7. Patterns — fire rates per ticker
 *   8. The accepts — what 5 trades did pass
 *
 * Usage:
 *   npm run calibrate
 */

import Database from 'better-sqlite3';
import { join } from 'path';
import { config } from '../src/utils/config.js';

const dbPath = join(config.dataDir, 'gexester.db');
const db = new Database(dbPath, { readonly: true });

const fmt = n => typeof n === 'number' ? (Number.isInteger(n) ? n.toLocaleString() : n.toFixed(2)) : String(n);

function header(title) {
  const line = '─'.repeat(78);
  console.log(`\n${line}\n  ${title}\n${line}`);
}

function table(rows) {
  if (rows.length === 0) { console.log('  (no rows)'); return; }
  const cols = Object.keys(rows[0]);
  const widths = cols.map(c => Math.max(c.length, ...rows.map(r => String(r[c] ?? '').length)));
  const line = cols.map((c, i) => c.padEnd(widths[i])).join('  ');
  console.log('  ' + line);
  console.log('  ' + cols.map((_, i) => '─'.repeat(widths[i])).join('  '));
  for (const r of rows) {
    console.log('  ' + cols.map((c, i) => String(r[c] ?? '').padEnd(widths[i])).join('  '));
  }
}

// ── 1. Coverage ────────────────────────────────────────────────────────────────
header('1. Coverage');
{
  const days = db.prepare(`SELECT COUNT(DISTINCT trading_day) c FROM snapshots`).get().c;
  const snaps = db.prepare(`SELECT COUNT(*) c FROM snapshots`).get().c;
  const nodes = db.prepare(`SELECT COUNT(*) c FROM node_snapshots`).get().c;
  const decisions = db.prepare(`SELECT COUNT(*) c FROM decision_log`).get().c;
  const accepted = db.prepare(`SELECT COUNT(*) c FROM decision_log WHERE decision = 'would_enter'`).get().c;
  console.log(`  trading days: ${fmt(days)}`);
  console.log(`  snapshots:    ${fmt(snaps)}`);
  console.log(`  node-rows:    ${fmt(nodes)}`);
  console.log(`  decisions:    ${fmt(decisions)}`);
  console.log(`  accepted:     ${fmt(accepted)}  (${(accepted/decisions*100).toFixed(3)}%)`);
}

// ── 2. Decision funnel ─────────────────────────────────────────────────────────
header('2. Decision funnel — where 9-step synthesis dies');
{
  const total = db.prepare(`SELECT COUNT(*) c FROM decision_log`).get().c;
  const rows = db.prepare(`
    SELECT step_failed, reject_reason,
           COUNT(*) count,
           ROUND(COUNT(*) * 100.0 / ?, 2) pct
    FROM decision_log WHERE decision = 'reject'
    GROUP BY step_failed, reject_reason ORDER BY count DESC
  `).all(total);
  table(rows);
}

// ── 3. Step 1 (unstructured_price) — actual 5-min spot range distribution ─────
header('3. Step 1 quietness threshold — actual 5-min spot range distribution');
console.log('  Current threshold: 5-min range / spot < 0.05% → reject as unstructured');
console.log('  (Threshold is meant to filter out chop. The question: is 0.05% too tight?)');
{
  // For each snapshot, compute (max-min spot over last 5 min) / spot.
  // SQLite window function over a time-bounded preceding range.
  const rows = db.prepare(`
    WITH ranges AS (
      SELECT s.ticker, s.trading_day, s.ts_ms, s.spot,
        (SELECT MAX(s2.spot) - MIN(s2.spot)
         FROM snapshots s2
         WHERE s2.ticker = s.ticker AND s2.trading_day = s.trading_day
           AND s2.ts_ms BETWEEN s.ts_ms - 5*60*1000 AND s.ts_ms) AS range_5min
      FROM snapshots s
    ),
    pcts AS (
      SELECT range_5min / spot * 100.0 AS pct
      FROM ranges
      WHERE range_5min IS NOT NULL AND spot > 0
    )
    SELECT
      ROUND(MIN(pct), 5)  AS min_pct,
      ROUND(AVG(pct), 4)  AS avg_pct,
      ROUND(MAX(pct), 4)  AS max_pct,
      COUNT(*) n
    FROM pcts
  `).get();
  console.log(`  range/spot  min=${rows.min_pct}%  avg=${rows.avg_pct}%  max=${rows.max_pct}%  n=${fmt(rows.n)}`);

  // What pct of snapshots fall BELOW each candidate threshold?
  const candidates = [0.01, 0.02, 0.03, 0.05, 0.10, 0.15, 0.20, 0.30, 0.50];
  const total = db.prepare(`
    SELECT COUNT(*) c FROM snapshots s
    WHERE EXISTS (SELECT 1 FROM snapshots s2 WHERE s2.ticker=s.ticker AND s2.trading_day=s.trading_day AND s2.ts_ms BETWEEN s.ts_ms - 5*60*1000 AND s.ts_ms)
  `).get().c;
  const probe = db.prepare(`
    SELECT
      SUM(CASE WHEN range_5min/spot*100.0 < ? THEN 1 ELSE 0 END) below
    FROM (
      SELECT s.spot,
        (SELECT MAX(s2.spot) - MIN(s2.spot) FROM snapshots s2
         WHERE s2.ticker=s.ticker AND s2.trading_day=s.trading_day
           AND s2.ts_ms BETWEEN s.ts_ms - 5*60*1000 AND s.ts_ms) AS range_5min
      FROM snapshots s
    ) WHERE range_5min IS NOT NULL AND spot > 0
  `);
  const out = candidates.map(t => {
    const r = probe.get(t);
    return { threshold_pct: t, would_reject: fmt(r.below), pct_of_snapshots: fmt(r.below / total * 100) + '%' };
  });
  console.log('  How aggressively would each threshold gate Step 1:');
  table(out);
}

// ── 4. Step 4 (tap_4plus) — tap-count distribution ─────────────────────────────
header('4. Step 4 tap_4plus — tap-count distribution + minute-by-minute over-counting');
console.log('  Current rule: 4+ taps → no edge. Cooldown: 5 min OR 2× zone away.');
console.log('  Question: does 1-minute frame cadence inflate tap counts vs. real trading?');
{
  const dist = db.prepare(`
    SELECT
      CASE WHEN tap_count = 0 THEN '0'
           WHEN tap_count = 1 THEN '1'
           WHEN tap_count = 2 THEN '2'
           WHEN tap_count = 3 THEN '3'
           WHEN tap_count = 4 THEN '4'
           WHEN tap_count BETWEEN 5 AND 9 THEN '5-9'
           ELSE '10+' END AS tap_bucket,
      ticker,
      COUNT(*) nodes
    FROM node_lifecycle
    GROUP BY tap_bucket, ticker
    ORDER BY ticker, tap_bucket
  `).all();
  table(dist);

  const peakTaps = db.prepare(`
    SELECT ticker, strike, trading_day, tap_count, lifecycle_state
    FROM node_lifecycle WHERE tap_count >= 5
    ORDER BY tap_count DESC LIMIT 10
  `).all();
  console.log('  Top 10 most-tapped strikes across 60 days:');
  table(peakTaps);
}

// ── 5. Step 4 (no_directional_bias) — bias score distribution ─────────────────
header('5. Bias score distribution per ticker (current step-4 floor: |bias| > 30)');
{
  const rows = db.prepare(`
    SELECT
      ticker,
      ROUND(MIN(bias_score), 1) min,
      ROUND(AVG(bias_score), 1) avg,
      ROUND(MAX(bias_score), 1) max,
      SUM(CASE WHEN ABS(bias_score) > 30 THEN 1 ELSE 0 END) AS gt_30,
      SUM(CASE WHEN ABS(bias_score) > 60 THEN 1 ELSE 0 END) AS gt_60,
      COUNT(*) total
    FROM bias_scores GROUP BY ticker
  `).all();
  for (const r of rows) {
    r.gt_30_pct = (r.gt_30 / r.total * 100).toFixed(1) + '%';
    r.gt_60_pct = (r.gt_60 / r.total * 100).toFixed(1) + '%';
  }
  table(rows);
}

// ── 6. Trinity ────────────────────────────────────────────────────────────────
header('6. Trinity classification rates');
{
  const rows = db.prepare(`
    SELECT classification, COUNT(*) count,
      ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM trinity_evaluations), 2) pct
    FROM trinity_evaluations GROUP BY classification ORDER BY count DESC
  `).all();
  table(rows);

  console.log('  Per-day moderate-trinity event count (top 10):');
  const perDay = db.prepare(`
    SELECT trading_day, COUNT(*) moderate_events
    FROM trinity_evaluations
    WHERE classification = 'moderate_confidence_directional'
    GROUP BY trading_day ORDER BY moderate_events DESC LIMIT 10
  `).all();
  table(perDay);
}

// ── 7. Patterns ───────────────────────────────────────────────────────────────
header('7. Pattern fire rates');
{
  const rows = db.prepare(`
    SELECT
      pattern, ticker,
      SUM(detected) hits,
      COUNT(*) total,
      ROUND(SUM(detected) * 100.0 / COUNT(*), 1) pct
    FROM pattern_detections
    GROUP BY pattern, ticker ORDER BY pattern, ticker
  `).all();
  table(rows);
}

// ── 8. The accepts ────────────────────────────────────────────────────────────
header('8. Accepted decisions across 60 days');
{
  const rows = db.prepare(`
    SELECT trading_day, ticker, direction,
           ROUND(bias_score, 1) bias,
           trinity_classification AS trinity,
           datetime(ts_ms/1000, 'unixepoch', '-4 hours') AS et_time
    FROM decision_log WHERE decision = 'would_enter'
    ORDER BY ts_ms
  `).all();
  table(rows);
}

console.log();
db.close();
