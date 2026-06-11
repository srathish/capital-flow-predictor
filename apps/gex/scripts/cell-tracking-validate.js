#!/usr/bin/env node
/**
 * Phase 2 — validate the streak≥21 edge and run hysteresis P&L.
 *
 * Reads the signal log produced by cell-tracking-patterns.js, then:
 *   1. Splits 10 days into halves and recomputes hit-rate per bucket on each
 *      half. Out-of-sample sanity check.
 *   2. Adds avg signed move per bucket (hit-rate is necessary but not
 *      sufficient — magnitude × hit determines profitability).
 *   3. Runs a P&L backtest of the streak≥N rule for N ∈ {10, 15, 20, 25} with
 *      realistic transaction costs.
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'out');
const LOG_PATH = join(OUT_DIR, 'cell-tracking-signals.csv');

const HORIZONS = [5, 15, 30];
const FLIP_COST = { SPXW: 0.0008, SPY: 0.0005, QQQ: 0.0005 };

function loadSignals() {
  const text = readFileSync(LOG_PATH, 'utf-8');
  const [head, ...rows] = text.trim().split('\n');
  const cols = head.split(',');
  return rows.map(line => {
    const v = line.split(',');
    const o = {};
    cols.forEach((c, i) => (o[c] = v[i]));
    return {
      date: o.date,
      ticker: o.ticker,
      ts: o.ts,
      direction: parseInt(o.direction, 10),
      velocity: parseFloat(o.velocity),
      strike: parseFloat(o.strike),
      spot: parseFloat(o.spot),
      streak: parseInt(o.streak, 10),
      hour: parseInt(o.hour, 10),
      moves: HORIZONS.reduce((m, h) => {
        const v2 = o[`move_${h}m`];
        m[h] = v2 === '' ? null : parseFloat(v2);
        return m;
      }, {}),
    };
  });
}

function bucketStats(signals, horizon) {
  const wins = signals.filter(s => s.moves[horizon] != null && Math.sign(s.moves[horizon]) === s.direction).length;
  const total = signals.filter(s => s.moves[horizon] != null).length;
  const moves = signals.filter(s => s.moves[horizon] != null).map(s => s.direction * s.moves[horizon]);
  const avgSigned = moves.length ? moves.reduce((a, b) => a + b, 0) / moves.length : 0;
  return {
    n: total,
    hitRate: total > 0 ? wins / total : 0,
    avgSignedMove: avgSigned,
    expectancyBps: avgSigned * 10000, // basis points
  };
}

function streakBucket(s) {
  if (s.streak <= 1) return '1';
  if (s.streak === 2) return '2';
  if (s.streak <= 5) return '3-5';
  if (s.streak <= 10) return '6-10';
  if (s.streak <= 20) return '11-20';
  return '21+';
}

function reportOOS(signals) {
  const allDates = [...new Set(signals.map(s => s.date))].sort();
  const half = Math.ceil(allDates.length / 2);
  const firstHalf = new Set(allDates.slice(0, half));
  const secondHalf = new Set(allDates.slice(half));
  console.log(`\n  First half:  ${[...firstHalf].join(', ')}`);
  console.log(`  Second half: ${[...secondHalf].join(', ')}`);

  const buckets = ['1', '2', '3-5', '6-10', '11-20', '21+'];
  console.log(`\n  ${'streak'.padEnd(8)} ${'half'.padEnd(6)} ${'n'.padStart(5)}  hit@5  hit@15 hit@30  bps@5  bps@15 bps@30`);
  for (const b of buckets) {
    for (const [name, set] of [['1st', firstHalf], ['2nd', secondHalf]]) {
      const subset = signals.filter(s => streakBucket(s) === b && set.has(s.date));
      const s5 = bucketStats(subset, 5);
      const s15 = bucketStats(subset, 15);
      const s30 = bucketStats(subset, 30);
      console.log(
        `  ${b.padEnd(8)} ${name.padEnd(6)} ${String(s5.n).padStart(5)}  ` +
        `${(s5.hitRate*100).toFixed(1).padStart(5)}% ${(s15.hitRate*100).toFixed(1).padStart(5)}% ${(s30.hitRate*100).toFixed(1).padStart(5)}%  ` +
        `${s5.expectancyBps.toFixed(1).padStart(5)} ${s15.expectancyBps.toFixed(1).padStart(5)} ${s30.expectancyBps.toFixed(1).padStart(5)}`
      );
    }
  }
}

function reportMagnitude(signals) {
  const buckets = ['1', '2', '3-5', '6-10', '11-20', '21+'];
  console.log(`\n  ${'streak'.padEnd(8)} ${'n'.padStart(5)}  hit@30  avgSignedMove@30  bps`);
  for (const b of buckets) {
    const subset = signals.filter(s => streakBucket(s) === b);
    const st = bucketStats(subset, 30);
    console.log(
      `  ${b.padEnd(8)} ${String(st.n).padStart(5)}  ${(st.hitRate*100).toFixed(1).padStart(5)}%   ` +
      `${(st.avgSignedMove*100).toFixed(3).padStart(7)}%        ${st.expectancyBps.toFixed(1).padStart(5)}`
    );
  }
}

/**
 * P&L sim with streak≥N entry rule.
 *
 * Strategy: enter position the FIRST frame the signal crosses streak threshold N.
 * Hold for HOLD_MINUTES. Exit. Don't re-enter until streak crosses threshold
 * again in some direction (with a fresh streak count).
 *
 * This is a simulator over the signal log, NOT the original frames, so we use
 * each signal's recorded move_30m as the realized return.
 */
