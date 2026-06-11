#!/usr/bin/env node
/**
 * Cell-tracking backtest.
 *
 * Question: does tracking per-(strike, expiry) cell growth on the full GEX surface
 * produce a better intraday directional signal than the current king-node logic?
 *
 * Method: for each minute of each replay day, four predictors emit a direction
 * (LONG/SHORT/FLAT). We simulate holding signed underlying-equivalent exposure,
 * flipping on signal change, with a transaction-cost drag. Score by total P&L.
 *
 *   1. STATIC_KING — set at 9:30 ET, hold all day (the "no intraday updates" floor)
 *   2. DYN_KING    — re-evaluate king every minute, flip on king/regime change
 *   3. CELL_FULL   — fastest growing +gamma cell within ±2% of spot, all expiries
 *   4. CELL_WEEK   — same, restricted to first ~5 expiries (~1 week)
 *
 * Output:
 *   apps/gex/scripts/out/cell-backtest-{date}-{ticker}.csv  (per-frame trace)
 *   apps/gex/scripts/out/cell-backtest-summary.csv          (predictor × ticker)
 *   stdout summary table
 *
 * Usage: node scripts/cell-tracking-backtest.js [n_days]
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPLAY_DIR = '/Users/saiyeeshrathish/gex-data-replay-reader/data';
const OUT_DIR = join(__dirname, 'out');
const TICKERS = ['SPXW', 'SPY', 'QQQ'];

// Transaction cost per direction flip (fraction of position notional).
// SPX options wider spreads → higher; SPY/QQQ tight 0DTE spreads.
const FLIP_COST = { SPXW: 0.0008, SPY: 0.0005, QQQ: 0.0005 };

// Cell-velocity parameters.
const VEL_WINDOW_FRAMES = 5;     // 5 minutes of history for velocity calc
const PROXIMITY_PCT = 0.02;      // candidates within ±2% of spot
const MIN_ABS_GAMMA = 1e6;       // ignore tiny cells ($1M abs floor)
const WEEK_EXPIRY_COUNT = 5;     // restrict to first 5 expiries for CELL_WEEK

const PREDICTORS = ['STATIC_KING', 'DYN_KING', 'CELL_FULL', 'CELL_WEEK'];

// ─── Load replay file and yield per-ticker frame arrays ───
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
        expirations: t.expirations,
        gamma: t.gammaValues, // [strikeIdx][expIdx]
      });
    }
    out[ticker] = frames;
  }
  return out;
}

// ─── King-node predictors ───
// Rule: direction = sign(king_strike − spot). Price gets pulled toward the
// dominant gamma node. We use 0DTE column for parity with current pipeline.
function kingDirection(frame) {
  const { spot, strikes, gamma } = frame;
  let kingIdx = -1;
  let kingAbs = 0;
  for (let i = 0; i < gamma.length; i++) {
    const g = gamma[i]?.[0] ?? 0;
    const a = Math.abs(g);
    if (a > kingAbs) { kingAbs = a; kingIdx = i; }
  }
  if (kingIdx < 0 || kingAbs === 0) return 0;
  const kingStrike = strikes[kingIdx];
  const diff = kingStrike - spot;
  if (Math.abs(diff) < 0.5) return 0; // sitting on the king → flat
  return diff > 0 ? 1 : -1;
}

// ─── Cell-velocity predictor ───
// State: per-cell history of recent gamma values across frames.
// Rule: among cells with positive gamma growth in the last VEL_WINDOW_FRAMES
// and |gamma| > MIN_ABS_GAMMA and |strike−spot| < PROXIMITY_PCT,
// pick the one with the largest Δgamma. Direction = sign(strike − spot).
function makeCellPredictor(maxExpIdx /* exclusive bound, null = all */) {
  // history[strikeIdx][expIdx] = ring buffer of last N gamma values
  let history = null;
  let strikesRef = null;

  return function predict(frame) {
    const { spot, strikes, gamma } = frame;

    // Initialize / re-init when strike grid changes shape
    if (!history || strikes.length !== history.length) {
      strikesRef = strikes;
      history = strikes.map(() =>
        Array.from({ length: gamma[0]?.length || 0 }, () => [])
      );
    }

    const expLimit = maxExpIdx == null
      ? (gamma[0]?.length || 0)
      : Math.min(maxExpIdx, gamma[0]?.length || 0);

    // Push current frame into history; trim to window
    for (let si = 0; si < gamma.length; si++) {
      const row = gamma[si];
      if (!row) continue;
      for (let ei = 0; ei < expLimit; ei++) {
        const buf = history[si][ei];
        buf.push(row[ei] ?? 0);
        if (buf.length > VEL_WINDOW_FRAMES + 1) buf.shift();
      }
    }

    // Need full window before signaling
    if (history[0]?.[0]?.length < VEL_WINDOW_FRAMES + 1) return 0;

    // Score each in-proximity cell
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

        // Only count growing positive-gamma magnets
        if (now <= MIN_ABS_GAMMA) continue;
        const delta = now - then;
        if (delta <= 0) continue;

        // Score: absolute growth Δ, scaled by current magnitude
        const score = delta;
        if (score > bestScore) {
          bestScore = score;
          bestStrike = strike;
        }
      }
    }

    if (bestStrike == null) return 0;
    const diff = bestStrike - spot;
    if (Math.abs(diff) < 0.5) return 0;
    return diff > 0 ? 1 : -1;
  };
}

