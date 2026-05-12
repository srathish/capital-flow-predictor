/**
 * Snapshot poller — full Phase 1 pipeline (Sprints 1-5 integrated).
 *
 * Per ticker, per tick:
 *   1. fetch SSE snapshot from Heatseeker
 *   2. computeSurface → relative_significance, king, regime, signed totals
 *   3. recordSample (velocity buffers) + computeVelocity for every tracked node
 *   4. deriveStructure → floor / ceiling / gatekeepers / air pockets
 *   5. processLifecycle → tap detection, Fresh→Tested→Delivered, consolidation events
 *   6. classifyNode (hedge/real/ambiguous) per tracked node
 *   7. updateAwareness (rolling tier escalation) per floor/ceiling
 *   8. runPerTickerPatterns → 5 detectors (whipsaw is cross-ticker)
 *   9. computeBiasScore → six-component weighted score, flags
 *  10. classifyTrinity → cross-ticker confluence (using freshest bias for the OTHER tickers)
 *  11. evaluateSetup (9-step synthesis) → decision: would_enter | reject + full trace
 *  12. persist EVERYTHING in transactions
 *
 * V1 produces SIGNALS only. No live trades. Phase 2 hooks broker integration.
 */

import { fetchSnapshot } from '../heatseeker/client.js';
import { computeSurface } from '../domain/significance.js';
import { processLifecycle } from '../domain/lifecycle.js';
import { recordSample, computeVelocity } from '../domain/velocity.js';
import { deriveStructure } from '../domain/structure.js';
import { classifyNode } from '../domain/classification.js';
import { updateAwareness, snapshotAwarenessForPersist } from '../domain/awareness.js';
import { runPerTickerPatterns } from '../domain/patterns/index.js';
import { computeBiasScore } from '../domain/bias.js';
import { classifyTrinity } from '../domain/trinity.js';
import { evaluateSetup } from '../domain/synthesis.js';
import { getStmts, txn, openDb } from '../store/db.js';
import { writeEvent } from '../store/jsonl-events.js';
import { config, thresholds } from '../utils/config.js';
import { tradingDayET } from '../utils/time.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('Poller');

let running = false;
let timer = null;

// In-memory cache of latest bias per ticker (for trinity classification).
// Keyed by source symbol (SPXW/SPY/QQQ). trinity.js handles SPXW→SPX mapping
// internally for the per-ticker bias dictionary keys.
const latestBiasByTicker = new Map();

const SPOT_HISTORY_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

export function startPoller() {
  if (running) return;
  running = true;
  log.info(`Starting poller | tickers=${config.tickers.join(',')} | interval=${config.pollIntervalMs}ms`);
  schedule(0);
}

export function stopPoller() {
  running = false;
  if (timer) clearTimeout(timer);
  timer = null;
}

function schedule(delay) {
  if (!running) return;
  timer = setTimeout(tick, delay);
}

async function tick() {
  const start = Date.now();
  try {
    await pollOnce();
  } catch (err) {
    log.error('Poll cycle failed:', err.message);
  }
  const elapsed = Date.now() - start;
  const next = Math.max(0, config.pollIntervalMs - elapsed);
  schedule(next);
}

async function pollOnce() {
  const tradingDay = tradingDayET();

  const results = await Promise.allSettled(
    config.tickers.map(t => fetchAndProcess(t, tradingDay))
  );

  const summary = results.map((r, i) => {
    const t = config.tickers[i];
    if (r.status === 'fulfilled') {
      const v = r.value;
      return `${t}=${v.numStrikes}n bias=${v.biasScore?.toFixed(0) ?? '-'} trinity=${v.trinityClassification ?? '-'} ${v.decision ?? '-'}`;
    }
    return `${t}=ERR(${r.reason.message?.slice(0, 30)})`;
  }).join(' | ');
  log.info(`tick | ${summary}`);
}

async function fetchAndProcess(ticker, tradingDay) {
  const snap = await fetchSnapshot(ticker);
  return processSnapshot({ ticker, tradingDay, snap });
}

