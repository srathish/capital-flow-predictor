#!/usr/bin/env node
/**
 * Replay backtest — feed a day (or range) of historical trinity snapshots through the
 * Phase 1 pipeline minute-by-minute and report what the system would have done.
 *
 * Output is written to a SEPARATE data dir from live mode (default ./data/replay) so
 * backtest results don't pollute the live observation DB.
 *
 * Usage:
 *   npm run replay -- --date=2026-03-21
 *   npm run replay -- --from=2026-03-15 --to=2026-03-21
 *   npm run replay -- --last=10                      # last 10 available days
 *   npm run replay -- --date=2026-03-21 --reset      # wipe replay DB before running
 *
 * Env:
 *   DATA_DIR        — output dir (default ./data/replay; the npm script sets this)
 *   REPLAY_DIR      — input dir for raw JSON files (default the OpenClaw scraper path)
 *   LOG_LEVEL       — info | debug
 */

import { existsSync, readdirSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { DateTime } from 'luxon';
import { config } from '../src/utils/config.js';
import { openDb, closeDb, getStmts } from '../src/store/db.js';
import { closeAll as closeJsonl } from '../src/store/jsonl-events.js';
import { clearVelocityState } from '../src/domain/velocity.js';
import { clearAwarenessState } from '../src/domain/awareness.js';
import { processSnapshot } from '../src/ingest/snapshot-poller.js';
import { loadDay, frameToSnapshots, DEFAULT_REPLAY_DIR } from '../src/replay/reader.js';
import { createLogger } from '../src/utils/logger.js';

const log = createLogger('Replay');

function parseArgs() {
  const args = {};
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--([^=]+)(?:=(.*))?$/);
    if (!m) continue;
    args[m[1]] = m[2] ?? true;
  }
  return args;
}

function listAvailable(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => /^gex-replay-\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map(f => f.match(/(\d{4}-\d{2}-\d{2})/)[1])
    .sort();
}

function isWeekday(dateStr) {
  // Luxon weekday: 1=Mon, 7=Sun. Files were named in ET; date alone is unambiguous for day-of-week.
  const dow = DateTime.fromISO(dateStr).weekday;
  return dow >= 1 && dow <= 5;
}

function resolveDates(args, replayDir) {
  let dates;
  if (args.date) {
    dates = [args.date];
  } else {
    const all = listAvailable(replayDir);
    if (args.last) {
      // For --last=N we filter to weekdays first, then take the last N.
      const filtered = (args['skip-weekends'] === 'false') ? all : all.filter(isWeekday);
      dates = filtered.slice(-parseInt(args.last, 10));
    } else if (args.from || args.to) {
      const from = args.from || all[0];
      const to = args.to || all[all.length - 1];
      dates = all.filter(d => d >= from && d <= to);
    } else {
      dates = all.slice(-1);
    }
  }
  if (args['skip-weekends'] !== 'false') {
    const before = dates.length;
    dates = dates.filter(isWeekday);
    const skipped = before - dates.length;
    if (skipped > 0) console.log(`(skipped ${skipped} weekend dates — frozen data)`);
  }
  return dates;
}