function pnlBacktest(signals, threshold, holdMin) {
  // Group by date+ticker to process sequentially
  const groups = new Map();
  for (const s of signals) {
    const key = `${s.date}|${s.ticker}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }

  const trades = [];
  for (const [key, arr] of groups) {
    const [, ticker] = key.split('|');
    const cost = FLIP_COST[ticker] ?? 0.0005;

    arr.sort((a, b) => a.ts.localeCompare(b.ts));
    let cooldownUntil = null;

    for (const s of arr) {
      if (cooldownUntil && s.ts <= cooldownUntil) continue;
      if (s.streak < threshold) continue;
      if (s.moves[holdMin] == null) continue;
      // Trade: enter at s.ts, exit holdMin later
      const pnl = s.direction * s.moves[holdMin] - cost; // round-trip cost in/out
      trades.push({
        date: s.date,
        ticker,
        ts: s.ts,
        direction: s.direction,
        streak: s.streak,
        pnl,
        rawMove: s.direction * s.moves[holdMin],
      });
      // Cooldown = exit time (next holdMin frames)
      const exitTime = new Date(new Date(s.ts).getTime() + holdMin * 60000).toISOString();
      cooldownUntil = exitTime;
    }
  }

  return trades;
}

function reportPnL(signals) {
  console.log(`\n  hold horizon: 30 min  |  cost: SPX 8bps round-trip, SPY/QQQ 5bps\n`);
  const headers = ['threshold', 'n_trades', 'win_rate', 'avg_pnl_bps', 'cum_pnl_pct', 'best_trade_bps', 'worst_trade_bps', 'sharpe'];
  console.log('  ' + headers.map(h => h.padEnd(14)).join(''));

  for (const threshold of [5, 10, 15, 20, 25]) {
    const trades = pnlBacktest(signals, threshold, 30);
    if (!trades.length) { console.log(`  threshold=${threshold}: no trades`); continue; }
    const wins = trades.filter(t => t.pnl > 0).length;
    const avg = trades.reduce((a, t) => a + t.pnl, 0) / trades.length;
    const cum = trades.reduce((a, t) => a + t.pnl, 0);
    const best = Math.max(...trades.map(t => t.pnl));
    const worst = Math.min(...trades.map(t => t.pnl));
    const variance = trades.reduce((a, t) => a + (t.pnl - avg) ** 2, 0) / trades.length;
    const sharpe = variance > 0 ? avg / Math.sqrt(variance) : 0;
    console.log(
      `  ` +
      `≥${threshold}`.padEnd(14) +
      String(trades.length).padEnd(14) +
      `${(wins/trades.length*100).toFixed(1)}%`.padEnd(14) +
      `${(avg*10000).toFixed(1)}`.padEnd(14) +
      `${(cum*100).toFixed(2)}%`.padEnd(14) +
      `${(best*10000).toFixed(1)}`.padEnd(14) +
      `${(worst*10000).toFixed(1)}`.padEnd(14) +
      `${sharpe.toFixed(3)}`.padEnd(14)
    );
  }

  // Break threshold=20 down by ticker since SPX showed best cohort
  console.log('\n  Threshold=20 breakdown by ticker:');
  const trades = pnlBacktest(signals, 20, 30);
  for (const ticker of ['SPXW', 'SPY', 'QQQ']) {
    const t = trades.filter(x => x.ticker === ticker);
    if (!t.length) continue;
    const wins = t.filter(x => x.pnl > 0).length;
    const avg = t.reduce((a, x) => a + x.pnl, 0) / t.length;
    const cum = t.reduce((a, x) => a + x.pnl, 0);
    console.log(
      `    ${ticker.padEnd(5)}  n=${String(t.length).padStart(3)}  win=${(wins/t.length*100).toFixed(1)}%  ` +
      `avgPnL=${(avg*10000).toFixed(1)}bps  cumPnL=${(cum*100).toFixed(2)}%`
    );
  }

  // And threshold=20 LONG vs SHORT
  console.log('\n  Threshold=20 LONG vs SHORT:');
  for (const dir of [1, -1]) {
    const t = trades.filter(x => x.direction === dir);
    if (!t.length) continue;
    const wins = t.filter(x => x.pnl > 0).length;
    const avg = t.reduce((a, x) => a + x.pnl, 0) / t.length;
    const cum = t.reduce((a, x) => a + x.pnl, 0);
    console.log(
      `    ${dir === 1 ? 'LONG ' : 'SHORT'}  n=${String(t.length).padStart(3)}  win=${(wins/t.length*100).toFixed(1)}%  ` +
      `avgPnL=${(avg*10000).toFixed(1)}bps  cumPnL=${(cum*100).toFixed(2)}%`
    );
  }
}

function main() {
  const signals = loadSignals();
  console.log(`\n▶ Phase 2 validation on ${signals.length} signals\n`);

  console.log('════════════ OUT-OF-SAMPLE: 5+5 split ════════════');
  reportOOS(signals);

  console.log('\n════════════ MAGNITUDE: avg signed move per streak bucket (30-min horizon) ════════════');
  reportMagnitude(signals);

  console.log('\n════════════ P&L BACKTEST: streak ≥ N, exit at +30min ════════════');
  reportPnL(signals);

  console.log('');
}

main();
