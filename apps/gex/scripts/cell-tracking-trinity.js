#!/usr/bin/env node
/**
 * Phase 4 — per-ticker breakdown + cross-ticker confluence ("trinity").
 *
 * Reads cell-tracking-deep-signals.csv (15K signals across SPX/SPY/QQQ × GEX/VEX)
 * and answers:
 *
 *   1. Per-ticker: does the streak≥N edge hold across all three, or is it only
 *      SPX? Breakdown by streak bucket × horizon, GEX and VEX separately.
 *
 *   2. Confluence: when SPX + SPY + QQQ ALL show streak≥N same-direction at the
 *      same minute, what is the hit-rate and P&L? This is the cell-tracking
 *      analog of the existing trinity layer.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'out');
const LOG_PATH = join(OUT_DIR, 'cell-tracking-deep-signals.csv');

const HORIZONS = [5, 15, 30, 60, 120];
const FLIP_COST = { SPXW: 0.0008, SPY: 0.0005, QQQ: 0.0005 };
const TRINITY_COST = 0.0006; // avg across tickers, applied per ticker leg

function loadSignals() {
  const text = readFileSync(LOG_PATH, 'utf-8');
  const [head, ...rows] = text.trim().split('\n');
  const cols = head.split(',');
  return rows.map(line => {
    const v = line.split(',');
    const o = {};
    cols.forEach((c, i) => (o[c] = v[i]));
    const moves = {};
    for (const h of HORIZONS) {
      const raw = o[`move_${h}m`];
      moves[h] = raw === '' ? null : parseFloat(raw);
    }
    moves.EOD = o.move_EOD === '' ? null : parseFloat(o.move_EOD);
    return {
      date: o.date,
      ticker: o.ticker,
      greek: o.greek,
      ts: o.ts,
      direction: parseInt(o.direction, 10),
      streak: parseInt(o.streak, 10),
      moves,
    };
  });
}

function streakBucket(streak) {
  if (streak <= 1) return '1';
  if (streak === 2) return '2';
  if (streak <= 5) return '3-5';
  if (streak <= 10) return '6-10';
  if (streak <= 20) return '11-20';
  return '21+';
}

function bucketStats(signals, horizon) {
  const valid = signals.filter(s => s.moves[horizon] != null);
  if (!valid.length) return { n: 0, hitRate: 0, expectancyBps: 0 };
  const wins = valid.filter(s => Math.sign(s.moves[horizon]) === s.direction).length;
  const avg = valid.reduce((a, s) => a + s.direction * s.moves[horizon], 0) / valid.length;
  return { n: valid.length, hitRate: wins / valid.length, expectancyBps: avg * 10000 };
}

function reportPerTicker(signals) {
  const buckets = ['1', '2', '3-5', '6-10', '11-20', '21+'];
  for (const greek of ['gamma', 'vanna']) {
    console.log(`\n  ── ${greek.toUpperCase()} ──`);
    console.log(`  ${'ticker'.padEnd(6)} ${'streak'.padEnd(8)} ${'n'.padStart(5)}  hit@30  hit@60 hit@EOD  bps@30  bps@60  bpsEOD`);
    for (const ticker of ['SPXW', 'SPY', 'QQQ']) {
      for (const b of buckets) {
        const arr = signals.filter(s => s.greek === greek && s.ticker === ticker && streakBucket(s.streak) === b);
        if (!arr.length) continue;
        const s30 = bucketStats(arr, 30);
        const s60 = bucketStats(arr, 60);
        const sE = bucketStats(arr, 'EOD');
        console.log(
          `  ${ticker.padEnd(6)} ${b.padEnd(8)} ${String(arr.length).padStart(5)}  ` +
          `${(s30.hitRate*100).toFixed(1).padStart(4)}%  ${(s60.hitRate*100).toFixed(1).padStart(4)}%  ` +
          `${(sE.hitRate*100).toFixed(1).padStart(4)}%   ` +
          `${s30.expectancyBps.toFixed(1).padStart(5)}   ${s60.expectancyBps.toFixed(1).padStart(5)}   ` +
          `${sE.expectancyBps.toFixed(1).padStart(5)}`
        );
      }
      console.log('');
    }
  }
}

function reportPerTickerPnL(signals) {
  const thresholds = [10, 15, 20, 25];
  const holds = [60, 120, 'EOD'];

  for (const greek of ['gamma', 'vanna']) {
    console.log(`\n  ── ${greek.toUpperCase()} P&L (cumulative %, n_trades, win%) ──`);
    console.log(`  ${'ticker'.padEnd(6)} ${'thr'.padEnd(5)} ` + holds.map(h => String(h).padStart(20)).join(''));
    for (const ticker of ['SPXW', 'SPY', 'QQQ']) {
      for (const t of thresholds) {
        const cells = [`  ${ticker.padEnd(6)} ≥${t}`.padEnd(14)];
        for (const h of holds) {
          const subset = signals.filter(s => s.greek === greek && s.ticker === ticker);
          const trades = simulateTrades(subset, ticker, t, h);
          if (!trades.length) { cells.push('—'.padStart(20)); continue; }
          const cum = trades.reduce((a, x) => a + x.pnl, 0);
          const wins = trades.filter(x => x.pnl > 0).length;
          cells.push((`${(cum*100).toFixed(2)}% (${trades.length}, ${(wins/trades.length*100).toFixed(0)}%)`).padStart(20));
        }
        console.log(cells.join(''));
      }
      console.log('');
    }
  }
}

function simulateTrades(signals, ticker, threshold, holdMin) {
  // Group by date to apply cooldown within day
  const byDate = new Map();
  for (const s of signals) {
    if (!byDate.has(s.date)) byDate.set(s.date, []);
    byDate.get(s.date).push(s);
  }
  const cost = FLIP_COST[ticker] ?? 0.0005;
  const trades = [];
  for (const arr of byDate.values()) {
    arr.sort((a, b) => a.ts.localeCompare(b.ts));
    let cooldownUntil = null;
    for (const s of arr) {
      if (cooldownUntil && s.ts <= cooldownUntil) continue;
      if (s.streak < threshold) continue;
      if (s.moves[holdMin] == null) continue;
      const pnl = s.direction * s.moves[holdMin] - cost;
      trades.push({ pnl, direction: s.direction });
      const exitMs = holdMin === 'EOD' ? Infinity : holdMin * 60000;
      cooldownUntil = exitMs === Infinity ? '9999' : new Date(new Date(s.ts).getTime() + exitMs).toISOString();
    }
  }
  return trades;
}

/**
 * Confluence: at each (date, ts), find if ALL THREE tickers agree on a direction
 * with streak ≥ N. Emit a trinity-signal. Score by avg of the three tickers'
 * subsequent moves at each horizon.
 */