async function runOneDay(date, replayDir) {
  log.info(`▶ ${date}: loading…`);
  const data = loadDay(date, replayDir);
  const frames = data.frames;
  log.info(`  ${frames.length} frames`);

  // Per-day stats accumulators
  const stats = {
    framesProcessed: 0,
    snapshotsByTicker: { SPXW: 0, SPY: 0, QQQ: 0 },
    patternsDetected: {},
    decisions: { would_enter: 0, reject: 0 },
    rejectByStep: {},
    trinityClasses: {},
    biasExtrema: { SPXW: { min: Infinity, max: -Infinity },
                   SPY:  { min: Infinity, max: -Infinity },
                   QQQ:  { min: Infinity, max: -Infinity } },
  };

  // Stream frames in chronological order — this IS minute-by-minute since the
  // scraper captures one frame per minute.
  const t0 = Date.now();
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const snapshots = frameToSnapshots(frame);
    for (const { ticker, tradingDay, snap } of snapshots) {
      try {
        const r = processSnapshot({ ticker, tradingDay, snap });
        stats.snapshotsByTicker[ticker] = (stats.snapshotsByTicker[ticker] || 0) + 1;
        stats.decisions[r.decision] = (stats.decisions[r.decision] || 0) + 1;
        if (r.decision === 'reject' && r.plan?.rejectReason) {
          // (would only land here if execution.planTrade returned a rejection reason in plan)
        }
        if (r.biasScore != null) {
          const ex = stats.biasExtrema[ticker];
          if (r.biasScore < ex.min) ex.min = r.biasScore;
          if (r.biasScore > ex.max) ex.max = r.biasScore;
        }
        if (r.trinityClassification) {
          stats.trinityClasses[r.trinityClassification] = (stats.trinityClasses[r.trinityClassification] || 0) + 1;
        }
      } catch (err) {
        log.error(`  frame ${i} ${ticker}: ${err.message}`);
      }
    }
    stats.framesProcessed++;
  }

  // Pull aggregate counts from DB for this trading_day
  const stmts = getStmts();
  const d = openDb();
  const tradingDay = data.frames[0]
    ? new Date(data.frames[0].timestamp).toISOString().slice(0, 10)
    : date;

  const detected = d.prepare(`
    SELECT ticker, pattern, COUNT(*) hits FROM pattern_detections
    WHERE trading_day = ? AND detected = 1
    GROUP BY ticker, pattern ORDER BY hits DESC
  `).all(tradingDay);
  stats.patternsDetected = detected;

  const rejBreakdown = d.prepare(`
    SELECT step_failed, reject_reason, COUNT(*) c FROM decision_log
    WHERE trading_day = ? AND decision = 'reject'
    GROUP BY step_failed, reject_reason
    ORDER BY c DESC
  `).all(tradingDay);
  stats.rejectByStep = rejBreakdown;

  const acceptedRow = d.prepare(`
    SELECT COUNT(*) c FROM decision_log
    WHERE trading_day = ? AND decision = 'would_enter'
  `).get(tradingDay);
  stats.acceptedCount = acceptedRow.c;

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  log.info(`✓ ${date} done in ${elapsed}s | frames=${stats.framesProcessed} | snaps SPXW=${stats.snapshotsByTicker.SPXW} SPY=${stats.snapshotsByTicker.SPY} QQQ=${stats.snapshotsByTicker.QQQ} | accepted=${stats.acceptedCount} rejected=${stats.decisions.reject || 0}`);
  return stats;
}

async function main() {
  const args = parseArgs();
  const replayDir = process.env.REPLAY_DIR || DEFAULT_REPLAY_DIR;
  const dates = resolveDates(args, replayDir);

  if (dates.length === 0) {
    log.error(`No replay dates available in ${replayDir}`);
    process.exit(1);
  }

  log.info(`Replay output dir: ${config.dataDir}`);
  log.info(`Source replay dir: ${replayDir}`);
  log.info(`Dates to process (${dates.length}): ${dates.length > 10 ? dates[0] + '…' + dates[dates.length-1] : dates.join(', ')}`);

  if (args.reset) {
    if (existsSync(config.dataDir)) {
      log.warn(`--reset: wiping ${config.dataDir}`);
      rmSync(config.dataDir, { recursive: true, force: true });
    }
  }
  mkdirSync(config.dataDir, { recursive: true });

  // Open DB once. Each day clears in-memory state (velocity buffers, awareness)
  // because in real life those reset per session.
  openDb();

  const allStats = [];
  for (const date of dates) {
    clearVelocityState();
    clearAwarenessState();
    try {
      const s = await runOneDay(date, replayDir);
      allStats.push({ date, ...s });
    } catch (err) {
      log.error(`✗ ${date}: ${err.message}`);
      allStats.push({ date, error: err.message });
    }
  }

  // Final cross-day summary
  log.info('━━━ replay complete ━━━');
  for (const s of allStats) {
    if (s.error) { log.info(`${s.date}  ERROR: ${s.error}`); continue; }
    const trinity = Object.entries(s.trinityClasses).sort((a, b) => b[1] - a[1])
      .slice(0, 3).map(([k, v]) => `${k}=${v}`).join(' ');
    const patterns = (s.patternsDetected || []).slice(0, 5)
      .map(p => `${p.ticker}:${p.pattern}=${p.hits}`).join(' ');
    log.info(`${s.date} | accepted=${s.acceptedCount} rejected=${s.decisions.reject || 0} | trinity[${trinity}] | patterns[${patterns}]`);
  }

  closeJsonl();
  closeDb();
}

main().catch(err => {
  log.error('fatal:', err);
  process.exit(1);
});
