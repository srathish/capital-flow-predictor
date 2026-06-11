#!/usr/bin/env node
/**
 * Cell-tracking PATTERN analysis.
 *
 * The naive cell-velocity backtest got murdered by transaction costs (~80-110
 * flips/day). But that doesn't mean the underlying signal is worthless — it
 * might have edge that's getting buried in friction.
 *
 * This script runs the same per-cell velocity rule but ignores P&L. Instead, for
 * each emitted directional signal it asks: did spot actually move in that
 * direction over the next 5 / 15 / 30 minutes? That's the cost-free hit-rate.
 *
 * Then it breaks hit-rate down by:
 *   • signal streak length (how many consecutive frames called the same way)
 *   • winning-cell velocity quartile (small Δgamma vs large Δgamma)
 *   • hour of US trading day (open vs mid vs close)
 *
 * If hit-rate is ~50% across the board → signal is noise, abandon.
 * If certain buckets beat ~55% → there's an exploitable subset.
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
const MIN_ABS_GAMMA = 1e6;
const HORIZONS = [5, 15, 30]; // minutes

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
      });
    }
    out[ticker] = frames;
  }
  return out;
}

/**
 * Same predictor as backtest but returns {direction, velocity} so we can bucket
 * by signal strength.
 */
function makeCellPredictor() {
  let history = null;

  return function predict(frame) {
    const { spot, strikes, gamma } = frame;

    if (!history || strikes.length !== history.length) {
      history = strikes.map(() =>
        Array.from({ length: gamma[0]?.length || 0 }, () => [])
      );
    }
    const expLimit = gamma[0]?.length || 0;

    for (let si = 0; si < gamma.length; si++) {
      const row = gamma[si];
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
        if (now <= MIN_ABS_GAMMA) continue;
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
    return {
      direction: diff > 0 ? 1 : -1,
      velocity: bestScore,
      strike: bestStrike,
    };
  };
}

function hourOfET(tsString) {
  // Frames are UTC. US RTH 13:30-20:00 UTC = 9:30-16:00 ET (no DST handling
  // since replays span periods where ET is variably UTC-5 or UTC-4; close
  // enough for pattern bucketing).
  const utcHour = new Date(tsString).getUTCHours();
  return utcHour - 4; // approximate ET hour (will be off by 1 around DST flip)
}

function quartile(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  return [0.25, 0.5, 0.75].map(q => sorted[Math.floor(sorted.length * q)]);
}

function runDay(date, allSignals) {
  const path = join(REPLAY_DIR, `gex-replay-${date}.json`);
  if (!existsSync(path)) return;

  const byTicker = loadReplay(path);
  for (const ticker of TICKERS) {
    const frames = byTicker[ticker];
    if (!frames || frames.length < VEL_WINDOW_FRAMES + Math.max(...HORIZONS) + 2) continue;

    const predictor = makeCellPredictor();
    let prevDir = 0;
    let streak = 0;

    for (let i = 0; i < frames.length; i++) {
      const { direction, velocity, strike } = predictor(frames[i]);
      if (direction === 0) {
        prevDir = 0;
        streak = 0;
        continue;
      }
      if (direction === prevDir) streak++;
      else streak = 1;
      prevDir = direction;

      // Compute spot moves at each horizon (cost-free)
      const moves = {};
      for (const h of HORIZONS) {
        if (i + h < frames.length) {
          moves[h] = (frames[i + h].spot - frames[i].spot) / frames[i].spot;
        }
      }

      allSignals.push({
        date,
        ticker,
        ts: frames[i].ts,
        direction,
        velocity,
        strike,
        spot: frames[i].spot,
        streak,
        hour: hourOfET(frames[i].ts),
        moves,
      });
    }
  }
}

function reportBucket(label, signals, bucketFn, bucketLabels) {
  console.log(`\n  ── ${label} ──`);
  const buckets = new Map();
  for (const s of signals) {
    const b = bucketFn(s);
    if (!buckets.has(b)) buckets.set(b, []);
    buckets.get(b).push(s);
  }
  const keys = [...buckets.keys()].sort((a, b) => (typeof a === 'number' ? a - b : String(a).localeCompare(b)));
  for (const k of keys) {
    const arr = buckets.get(k);
    const counts = {};
    for (const h of HORIZONS) {
      const valid = arr.filter(s => s.moves[h] != null);
      const wins = valid.filter(s => Math.sign(s.moves[h]) === s.direction).length;
      const total = valid.length;
      counts[h] = total > 0 ? wins / total : 0;
      counts[`n${h}`] = total;
    }
    const klabel = bucketLabels ? bucketLabels(k) : k;
    console.log(
      `    ${String(klabel).padEnd(18)} ` +
      `n=${String(arr.length).padStart(5)}  ` +
      `hit@5m=${(counts[5]*100).toFixed(1).padStart(5)}%  ` +
      `hit@15m=${(counts[15]*100).toFixed(1).padStart(5)}%  ` +
      `hit@30m=${(counts[30]*100).toFixed(1).padStart(5)}%`
    );
  }
}

function main() {
  const nDays = parseInt(process.argv[2] || '10', 10);
  mkdirSync(OUT_DIR, { recursive: true });

  const files = readdirSync(REPLAY_DIR)
    .filter(f => /^gex-replay-\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
  const recent = files.slice(-nDays).map(f => f.match(/(\d{4}-\d{2}-\d{2})/)[1]);

  console.log(`\n▶ Pattern analysis on ${recent.length} days: ${recent[0]} → ${recent[recent.length-1]}`);
  console.log(`  Predictor: fastest-growing +gamma cell within ±${PROXIMITY_PCT*100}% of spot, all expiries\n`);

  const signals = [];
  for (const date of recent) runDay(date, signals);

  console.log(`Total directional signals emitted: ${signals.length}`);
  console.log(`  → SPX: ${signals.filter(s => s.ticker === 'SPXW').length}`);
  console.log(`  → SPY: ${signals.filter(s => s.ticker === 'SPY').length}`);
  console.log(`  → QQQ: ${signals.filter(s => s.ticker === 'QQQ').length}`);

  // ── 1. Overall cost-free hit-rate ──
  console.log('\n════════════ COST-FREE HIT-RATE (50% = no edge) ════════════');
  reportBucket('Overall (all signals)', signals, () => 'all');
  reportBucket('By ticker', signals, s => s.ticker);

  // ── 2. Streak length ──
  // Bucket streaks: 1 (just flipped), 2, 3-5, 6-10, 11-20, 21+
  const streakBucket = (s) => {
    if (s.streak <= 1) return '1 (just flipped)';
    if (s.streak === 2) return '2';
    if (s.streak <= 5) return '3-5';
    if (s.streak <= 10) return '6-10';
    if (s.streak <= 20) return '11-20';
    return '21+';
  };
  reportBucket('By signal streak length', signals, streakBucket);

  // ── 3. Velocity quartile ──
  const velocities = signals.map(s => s.velocity).filter(v => v > 0);
  const [q25, q50, q75] = quartile(velocities);
  console.log(`\n  Velocity quartiles: 25%=$${(q25/1e6).toFixed(1)}M  50%=$${(q50/1e6).toFixed(1)}M  75%=$${(q75/1e6).toFixed(1)}M`);
  const velBucket = (s) => {
    if (s.velocity < q25) return 'Q1 (smallest)';
    if (s.velocity < q50) return 'Q2';
    if (s.velocity < q75) return 'Q3';
    return 'Q4 (biggest)';
  };
  reportBucket('By velocity quartile', signals, velBucket);

  // ── 4. Hour of day (ET approx) ──
  reportBucket('By ET hour (approx)', signals, s => s.hour);

  // ── 5. Direction (do calls vs puts behave differently?) ──
  reportBucket('By direction', signals, s => s.direction === 1 ? 'LONG  (calls)' : 'SHORT (puts)');

  // Write full signal log for offline analysis
  const logPath = join(OUT_DIR, 'cell-tracking-signals.csv');
  const header = ['date', 'ticker', 'ts', 'direction', 'velocity', 'strike', 'spot', 'streak', 'hour', ...HORIZONS.map(h => `move_${h}m`)].join(',');
  const lines = [header];
  for (const s of signals) {
    lines.push([
      s.date, s.ticker, s.ts, s.direction, s.velocity.toFixed(0), s.strike, s.spot.toFixed(4), s.streak, s.hour,
      ...HORIZONS.map(h => s.moves[h] != null ? s.moves[h].toFixed(6) : ''),
    ].join(','));
  }
  writeFileSync(logPath, lines.join('\n'));
  console.log(`\nFull signal log: ${logPath}\n`);
}

main();
