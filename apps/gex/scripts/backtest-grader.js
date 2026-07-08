/**
 * backtest-grader — walk-forward test of the Skylit grader against 106 days
 * of Skylit-sourced replay data (SPXW/SPY/QQQ, Dec 2025 → recent).
 *
 * For each replay day D:
 *   1. Take the FIRST frame of D (market-open snapshot)
 *   2. Grade against the first non-0DTE expiration on the map
 *      (0DTE closes same-day and is dominated by pin dynamics —
 *       the grader's structural setup logic is meant for hold-across-days)
 *   3. Extract prediction { direction, entry_anchor, stop_strike, target_strike }
 *   4. Walk forward through D and subsequent days' frames until:
 *        - price reaches target_strike (WIN)
 *        - price reaches stop_strike (LOSS)
 *        - target_expiration passes (NEITHER)
 *   5. Record outcome, grade, actual bps move, days-to-outcome
 *
 * Aggregates hit rate by grade tier (A+/A/B) and prints failure examples
 * so we can iterate on grader thresholds where it's still weak.
 *
 * Usage:  node scripts/backtest-grader.js
 *         node scripts/backtest-grader.js --ticker=SPY
 *         node scripts/backtest-grader.js --min-grade=B
 *         node scripts/backtest-grader.js --verbose  # print every trade
 */

import fs from 'node:fs';
import path from 'node:path';
import { gradeSnapshot } from '../src/grader/seven-rules.js';

const REPLAY_DIR = '/Users/saiyeeshrathish/gex-data-replay-reader/data';
const TICKERS = ['SPXW', 'SPY', 'QQQ'];

function parseArgs() {
  const args = { ticker: null, minGrade: 'B', verbose: false, limit: null };
  for (const a of process.argv.slice(2)) {
    if (a.startsWith('--ticker=')) args.ticker = a.slice(9).toUpperCase();
    else if (a.startsWith('--min-grade=')) args.minGrade = a.slice(12);
    else if (a === '--verbose') args.verbose = true;
    else if (a.startsWith('--limit=')) args.limit = Number(a.slice(8));
  }
  return args;
}

