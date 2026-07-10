-- Falcon-style tracked plays feed backed by the gex fire-state machine.
-- One row per candidate contract snapshot when a bearish/bullish pattern
-- enters an armed state. Updated every ~60s by the tracker service.

CREATE TABLE IF NOT EXISTS tracked_plays (
  play_id           BIGSERIAL PRIMARY KEY,
  fire_ts_ms        BIGINT NOT NULL,
  trading_day       DATE NOT NULL,
  ticker            TEXT NOT NULL,                          -- SPXW / SPY / QQQ
  state             TEXT NOT NULL,                          -- BEAR_RUG | BEAR_TRAPDOOR | BEAR_CONTINUE | BEAR_OVERNIGHT | BULL_REVERSE
  pattern_name      TEXT NOT NULL,                          -- rug_setup | trapdoor | vanna_persistent_bear | overnight_carryover | reverse_rug
  option_symbol     TEXT NOT NULL,                          -- OCC symbol
  option_type       TEXT NOT NULL CHECK (option_type IN ('put','call')),
  strike            NUMERIC(12,4) NOT NULL,
  expiration        DATE NOT NULL,
  spot_at_fire      NUMERIC(14,4) NOT NULL,
  entry_mark        NUMERIC(12,4) NOT NULL,
  entry_bid         NUMERIC(12,4),
  entry_ask         NUMERIC(12,4),
  current_mark      NUMERIC(12,4),
  current_ts_ms     BIGINT,
  best_mark         NUMERIC(12,4),
  best_mark_ts_ms   BIGINT,
  best_pct_gain     NUMERIC(9,4),
  status            TEXT NOT NULL DEFAULT 'live',           -- live | closed_state_clear | closed_eod | closed_expired
  close_ts_ms       BIGINT,
  close_mark        NUMERIC(12,4),
  close_reason      TEXT,
  supporting_state  JSONB
);

CREATE INDEX IF NOT EXISTS idx_tracked_plays_day_ticker
  ON tracked_plays (trading_day, ticker, fire_ts_ms DESC);

CREATE INDEX IF NOT EXISTS idx_tracked_plays_status
  ON tracked_plays (status, ticker)
  WHERE status = 'live';

CREATE INDEX IF NOT EXISTS idx_tracked_plays_symbol
  ON tracked_plays (option_symbol);
