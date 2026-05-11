-- Capital Flow Predictor — Whale Conviction layer.
--
-- Three new tables that turn the existing UW feeds from "raw events" into
-- "moments where somebody is making a real bet":
--
--   1. uw_volatility_stats  — per-ticker IV rank / IV percentile / IV30
--      Regime context: buying calls when IV is dirt cheap is a *much* bolder
--      signal than buying calls when IV is already rich.
--
--   2. uw_market_tide       — market-wide net call/put premium tape (UW's
--      flagship "is the whole tape risk-on right now?" feed). Lets us mark a
--      single-name bet as with-tape vs against-tape (against = bolder).
--
--   3. whale_conviction_signals — derived. One row per (window, ticker) with
--      a 0..100 conviction score, the why (json reasons), and the dominant
--      direction. This is what the Flow tab's "Whale Bets" feed reads.

-- ----------------------------------------------------------------------------
-- IV regime stats per ticker.
-- Endpoint: /api/stock/{ticker}/volatility/stats
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uw_volatility_stats (
    snapshot_date     DATE NOT NULL,
    ticker            TEXT NOT NULL,
    iv30              DOUBLE PRECISION,     -- 30d implied vol, fraction (0.42 = 42%)
    iv_rank           DOUBLE PRECISION,     -- 0..1 — where IV30 sits in its 52w range
    iv_percentile     DOUBLE PRECISION,     -- 0..1 — pct of days in last 52w with IV30 <= today
    rv30              DOUBLE PRECISION,     -- realized 30d vol, fraction
    iv_rv_ratio       DOUBLE PRECISION,     -- iv30 / rv30 — > 1 = vol is rich
    last_fetched      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (snapshot_date, ticker)
);
CREATE INDEX IF NOT EXISTS idx_uw_vol_stats_ticker_date
    ON uw_volatility_stats (ticker, snapshot_date DESC);

-- ----------------------------------------------------------------------------
-- Market-wide net premium tape ("market tide").
-- Endpoint: /api/market/market-tide  (intraday, ~5min resolution)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uw_market_tide (
    ts                TIMESTAMPTZ NOT NULL,
    net_call_premium  DOUBLE PRECISION,     -- ask-side minus bid-side, calls, $
    net_put_premium   DOUBLE PRECISION,
    net_volume        BIGINT,
    PRIMARY KEY (ts)
);
CREATE INDEX IF NOT EXISTS idx_uw_market_tide_ts
    ON uw_market_tide (ts DESC);

-- ----------------------------------------------------------------------------
-- Derived: Whale Conviction signals.
-- One row per (window_end, ticker). Re-derived every few minutes from the raw
-- feeds. Score combines: ask-side premium, sweep + opening flag, vol/OI,
-- $ size vs ticker baseline, dark-pool blocks above mid, recent insider buy,
-- recent congress buy, IV regime, tape alignment.
--
-- We keep the score history (not a single live snapshot) so the UI can sparkline
-- conviction over time and the ranker can train against forward returns later.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS whale_conviction_signals (
    window_end        TIMESTAMPTZ NOT NULL,
    ticker            TEXT NOT NULL,
    window_hours      INTEGER NOT NULL,        -- typically 4 or 24
    direction         TEXT NOT NULL,           -- 'bull' | 'bear'
    score             DOUBLE PRECISION NOT NULL,  -- 0..100
    -- Premium aggregates over the window:
    call_premium      DOUBLE PRECISION,
    put_premium       DOUBLE PRECISION,
    ask_side_premium  DOUBLE PRECISION,        -- side-of-trade premium for dominant direction
    sweep_count       INTEGER,
    block_count       INTEGER,
    opening_share     DOUBLE PRECISION,        -- fraction of premium tagged opening trades
    vol_oi_max        DOUBLE PRECISION,
    -- Cross-signal corroboration:
    dark_pool_above_mid_prem DOUBLE PRECISION, -- dark prints above NBBO mid in window
    insider_buy_7d     DOUBLE PRECISION,       -- $ insider buys last 7d
    congress_buy_14d   INTEGER,                -- count of Congress buys last 14d
    -- Regime context:
    iv_rank            DOUBLE PRECISION,
    against_tape       BOOLEAN,                -- bet direction opposite to market tide
    -- Human-readable reasons (array of short strings) — drives the "why" pill list.
    reasons            JSONB,
    PRIMARY KEY (window_end, ticker, window_hours)
);
CREATE INDEX IF NOT EXISTS idx_whale_conviction_ts
    ON whale_conviction_signals (window_end DESC, score DESC);
CREATE INDEX IF NOT EXISTS idx_whale_conviction_ticker
    ON whale_conviction_signals (ticker, window_end DESC);
