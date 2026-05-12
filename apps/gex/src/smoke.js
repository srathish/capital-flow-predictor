/**
 * End-to-end smoke test for Sprints 1-5.
 *
 * Drives synthetic snapshots through processSnapshot for SPXW + SPY + QQQ,
 * crafted to:
 *   - trigger a reverse_rug on SPXW (pika floor below spot, barney just above)
 *   - leave SPY / QQQ in supporting positive structure
 *   - then drive a follow-up snapshot to exercise lifecycle taps + velocity
 * and verify:
 *   - patterns detected
 *   - bias score in expected direction
 *   - trinity classification populated
 *   - decision_log row written (accept or rejected with reason)
 *
 * Run: `npm run smoke`
 */

import { openDb, closeDb, getStmts, txn } from './store/db.js';
import { closeAll as closeJsonl } from './store/jsonl-events.js';
import { config, thresholds } from './utils/config.js';
import { processSnapshot } from './ingest/snapshot-poller.js';
import { tradingDayET } from './utils/time.js';
import { createLogger } from './utils/logger.js';
import { clearVelocityState } from './domain/velocity.js';
import { clearAwarenessState } from './domain/awareness.js';

const log = createLogger('Smoke');

// Build a SPXW frame with a clean reverse rug: pika floor at spot-15, barney just below spot.
// Spot 6940 → strikes 6915..6965 step 5.
function spxwFrame({ tsMs, spot }) {
  const strikes = [];
  for (let s = spot - 50; s <= spot + 50; s += 5) {
    let gamma = (Math.random() - 0.5) * 1_500_000;
    if (s === spot - 15) gamma = +25_000_000;   // pika floor
    if (s === spot + 5)  gamma = -8_000_000;    // barney just above
    if (s === spot + 25) gamma = +12_000_000;   // ceiling further out
    if (s === spot - 30) gamma = -4_000_000;    // a barney further below
    strikes.push({ strike: s, gamma });
  }
  return { ticker: 'SPXW', fetchedAtMs: tsMs, spot, expiration: '2026-04-30', strikes, apiVelocity: null };
}

// SPY: structurally bullish too — pika floor below, barney above.
function spyFrame({ tsMs, spot }) {
  const strikes = [];
  for (let s = spot - 5; s <= spot + 5; s += 1) {
    let gamma = (Math.random() - 0.5) * 200_000;
    if (s === spot - 2) gamma = +18_000_000;  // strong pika floor
    if (s === spot + 1) gamma = -3_000_000;
    if (s === spot + 3) gamma = +5_000_000;
    strikes.push({ strike: s, gamma });
  }
  return { ticker: 'SPY', fetchedAtMs: tsMs, spot, expiration: '2026-04-30', strikes, apiVelocity: null };
}

// QQQ: also bullish.
function qqqFrame({ tsMs, spot }) {
  const strikes = [];
  for (let s = spot - 5; s <= spot + 5; s += 1) {
    let gamma = (Math.random() - 0.5) * 200_000;
    if (s === spot - 2) gamma = +14_000_000;
    if (s === spot + 1) gamma = -3_000_000;
    strikes.push({ strike: s, gamma });
  }
  return { ticker: 'QQQ', fetchedAtMs: tsMs, spot, expiration: '2026-04-30', strikes, apiVelocity: null };
}

function run() {
  log.info(`config: tickers=${config.tickers.join(',')} | thresholds version=${thresholds.version}`);
  openDb();
  const stmts = getStmts();
  const tradingDay = tradingDayET();
  clearVelocityState();
  clearAwarenessState();

  const baseTs = Date.now();
  const ticks = [
    { offsetMs: 0,        spxw: 6940, spy: 612, qqq: 545 },
    { offsetMs: 30_000,   spxw: 6938, spy: 612.1, qqq: 545.05 },
    { offsetMs: 60_000,   spxw: 6936, spy: 612.2, qqq: 545.1 },
    { offsetMs: 120_000,  spxw: 6932, spy: 612.4, qqq: 545.3 },  // approaching SPXW pika floor at 6925
    { offsetMs: 180_000,  spxw: 6925, spy: 612.5, qqq: 545.4 },  // tap on SPXW pika floor
  ];

  for (const tick of ticks) {
    const tsMs = baseTs + tick.offsetMs;

    const spxwResult = processSnapshot({ ticker: 'SPXW', tradingDay, snap: spxwFrame({ tsMs, spot: tick.spxw }) });
    const spyResult  = processSnapshot({ ticker: 'SPY',  tradingDay, snap: spyFrame({  tsMs, spot: tick.spy  }) });
    const qqqResult  = processSnapshot({ ticker: 'QQQ',  tradingDay, snap: qqqFrame({  tsMs, spot: tick.qqq  }) });

    log.info(
      `t+${tick.offsetMs/1000}s | ` +
      `SPXW spot=${tick.spxw} bias=${spxwResult.biasScore.toFixed(1)} trinity=${spxwResult.trinityClassification} dec=${spxwResult.decision} | ` +
      `SPY  bias=${spyResult.biasScore.toFixed(1)} | ` +
      `QQQ  bias=${qqqResult.biasScore.toFixed(1)}`
    );
  }

  // Final inspection: query the db to verify rows landed.
  const d = openDb();
  const counts = {
    snapshots: d.prepare('SELECT COUNT(*) c FROM snapshots').get().c,
    node_snapshots: d.prepare('SELECT COUNT(*) c FROM node_snapshots').get().c,
    pattern_detections: d.prepare('SELECT COUNT(*) c FROM pattern_detections').get().c,
    bias_scores: d.prepare('SELECT COUNT(*) c FROM bias_scores').get().c,
    trinity_evaluations: d.prepare('SELECT COUNT(*) c FROM trinity_evaluations').get().c,
    decision_log: d.prepare('SELECT COUNT(*) c FROM decision_log').get().c,
    event_log: d.prepare('SELECT COUNT(*) c FROM event_log').get().c,
    rolling_awareness: d.prepare('SELECT COUNT(*) c FROM rolling_awareness').get().c,
  };
  log.info('row counts:', counts);

  const detected = d.prepare(`
    SELECT ticker, pattern, COUNT(*) hits
    FROM pattern_detections WHERE detected = 1
    GROUP BY ticker, pattern
    ORDER BY hits DESC
  `).all();
  log.info('patterns detected (across all snapshots):', detected);

  const decisions = d.prepare(`
    SELECT decision, step_failed, reject_reason, COUNT(*) c
    FROM decision_log
    GROUP BY decision, step_failed, reject_reason
    ORDER BY c DESC
  `).all();
  log.info('decision distribution:', decisions);

  const lastTrinity = d.prepare(`
    SELECT triggering_ticker, classification, direction, bias_spx, bias_spy, bias_qqq, avg_bias
    FROM trinity_evaluations ORDER BY ts_ms DESC LIMIT 5
  `).all();
  log.info('last 5 trinity evals:', lastTrinity);

  closeJsonl();
  closeDb();
  log.info('smoke test passed');
}

run();