// ─── P&L simulator ───
// position ∈ {−1, 0, +1}. Return per frame = position × (spot[t+1] − spot[t]) / spot[0].
// Flip cost = FLIP_COST whenever position changes (incl. 0 ↔ ±1).
function simulate(frames, signals, ticker) {
  const flipCost = FLIP_COST[ticker] ?? 0.0005;
  const spot0 = frames[0].spot;
  let cumPnl = 0;
  let prevPos = 0;
  let flips = 0;
  const trace = [];

  for (let i = 0; i < frames.length; i++) {
    const pos = signals[i] ?? 0;
    if (pos !== prevPos) {
      // Cost on size change. Magnitude of change matters (0→1 is one full leg,
      // -1→+1 is two legs and round-trips both sides).
      const sizeChange = Math.abs(pos - prevPos);
      cumPnl -= flipCost * sizeChange;
      if (pos !== 0 || prevPos !== 0) flips++;
    }

    const next = frames[i + 1];
    if (next) {
      const move = (next.spot - frames[i].spot) / spot0;
      cumPnl += pos * move;
    }
    trace.push({ ts: frames[i].ts, spot: frames[i].spot, pos, cumPnl });
    prevPos = pos;
  }

  // Square out at close
  if (prevPos !== 0) {
    cumPnl -= flipCost * Math.abs(prevPos);
    flips++;
  }

  return { cumPnl, flips, trace };
}

// ─── Day runner ───
function runDay(date) {
  const path = join(REPLAY_DIR, `gex-replay-${date}.json`);
  if (!existsSync(path)) return null;

  const byTicker = loadReplay(path);
  const dayResults = {};

  for (const ticker of TICKERS) {
    const frames = byTicker[ticker];
    if (!frames || frames.length < VEL_WINDOW_FRAMES + 2) continue;

    // Compute per-predictor signal vector
    const sigStaticKing = new Array(frames.length).fill(0);
    const sigDynKing = new Array(frames.length);
    const sigCellFull = new Array(frames.length);
    const sigCellWeek = new Array(frames.length);

    const cellFullPredictor = makeCellPredictor(null);
    const cellWeekPredictor = makeCellPredictor(WEEK_EXPIRY_COUNT);

    const openDir = kingDirection(frames[0]);
    for (let i = 0; i < frames.length; i++) {
      sigStaticKing[i] = openDir;
      sigDynKing[i] = kingDirection(frames[i]);
      sigCellFull[i] = cellFullPredictor(frames[i]);
      sigCellWeek[i] = cellWeekPredictor(frames[i]);
    }

    // Simulate each
    const sims = {
      STATIC_KING: simulate(frames, sigStaticKing, ticker),
      DYN_KING:    simulate(frames, sigDynKing, ticker),
      CELL_FULL:   simulate(frames, sigCellFull, ticker),
      CELL_WEEK:   simulate(frames, sigCellWeek, ticker),
    };

    dayResults[ticker] = sims;

    // Write per-day per-ticker CSV
    const csvPath = join(OUT_DIR, `cell-backtest-${date}-${ticker}.csv`);
    const header = ['ts', 'spot', ...PREDICTORS.flatMap(p => [`${p}_pos`, `${p}_cumPnl`])].join(',');
    const lines = [header];
    for (let i = 0; i < frames.length; i++) {
      lines.push([
        frames[i].ts,
        frames[i].spot.toFixed(4),
        ...PREDICTORS.flatMap(p => [sims[p].trace[i].pos, sims[p].trace[i].cumPnl.toFixed(6)]),
      ].join(','));
    }
    writeFileSync(csvPath, lines.join('\n'));
  }

  return dayResults;
}

