-- Capital Flow Predictor — Explosive Options tab (Phase 1)
-- Goal: surface options that could explode 1→300 by combining (a) UW's
-- pre-built contract screener, (b) per-strike/expiry flow concentration,
-- (c) IV term-structure inversion, (d) short-squeeze setup, and (e) a
-- catalyst calendar (earnings + FDA + IPO).
--
-- Tables mirror the UW endpoints we're adding in this phase:
--   /screeners/contract_screener       -> uw_contract_screener
--   /stock/{T}/flow_per_strike         -> uw_flow_per_strike
--   /stock/{T}/flow_per_expiry         -> uw_flow_per_expiry
--   /stock/{T}/implied_volatility_term_structure -> uw_iv_term_structure
--   /stock/{T}/max_pain                -> uw_max_pain
--   /short/short_screener              -> uw_short_screener
--   /short/failures_to_deliver         -> uw_failures_to_deliver
--   /market/fda_calendar               -> uw_fda_calendar
--   /intel/ipo_calendar                -> uw_ipo_calendar
--
-- Plus the computed score table the API reads from:
--   explosive_scores                   -> top-N ranked feed

-- ----------------------------------------------------------------------------
-- Contract screener: UW's "hottest chains" — pre-ranked unusual option contracts.
-- Endpoint: /screeners/contract_screener
-- Snapshot model: one row per (snapshot_ts, option_symbol). We keep raw payload
-- because UW returns lots of derived fields we may surface later.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uw_contract_screener (
    snapshot_ts         TIMESTAMPTZ NOT NULL,
    option_symbol       TEXT NOT NULL,           -- OCC, e.g. RGTI260516C00010000
    ticker              TEXT NOT NULL,
    option_type         TEXT NOT NULL,           -- 'call' | 'put'
    expiry              DATE NOT NULL,
    strike              DOUBLE PRECISION NOT NULL,
    underlying_price    DOUBLE PRECISION,
    last_price          DOUBLE PRECISION,
    volume              BIGINT,
    open_interest       BIGINT,
    volume_oi_ratio     DOUBLE PRECISION,
    total_premium       DOUBLE PRECISION,
    ask_side_prem       DOUBLE PRECISION,
    bid_side_prem       DOUBLE PRECISION,
    iv                  DOUBLE PRECISION,
    delta               DOUBLE PRECISION,
    gamma               DOUBLE PRECISION,
    theta               DOUBLE PRECISION,
    vega                DOUBLE PRECISION,
    payload             JSONB,
    PRIMARY KEY (snapshot_ts, option_symbol)
);
CREATE INDEX IF NOT EXISTS idx_uw_contract_screener_ticker_ts
    ON uw_contract_screener (ticker, snapshot_ts DESC);
CREATE INDEX IF NOT EXISTS idx_uw_contract_screener_ts
    ON uw_contract_screener (snapshot_ts DESC);

-- ----------------------------------------------------------------------------
-- Per-strike flow: where the buying is concentrating on a given ticker.
-- Endpoint: /stock/{T}/flow_per_strike
-- One snapshot per (ticker, snapshot_date, expiry, strike).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uw_flow_per_strike (
    snapshot_date       DATE NOT NULL,
    ticker              TEXT NOT NULL,
    expiry              DATE NOT NULL,
    strike              DOUBLE PRECISION NOT NULL,
    call_volume         BIGINT,
    put_volume          BIGINT,
    call_premium        DOUBLE PRECISION,
    put_premium         DOUBLE PRECISION,
    call_ask_premium    DOUBLE PRECISION,        -- aggressive buying
    call_bid_premium    DOUBLE PRECISION,
    put_ask_premium     DOUBLE PRECISION,
    put_bid_premium     DOUBLE PRECISION,
    call_oi             BIGINT,
    put_oi              BIGINT,
    payload             JSONB,
    PRIMARY KEY (snapshot_date, ticker, expiry, strike)
);
CREATE INDEX IF NOT EXISTS idx_uw_flow_per_strike_ticker_date
    ON uw_flow_per_strike (ticker, snapshot_date DESC);

