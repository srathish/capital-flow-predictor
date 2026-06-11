#!/usr/bin/env node
/**
 * Phase 3 — deep pattern + P&L on GEX and VEX cells.
 *
 * Adds vs cell-tracking-patterns.js:
 *   • Tracks VEX (vanna) cells in parallel with GEX (gamma) cells
 *   • Longer horizons: 5, 15, 30, 60, 120 min, plus EOD (last frame)
 *   • Magnitude reporting alongside hit-rate
 *   • Final P&L: entry at first streak≥N frame, exits at each horizon
 *
 * Hypothesis from prior runs: GEX streak≥21 has real out-of-sample hit-rate
 * (~60% at 15min) but magnitude (2.9 bps at 30min) is too small to overcome
 * underlying transaction cost. Either VEX has better magnitudes, or longer
 * horizons amplify the move enough to be tradeable.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPLAY_DIR = '/Users/saiyeeshrathish/gex-data-replay-reader/data';
const OUT_DIR = join(__dirname, 'out');
const TICKERS = ['SPXW', 'SPY', 'QQQ'];

const VEL_WINDOW_FRAMES = 5;
const PROXIMITY_PCT = 0.02;
const MIN_ABS_VALUE = { gamma: 1e6, vanna: 1e6 };
const HORIZONS = [5, 15, 30, 60, 120]; // minutes; EOD added separately

const FLIP_COST = { SPXW: 0.0008, SPY: 0.0005, QQQ: 0.0005 };

function loadReplay(path) {
  const raw = JSON.parse(readFileSync(path, 'utf-8'));
  const out = {};
  for (const ticker of TICKERS) {
    const frames = [];
    for (const f of raw.frames) {
      const t = f.tickers[ticker];
      if (!t || !t.spotPrice || !Array.isArray(t.gammaValues)) continue;
      frames.push({
        ts: f.timestamp,
        spot: t.spotPrice,
        strikes: t.strikes,
        gamma: t.gammaValues,
        vanna: t.vannaValues,
      });
    }
    out[ticker] = frames;
  }
  return out;
}

/**
 * Cell predictor parameterized by which greek to track.
 * Same logic: fastest growing positive cell within proximity → direction.
 * (For vanna, "positive" means dealer short-vol-bias growing in that direction.)
 */
function makeCellPredictor(greek) {
  let history = null;
  const minAbs = MIN_ABS_VALUE[greek];

  return function predict(frame) {
    const { spot, strikes } = frame;
    const grid = frame[greek]; // [strikeIdx][expIdx]
    if (!grid) return { direction: 0, velocity: 0, strike: null };

    if (!history || strikes.length !== history.length) {
      history = strikes.map(() =>
        Array.from({ length: grid[0]?.length || 0 }, () => [])
      );
    }
    const expLimit = grid[0]?.length || 0;

    for (let si = 0; si < grid.length; si++) {
      const row = grid[si];
      if (!row) continue;
      for (let ei = 0; ei < expLimit; ei++) {
        const buf = history[si][ei];
        buf.push(row[ei] ?? 0);
        if (buf.length > VEL_WINDOW_FRAMES + 1) buf.shift();
      }
    }

    if (history[0]?.[0]?.length < VEL_WINDOW_FRAMES + 1) {
      return { direction: 0, velocity: 0, strike: null };
    }

    let bestScore = 0;
    let bestStrike = null;
    const proximity = spot * PROXIMITY_PCT;

    for (let si = 0; si < strikes.length; si++) {
      const strike = strikes[si];
      if (Math.abs(strike - spot) > proximity) continue;

      for (let ei = 0; ei < expLimit; ei++) {
        const buf = history[si][ei];
        if (buf.length < VEL_WINDOW_FRAMES + 1) continue;
        const now = buf[buf.length - 1];
        const then = buf[0];
        if (now <= minAbs) continue;
        const delta = now - then;
        if (delta <= 0) continue;
        if (delta > bestScore) {
          bestScore = delta;
          bestStrike = strike;
        }
      }
    }

    if (bestStrike == null) return { direction: 0, velocity: 0, strike: null };
    const diff = bestStrike - spot;
    if (Math.abs(diff) < 0.5) return { direction: 0, velocity: bestScore, strike: bestStrike };
    return { direction: diff > 0 ? 1 : -1, velocity: bestScore, strike: bestStrike };
  };
}

