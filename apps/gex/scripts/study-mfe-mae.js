#!/usr/bin/env node
/**
 * Maximum Favorable Excursion (MFE) and Maximum Adverse Excursion (MAE) study.
 *
 * For each of the 24 baseline accepts:
 *   - Walk forward minute-by-minute for the first 30 / 60 / EOD bars
 *   - Track peak direction-adjusted return (MFE) and worst (MAE)
 *   - Note the time-to-MFE and time-to-MAE
 *
 * Then grid-search a fixed take-profit policy: for each candidate TP level
 * (5/8/10/12/15/20/25/30 bps), simulate hit-TP-or-stop-or-eod and report total
 * realized return. This tells us which fixed TP captures the most edge.
 *
 * Combined with stop simulation, gives a full picture: do the trades have enough
 * favorable excursion to extract PnL, and where should we cut them?
 */

import Database from 'better-sqlite3';
import { join } from 'path';
import { config } from '../src/utils/config.js';

const dbPath = join(config.dataDir, 'gexester.db');
const db = new Database(dbPath, { readonly: true });

const accepts = db.prepare(`
  SELECT decision_id, ts_ms, trading_day, ticker, direction, proposed_plan, bias_score
  FROM decision_log
  WHERE decision = 'would_enter' AND proposed_plan IS NOT NULL
  ORDER BY ts_ms
`).all();

const forwardSpots = db.prepare(`
  SELECT ts_ms, spot FROM snapshots
  WHERE ticker = ? AND trading_day = ? AND ts_ms >= ?
  ORDER BY ts_ms ASC
`);

// Compute MFE/MAE arrays for each trade.
const trades = [];
for (const a of accepts) {
  const plan = JSON.parse(a.proposed_plan);
  const isCalls = a.direction === 'calls';
  const dirSign = isCalls ? +1 : -1;
  const entrySpot = plan.entryPrice;
  const stopStrike = plan.stopStrike;
  const targetStrike = plan.targets?.[0]?.strike;

  const stream = forwardSpots.all(a.ticker, a.trading_day, a.ts_ms);
  if (stream.length < 2) continue;

  let mfe30 = 0, mfe60 = 0, mfeEod = 0;
  let mae30 = 0, mae60 = 0, maeEod = 0;
  let mfe30Time = null, mfe60Time = null, mfeEodTime = null;

  for (const { ts_ms, spot } of stream) {
    const elapsedMin = (ts_ms - a.ts_ms) / 60_000;
    const ret = dirSign * (spot - entrySpot) / entrySpot;

    if (elapsedMin <= 30) {
      if (ret > mfe30) { mfe30 = ret; mfe30Time = elapsedMin; }
      if (ret < mae30) { mae30 = ret; }
    }
    if (elapsedMin <= 60) {
      if (ret > mfe60) { mfe60 = ret; mfe60Time = elapsedMin; }
      if (ret < mae60) { mae60 = ret; }
    }
    if (ret > mfeEod) { mfeEod = ret; mfeEodTime = elapsedMin; }
    if (ret < maeEod) { maeEod = ret; }
  }

  trades.push({
    decision_id: a.decision_id,
    day: a.trading_day,
    ticker: a.ticker,
    direction: a.direction,
    bias: a.bias_score,
    entrySpot,
    stopStrike,
    targetStrike,
    targetDistBps: targetStrike ? Math.abs(targetStrike - entrySpot) / entrySpot * 10000 : null,
    stopDistBps: stopStrike ? Math.abs(stopStrike - entrySpot) / entrySpot * 10000 : null,
    mfe30Bps: mfe30 * 10000,
    mfe60Bps: mfe60 * 10000,
    mfeEodBps: mfeEod * 10000,
    mae30Bps: mae30 * 10000,
    mae60Bps: mae60 * 10000,
    maeEodBps: maeEod * 10000,
    mfe30Time, mfe60Time, mfeEodTime,
    stream,
  });
}

console.log(`MFE/MAE for ${trades.length} accepted trades.\n`);