function buildConfluenceSignals(signals, greek, threshold, requireAll) {
  // Index by (date, ts) → {ticker: signal}
  const byMinute = new Map();
  for (const s of signals.filter(x => x.greek === greek && x.streak >= threshold)) {
    const key = `${s.date}|${s.ts}`;
    if (!byMinute.has(key)) byMinute.set(key, {});
    byMinute.get(key)[s.ticker] = s;
  }
  const out = [];
  for (const [key, obj] of byMinute) {
    const tickers = Object.keys(obj);
    if (requireAll && tickers.length < 3) continue;
    if (!requireAll && tickers.length < 2) continue;

    // Need majority direction agreement
    const dirs = tickers.map(t => obj[t].direction);
    const sum = dirs.reduce((a, b) => a + b, 0);
    if (requireAll && Math.abs(sum) !== 3) continue; // need unanimous
    if (!requireAll && Math.abs(sum) < 2) continue;  // need 2-of-N agreement
    const direction = Math.sign(sum);

    // Avg move across the agreeing tickers' SPY (use SPY as primary proxy)
    const [date, ts] = key.split('|');
    const moves = {};
    for (const h of [...HORIZONS, 'EOD']) {
      const vals = tickers.filter(t => obj[t].direction === direction).map(t => obj[t].moves[h]).filter(v => v != null);
      moves[h] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    }
    out.push({ date, ts, direction, tickers, moves });
  }
  return out;
}