function streakBucket(streak) {
  if (streak <= 1) return '1';
  if (streak === 2) return '2';
  if (streak <= 5) return '3-5';
  if (streak <= 10) return '6-10';
  if (streak <= 20) return '11-20';
  return '21+';
}

function runDay(date, allSignals) {
  const path = join(REPLAY_DIR, `gex-replay-${date}.json`);
  if (!existsSync(path)) return;
  const byTicker = loadReplay(path);

  for (const ticker of TICKERS) {
    const frames = byTicker[ticker];
    if (!frames || frames.length < VEL_WINDOW_FRAMES + Math.max(...HORIZONS) + 2) continue;
    const eodSpot = frames[frames.length - 1].spot;

    for (const greek of ['gamma', 'vanna']) {
      const predictor = makeCellPredictor(greek);
      let prevDir = 0;
      let streak = 0;

      for (let i = 0; i < frames.length; i++) {
        const { direction, velocity, strike } = predictor(frames[i]);
        if (direction === 0) { prevDir = 0; streak = 0; continue; }
        if (direction === prevDir) streak++;
        else streak = 1;
        prevDir = direction;

        const moves = {};
        for (const h of HORIZONS) {
          if (i + h < frames.length) moves[h] = (frames[i + h].spot - frames[i].spot) / frames[i].spot;
        }
        moves.EOD = (eodSpot - frames[i].spot) / frames[i].spot;

        allSignals.push({
          date, ticker, greek,
          ts: frames[i].ts,
          direction, velocity, strike,
          spot: frames[i].spot,
          streak,
          moves,
        });
      }
    }
  }
}

function bucketStats(signals, horizon) {
  const valid = signals.filter(s => s.moves[horizon] != null);
  if (!valid.length) return { n: 0, hitRate: 0, avgSignedMove: 0, expectancyBps: 0 };
  const wins = valid.filter(s => Math.sign(s.moves[horizon]) === s.direction).length;
  const avgSigned = valid.reduce((a, s) => a + s.direction * s.moves[horizon], 0) / valid.length;
  return {
    n: valid.length,
    hitRate: wins / valid.length,
    avgSignedMove: avgSigned,
    expectancyBps: avgSigned * 10000,
  };
}

function reportGreekTable(signals, greek) {
  const subset = signals.filter(s => s.greek === greek);
  console.log(`\n  ── ${greek.toUpperCase()} (n=${subset.length} total signals) ──`);
  console.log(`  ${'streak'.padEnd(8)} ${'n'.padStart(5)}   hit@5  hit@30  hit@60 hit@EOD   bps@5  bps@30  bps@60  bpsEOD`);
  for (const b of ['1', '2', '3-5', '6-10', '11-20', '21+']) {
    const arr = subset.filter(s => streakBucket(s.streak) === b);
    const s5 = bucketStats(arr, 5);
    const s30 = bucketStats(arr, 30);
    const s60 = bucketStats(arr, 60);
    const sE = bucketStats(arr, 'EOD');
    console.log(
      `  ${b.padEnd(8)} ${String(arr.length).padStart(5)}   ` +
      `${(s5.hitRate*100).toFixed(1).padStart(4)}%  ${(s30.hitRate*100).toFixed(1).padStart(4)}%  ` +
      `${(s60.hitRate*100).toFixed(1).padStart(4)}%  ${(sE.hitRate*100).toFixed(1).padStart(4)}%   ` +
      `${s5.expectancyBps.toFixed(1).padStart(5)}   ${s30.expectancyBps.toFixed(1).padStart(5)}   ` +
      `${s60.expectancyBps.toFixed(1).padStart(5)}   ${sE.expectancyBps.toFixed(1).padStart(5)}`
    );
  }
}