// ─── Per-trade detail ────────────────────────────────────────────────────────
console.log('━━━ Per-trade MFE / MAE ━━━');
console.log('  day        | tkr  | dir   | bias  | targetD | stopD | MFE_30m | MAE_30m | MFE_60m | MAE_60m | MFE_eod');
console.log('  ───────────┼──────┼───────┼───────┼─────────┼───────┼─────────┼─────────┼─────────┼─────────┼─────────');
for (const t of trades) {
  console.log(
    `  ${t.day.padEnd(10)} | ${t.ticker.padEnd(4)} | ${t.direction.padEnd(5)} | ${String(t.bias.toFixed(0)).padStart(5)} | ` +
    `${(t.targetDistBps?.toFixed(0) ?? '—').padStart(7)} | ` +
    `${(t.stopDistBps?.toFixed(0) ?? '—').padStart(5)} | ` +
    `${t.mfe30Bps.toFixed(1).padStart(7)} | ${t.mae30Bps.toFixed(1).padStart(7)} | ` +
    `${t.mfe60Bps.toFixed(1).padStart(7)} | ${t.mae60Bps.toFixed(1).padStart(7)} | ` +
    `${t.mfeEodBps.toFixed(1).padStart(7)}`
  );
}

// ─── Distribution summary ────────────────────────────────────────────────────
function pctile(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.floor(p * sorted.length)];
}

const mfe30s = trades.map(t => t.mfe30Bps);
const mae30s = trades.map(t => t.mae30Bps);
const targetDists = trades.map(t => t.targetDistBps).filter(d => d != null);
const stopDists = trades.map(t => t.stopDistBps).filter(d => d != null);

console.log('\n━━━ Distribution (24 trades, bps) ━━━');
console.log(`  MFE_30m:    P10=${pctile(mfe30s, 0.10).toFixed(1)}  P25=${pctile(mfe30s, 0.25).toFixed(1)}  median=${pctile(mfe30s, 0.50).toFixed(1)}  P75=${pctile(mfe30s, 0.75).toFixed(1)}  P90=${pctile(mfe30s, 0.90).toFixed(1)}`);
console.log(`  MAE_30m:    P10=${pctile(mae30s, 0.10).toFixed(1)}  P25=${pctile(mae30s, 0.25).toFixed(1)}  median=${pctile(mae30s, 0.50).toFixed(1)}  P75=${pctile(mae30s, 0.75).toFixed(1)}  P90=${pctile(mae30s, 0.90).toFixed(1)}`);
console.log(`  Target dist: median=${pctile(targetDists, 0.50).toFixed(1)}  P75=${pctile(targetDists, 0.75).toFixed(1)}  max=${Math.max(...targetDists).toFixed(1)}`);
console.log(`  Stop dist:   median=${pctile(stopDists, 0.50).toFixed(1)}  P75=${pctile(stopDists, 0.75).toFixed(1)}  max=${Math.max(...stopDists).toFixed(1)}`);

const trades_with_mfe_above_10 = mfe30s.filter(x => x >= 10).length;
const trades_with_mfe_above_15 = mfe30s.filter(x => x >= 15).length;
const trades_with_mfe_above_20 = mfe30s.filter(x => x >= 20).length;
const trades_with_mfe_above_30 = mfe30s.filter(x => x >= 30).length;
console.log(`\n  How many trades had MFE_30m exceeding fixed TP levels:`);
console.log(`    MFE ≥ 10 bps:  ${trades_with_mfe_above_10}/${trades.length} (${(trades_with_mfe_above_10/trades.length*100).toFixed(0)}%)`);
console.log(`    MFE ≥ 15 bps:  ${trades_with_mfe_above_15}/${trades.length} (${(trades_with_mfe_above_15/trades.length*100).toFixed(0)}%)`);
console.log(`    MFE ≥ 20 bps:  ${trades_with_mfe_above_20}/${trades.length} (${(trades_with_mfe_above_20/trades.length*100).toFixed(0)}%)`);
console.log(`    MFE ≥ 30 bps:  ${trades_with_mfe_above_30}/${trades.length} (${(trades_with_mfe_above_30/trades.length*100).toFixed(0)}%)`);