/**
 * Pure-ish processor — works on either a live `snap` (from fetchSnapshot) or
 * a synthetic snapshot for the smoke test.
 */
export function processSnapshot({ ticker, tradingDay, snap }) {
  const stmts = getStmts();
  const tsMs = snap.fetchedAtMs;
  const surface = computeSurface(snap.strikes, snap.spot);
  const structure = deriveStructure({ nodes: surface.nodes, spot: snap.spot });

  // Build per-strike velocity map BEFORE recording new samples (so velocity reflects history-up-to-now).
  const velocityByStrike = new Map();
  for (const n of surface.nodes) {
    velocityByStrike.set(n.strike, computeVelocity({
      ticker, strike: n.strike, tradingDay, tsMs,
      relativeSignificance: n.relativeSignificance,
    }));
  }
  // Record new samples for next tick.
  for (const n of surface.nodes) {
    recordSample({ ticker, strike: n.strike, tradingDay, tsMs, relativeSignificance: n.relativeSignificance });
  }

  // Persist snapshot + per-node rows in one transaction.
  let snapshotId;
  txn(() => {
    const info = stmts.insertSnapshot.run(
      tsMs, tradingDay, ticker, snap.spot, snap.expiration,
      surface.totalAbs, surface.signedTotal, surface.regimeScore,
      surface.kingStrike, surface.kingGamma, surface.nodes.length,
      snap.apiVelocity ? JSON.stringify(snap.apiVelocity) : null
    );
    snapshotId = info.lastInsertRowid;
    for (const n of surface.nodes) {
      stmts.insertNodeSnapshot.run(
        snapshotId, tsMs, tradingDay, ticker,
        n.strike, n.gamma, n.absGamma, n.sign,
        n.relativeSignificance, n.distanceFromSpot, n.isKing ? 1 : 0
      );
    }
  })();

  // Lifecycle (tap detection, transitions) in its own txn.
  txn(() =>
    processLifecycle({ ticker, spot: snap.spot, nodes: surface.nodes, tsMs, tradingDay })
  )();

  // Build lookups for downstream layers.
  const lifecycleRows = stmts.listLifecycleForTickerDay.all(ticker, tradingDay);
  const lifecycleByStrike = new Map(lifecycleRows.map(r => [r.strike, r]));

  // Classify nodes (hedge/real/ambiguous) and update awareness on floor/ceiling.
  const classByStrike = new Map();
  for (const n of surface.nodes) {
    if (n.relativeSignificance < thresholds.node_significance.min_significance_for_gatekeeper) continue;
    const cls = classifyNode({
      node: n,
      velocity: velocityByStrike.get(n.strike),
      lifecycle: lifecycleByStrike.get(n.strike),
      spot: snap.spot,
    });
    classByStrike.set(n.strike, cls);
  }

  for (const node of [structure.floor, structure.ceiling].filter(Boolean)) {
    updateAwareness({
      ticker, strike: node.strike, tradingDay, tsMs,
      velocity: velocityByStrike.get(node.strike),
      structure, spot: snap.spot,
    });
  }

  // Patterns (per-ticker — whipsaw runs at trinity layer).
  const spotHistory = stmts.recentSpotHistory.all(ticker, tradingDay, tsMs - SPOT_HISTORY_WINDOW_MS);
  spotHistory.push({ ts_ms: tsMs, spot: snap.spot });
  const detections = runPerTickerPatterns({
    ticker, nodes: surface.nodes, spot: snap.spot, structure,
    spotHistory: spotHistory.map(r => ({ tsMs: r.ts_ms, spot: r.spot })),
  });

  // Bias score.
  const bias = computeBiasScore({
    ticker, tradingDay, spot: snap.spot,
    regimeScore: surface.regimeScore,
    nodes: surface.nodes, structure, detections,
    velocityByStrike, classByStrike, lifecycleByStrike,
  });

  // Update latest-bias cache for trinity. Use the source ticker symbol (SPXW/SPY/QQQ)
  // throughout so trinity_evaluations.triggering_ticker matches decision_log.ticker on JOIN.
  // The canonical SPX label is purely for display in spec text — never persisted.
  latestBiasByTicker.set(ticker, { ...bias, tsMs });

  const trinity = classifyTrinity({ latestBiasByTicker, triggeringTicker: ticker, tsMs });

  // 9-step synthesis.
  const decision = evaluateSetup({
    ticker, spot: snap.spot, tsMs, tradingDay, snapshotId,
    nodes: surface.nodes, structure, detections,
    regimeScore: surface.regimeScore,
    bias, trinity,
    velocityByStrike, classByStrike, lifecycleByStrike,
    spotHistory: spotHistory.map(r => ({ tsMs: r.ts_ms, spot: r.spot })),
    chartContext: null, // heatmap-only mode — Step 2 uses floor/ceiling proximity
  });

  // Persist analysis output (patterns, bias, trinity, awareness, decision).
  txn(() => {
    // Patterns
    for (const [, det] of Object.entries(detections)) {
      stmts.insertPattern.run(
        snapshotId, tsMs, tradingDay, ticker, det.pattern,
        det.detected ? 1 : 0, det.confidence ?? 0, det.score ?? 0,
        JSON.stringify(det.supportingStrikes ?? []),
        JSON.stringify(det.conditionsMet ?? []),
        JSON.stringify(det.flags ?? []),
        det.rejectReason ?? null
      );
    }
    // Bias
    stmts.insertBiasScore.run(
      snapshotId, tsMs, tradingDay, ticker, bias.biasScore,
      bias.components.pattern_signal,
      bias.components.king_node_position,
      bias.components.floor_ceiling_proximity,
      bias.components.regime_modifier,
      bias.components.velocity_signal,
      bias.components.rolling_signal,
      JSON.stringify(bias.flags),
      JSON.stringify(bias.weightsApplied),
      JSON.stringify(bias.supportingState)
    );
    // Trinity — triggering_ticker is the source symbol so it joins to decision_log.ticker.
    // bias_spx stays under the canonical "SPX" key inside the biases map (SPXW maps there).
    stmts.insertTrinity.run(
      tsMs, tradingDay, ticker, trinity.classification, trinity.direction ?? null,
      trinity.biases?.SPX ?? null, trinity.biases?.SPY ?? null, trinity.biases?.QQQ ?? null,
      trinity.avg ?? null, trinity.spread ?? null,
      JSON.stringify(trinity.staleness ?? {}),
      JSON.stringify(trinity.flags ?? []),
      trinity.whipsaw?.detected ? 1 : 0
    );
    // Awareness rows
    for (const a of snapshotAwarenessForPersist({ ticker, tradingDay })) {
      stmts.upsertAwareness.run(
        a.ticker, a.strike, a.tradingDay,
        a.level, a.variant, a.paired,
        a.lastDirection, a.startedMs, tsMs
      );
    }
    // Decision
    stmts.insertDecision.run(
      tsMs, tradingDay, ticker, snapshotId,
      decision.accepted ? 'would_enter' : 'reject',
      decision.stepFailed ?? null,
      decision.rejectReason ?? null,
      decision.direction ?? null,
      bias.biasScore,
      trinity.classification,
      decision.plan ? JSON.stringify(decision.plan) : null,
      JSON.stringify(decision.trace ?? [])
    );
  })();

  // JSONL mirror for VS Code grep-ability.
  writeEvent(tradingDay, 'pipeline', {
    ts: tsMs, ticker, spot: snap.spot,
    regime: surface.regimeScore,
    bias: bias.biasScore,
    detected: bias.supportingState.patternsDetected,
    trinity: trinity.classification,
    decision: decision.accepted ? 'would_enter' : `reject:step${decision.stepFailed}:${decision.rejectReason}`,
  });

  return {
    ticker,
    spot: snap.spot,
    numStrikes: surface.nodes.length,
    biasScore: bias.biasScore,
    trinityClassification: trinity.classification,
    decision: decision.accepted ? 'would_enter' : 'reject',
    plan: decision.plan,
  };
}