function pnlBacktest(signals, greek, threshold, holdMin) {
  const groups = new Map();
  for (const s of signals.filter(x => x.greek === greek)) {
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
      const pnl = s.direction * s.moves[holdMin] - cost;
      trades.push({ date: s.date, ticker, direction: s.direction, pnl, rawMove: s.direction * s.moves[holdMin] });
      const exitMs = holdMin === 'EOD' ? Infinity : holdMin * 60000;
      cooldownUntil = exitMs === Infinity ? '9999' : new Date(new Date(s.ts).getTime() + exitMs).toISOString();
    }
  }
  return trades;
}

function reportPnLMatrix(signals) {
  console.log(`\n  Streak threshold × hold horizon → cumulative P&L (after costs)`);
  console.log(`  Format: cumPnL% (n_trades, win%)\n`);

  const thresholds = [5, 10, 15, 20, 25];
  const holds = [30, 60, 120, 'EOD'];

  for (const greek of ['gamma', 'vanna']) {
    console.log(`  ── ${greek.toUpperCase()} ──`);
    console.log(`  ${'thr'.padEnd(6)} ` + holds.map(h => String(h).padStart(20)).join(''));
    for (const t of thresholds) {
      const cells = [`≥${t}`.padEnd(6) + ' '];
      for (const h of holds) {
        const trades = pnlBacktest(signals, greek, t, h);
        if (!trades.length) { cells.push('—'.padStart(20)); continue; }
        const cum = trades.reduce((a, x) => a + x.pnl, 0);
        const wins = trades.filter(x => x.pnl > 0).length;
        cells.push(
          (`${(cum*100).toFixed(2)}% (${trades.length}, ${(wins/trades.length*100).toFixed(0)}%)`).padStart(20)
        );
      }
      console.log(cells.join(''));
    }
    console.log('');
  }
}

function main() {
  const nDays = parseInt(process.argv[2] || '10', 10);
  mkdirSync(OUT_DIR, { recursive: true });

  const files = readdirSync(REPLAY_DIR)
    .filter(f => /^gex-replay-\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
  const recent = files.slice(-nDays).map(f => f.match(/(\d{4}-\d{2}-\d{2})/)[1]);

  console.log(`\n▶ Phase 3 deep analysis: ${recent.length} days, GEX + VEX, horizons 5-120m + EOD\n`);

  const signals = [];
  for (const date of recent) runDay(date, signals);

  console.log(`Total signals: ${signals.length}`);
  console.log(`  GEX: ${signals.filter(s => s.greek === 'gamma').length}`);
  console.log(`  VEX: ${signals.filter(s => s.greek === 'vanna').length}`);

  console.log('\n════════════ HIT-RATE & EXPECTANCY by streak × horizon ════════════');
  reportGreekTable(signals, 'gamma');
  reportGreekTable(signals, 'vanna');

  console.log('\n════════════ P&L MATRIX (underlying-equivalent, after costs) ════════════');
  reportPnLMatrix(signals);

  // Write combined log
  const logPath = join(OUT_DIR, 'cell-tracking-deep-signals.csv');
  const header = ['date', 'ticker', 'greek', 'ts', 'direction', 'velocity', 'strike', 'spot', 'streak',
    ...HORIZONS.map(h => `move_${h}m`), 'move_EOD'].join(',');
  const lines = [header];
  for (const s of signals) {
    lines.push([
      s.date, s.ticker, s.greek, s.ts, s.direction, s.velocity.toFixed(0), s.strike, s.spot.toFixed(4), s.streak,
      ...HORIZONS.map(h => s.moves[h] != null ? s.moves[h].toFixed(6) : ''),
      s.moves.EOD != null ? s.moves.EOD.toFixed(6) : '',
    ].join(','));
  }
  writeFileSync(logPath, lines.join('\n'));
  console.log(`\nFull signal log: ${logPath}\n`);
}

main();