// ─── Main ───
function main() {
  const nDays = parseInt(process.argv[2] || '10', 10);
  mkdirSync(OUT_DIR, { recursive: true });

  const files = readdirSync(REPLAY_DIR)
    .filter(f => /^gex-replay-\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
  const recent = files.slice(-nDays).map(f => f.match(/(\d{4}-\d{2}-\d{2})/)[1]);

  console.log(`\n▶ Running cell-tracking backtest on ${recent.length} days: ${recent[0]} → ${recent[recent.length-1]}\n`);

  // Aggregate: predictor → ticker → array of daily cumPnl
  const agg = {};
  for (const p of PREDICTORS) {
    agg[p] = {};
    for (const t of TICKERS) agg[p][t] = { days: [], flips: 0 };
  }

  for (const date of recent) {
    const day = runDay(date);
    if (!day) { console.log(`  [skip] ${date} — no file`); continue; }
    const row = [date];
    for (const ticker of TICKERS) {
      const sims = day[ticker];
      if (!sims) { row.push('—'); continue; }
      for (const p of PREDICTORS) {
        agg[p][ticker].days.push(sims[p].cumPnl);
        agg[p][ticker].flips += sims[p].flips;
      }
      row.push(ticker, ...PREDICTORS.map(p => (sims[p].cumPnl * 100).toFixed(2) + '%'));
    }
    console.log(`  ${date} → ${row.slice(1).join('  ')}`);
  }

  // Summary
  console.log('\n══════════════════════════════════════════════════════════════════');
  console.log('  SUMMARY — avg daily return, total flips across', recent.length, 'days');
  console.log('══════════════════════════════════════════════════════════════════');
  const summaryRows = [['predictor', 'ticker', 'avg_daily_ret_pct', 'cum_ret_pct', 'win_days', 'total_days', 'total_flips', 'max_drawdown_pct']];

  for (const p of PREDICTORS) {
    for (const t of TICKERS) {
      const arr = agg[p][t].days;
      if (!arr.length) continue;
      const cum = arr.reduce((a, b) => a + b, 0);
      const avg = cum / arr.length;
      const wins = arr.filter(x => x > 0).length;
      // Max drawdown over cumulative path
      let peak = 0, dd = 0, running = 0;
      for (const x of arr) { running += x; peak = Math.max(peak, running); dd = Math.min(dd, running - peak); }
      console.log(
        `  ${p.padEnd(12)} ${t.padEnd(5)} avg ${(avg*100).toFixed(3).padStart(7)}%  cum ${(cum*100).toFixed(2).padStart(7)}%  wins ${wins}/${arr.length}  flips ${agg[p][t].flips}  maxDD ${(dd*100).toFixed(2)}%`
      );
      summaryRows.push([p, t, (avg*100).toFixed(4), (cum*100).toFixed(4), wins, arr.length, agg[p][t].flips, (dd*100).toFixed(4)]);
    }
    console.log('');
  }

  const summaryPath = join(OUT_DIR, 'cell-backtest-summary.csv');
  writeFileSync(summaryPath, summaryRows.map(r => r.join(',')).join('\n'));
  console.log(`Summary written: ${summaryPath}`);
  console.log(`Per-day traces:  ${OUT_DIR}/cell-backtest-{date}-{ticker}.csv\n`);
}

main();