-- ----------------------------------------------------------------------------
-- Per-expiry flow: which expiration is being targeted.
-- Endpoint: /stock/{T}/flow_per_expiry
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uw_flow_per_expiry (
    snapshot_date       DATE NOT NULL,
    ticker              TEXT NOT NULL,
    expiry              DATE NOT NULL,
    call_volume         BIGINT,
    put_volume          BIGINT,
    call_premium        DOUBLE PRECISION,
    put_premium         DOUBLE PRECISION,
    call_ask_premium    DOUBLE PRECISION,
    put_ask_premium     DOUBLE PRECISION,
    call_oi             BIGINT,
    put_oi              BIGINT,
    payload             JSONB,
    PRIMARY KEY (snapshot_date, ticker, expiry)
);
CREATE INDEX IF NOT EXISTS idx_uw_flow_per_expiry_ticker_date
    ON uw_flow_per_expiry (ticker, snapshot_date DESC);

-- ----------------------------------------------------------------------------
-- IV term structure: IV by expiry. Front-month spike vs back = catalyst priced.
-- Endpoint: /stock/{T}/implied_volatility_term_structure
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uw_iv_term_structure (
    snapshot_date       DATE NOT NULL,
    ticker              TEXT NOT NULL,
    expiry              DATE NOT NULL,
    dte                 INTEGER,
    iv                  DOUBLE PRECISION,
    iv_atm              DOUBLE PRECISION,
    payload             JSONB,
    PRIMARY KEY (snapshot_date, ticker, expiry)
);
CREATE INDEX IF NOT EXISTS idx_uw_iv_term_structure_ticker_date
    ON uw_iv_term_structure (ticker, snapshot_date DESC);

-- ----------------------------------------------------------------------------
-- Max pain: theoretical pin strike per expiry. Tells us where dealers want price.
-- Endpoint: /stock/{T}/max_pain
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uw_max_pain (
    snapshot_date       DATE NOT NULL,
    ticker              TEXT NOT NULL,
    expiry              DATE NOT NULL,
    max_pain_strike     DOUBLE PRECISION,
    underlying_price    DOUBLE PRECISION,
    payload             JSONB,
    PRIMARY KEY (snapshot_date, ticker, expiry)
);
CREATE INDEX IF NOT EXISTS idx_uw_max_pain_ticker_date
    ON uw_max_pain (ticker, snapshot_date DESC);

