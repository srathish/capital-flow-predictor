/**
 * Lifecycle state machine + tap detection per spec §1.2, §6.3.
 *
 * Lifecycle states: Fresh | Tested | Delivered | Broken
 *   Fresh     — never tapped this trading day
 *   Tested    — at least one tap registered
 *   Delivered — tapped, then price moved away ≥2× deflection_zone (defended successfully)
 *   Broken    — break-and-hold confirmed: price closed beyond stop level for ≥60s. Excluded from live trade logic.
 *
 * Sprint 1 implements Fresh → Tested transitions (tap detection) and Delivered detection
 * via distance check. Broken (break-and-hold confirmation) requires 1-min candle close
 * tracking — deferred until candle ingestion lands.
 *
 * Tap separation rule (§6.3): a new tap counts when price enters deflection zone AND has
 * been outside for ≥5 min OR moved ≥2× deflection_zone away since the last entry.
 *
 * Consolidation (§6.3): price inside zone for >10 min → consolidation_event logged.
 */

import { thresholds, deflectionZone } from '../utils/config.js';
import { tradingDayET } from '../utils/time.js';
import { getStmts } from '../store/db.js';
import { writeEvent } from '../store/jsonl-events.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('Lifecycle');

const COOLDOWN_MS = thresholds.tap_separation.cooldown_minutes * 60 * 1000;
const CONSOLIDATION_MS = thresholds.tap_separation.consolidation_threshold_minutes * 60 * 1000;
const DELIVERED_MULTIPLIER = thresholds.tap_separation.distance_multiplier_of_zone;

/**
 * Process one snapshot's worth of nodes for a ticker.
 * For each node, update lifecycle state based on whether spot is inside its deflection zone.
 * Emits tap / consolidation / delivered events.
 */
export function processLifecycle({ ticker, spot, nodes, tsMs, tradingDay }) {
  const stmts = getStmts();
  const zone = deflectionZone(ticker);
  const events = [];

  for (const node of nodes) {
    // Only track nodes with non-trivial significance — otherwise table explodes with noise.
    // Floor for tracking: gatekeeper threshold (3% by default). Can be loosened later.
    if (node.relativeSignificance < thresholds.node_significance.min_significance_for_gatekeeper) {
      continue;
    }

    const inside = Math.abs(spot - node.strike) <= zone;
    const existing = stmts.getLifecycle.get(ticker, node.strike, tradingDay);

    if (!existing) {
      // First time we see this strike this day. Initialize Fresh.
      stmts.upsertLifecycle.run(
        ticker, node.strike, tradingDay,
        'Fresh', 0, tsMs,
        null, null,
        inside ? 1 : 0,
        inside ? tsMs : null,
        0
      );
      // Edge case: initialized while already inside → count as first tap
      if (inside) {
        registerTap({ ticker, strike: node.strike, tradingDay, tsMs, spot, prevTapCount: 0, events });
      }
      continue;
    }

    const wasInside = existing.inside_zone === 1;

    if (inside && !wasInside) {
      // Transition outside → inside: candidate for new tap
      const cooldownElapsed = !existing.last_tap_ms || (tsMs - existing.last_tap_ms) >= COOLDOWN_MS;
      const distantEnough = !existing.last_tap_spot ||
        Math.abs(existing.last_tap_spot - spot) >= DELIVERED_MULTIPLIER * zone;
      const newTap = existing.tap_count === 0 || cooldownElapsed || distantEnough;

      if (newTap) {
        registerTap({
          ticker, strike: node.strike, tradingDay, tsMs, spot,
          prevTapCount: existing.tap_count, events
        });
      } else {
        // Re-entered without cooldown or distance — not a fresh tap, just update inside flag.
        stmts.upsertLifecycle.run(
          ticker, node.strike, tradingDay,
          existing.lifecycle_state,
          existing.tap_count,
          existing.first_seen_ms,
          existing.last_tap_ms,
          existing.last_tap_spot,
          1, tsMs,
          existing.consolidation_logged
        );
      }
    } else if (!inside && wasInside) {
      // Transition inside → outside. Check if "Delivered" criterion met.
      const movedAway = existing.last_tap_spot != null &&
        Math.abs(spot - node.strike) >= DELIVERED_MULTIPLIER * zone;
      const newState = (existing.lifecycle_state === 'Tested' && movedAway) ? 'Delivered' : existing.lifecycle_state;

      stmts.upsertLifecycle.run(
        ticker, node.strike, tradingDay,
        newState,
        existing.tap_count,
        existing.first_seen_ms,
        existing.last_tap_ms,
        existing.last_tap_spot,
        0, null,
        existing.consolidation_logged
      );

      if (newState !== existing.lifecycle_state) {
        const evt = {
          tsMs, tradingDay, ticker, strike: node.strike,
          eventType: 'lifecycle_delivered',
          payload: { fromState: existing.lifecycle_state, toState: newState, spot, tapCount: existing.tap_count }
        };
        events.push(evt);
        emit(evt);
      }
    } else if (inside && wasInside) {
      // Continuous time inside — check for consolidation event
      const elapsedInside = tsMs - (existing.inside_since_ms || tsMs);
      const shouldLog = elapsedInside >= CONSOLIDATION_MS && existing.consolidation_logged === 0;

      stmts.upsertLifecycle.run(
        ticker, node.strike, tradingDay,
        existing.lifecycle_state,
        existing.tap_count,
        existing.first_seen_ms,
        existing.last_tap_ms,
        existing.last_tap_spot,
        1,
        existing.inside_since_ms,
        shouldLog ? 1 : existing.consolidation_logged
      );

      if (shouldLog) {
        const evt = {
          tsMs, tradingDay, ticker, strike: node.strike,
          eventType: 'consolidation',
          payload: { durationMs: elapsedInside, spot, isKingNode: node.isKing }
        };
        events.push(evt);
        emit(evt);
      }
    }
    // else: outside and stayed outside — nothing to update
  }

  return events;
}

function registerTap({ ticker, strike, tradingDay, tsMs, spot, prevTapCount, events }) {
  const stmts = getStmts();
  const newCount = prevTapCount + 1;
  const tapBucket = newCount === 1 ? 'tap_1st' : newCount === 2 ? 'tap_2nd' : newCount === 3 ? 'tap_3rd' : 'tap_4plus';

  stmts.upsertLifecycle.run(
    ticker, strike, tradingDay,
    'Tested',
    newCount,
    tsMs,           // first_seen_ms — overwritten if existing, but ON CONFLICT preserves
    tsMs, spot,
    1, tsMs,
    0
  );

  const evt = {
    tsMs, tradingDay, ticker, strike,
    eventType: tapBucket,
    payload: { tapCount: newCount, spot, distanceAtEntry: Math.abs(spot - strike) }
  };
  events.push(evt);
  emit(evt);
  log.info(`${ticker} ${strike}: ${tapBucket} @ spot=${spot.toFixed(2)}`);
}

function emit(evt) {
  const stmts = getStmts();
  const payloadJson = JSON.stringify(evt.payload);
  stmts.insertEvent.run(evt.tsMs, evt.tradingDay, evt.ticker, evt.strike, evt.eventType, payloadJson);
  writeEvent(evt.tradingDay, 'lifecycle', { ts: evt.tsMs, ...evt, payload: evt.payload });
}
