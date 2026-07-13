-- gexester-vexster Phase 1 schema
-- Hot tier (SQLite, last ≤7 days). Warm Parquet rollover added around session 50.

PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA temp_store = MEMORY;

-- One row per fetched snapshot per ticker. Identifies the surface state at time T.
CREATE TABLE IF NOT EXISTS snapshots (
  snapshot_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  ts_ms           INTEGER NOT NULL,
  trading_day     TEXT    NOT NULL,
  ticker          TEXT    NOT NULL,
  spot            REAL    NOT NULL,
  expiration      TEXT,
  total_surface_gamma REAL NOT NULL,   -- sum(|gamma|) across all strikes
  signed_total_gamma  REAL NOT NULL,   -- sum(gamma) — used for regime score
  regime_score    REAL    NOT NULL,    -- signed_total_gamma / total_surface_gamma
  king_strike     REAL,                -- argmax(|gamma|)
  king_gamma      REAL,
  num_strikes     INTEGER NOT NULL,
  api_velocity    TEXT                 -- JSON blob of API's velocity_update for cross-validation
);

CREATE INDEX IF NOT EXISTS idx_snapshots_ticker_ts ON snapshots(ticker, ts_ms);
CREATE INDEX IF NOT EXISTS idx_snapshots_day ON snapshots(trading_day, ticker);