// ─── Grid search: optimal fixed take-profit ──────────────────────────────────
console.log('\n━━━ Grid search: fixed take-profit + 3% spec stop ━━━');
console.log('  Simulates: take-profit fires at TP_bps in trade direction, OR spec stop hits, OR EOD.');
console.log('  TP_bps | wins  | avg_bps | total_bps | tp_hits | stops | eods');
console.log('  ───────┼───────┼─────────┼───────────┼─────────┼───────┼─────');
const tpLevels = [5, 8, 10, 12, 15, 20, 25, 30, 50];
for (const tpBps of tpLevels) {
  let wins = 0, total = 0, tpHits = 0, stopHits = 0, eodExits = 0;
  for (const t of trades) {
    const isCalls = t.direction === 'calls';
    const dirSign = isCalls ? +1 : -1;
    const tpStrike = t.entrySpot * (1 + dirSign * tpBps / 10000);
    const stopStrike = t.stopStrike;

    let exit = null, ret = null;
    let pendingStopBars = 0;
    for (let i = 1; i < t.stream.length; i++) {
      const { spot } = t.stream[i];
      const tpHit = isCalls ? spot >= tpStrike : spot <= tpStrike;
      if (tpHit) { exit = 'tp'; ret = dirSign * (tpStrike - t.entrySpot) / t.entrySpot; break; }
      const stopBeyond = isCalls ? spot <= stopStrike : spot >= stopStrike;
      if (stopBeyond) {
        pendingStopBars++;
        if (pendingStopBars >= 1) { exit = 'stop'; ret = dirSign * (stopStrike - t.entrySpot) / t.entrySpot; break; }
      } else { pendingStopBars = 0; }
    }
    if (!exit) {
      exit = 'eod';
      const last = t.stream[t.stream.length - 1];
      ret = dirSign * (last.spot - t.entrySpot) / t.entrySpot;
    }
    if (ret > 0) wins++;
    total += ret * 10000;
    if (exit === 'tp') tpHits++;
    else if (exit === 'stop') stopHits++;
    else eodExits++;
  }
  const avgBps = total / trades.length;
  console.log(`  ${tpBps.toString().padStart(5)}  | ${String(wins).padStart(2)}/${trades.length} | ${avgBps.toFixed(2).padStart(7)} | ${total.toFixed(1).padStart(9)} | ${String(tpHits).padStart(7)} | ${String(stopHits).padStart(5)} | ${eodExits}`);
}

// ─── What if we ALSO loosened the stop while using fixed TP? ─────────────────
console.log('\n━━━ Grid: fixed TP × wider fixed-bps stop ━━━');
console.log('  TP_bps × stop_bps |  wins | avg_bps | total_bps | tp_hits | stops | eods');
console.log('  ──────────────────┼───────┼─────────┼───────────┼─────────┼───────┼─────');
for (const tpBps of [10, 15, 20]) {
  for (const stopBps of [10, 15, 20, 30]) {
    let wins = 0, total = 0, tpHits = 0, stopHits = 0, eodExits = 0;
    for (const t of trades) {
      const isCalls = t.direction === 'calls';
      const dirSign = isCalls ? +1 : -1;
      const tpStrike = t.entrySpot * (1 + dirSign * tpBps / 10000);
      const stopStrike = t.entrySpot * (1 - dirSign * stopBps / 10000);
      let exit = null, ret = null;
      let pendingStopBars = 0;
      for (let i = 1; i < t.stream.length; i++) {
        const { spot } = t.stream[i];
        const tpHit = isCalls ? spot >= tpStrike : spot <= tpStrike;
        if (tpHit) { exit = 'tp'; ret = tpBps / 10000; break; }
        const stopBeyond = isCalls ? spot <= stopStrike : spot >= stopStrike;
        if (stopBeyond) {
          pendingStopBars++;
          if (pendingStopBars >= 1) { exit = 'stop'; ret = -stopBps / 10000; break; }
        } else { pendingStopBars = 0; }
      }
      if (!exit) {
        exit = 'eod';
        const last = t.stream[t.stream.length - 1];
        ret = dirSign * (last.spot - t.entrySpot) / t.entrySpot;
      }
      if (ret > 0) wins++;
      total += ret * 10000;
      if (exit === 'tp') tpHits++;
      else if (exit === 'stop') stopHits++;
      else eodExits++;
    }
    const avgBps = total / trades.length;
    console.log(`  TP=${String(tpBps).padStart(2)} × stop=${String(stopBps).padStart(2)}  | ${String(wins).padStart(2)}/${trades.length} | ${avgBps.toFixed(2).padStart(7)} | ${total.toFixed(1).padStart(9)} | ${String(tpHits).padStart(7)} | ${String(stopHits).padStart(5)} | ${eodExits}`);
  }
}

db.close();
