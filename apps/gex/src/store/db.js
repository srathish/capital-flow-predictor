import Database from 'better-sqlite3';
import { readFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from '../utils/config.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('DB');
const __dirname = dirname(fileURLToPath(import.meta.url));

let db = null;

export function openDb() {
  if (db) return db;

  mkdirSync(config.dataDir, { recursive: true });
  const dbPath = join(config.dataDir, 'gexester.db');

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('temp_store = MEMORY');

  const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
  db.exec(schema);
  migrateTrackedPlays(db);

  log.info(`DB opened at ${dbPath}`);
  return db;
}

// Idempotent, additive migration: bring pre-existing DBs up to the current
// schema without a migration framework. ONLY adds nullable columns and
// backfills them once from the JSON blob — never drops or rewrites. Safe on
// every open, and does not touch the fire/exit decision path. (Research-only:
// enables a later confidence→MFE study.)
function migrateTrackedPlays(db) {
  const cols = new Set(db.prepare(`PRAGMA table_info(tracked_plays)`).all().map(c => c.name));
  let added = false;
  if (!cols.has('fire_confidence')) { db.exec(`ALTER TABLE tracked_plays ADD COLUMN fire_confidence REAL`); added = true; }
  if (!cols.has('fire_score'))      { db.exec(`ALTER TABLE tracked_plays ADD COLUMN fire_score REAL`); added = true; }
  if (added) {
    try {
      db.exec(`
        UPDATE tracked_plays
        SET fire_confidence = COALESCE(fire_confidence, json_extract(supporting_state, '$.patternDetection.confidence')),
            fire_score      = COALESCE(fire_score,      json_extract(supporting_state, '$.patternDetection.score'))
        WHERE supporting_state IS NOT NULL
      `);
    } catch (e) { log.warn(`tracked_plays confidence/score backfill skipped: ${e.message}`); }
  }
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

// Prepared statements — built lazily on first use, reused.
let stmts = null;

export function getStmts() {
  if (stmts) return stmts;
  const d = openDb();

  stmts = {
    insertSnapshot: d.prepare(`
      INSERT INTO snapshots
        (ts_ms, trading_day, ticker, spot, expiration, total_surface_gamma, signed_total_gamma,
         regime_score, king_strike, king_gamma, num_strikes, api_velocity)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    insertNodeSnapshot: d.prepare(`
      INSERT OR REPLACE INTO node_snapshots
        (snapshot_id, ts_ms, trading_day, ticker, strike, gamma, abs_gamma, sign,
         relative_significance, distance_from_spot, is_king)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    upsertLifecycle: d.prepare(`
      INSERT INTO node_lifecycle
        (ticker, strike, trading_day, lifecycle_state, tap_count, first_seen_ms,
         last_tap_ms, last_tap_spot, inside_zone, inside_since_ms, consolidation_logged)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(ticker, strike, trading_day) DO UPDATE SET
        lifecycle_state = excluded.lifecycle_state,
        tap_count = excluded.tap_count,
        last_tap_ms = excluded.last_tap_ms,
        last_tap_spot = excluded.last_tap_spot,
        inside_zone = excluded.inside_zone,
        inside_since_ms = excluded.inside_since_ms,
        consolidation_logged = excluded.consolidation_logged
    `),
    getLifecycle: d.prepare(`
      SELECT * FROM node_lifecycle WHERE ticker = ? AND strike = ? AND trading_day = ?
    `),
    insertEvent: d.prepare(`
      INSERT INTO event_log (ts_ms, trading_day, ticker, strike, event_type, payload)
      VALUES (?, ?, ?, ?, ?, ?)
    `),
    insertPattern: d.prepare(`
      INSERT OR REPLACE INTO pattern_detections
        (snapshot_id, ts_ms, trading_day, ticker, pattern, detected, confidence,
         pattern_score, supporting_strikes, conditions_met, flags, reject_reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    insertBiasScore: d.prepare(`
      INSERT OR REPLACE INTO bias_scores
        (snapshot_id, ts_ms, trading_day, ticker, bias_score,
         c_pattern_signal, c_king_node_position, c_floor_ceiling_proxim,
         c_regime_modifier, c_velocity_signal, c_rolling_signal,
         flags, weights_applied, supporting_state)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    insertTrinity: d.prepare(`
      INSERT INTO trinity_evaluations
        (ts_ms, trading_day, triggering_ticker, classification, direction,
         bias_spx, bias_spy, bias_qqq, avg_bias, spread,
         staleness_json, flags, whipsaw_detected)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    upsertAwareness: d.prepare(`
      INSERT INTO rolling_awareness
        (ticker, strike, trading_day, awareness_level, variant, paired_strike,
         direction, started_ms, last_update_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(ticker, strike, trading_day) DO UPDATE SET
        awareness_level = excluded.awareness_level,
        variant = excluded.variant,
        paired_strike = excluded.paired_strike,
        direction = excluded.direction,
        started_ms = excluded.started_ms,
        last_update_ms = excluded.last_update_ms
    `),
    insertDecision: d.prepare(`
      INSERT INTO decision_log
        (ts_ms, trading_day, ticker, snapshot_id, decision, step_failed, reject_reason,
         direction, bias_score, trinity_classification, proposed_plan, trace)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    listLifecycleForTickerDay: d.prepare(`
      SELECT * FROM node_lifecycle WHERE ticker = ? AND trading_day = ?
    `),
    recentSpotHistory: d.prepare(`
      SELECT ts_ms, spot FROM snapshots
      WHERE ticker = ? AND trading_day = ? AND ts_ms >= ?
      ORDER BY ts_ms ASC
    `),
  };

  return stmts;
}

export function txn(fn) {
  const d = openDb();
  return d.transaction(fn);
}
