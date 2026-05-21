-- Capital Flow Predictor — Explosive Options tab Phase 2: confirmation signals.
-- Layers 5 more UW endpoints onto the Phase 1 scoring engine:
--   /stock/{T}/nope                              -> uw_nope
--   /stock/{T}/historical-risk-reversal-skew     -> uw_risk_reversal_skew
--   /stock/{T}/realized-volatility               -> uw_realized_volatility
--   /option-contract/{symbol}/volume-profile     -> uw_volume_profile
--   /insiders/ticker-flow                        -> uw_insider_ticker_flow
--
-- Plus new sub-score columns on explosive_scores (NULL-safe ALTERs so existing
-- rows continue to render in the UI while the next scorer run backfills them).

CREATE TABLE IF NOT EXISTS uw_nope (
    snapshot_date       DATE NOT NULL,
    ticker              TEXT NOT NULL,
    nope               DOUBLE PRECISION,
    nope_z             DOUBLE PRECISION,             -- z-score vs trailing window if UW provides
    underlying_price   DOUBLE PRECISION,
    payload            JSONB,
    PRIMARY KEY (snapshot_date, ticker)
);
CREATE INDEX IF NOT EXISTS idx_uw_nope_ticker_date
    ON uw_nope (ticker, snapshot_date DESC);

CREATE TABLE IF NOT EXISTS uw_risk_reversal_skew (
    snapshot_date       DATE NOT NULL,
    ticker              TEXT NOT NULL,
    dte                 INTEGER NOT NULL,            -- 7, 30, 60, 90 (whatever buckets UW returns)
    skew                DOUBLE PRECISION,            -- call_iv - put_iv at 25-delta (signed)
    call_iv             DOUBLE PRECISION,
    put_iv              DOUBLE PRECISION,
    payload             JSONB,
    PRIMARY KEY (snapshot_date, ticker, dte)
);
CREATE INDEX IF NOT EXISTS idx_uw_rrs_ticker_date
    ON uw_risk_reversal_skew (ticker, snapshot_date DESC);

CREATE TABLE IF NOT EXISTS uw_realized_volatility (
    snapshot_date       DATE NOT NULL,
    ticker              TEXT NOT NULL,
    rv_window_days      INTEGER NOT NULL,            -- 10, 20, 30
    realized_volatility DOUBLE PRECISION,            -- annualized
    payload             JSONB,
    PRIMARY KEY (snapshot_date, ticker, rv_window_days)
);
CREATE INDEX IF NOT EXISTS idx_uw_rv_ticker_date
    ON uw_realized_volatility (ticker, snapshot_date DESC);

CREATE TABLE IF NOT EXISTS uw_volume_profile (
    snapshot_date       DATE NOT NULL,
    option_symbol       TEXT NOT NULL,
    ticker              TEXT NOT NULL,
    price_level         DOUBLE PRECISION NOT NULL,   -- underlying price bucket
    volume              BIGINT,
    premium             DOUBLE PRECISION,
    payload             JSONB,
    PRIMARY KEY (snapshot_date, option_symbol, price_level)
);
CREATE INDEX IF NOT EXISTS idx_uw_volume_profile_ticker_date
    ON uw_volume_profile (ticker, snapshot_date DESC);

CREATE TABLE IF NOT EXISTS uw_insider_ticker_flow (
    snapshot_date       DATE NOT NULL,
    ticker              TEXT NOT NULL,
    lookback_days       INTEGER NOT NULL,            -- typically 30 or 90
    net_buy_value       DOUBLE PRECISION,
    buy_count           INTEGER,
    sell_count          INTEGER,
    buy_value           DOUBLE PRECISION,
    sell_value          DOUBLE PRECISION,
    payload             JSONB,
    PRIMARY KEY (snapshot_date, ticker, lookback_days)
);
CREATE INDEX IF NOT EXISTS idx_uw_insider_flow_ticker_date
    ON uw_insider_ticker_flow (ticker, snapshot_date DESC);

-- Extend explosive_scores with the new sub-scores. NULL on legacy rows is fine
-- — the API and frontend treat missing sub-scores as 0.
ALTER TABLE explosive_scores ADD COLUMN IF NOT EXISTS iv_vs_rv_score      DOUBLE PRECISION;
ALTER TABLE explosive_scores ADD COLUMN IF NOT EXISTS skew_flip_score     DOUBLE PRECISION;
ALTER TABLE explosive_scores ADD COLUMN IF NOT EXISTS nope_score          DOUBLE PRECISION;
ALTER TABLE explosive_scores ADD COLUMN IF NOT EXISTS insider_buy_score   DOUBLE PRECISION;
ALTER TABLE explosive_scores ADD COLUMN IF NOT EXISTS volume_profile_score DOUBLE PRECISION;