-- One row per (snapshot, strike). The full surface preserved for pattern discovery (Overlay #10).
CREATE TABLE IF NOT EXISTS node_snapshots (
  snapshot_id     INTEGER NOT NULL,
  ts_ms           INTEGER NOT NULL,
  trading_day     TEXT    NOT NULL,
  ticker          TEXT    NOT NULL,
  strike          REAL    NOT NULL,
  gamma           REAL    NOT NULL,    -- signed gamma value
  abs_gamma       REAL    NOT NULL,
  sign            TEXT    NOT NULL,    -- 'pika' | 'barney' | 'zero'
  relative_significance REAL NOT NULL, -- abs_gamma / total_surface_gamma
  distance_from_spot REAL NOT NULL,
  is_king         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (snapshot_id, strike),
  FOREIGN KEY (snapshot_id) REFERENCES snapshots(snapshot_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_node_snapshots_node_ts ON node_snapshots(ticker, strike, trading_day, ts_ms);

-- Lifecycle state per (ticker, strike, trading_day). Updated as taps land and price moves.
CREATE TABLE IF NOT EXISTS node_lifecycle (
  ticker          TEXT    NOT NULL,
  strike          REAL    NOT NULL,
  trading_day     TEXT    NOT NULL,
  lifecycle_state TEXT    NOT NULL,    -- 'Fresh' | 'Tested' | 'Delivered' | 'Broken'
  tap_count       INTEGER NOT NULL DEFAULT 0,
  first_seen_ms   INTEGER NOT NULL,
  last_tap_ms     INTEGER,
  last_tap_spot   REAL,
  inside_zone     INTEGER NOT NULL DEFAULT 0,  -- 1 if price currently inside deflection zone
  inside_since_ms INTEGER,
  consolidation_logged INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ticker, strike, trading_day)
);

CREATE INDEX IF NOT EXISTS idx_lifecycle_day ON node_lifecycle(trading_day, ticker);

-- Event log table. Mirrored to JSONL on disk for grep-ability per Overlay #9.
-- Event types: snapshot_persisted | tap_1st | tap_2nd | tap_3rd | tap_4plus
--              | consolidation | king_node_shift | regime_change | auth_refreshed
CREATE TABLE IF NOT EXISTS event_log (
  event_id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ts_ms           INTEGER NOT NULL,
  trading_day     TEXT    NOT NULL,
  ticker          TEXT,
  strike          REAL,
  event_type      TEXT    NOT NULL,
  payload         TEXT    NOT NULL    -- JSON
);

CREATE INDEX IF NOT EXISTS idx_event_log_day_type ON event_log(trading_day, event_type);
CREATE INDEX IF NOT EXISTS idx_event_log_ts ON event_log(ts_ms);

-- Trade outcome log per spec §6.11. Empty in Sprint 1; populated when execution layer lands.
CREATE TABLE IF NOT EXISTS trade_outcome_log (
  trade_id        INTEGER PRIMARY KEY AUTOINCREMENT,
  decision_ts_ms  INTEGER NOT NULL,
  trading_day     TEXT    NOT NULL,
  decision_type   TEXT    NOT NULL,    -- 'entry' | 'exit' | 'rejected'
  ticker          TEXT,
  trade_direction TEXT,                -- 'calls' | 'puts'
  entry_price     REAL,
  entry_node_strike REAL,
  stop_price      REAL,
  target_prices   TEXT,                -- JSON array
  size            REAL,
  reasoning       TEXT NOT NULL,       -- JSON
  outcome         TEXT                 -- JSON, filled on exit
);

CREATE INDEX IF NOT EXISTS idx_trade_log_day ON trade_outcome_log(trading_day);

-- Pattern detections per snapshot per ticker (Sprint 2).
CREATE TABLE IF NOT EXISTS pattern_detections (
  snapshot_id     INTEGER NOT NULL,
  ts_ms           INTEGER NOT NULL,
  trading_day     TEXT    NOT NULL,
  ticker          TEXT    NOT NULL,
  pattern         TEXT    NOT NULL,   -- 'rug_setup' | 'reverse_rug' | 'pika_cloud' | 'beach_ball' | 'rainbow_road' | 'whipsaw'
  detected        INTEGER NOT NULL,
  confidence      REAL    NOT NULL,
  pattern_score   REAL    NOT NULL,   -- contribution to bias pattern_signal component
  supporting_strikes TEXT,            -- JSON array
  conditions_met  TEXT,                -- JSON array
  flags           TEXT,                -- JSON array — chop / caution / no_trade etc.
  reject_reason   TEXT,
  PRIMARY KEY (snapshot_id, ticker, pattern)
);

CREATE INDEX IF NOT EXISTS idx_patterns_day ON pattern_detections(trading_day, ticker, pattern);
CREATE INDEX IF NOT EXISTS idx_patterns_detected ON pattern_detections(trading_day, ticker, detected);

-- Bias scores per snapshot per ticker (Sprint 3).
CREATE TABLE IF NOT EXISTS bias_scores (
  snapshot_id     INTEGER NOT NULL,
  ts_ms           INTEGER NOT NULL,
  trading_day     TEXT    NOT NULL,
  ticker          TEXT    NOT NULL,
  bias_score      REAL    NOT NULL,
  c_pattern_signal       REAL NOT NULL,
  c_king_node_position   REAL NOT NULL,
  c_floor_ceiling_proxim REAL NOT NULL,
  c_regime_modifier      REAL NOT NULL,
  c_velocity_signal      REAL NOT NULL,
  c_rolling_signal       REAL NOT NULL,
  flags                  TEXT,         -- JSON
  weights_applied        TEXT NOT NULL, -- JSON
  supporting_state       TEXT NOT NULL, -- JSON: patterns, king/floor/ceiling, regime, spot
  PRIMARY KEY (snapshot_id, ticker)
);

CREATE INDEX IF NOT EXISTS idx_bias_day_ticker ON bias_scores(trading_day, ticker, ts_ms);

-- Trinity evaluations — one row per evaluation triggered by a ticker's snapshot (Sprint 4).
CREATE TABLE IF NOT EXISTS trinity_evaluations (
  eval_id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts_ms           INTEGER NOT NULL,
  trading_day     TEXT    NOT NULL,
  triggering_ticker TEXT  NOT NULL,
  classification  TEXT    NOT NULL,
  direction       TEXT,                  -- 'calls' | 'puts' | 'informational_only' | NULL
  bias_spx        REAL,
  bias_spy        REAL,
  bias_qqq        REAL,
  avg_bias        REAL,
  spread          REAL,
  staleness_json  TEXT NOT NULL,
  flags           TEXT,
  whipsaw_detected INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_trinity_day ON trinity_evaluations(trading_day, ts_ms);
CREATE INDEX IF NOT EXISTS idx_trinity_class ON trinity_evaluations(trading_day, classification);

-- Rolling awareness state — current per (ticker, strike, day) (Sprint 3 — Overlay #6).
CREATE TABLE IF NOT EXISTS rolling_awareness (
  ticker          TEXT    NOT NULL,
  strike          REAL    NOT NULL,
  trading_day     TEXT    NOT NULL,
  awareness_level TEXT    NOT NULL,  -- None | Watching | Monitoring | Tracking | Confirmed
  variant         TEXT,                -- realized | anticipatory_wide | anticipatory_tight
  paired_strike   REAL,
  direction       TEXT,                -- growing | decaying | NULL
  started_ms      INTEGER,
  last_update_ms  INTEGER NOT NULL,
  PRIMARY KEY (ticker, strike, trading_day)
);

-- 9-step decision log — one row per evaluation that ran past Step 1 (Sprint 5).
CREATE TABLE IF NOT EXISTS decision_log (
  decision_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  ts_ms           INTEGER NOT NULL,
  trading_day     TEXT    NOT NULL,
  ticker          TEXT    NOT NULL,
  snapshot_id     INTEGER,
  decision        TEXT    NOT NULL,     -- 'would_enter' | 'reject'
  step_failed     INTEGER,                 -- 1-9 if rejected, NULL if accepted
  reject_reason   TEXT,
  direction       TEXT,                    -- 'calls' | 'puts' | NULL
  bias_score      REAL,
  trinity_classification TEXT,
  proposed_plan   TEXT,                    -- JSON of execution.planTrade output
  trace           TEXT NOT NULL            -- JSON array of step-by-step results
);

CREATE INDEX IF NOT EXISTS idx_decision_day_ticker ON decision_log(trading_day, ticker, ts_ms);
CREATE INDEX IF NOT EXISTS idx_decision_outcome ON decision_log(trading_day, decision);

-- Tracked plays — one row per candidate contract snapshot on a state-fire event.
-- Populated by fire-state.js -> tracker service. Polled every 60s for best_mark update.
CREATE TABLE IF NOT EXISTS tracked_plays (
  play_id           INTEGER PRIMARY KEY AUTOINCREMENT,
  fire_ts_ms        INTEGER NOT NULL,
  trading_day       TEXT    NOT NULL,
  ticker            TEXT    NOT NULL,     -- underlying (SPXW/SPY/QQQ)
  state             TEXT    NOT NULL,     -- BEAR_RUG | BEAR_TRAPDOOR | BEAR_CONTINUE | BEAR_OVERNIGHT | BULL_REVERSE
  pattern_name      TEXT    NOT NULL,
  option_symbol     TEXT    NOT NULL,     -- OCC symbol e.g. SPXW260707P07505000
  option_type       TEXT    NOT NULL,     -- 'put' | 'call'
  strike            REAL    NOT NULL,
  expiration        TEXT    NOT NULL,     -- YYYY-MM-DD
  spot_at_fire      REAL    NOT NULL,
  entry_mark        REAL    NOT NULL,     -- option mid at fire
  entry_bid         REAL,
  entry_ask         REAL,
  current_mark      REAL,                 -- latest polled mid
  current_ts_ms     INTEGER,
  best_mark         REAL,                 -- max mid seen since entry
  best_mark_ts_ms   INTEGER,
  best_pct_gain     REAL,                 -- (best_mark - entry_mark) / entry_mark
  status            TEXT    NOT NULL,     -- 'live' | 'closed_state_clear' | 'closed_eod' | 'closed_expired' | 'closed_trail_stop' | 'closed_structure_invalidated'
  close_ts_ms       INTEGER,
  close_mark        REAL,
  close_reason      TEXT,
  supporting_state  TEXT,                 -- JSON blob: fire event context
  fire_confidence   REAL,                 -- patternDetection.confidence at fire (research: confidence->MFE cut)
  fire_score        REAL                  -- patternDetection.score at fire
);

CREATE INDEX IF NOT EXISTS idx_plays_day_ticker ON tracked_plays(trading_day, ticker, fire_ts_ms);
CREATE INDEX IF NOT EXISTS idx_plays_status ON tracked_plays(status, ticker);
CREATE INDEX IF NOT EXISTS idx_plays_symbol ON tracked_plays(option_symbol);
