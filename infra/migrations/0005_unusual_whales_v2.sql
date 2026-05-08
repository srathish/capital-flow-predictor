-- Capital Flow Predictor — Unusual Whales Tier 1 expansion
--
-- Adds the four highest-signal tables that 0004 didn't cover:
--   uw_stock_info  — instrument frame (kills the ETF-hallucination bug)
--   uw_oi_change   — daily OI delta per option strike (sticky vs transient flow)
--   uw_news        — UW-tagged news with sentiment (replaces news analyst stub)
--   uw_earnings    — earnings calendar + expected move + historical reaction


-- ----------------------------------------------------------------------------
-- Stock info — sector, industry, name, type, marketcap, next earnings.
-- Cached one row per ticker, refreshed on TTL by the runner.
-- Endpoint: /stock/{ticker}/info — returns a single object (not a list).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uw_stock_info (
    ticker                TEXT PRIMARY KEY,
    full_name             TEXT,
    short_name            TEXT,
    issue_type            TEXT,                 -- 'Common Stock' | 'ETF' | 'ADR' | etc.
    sector                TEXT,
    short_description     TEXT,
    marketcap_size        TEXT,                 -- 'small' | 'medium' | 'large' | 'big'
    beta                  DOUBLE PRECISION,
    marketcap             DOUBLE PRECISION,
    outstanding           BIGINT,
    avg30_volume          DOUBLE PRECISION,
    next_earnings_date    DATE,
    announce_time         TEXT,                 -- 'premarket' | 'postmarket' | 'unspecified'
    uw_tags               TEXT[],
    has_options           BOOLEAN,
    has_dividend          BOOLEAN,
    has_earnings_history  BOOLEAN,
    last_fetched          TIMESTAMPTZ NOT NULL
);


-- ----------------------------------------------------------------------------
-- OI change per option strike per day. Joins to uw_flow_alerts.option_chain
-- to compute "stickiness" — was a $20M call sweep absorbed into open interest
-- (real positioning) or did OI vanish next day (someone closing).
-- Endpoint: /stock/{ticker}/oi-change
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uw_oi_change (
    curr_date                    DATE NOT NULL,
    ticker                       TEXT NOT NULL,
    option_symbol                TEXT NOT NULL,        -- OCC, joins to flow alerts
    last_date                    DATE,
    volume                       BIGINT,
    trades                       INTEGER,
    avg_price                    DOUBLE PRECISION,
    last_fill                    DOUBLE PRECISION,
    last_ask                     DOUBLE PRECISION,
    last_bid                     DOUBLE PRECISION,
    curr_oi                      BIGINT,
    last_oi                      BIGINT,
    oi_diff_plain                BIGINT,                -- signed delta (curr - last)
    oi_change_ratio              DOUBLE PRECISION,
    prev_ask_volume              BIGINT,
    prev_bid_volume              BIGINT,
    prev_mid_volume              BIGINT,
    prev_multi_leg_volume        BIGINT,
    prev_neutral_volume          BIGINT,
    prev_stock_multi_leg_volume  BIGINT,
    prev_total_premium           DOUBLE PRECISION,
    days_of_oi_increases         INTEGER,
    days_of_vol_greater_than_oi  INTEGER,
    percentage_of_total          DOUBLE PRECISION,
    rnk                          INTEGER,
    PRIMARY KEY (curr_date, ticker, option_symbol)
);
CREATE INDEX IF NOT EXISTS idx_uw_oi_change_ticker_date
    ON uw_oi_change (ticker, curr_date DESC);
CREATE INDEX IF NOT EXISTS idx_uw_oi_change_option_symbol
    ON uw_oi_change (option_symbol, curr_date DESC);


-- ----------------------------------------------------------------------------
-- News headlines with UW-tagged sentiment. Multi-ticker headlines are common
-- (a single Benzinga macro headline tags 30+ tickers); we store the array
-- and use a GIN index for ticker-filtered reads.
-- Endpoint: /news/headlines?ticker=X&limit=N
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uw_news (
    id           BIGSERIAL PRIMARY KEY,
    created_at   TIMESTAMPTZ NOT NULL,
    source       TEXT,                                  -- 'Benzinga', 'Reuters', etc.
    headline     TEXT NOT NULL,
    is_major     BOOLEAN,
    sentiment    TEXT,                                  -- 'positive' | 'neutral' | 'negative'
    tickers      TEXT[],
    tags         TEXT[]
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_uw_news_ts_headline
    ON uw_news (created_at, md5(headline));
CREATE INDEX IF NOT EXISTS idx_uw_news_tickers_gin
    ON uw_news USING GIN (tickers);
CREATE INDEX IF NOT EXISTS idx_uw_news_created_at
    ON uw_news (created_at DESC);


-- ----------------------------------------------------------------------------
-- Earnings calendar — past + future. expected_move is dollar terms, percent
-- is the same as a fraction. Historical post_earnings_move_* are realized
-- reactions used by Taleb / fundamental personas.
-- Endpoint: /earnings/{ticker}
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uw_earnings (
    ticker                  TEXT NOT NULL,
    report_date             DATE NOT NULL,
    report_time             TEXT,                       -- 'premarket' | 'postmarket'
    ending_fiscal_quarter   DATE,
    expected_move           DOUBLE PRECISION,           -- $ implied move
    expected_move_perc      DOUBLE PRECISION,           -- fraction (0.0696 = ~7%)
    street_mean_est         DOUBLE PRECISION,           -- consensus EPS
    actual_eps              DOUBLE PRECISION,           -- null until reported
    post_earnings_move_1d   DOUBLE PRECISION,
    post_earnings_move_3d   DOUBLE PRECISION,
    post_earnings_move_1w   DOUBLE PRECISION,
    post_earnings_move_2w   DOUBLE PRECISION,
    pre_earnings_move_1d    DOUBLE PRECISION,
    pre_earnings_move_3d    DOUBLE PRECISION,
    pre_earnings_move_1w    DOUBLE PRECISION,
    pre_earnings_move_2w    DOUBLE PRECISION,
    short_straddle_1d       DOUBLE PRECISION,
    short_straddle_1w       DOUBLE PRECISION,
    long_straddle_1d        DOUBLE PRECISION,
    long_straddle_1w        DOUBLE PRECISION,
    source                  TEXT,
    PRIMARY KEY (ticker, report_date)
);
CREATE INDEX IF NOT EXISTS idx_uw_earnings_ticker_date
    ON uw_earnings (ticker, report_date DESC);