function reportConfluence(signals) {
  console.log(`\n  ── 3-of-3 unanimous confluence (all SPXW + SPY + QQQ same dir + streak ≥ N) ──`);
  for (const greek of ['gamma', 'vanna']) {
    console.log(`\n  ${greek.toUpperCase()}:`);
    for (const threshold of [5, 10, 15, 20]) {
      const conf = buildConfluenceSignals(signals, greek, threshold, true);
      if (!conf.length) { console.log(`    ≥${threshold}: 0 minutes of unanimous confluence`); continue; }
      const stats = (h) => {
        const valid = conf.filter(c => c.moves[h] != null);
        const wins = valid.filter(c => Math.sign(c.moves[h]) === c.direction).length;
        const avg = valid.length ? valid.reduce((a, c) => a + c.direction * c.moves[h], 0) / valid.length : 0;
        return { n: valid.length, hit: valid.length ? wins / valid.length : 0, bps: avg * 10000 };
      };
      const s30 = stats(30), s60 = stats(60), sE = stats('EOD');
      console.log(
        `    ≥${String(threshold).padEnd(3)}  n=${String(conf.length).padStart(4)}  ` +
        `hit@30=${(s30.hit*100).toFixed(1).padStart(4)}% (bps ${s30.bps.toFixed(1).padStart(5)})  ` +
        `hit@60=${(s60.hit*100).toFixed(1).padStart(4)}% (bps ${s60.bps.toFixed(1).padStart(5)})  ` +
        `hitEOD=${(sE.hit*100).toFixed(1).padStart(4)}% (bps ${sE.bps.toFixed(1).padStart(5)})`
      );
    }
  }

  console.log(`\n  ── 2-of-3 majority confluence (any 2+ tickers agree + streak ≥ N) ──`);
  for (const greek of ['gamma', 'vanna']) {
    console.log(`\n  ${greek.toUpperCase()}:`);
    for (const threshold of [5, 10, 15, 20]) {
      const conf = buildConfluenceSignals(signals, greek, threshold, false);
      if (!conf.length) { console.log(`    ≥${threshold}: 0 minutes of majority confluence`); continue; }
      const stats = (h) => {
        const valid = conf.filter(c => c.moves[h] != null);
        const wins = valid.filter(c => Math.sign(c.moves[h]) === c.direction).length;
        const avg = valid.length ? valid.reduce((a, c) => a + c.direction * c.moves[h], 0) / valid.length : 0;
        return { n: valid.length, hit: valid.length ? wins / valid.length : 0, bps: avg * 10000 };
      };
      const s30 = stats(30), s60 = stats(60), sE = stats('EOD');
      console.log(
        `    ≥${String(threshold).padEnd(3)}  n=${String(conf.length).padStart(4)}  ` +
        `hit@30=${(s30.hit*100).toFixed(1).padStart(4)}% (bps ${s30.bps.toFixed(1).padStart(5)})  ` +
        `hit@60=${(s60.hit*100).toFixed(1).padStart(4)}% (bps ${s60.bps.toFixed(1).padStart(5)})  ` +
        `hitEOD=${(sE.hit*100).toFixed(1).padStart(4)}% (bps ${sE.bps.toFixed(1).padStart(5)})`
      );
    }
  }
}

function reportConfluencePnL(signals) {
  console.log(`\n  Confluence P&L: enter on first unanimous-confluence frame, hold to horizon, exit.`);
  console.log(`  One trade per confluence event (cooldown until exit). Cost = 6 bps avg.`);

  for (const greek of ['gamma', 'vanna']) {
    console.log(`\n  ── ${greek.toUpperCase()} ──`);
    console.log(`  ${'thr'.padEnd(6)} ${'horizon'.padEnd(10)} ${'n'.padStart(4)}  ${'win%'.padStart(6)}  ${'cumPnL%'.padStart(10)}  ${'avg bps'.padStart(8)}`);
    for (const threshold of [5, 10, 15, 20]) {
      for (const h of [30, 60, 120, 'EOD']) {
        const conf = buildConfluenceSignals(signals, greek, threshold, true);
        // Sort and apply cooldown
        const byDate = new Map();
        for (const c of conf) {
          if (!byDate.has(c.date)) byDate.set(c.date, []);
          byDate.get(c.date).push(c);
        }
        const trades = [];
        for (const arr of byDate.values()) {
          arr.sort((a, b) => a.ts.localeCompare(b.ts));
          let cooldownUntil = null;
          for (const c of arr) {
            if (cooldownUntil && c.ts <= cooldownUntil) continue;
            if (c.moves[h] == null) continue;
            const pnl = c.direction * c.moves[h] - TRINITY_COST;
            trades.push(pnl);
            const exitMs = h === 'EOD' ? Infinity : h * 60000;
            cooldownUntil = exitMs === Infinity ? '9999' : new Date(new Date(c.ts).getTime() + exitMs).toISOString();
          }
        }
        if (!trades.length) continue;
        const cum = trades.reduce((a, b) => a + b, 0);
        const wins = trades.filter(p => p > 0).length;
        const avg = cum / trades.length;
        console.log(
          `  ≥${String(threshold).padEnd(5)} ${String(h).padEnd(10)} ${String(trades.length).padStart(4)}  ` +
          `${(wins/trades.length*100).toFixed(1).padStart(5)}%  ` +
          `${(cum*100).toFixed(2).padStart(9)}%  ` +
          `${(avg*10000).toFixed(1).padStart(7)}`
        );
      }
    }
  }
}

function main() {
  const signals = loadSignals();
  console.log(`\n▶ Phase 4 — per-ticker + confluence analysis on ${signals.length} signals\n`);

  console.log('════════════ PER-TICKER HIT-RATE & EXPECTANCY ════════════');
  reportPerTicker(signals);

  console.log('\n════════════ PER-TICKER P&L (after costs) ════════════');
  reportPerTickerPnL(signals);

  console.log('\n════════════ CROSS-TICKER CONFLUENCE HIT-RATE ════════════');
  reportConfluence(signals);

  console.log('\n════════════ CONFLUENCE P&L ════════════');
  reportConfluencePnL(signals);

  console.log('');
}

main();
