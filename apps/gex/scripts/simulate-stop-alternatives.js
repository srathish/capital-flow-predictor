#!/usr/bin/env node
/**
 * Stop-loss alternative simulator.
 *
 * The default §6.6.1 logic (next ≥3% node + 1-bar break-and-hold) stops out 17/24
 * baseline trades. Test whether alternative stop logic preserves the edge.
 *
 * Variants:
 *   A. Spec default (≥3% stop, 1-bar break-and-hold) — same as simulate-target-exits.js
 *   B. Wider stop (≥5% rel_sig stop node)
 *   C. Hardier break-and-hold (3-bar / 3-min sustained)
 *   D. Fixed-distance stop (10 bps in spot)
 *   E. Fixed-distance wider (20 bps)
 *   F. No stop at all (target or EOD only — direction-only baseline)
 */

import Database from 'better-sqlite3';
import { join } from 'path';
import { config } from '../src/utils/config.js';

const dbPath = join(config.dataDir, 'gexester.db');
const db = new Database(dbPath, { readonly: true });

const accepts = db.prepare(`
  SELECT decision_id, ts_ms, trading_day, ticker, direction, proposed_plan
  FROM decision_log
  WHERE decision = 'would_enter' AND proposed_plan IS NOT NULL
`).all();

const forwardSpots = db.prepare(`
  SELECT ts_ms, spot FROM snapshots
  WHERE ticker = ? AND trading_day = ? AND ts_ms >= ?
  ORDER BY ts_ms ASC
`);

const nodeAtSnap = db.prepare(`
  SELECT strike, relative_significance FROM node_snapshots
  WHERE snapshot_id = (SELECT snapshot_id FROM snapshots WHERE ticker=? AND trading_day=? AND ts_ms=?)
`);

function findStopStrike(plan, accept, threshold) {
  // Re-derive stop using a different rel_sig threshold from the entry-time surface
  const isCalls = accept.direction === 'calls';
  const entryStrike = plan.entryNode?.strike ?? plan.entryPrice;
  const nodes = nodeAtSnap.all(accept.ticker, accept.trading_day, accept.ts_ms);
  const candidates = nodes
    .filter(n => n.relative_significance >= threshold)
    .filter(n => isCalls ? n.strike < entryStrike : n.strike > entryStrike);
  if (!candidates.length) return null;
  // closest in trade-adverse direction
  candidates.sort((a, b) => isCalls ? b.strike - a.strike : a.strike - b.strike);
  return candidates[0].strike;
}

function simulateOne(accept, plan, opts) {
  const { stopStrike, stopBars, fixedStopBps } = opts;
  const isCalls = accept.direction === 'calls';
  const dirSign = isCalls ? +1 : -1;
  const entrySpot = plan.entryPrice;
  const targetStrike = plan.targets?.[0]?.strike;
  if (!targetStrike) return null;

  // Effective stop strike (could be derived per-mode)
  let effectiveStop = stopStrike;
  if (fixedStopBps != null) {
    const stopDist = entrySpot * fixedStopBps / 10000;
    effectiveStop = isCalls ? entrySpot - stopDist : entrySpot + stopDist;
  }

  const stream = forwardSpots.all(accept.ticker, accept.trading_day, accept.ts_ms);
  if (stream.length < 2) return null;

  let pendingStopBars = 0;
  for (let i = 1; i < stream.length; i++) {
    const { ts_ms, spot } = stream[i];

    // Target?
    const targetHit = isCalls ? spot >= targetStrike : spot <= targetStrike;
    if (targetHit) {
      const ret = dirSign * (targetStrike - entrySpot) / entrySpot;
      return { exit: 'target', exit_ts: ts_ms, exit_spot: targetStrike, ret, dur: (ts_ms - accept.ts_ms) / 60_000 };
    }

    // Stop with break-and-hold (configurable bar count)
    if (effectiveStop != null) {
      const beyondStop = isCalls ? spot <= effectiveStop : spot >= effectiveStop;
      if (beyondStop) {
        pendingStopBars++;
        if (pendingStopBars >= stopBars) {
          const ret = dirSign * (effectiveStop - entrySpot) / entrySpot;
          return { exit: 'stop', exit_ts: ts_ms, exit_spot: effectiveStop, ret, dur: (ts_ms - accept.ts_ms) / 60_000 };
        }
      } else {
        pendingStopBars = 0;
      }
    }
  }

  // EOD
  const last = stream[stream.length - 1];
  const ret = dirSign * (last.spot - entrySpot) / entrySpot;
  return { exit: 'eod', exit_ts: last.ts_ms, exit_spot: last.spot, ret, dur: (last.ts_ms - accept.ts_ms) / 60_000 };
}

const variants = [
  { name: 'A. spec default (3% stop, 1-bar)', stopThreshold: 0.03, stopBars: 1 },
  { name: 'B. wider stop (5% threshold)',     stopThreshold: 0.05, stopBars: 1 },
  { name: 'C. 3-bar hold (3% stop)',          stopThreshold: 0.03, stopBars: 3 },
  { name: 'D. fixed 10bps stop',              fixedStopBps: 10, stopBars: 1 },
  { name: 'E. fixed 20bps stop',              fixedStopBps: 20, stopBars: 1 },
  { name: 'F. no stop (target or EOD only)',  stopThreshold: null, stopBars: 999 },
];

console.log('Variant comparison on 24 baseline accepts:\n');
console.log('  variant                           | wins  | avg_bps | total_bps | tgt | stp | eod | avg_dur');
console.log('  ──────────────────────────────────┼───────┼─────────┼───────────┼─────┼─────┼─────┼────────');

for (const v of variants) {
  let wins = 0, totalBps = 0, byReason = { target: 0, stop: 0, eod: 0 }, totalDur = 0, n = 0;
  for (const a of accepts) {
    const plan = JSON.parse(a.proposed_plan);
    let stopStrike = plan.stopStrike;
    if (v.stopThreshold === null) stopStrike = null;
    else if (v.stopThreshold !== undefined) {
      stopStrike = findStopStrike(plan, a, v.stopThreshold) ?? plan.stopStrike;
    }
    const out = simulateOne(a, plan, {
      stopStrike,
      stopBars: v.stopBars,
      fixedStopBps: v.fixedStopBps,
    });
    if (!out) continue;
    n++;
    if (out.ret > 0) wins++;
    totalBps += out.ret * 10000;
    byReason[out.exit]++;
    totalDur += out.dur;
  }
  const avgBps = totalBps / n;
  const winPct = (wins / n * 100).toFixed(1);
  const avgDur = (totalDur / n).toFixed(0);
  console.log(`  ${v.name.padEnd(33)} | ${String(wins).padStart(2)}/${n} | ${avgBps.toFixed(2).padStart(7)} | ${totalBps.toFixed(1).padStart(9)} | ${String(byReason.target).padStart(3)} | ${String(byReason.stop).padStart(3)} | ${String(byReason.eod).padStart(3)} | ${avgDur} min`);
}

console.log('\nReference fixed-30m baseline: 19/24 wins (79.2%), +8.54 avg, +205 total\n');

db.close();