function listReplayDays() {
  return fs.readdirSync(REPLAY_DIR)
    .filter(f => /^gex-replay-\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
    .map(f => ({ date: f.slice(11, 21), path: path.join(REPLAY_DIR, f) }));
}

function loadReplay(p) {
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

// Convert a raw replay ticker payload into the multi-expiration snapshot shape
// gradeSnapshot expects (matches heatseeker/client.js normalize output).
function replayToSnapshot(ticker, t, tsMs) {
  const strikes = t.strikes || [];
  const gammaRows = t.gammaValues || [];
  const vannaRows = t.vannaValues || [];
  const expirations = t.expirations || [];

  const allExpirations = [];
  for (let ei = 0; ei < expirations.length; ei++) {
    const nodes = [];
    for (let si = 0; si < gammaRows.length; si++) {
      const g = (gammaRows[si] && gammaRows[si][ei]) || 0;
      const v = (vannaRows[si] && vannaRows[si][ei]) || 0;
      if (strikes[si] == null) continue;
      nodes.push({ strike: strikes[si], gamma: g, vanna: v });
    }
    allExpirations.push({
      expiration: expirations[ei],
      expirationIndex: ei,
      strikes: nodes,
    });
  }

  return {
    ticker,
    fetchedAtMs: tsMs,
    spot: t.spotPrice,
    expiration: expirations[0] || null,
    strikes: allExpirations[0]?.strikes || [],
    allExpirations,
    apiVelocity: null,
  };
}

// From a graded prediction, pick the target expiration (first non-0DTE).
function pickTargetExpiry(snap, tradingDay) {
  const nonZero = snap.allExpirations
    .map(e => e.expiration)
    .filter(e => e && e > tradingDay);
  return nonZero[0] || snap.allExpirations[0]?.expiration || null;
}

/**
 * Walk forward through all frames of `days` (sorted by date), starting AFTER
 * the entry frame, until price touches target or stop.
 *
 * Returns { outcome, exitTs, exitPrice, daysToOutcome, mfeBps, maeBps }
 *   outcome: 'win' | 'loss' | 'expired' | 'timeout'
 */
function walkForward({ ticker, direction, entryPrice, targetStrike, stopStrike, targetExpiry, days, startIdx, startFrameIdx }) {
  let mfe = 0; // max favorable excursion (bps)
  let mae = 0; // max adverse excursion (bps)
  const isBull = direction === 'bull';

  for (let di = startIdx; di < days.length; di++) {
    const day = days[di];
    if (targetExpiry && day.date > targetExpiry) {
      return { outcome: 'expired', exitTs: null, exitPrice: null, daysToOutcome: di - startIdx, mfeBps: mfe, maeBps: mae };
    }

    const raw = loadReplay(day.path);
    const frames = raw.frames || [];
    const frameStart = di === startIdx ? startFrameIdx + 1 : 0;

    for (let fi = frameStart; fi < frames.length; fi++) {
      const frame = frames[fi];
      const t = frame.tickers?.[ticker];
      if (!t) continue;
      const price = t.spotPrice;
      if (price == null) continue;

      const moveBps = ((price - entryPrice) / entryPrice) * 10000 * (isBull ? 1 : -1);
      if (moveBps > mfe) mfe = moveBps;
      if (moveBps < mae) mae = moveBps;

      // Check target hit
      const targetHit = isBull ? price >= targetStrike : price <= targetStrike;
      if (targetHit) {
        return { outcome: 'win', exitTs: frame.timestamp, exitPrice: price, daysToOutcome: di - startIdx, mfeBps: mfe, maeBps: mae };
      }
      // Check stop hit
      const stopHit = isBull ? price <= stopStrike : price >= stopStrike;
      if (stopHit) {
        return { outcome: 'loss', exitTs: frame.timestamp, exitPrice: price, daysToOutcome: di - startIdx, mfeBps: mfe, maeBps: mae };
      }
    }
  }

  return { outcome: 'timeout', exitTs: null, exitPrice: null, daysToOutcome: days.length - startIdx, mfeBps: mfe, maeBps: mae };
}

// ---------- Main ----------

const GRADE_RANK = { 'A+': 4, 'A': 3, 'B': 2, 'C': 1 };

function main() {
  const args = parseArgs();
  const allDays = listReplayDays();
  const days = args.limit ? allDays.slice(0, args.limit) : allDays;
  const tickers = args.ticker ? [args.ticker] : TICKERS;

  console.log(`\n  Backtest: ${days.length} days · ${tickers.join(', ')} · min-grade ${args.minGrade}\n`);

  const trades = [];
  let dayCount = 0;
  for (let di = 0; di < days.length; di++) {
    const day = days[di];
    let raw;
    try { raw = loadReplay(day.path); } catch { continue; }
    const openFrame = raw.frames?.[0];
    if (!openFrame) continue;

    for (const ticker of tickers) {
      const t = openFrame.tickers?.[ticker];
      if (!t) continue;

      const snap = replayToSnapshot(ticker, t, Date.parse(openFrame.timestamp));
      const targetExpiry = pickTargetExpiry(snap, day.date);
      if (!targetExpiry) continue;

      const graded = gradeSnapshot(snap, { targetExpiry });
      if (!graded.grade || GRADE_RANK[graded.grade] < GRADE_RANK[args.minGrade]) continue;
      if (graded.direction === 'none') continue;
      if (!graded.plan?.stopStrike || !graded.plan?.targets?.[0]?.strike) continue;

      const entryPrice = graded.plan.entryPrice;
      const stopStrike = graded.plan.stopStrike;
      const targetStrike = graded.plan.targets[0].strike;

      const outcome = walkForward({
        ticker,
        direction: graded.direction,
        entryPrice,
        targetStrike,
        stopStrike,
        targetExpiry,
        days,
        startIdx: di,
        startFrameIdx: 0,
      });

      trades.push({
        date: day.date,
        ticker,
        grade: graded.grade,
        direction: graded.direction,
        pattern: graded.patternName,
        expiry: targetExpiry,
        entry: entryPrice,
        stop: stopStrike,
        target: targetStrike,
        rr: graded.rr,
        outcome: outcome.outcome,
        daysToOutcome: outcome.daysToOutcome,
        mfeBps: Math.round(outcome.mfeBps),
        maeBps: Math.round(outcome.maeBps),
      });

      if (args.verbose) {
        console.log(`  ${day.date} ${ticker.padEnd(4)} ${graded.grade.padEnd(2)} ${graded.direction.padEnd(4)} ` +
          `entry=$${entryPrice} tgt=$${targetStrike} stop=$${stopStrike} rr=${graded.rr?.toFixed(2)} ` +
          `→ ${outcome.outcome.padEnd(7)} in ${outcome.daysToOutcome}d  mfe=${Math.round(outcome.mfeBps)}bps mae=${Math.round(outcome.maeBps)}bps`);
      }
    }
    dayCount++;
  }

  // ---------- Aggregates ----------
  console.log(`\n  ${trades.length} trades generated across ${dayCount} days\n`);

  const byGrade = {};
  for (const t of trades) {
    const g = byGrade[t.grade] ||= { total: 0, win: 0, loss: 0, expired: 0, timeout: 0, sumMfe: 0, sumMae: 0, sumRr: 0 };
    g.total++;
    g[t.outcome] = (g[t.outcome] || 0) + 1;
    g.sumMfe += t.mfeBps;
    g.sumMae += t.maeBps;
    g.sumRr += t.rr || 0;
  }

  console.log('  Outcomes by grade:');
  console.log('  grade   n     win    loss   expired  timeout   winRate   avgMFE    avgMAE    avgRR');
  console.log('  ─────  ────  ─────  ─────  ───────  ────────  ────────  ────────  ────────  ────────');
  for (const grade of ['A+', 'A', 'B']) {
    const g = byGrade[grade];
    if (!g) continue;
    const decided = (g.win || 0) + (g.loss || 0);
    const wr = decided ? (((g.win || 0) / decided) * 100).toFixed(1) : '0.0';
    const avgMfe = g.total ? (g.sumMfe / g.total).toFixed(0) : '0';
    const avgMae = g.total ? (g.sumMae / g.total).toFixed(0) : '0';
    const avgRr = g.total ? (g.sumRr / g.total).toFixed(2) : '0.00';
    console.log(`  ${grade.padEnd(5)}  ${String(g.total).padEnd(4)}  ${String(g.win || 0).padEnd(5)}  ${String(g.loss || 0).padEnd(5)}  ${String(g.expired || 0).padEnd(7)}  ${String(g.timeout || 0).padEnd(8)}  ${wr.padEnd(6)}%   ${avgMfe.padEnd(6)}bps ${avgMae.padEnd(6)}bps ${avgRr}`);
  }

  console.log('');
  console.log('  Outcomes by direction:');
  const byDir = {};
  for (const t of trades) {
    const d = byDir[t.direction] ||= { total: 0, wins: 0 };
    d.total++;
    if (t.outcome === 'win') d.wins++;
  }
  for (const dir of Object.keys(byDir)) {
    const d = byDir[dir];
    const wr = d.total ? ((d.wins / d.total) * 100).toFixed(1) : '0.0';
    console.log(`    ${dir.padEnd(5)}  n=${d.total}  wins=${d.wins}  winRate=${wr}%`);
  }

  console.log('');
  console.log('  Losing A+ trades (learn from these):');
  const losers = trades.filter(t => t.grade === 'A+' && t.outcome === 'loss').slice(0, 10);
  for (const l of losers) {
    console.log(`    ${l.date} ${l.ticker} ${l.direction} entry=$${l.entry} stop=$${l.stop} tgt=$${l.target} pattern=${l.pattern} rr=${l.rr?.toFixed(2)}`);
  }

  // Save all trades to disk for downstream analysis.
  const outPath = path.join(process.cwd(), 'scripts/out/backtest-trades.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(trades, null, 2));
  console.log(`\n  Trades written to ${outPath}\n`);
}

main();
