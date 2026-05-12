#!/usr/bin/env node
/**
 * Target-based exit simulator (Step 1 of the prioritized roadmap).
 *
 * Replays every accepted decision's proposed_plan minute-by-minute and resolves the
 * trade with first-target-or-stop logic per spec §6.6.3 + §6.7:
 *
 *   - Target: any minute where spot touches/crosses the first target strike → WIN
 *   - Stop:   spot must close beyond stop strike at minute T AND still be beyond at T+1
 *             (break-and-hold per §6.6.3) → LOSS
 *   - EOD:    if neither, exit at last spot of the session → time-out flag
 *
 * Compared against the fixed-30m baseline already in decision_outcomes.
 *
 * Writes:
 *   simulated_outcomes table — one row per accept with realized return + exit reason
 *   prints comparison: fixed-30m vs target-based, per-trade and aggregate
 */

import Database from 'better-sqlite3';
import { join } from 'path';
import { config } from '../src/utils/config.js';

const dbPath = join(config.dataDir, 'gexester.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// One-shot table — drop and recompute.
db.exec(`
  DROP TABLE IF EXISTS simulated_outcomes;
  CREATE TABLE simulated_outcomes (
    decision_id     INTEGER PRIMARY KEY,
    ts_ms           INTEGER NOT NULL,
    trading_day     TEXT NOT NULL,
    ticker          TEXT NOT NULL,
    direction       TEXT NOT NULL,
    entry_spot      REAL NOT NULL,
    target_strike   REAL,
    stop_strike     REAL,
    rr_planned      REAL,
    exit_reason     TEXT NOT NULL,    -- 'target' | 'stop' | 'eod' | 'no_target_data'
    exit_ts_ms      INTEGER,
    exit_spot       REAL,
    duration_min    REAL,
    realized_ret    REAL,             -- direction-adjusted spot return
    realized_bps    REAL
  );
  CREATE INDEX idx_sim_day_ticker ON simulated_outcomes(trading_day, ticker);
`);

const accepts = db.prepare(`
  SELECT decision_id, ts_ms, trading_day, ticker, direction, proposed_plan, bias_score
  FROM decision_log
  WHERE decision = 'would_enter' AND proposed_plan IS NOT NULL
  ORDER BY ts_ms
`).all();

console.log(`Simulating ${accepts.length} accepted trades with target-based exits…\n`);

// Forward spot stream per (ticker, day) — fetch once per trade.
const forwardSpots = db.prepare(`
  SELECT ts_ms, spot FROM snapshots
  WHERE ticker = ? AND trading_day = ? AND ts_ms >= ?
  ORDER BY ts_ms ASC
`);

const insert = db.prepare(`
  INSERT INTO simulated_outcomes
    (decision_id, ts_ms, trading_day, ticker, direction, entry_spot,
     target_strike, stop_strike, rr_planned,
     exit_reason, exit_ts_ms, exit_spot, duration_min, realized_ret, realized_bps)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const rows = [];

for (const a of accepts) {
  const plan = JSON.parse(a.proposed_plan);
  const targetStrike = plan.targets?.[0]?.strike;
  const stopStrike = plan.stopStrike;
  if (!targetStrike || !stopStrike) {
    rows.push({ decision_id: a.decision_id, exit_reason: 'no_plan_data' });
    continue;
  }
  const isCalls = a.direction === 'calls';
  const dirSign = isCalls ? +1 : -1;
  const entrySpot = plan.entryPrice;

  const stream = forwardSpots.all(a.ticker, a.trading_day, a.ts_ms);
  if (stream.length < 2) {
    rows.push({
      decision_id: a.decision_id, ts_ms: a.ts_ms, trading_day: a.trading_day, ticker: a.ticker,
      direction: a.direction, entry_spot: entrySpot,
      target_strike: targetStrike, stop_strike: stopStrike, rr_planned: plan.rr,
      exit_reason: 'no_forward_data', exit_ts_ms: null, exit_spot: null,
      duration_min: 0, realized_ret: 0, realized_bps: 0,
    });
    continue;
  }

  // Walk forward looking for first target hit OR break-and-hold stop.
  let exitReason = null, exitSpot = null, exitTsMs = null;
  let pendingStopAt = null; // ts_ms of first bar that closed beyond stop

  for (let i = 1; i < stream.length; i++) {
    const { ts_ms, spot } = stream[i];

    // Target: ANY touch in trade direction
    const targetHit = isCalls ? spot >= targetStrike : spot <= targetStrike;
    if (targetHit) {
      exitReason = 'target';
      exitSpot = targetStrike; // assume conservative fill exactly at target
      exitTsMs = ts_ms;
      break;
    }

    // Stop: spec §6.6.3 — close beyond stop AND still beyond next bar (~60s later)
    const beyondStop = isCalls ? spot <= stopStrike : spot >= stopStrike;
    if (beyondStop) {
      if (pendingStopAt == null) {
        pendingStopAt = ts_ms;       // first bar closing beyond stop
      } else {
        exitReason = 'stop';
        exitSpot = stopStrike;        // conservative fill at stop
        exitTsMs = ts_ms;
        break;
      }
    } else {
      pendingStopAt = null; // recovered, reset
    }
  }

  if (!exitReason) {
    // Neither target nor stop hit — exit at last bar of session
    const last = stream[stream.length - 1];
    exitReason = 'eod';
    exitSpot = last.spot;
    exitTsMs = last.ts_ms;
  }

  const realizedRet = dirSign * (exitSpot - entrySpot) / entrySpot;
  const durationMin = (exitTsMs - a.ts_ms) / 60_000;

  rows.push({
    decision_id: a.decision_id, ts_ms: a.ts_ms, trading_day: a.trading_day, ticker: a.ticker,
    direction: a.direction, entry_spot: entrySpot,
    target_strike: targetStrike, stop_strike: stopStrike, rr_planned: plan.rr,
    exit_reason: exitReason, exit_ts_ms: exitTsMs, exit_spot: exitSpot,
    duration_min: durationMin, realized_ret: realizedRet, realized_bps: realizedRet * 10000,
  });
}

const insertAll = db.transaction((batch) => {
  for (const r of batch) {
    if (r.exit_reason === 'no_plan_data') continue; // skip un-insertable
    insert.run(
      r.decision_id, r.ts_ms ?? null, r.trading_day ?? null, r.ticker ?? null,
      r.direction ?? null, r.entry_spot ?? null,
      r.target_strike ?? null, r.stop_strike ?? null, r.rr_planned ?? null,
      r.exit_reason, r.exit_ts_ms ?? null, r.exit_spot ?? null,
      r.duration_min ?? null, r.realized_ret ?? null, r.realized_bps ?? null
    );
  }
});
insertAll(rows);

console.log(`Wrote ${rows.filter(r => r.exit_reason !== 'no_plan_data').length} simulated outcomes.\n`);

// ─── Per-trade comparison: fixed-30m vs target-based ─────────────────────────
console.log('━━━ Per-trade comparison: fixed-30m vs target-based exit ━━━');
const cmp = db.prepare(`
  SELECT
    dl.trading_day day,
    dl.ticker tkr,
    dl.direction dir,
    ROUND(dl.bias_score, 1) bias,
    ROUND(dout.ret_30m * 10000, 1) fixed_30m_bps,
    ROUND(so.realized_bps, 1) target_bps,
    so.exit_reason,
    ROUND(so.duration_min, 1) dur_min
  FROM decision_log dl
  JOIN decision_outcomes dout USING (decision_id)
  JOIN simulated_outcomes so USING (decision_id)
  WHERE dl.decision = 'would_enter'
  ORDER BY so.realized_bps DESC
`).all();

const colW = { day: 11, tkr: 4, dir: 5, bias: 6, fixed: 13, target: 11, reason: 8, dur: 7 };
console.log('  day         | tkr  | dir   | bias   | fixed_30m   | target    | reason   | dur_min');
console.log('  ────────────┼──────┼───────┼────────┼─────────────┼───────────┼──────────┼────────');
for (const r of cmp) {
  console.log(`  ${String(r.day).padEnd(colW.day)} | ${String(r.tkr).padEnd(colW.tkr)} | ${String(r.dir).padEnd(colW.dir)} | ${String(r.bias).padStart(6)} | ${String(r.fixed_30m_bps).padStart(11)} | ${String(r.target_bps).padStart(9)} | ${String(r.exit_reason).padEnd(8)} | ${String(r.dur_min).padStart(6)}`);
}

// ─── Aggregate comparison ─────────────────────────────────────────────────────
console.log('\n━━━ Aggregate ━━━');
const agg = db.prepare(`
  SELECT
    COUNT(*) n,
    SUM(CASE WHEN dout.ret_30m > 0 THEN 1 ELSE 0 END) fixed_winners,
    ROUND(AVG(dout.ret_30m) * 10000, 2) fixed_avg_bps,
    ROUND(SUM(dout.ret_30m) * 10000, 1) fixed_total_bps,
    SUM(CASE WHEN so.realized_ret > 0 THEN 1 ELSE 0 END) target_winners,
    ROUND(AVG(so.realized_ret) * 10000, 2) target_avg_bps,
    ROUND(SUM(so.realized_ret) * 10000, 1) target_total_bps,
    ROUND(AVG(so.duration_min), 1) avg_duration_min
  FROM decision_log dl
  JOIN decision_outcomes dout USING (decision_id)
  JOIN simulated_outcomes so USING (decision_id)
  WHERE dl.decision = 'would_enter'
`).get();

console.log(`                       | fixed-30m         | target-based`);
console.log(`  ─────────────────────┼───────────────────┼──────────────────`);
console.log(`  trades               | ${String(agg.n).padEnd(17)} | ${agg.n}`);
console.log(`  winners              | ${String(`${agg.fixed_winners} (${(agg.fixed_winners/agg.n*100).toFixed(1)}%)`).padEnd(17)} | ${agg.target_winners} (${(agg.target_winners/agg.n*100).toFixed(1)}%)`);
console.log(`  avg bps              | ${String(agg.fixed_avg_bps).padEnd(17)} | ${agg.target_avg_bps}`);
console.log(`  total bps            | ${String(agg.fixed_total_bps).padEnd(17)} | ${agg.target_total_bps}`);
console.log(`  avg duration (min)   | 30.0              | ${agg.avg_duration_min}`);

// Exit reason breakdown
const reasons = db.prepare(`
  SELECT exit_reason, COUNT(*) n,
    ROUND(SUM(realized_bps), 1) total_bps,
    ROUND(AVG(realized_bps), 1) avg_bps
  FROM simulated_outcomes GROUP BY exit_reason ORDER BY n DESC
`).all();
console.log('\n  Exit reason breakdown:');
for (const r of reasons) {
  console.log(`    ${String(r.exit_reason).padEnd(10)} n=${String(r.n).padEnd(4)} total=${String(r.total_bps).padStart(7)} bps  avg=${r.avg_bps} bps`);
}

db.close();