-- ----------------------------------------------------------------------------
-- Short screener: high-short-interest tickers (squeeze candidates).
-- Endpoint: /short/short_screener
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uw_short_screener (
    snapshot_date       DATE NOT NULL,
    ticker              TEXT NOT NULL,
    short_interest      DOUBLE PRECISION,
    short_percent_float DOUBLE PRECISION,        -- key signal
    days_to_cover       DOUBLE PRECISION,
    utilization         DOUBLE PRECISION,        -- borrow utilization 0-100
    cost_to_borrow      DOUBLE PRECISION,
    payload             JSONB,
    PRIMARY KEY (snapshot_date, ticker)
);
CREATE INDEX IF NOT EXISTS idx_uw_short_screener_ticker_date
    ON uw_short_screener (ticker, snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_uw_short_screener_pct_float
    ON uw_short_screener (snapshot_date, short_percent_float DESC);

-- ----------------------------------------------------------------------------
-- Failures to deliver: FTD spikes often precede squeezes.
-- Endpoint: /short/failures_to_deliver
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uw_failures_to_deliver (
    settlement_date     DATE NOT NULL,
    ticker              TEXT NOT NULL,
    quantity            BIGINT,
    price               DOUBLE PRECISION,
    payload             JSONB,
    PRIMARY KEY (settlement_date, ticker)
);
CREATE INDEX IF NOT EXISTS idx_uw_ftd_ticker_date
    ON uw_failures_to_deliver (ticker, settlement_date DESC);

-- ----------------------------------------------------------------------------
-- FDA catalyst calendar (PDUFA, AdCom, approval/decision dates).
-- Endpoint: /market/fda_calendar
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uw_fda_calendar (
    catalyst_date       DATE NOT NULL,
    ticker              TEXT NOT NULL,
    drug                TEXT,
    catalyst            TEXT,                    -- 'PDUFA', 'AdCom', 'Phase 3', etc.
    indication          TEXT,
    notes               TEXT,
    payload             JSONB,
    PRIMARY KEY (catalyst_date, ticker, drug)
);
CREATE INDEX IF NOT EXISTS idx_uw_fda_ticker_date
    ON uw_fda_calendar (ticker, catalyst_date);
CREATE INDEX IF NOT EXISTS idx_uw_fda_date
    ON uw_fda_calendar (catalyst_date);

-- ----------------------------------------------------------------------------
-- IPO calendar.
-- Endpoint: /intel/ipo_calendar
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uw_ipo_calendar (
    ipo_date            DATE NOT NULL,
    ticker              TEXT NOT NULL,
    company_name        TEXT,
    price_low           DOUBLE PRECISION,
    price_high          DOUBLE PRECISION,
    shares_offered      BIGINT,
    deal_status         TEXT,
    exchange            TEXT,
    payload             JSONB,
    PRIMARY KEY (ipo_date, ticker)
);
CREATE INDEX IF NOT EXISTS idx_uw_ipo_ticker
    ON uw_ipo_calendar (ticker, ipo_date);
CREATE INDEX IF NOT EXISTS idx_uw_ipo_date
    ON uw_ipo_calendar (ipo_date);

-- ----------------------------------------------------------------------------
-- explosive_scores: the computed ranking the explosive tab reads from.
-- One row per (snapshot_ts, ticker). Each scoring run inserts a new snapshot.
-- The API reads the latest snapshot to render the ranked feed.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS explosive_scores (
    snapshot_ts         TIMESTAMPTZ NOT NULL,
    ticker              TEXT NOT NULL,
    score               DOUBLE PRECISION NOT NULL,   -- 0-100 composite
    -- catalyst context
    catalyst_type       TEXT,                        -- 'earnings' | 'fda' | 'ipo' | 'contract_screener'
    catalyst_date       DATE,
    catalyst_label      TEXT,                        -- "PDUFA: olaparib" or "Earnings 2026-05-22"
    days_to_catalyst    INTEGER,
    -- price context
    underlying_price    DOUBLE PRECISION,
    -- top flow contract
    top_option_symbol   TEXT,
    top_option_type     TEXT,
    top_strike          DOUBLE PRECISION,
    top_expiry          DATE,
    top_last_price      DOUBLE PRECISION,            -- the "lottery ticket" price
    top_volume          BIGINT,
    top_open_interest   BIGINT,
    top_premium         DOUBLE PRECISION,
    -- signal sub-scores (each 0-100, weighted into composite)
    flow_concentration_score    DOUBLE PRECISION,    -- ask-side OTM clustering
    iv_term_score               DOUBLE PRECISION,    -- front-month inversion strength
    squeeze_score               DOUBLE PRECISION,    -- short interest + FTD
    catalyst_score              DOUBLE PRECISION,    -- proximity weighting
    cheap_optionality_score     DOUBLE PRECISION,    -- low price / cheap OTM weekly
    gex_bonus_score             DOUBLE PRECISION,    -- 0 if name not in GEX coverage
    -- the rationale shown in the UI ("why this rank")
    signals             JSONB,                       -- {flow_concentration: "...", iv_term: "...", ...}
    PRIMARY KEY (snapshot_ts, ticker)
);
CREATE INDEX IF NOT EXISTS idx_explosive_scores_ts
    ON explosive_scores (snapshot_ts DESC, score DESC);
CREATE INDEX IF NOT EXISTS idx_explosive_scores_ticker_ts
    ON explosive_scores (ticker, snapshot_ts DESC);
