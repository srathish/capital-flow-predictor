-- 0019 — GEX plan outcomes (Level 1 self-grading).
--
-- For every CALLS / PUTS plan posted in a brief or monitor digest, score it
-- against actual intraday price action: did spot cross the break level, did
-- it then hit target before stop, and what was the realized R:R?
--
-- Inputs to the scorer (cfp_jobs.score_gex_plans):
--   gex_feed rows (source='brief'|'monitor', fields JSON parsed for plan lines)
--   yfinance 1-min bars for SPY / QQQ / ^GSPC (mapped to SPXW level scale)
--
-- One row per (feed_id, ticker, side). Idempotent — re-running the scorer
-- updates an existing row rather than inserting a duplicate.

CREATE TABLE IF NOT EXISTS gex_plan_outcomes (
    id              BIGSERIAL PRIMARY KEY,
    feed_id         BIGINT NOT NULL REFERENCES gex_feed(id) ON DELETE CASCADE,
    ticker          TEXT NOT NULL,            -- SPY / QQQ / SPXW
    trading_day     DATE NOT NULL,            -- ET calendar date of the brief
    side            TEXT NOT NULL,            -- 'CALLS' | 'PUTS'
    source          TEXT NOT NULL,            -- 'brief' | 'monitor'
    posted_at       TIMESTAMPTZ NOT NULL,
    -- Plan parameters as posted
    break_level     DOUBLE PRECISION NOT NULL,
    target          DOUBLE PRECISION NOT NULL,
    stop            DOUBLE PRECISION NOT NULL,
    predicted_rr    DOUBLE PRECISION,
    -- Outcome — populated by score_gex_plans
    entered_at      TIMESTAMPTZ,              -- when spot first crossed break_level after posted_at
    entered_spot    DOUBLE PRECISION,
    exited_at       TIMESTAMPTZ,
    exited_spot     DOUBLE PRECISION,
    exit_reason     TEXT,                     -- 'target' | 'stop' | 'expired' | 'pending'
    realized_pct    DOUBLE PRECISION,         -- (exited - entered) / entered, signed by side
    realized_rr     DOUBLE PRECISION,         -- abs(exited-entered) / abs(stop-break) when entered
    hit_target      BOOLEAN,
    hit_stop        BOOLEAN,
    -- Day-end realized move for context (regardless of whether plan triggered)
    day_high        DOUBLE PRECISION,
    day_low         DOUBLE PRECISION,
    day_close       DOUBLE PRECISION,
    last_scored_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (feed_id, ticker, side)
);

CREATE INDEX IF NOT EXISTS idx_gex_plan_outcomes_day
    ON gex_plan_outcomes (trading_day DESC, ticker);
CREATE INDEX IF NOT EXISTS idx_gex_plan_outcomes_source
    ON gex_plan_outcomes (source, trading_day DESC);
