-- Capital Flow Predictor — Unusual Whales integration (Phase 5)
-- Single source of truth for everything the UW $200/mo subscription gives us.
--
-- Each table mirrors one UW endpoint family. The raw payload is preserved in
-- `payload` (jsonb) on the high-cardinality tables so we can re-derive fields
-- if our column extraction misses something. Column extraction is for the SQL
-- aggregations the flow analyst + sector dashboard need to be fast.

-- ----------------------------------------------------------------------------
-- Per-ticker option flow alerts: sweeps, blocks, repeated hits.
-- Endpoint: /stock/{ticker}/flow-alerts
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uw_flow_alerts (
    id                  BIGSERIAL PRIMARY KEY,
    created_at          TIMESTAMPTZ NOT NULL,
    ticker              TEXT NOT NULL,
    option_chain        TEXT NOT NULL,           -- OCC symbol e.g. NVDA260605C00205000
    option_type         TEXT NOT NULL,           -- 'call' | 'put'
    expiry              DATE NOT NULL,
    strike              DOUBLE PRECISION NOT NULL,
    underlying_price    DOUBLE PRECISION,
    price               DOUBLE PRECISION,
    volume              BIGINT,
    open_interest       BIGINT,
    total_premium       DOUBLE PRECISION,        -- $ premium aggregated across the alert window
    total_size          BIGINT,
    trade_count         INTEGER,
    iv_end              DOUBLE PRECISION,
    iv_start            DOUBLE PRECISION,
    has_sweep           BOOLEAN,
    has_floor           BOOLEAN,
    has_multileg        BOOLEAN,
    has_singleleg       BOOLEAN,
    all_opening_trades  BOOLEAN,
    alert_rule          TEXT,                    -- 'RepeatedHits', 'RepeatedHitsDescendingFill', etc.
    bid_side_prem       DOUBLE PRECISION,        -- $ at bid (sold to MM, slightly bearish for calls)
    ask_side_prem       DOUBLE PRECISION,        -- $ at ask (lifted, aggressive buying)
    volume_oi_ratio     DOUBLE PRECISION,
    payload             JSONB,
    UNIQUE (created_at, ticker, option_chain, alert_rule)
);
CREATE INDEX IF NOT EXISTS idx_uw_flow_alerts_ticker_ts
    ON uw_flow_alerts (ticker, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_uw_flow_alerts_expiry
    ON uw_flow_alerts (ticker, expiry, option_type);

-- ----------------------------------------------------------------------------
-- Dark pool prints (institutional positioning).
-- Endpoint: /darkpool/{ticker}
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uw_dark_pool_prints (
    tracking_id         BIGINT PRIMARY KEY,      -- UW's stable id; safe upsert key
    executed_at         TIMESTAMPTZ NOT NULL,
    ticker              TEXT NOT NULL,
    price               DOUBLE PRECISION NOT NULL,
    size                BIGINT NOT NULL,
    premium             DOUBLE PRECISION,
    nbbo_ask            DOUBLE PRECISION,
    nbbo_bid            DOUBLE PRECISION,
    market_center       TEXT,
    canceled            BOOLEAN,
    ext_hour_sold_codes TEXT,
    payload             JSONB
);
CREATE INDEX IF NOT EXISTS idx_uw_darkpool_ticker_ts
    ON uw_dark_pool_prints (ticker, executed_at DESC);

-- ----------------------------------------------------------------------------
-- Daily net option premium tape (call vs put pressure).
-- Endpoint: /stock/{ticker}/net-prem-ticks (we aggregate to daily for storage).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uw_net_prem_daily (
    date                DATE NOT NULL,
    ticker              TEXT NOT NULL,
    call_volume         BIGINT,
    put_volume          BIGINT,
    call_volume_ask     BIGINT,
    call_volume_bid     BIGINT,
    put_volume_ask      BIGINT,
    put_volume_bid      BIGINT,
    net_call_premium    DOUBLE PRECISION,        -- ask-side - bid-side, calls
    net_put_premium     DOUBLE PRECISION,
    net_delta           DOUBLE PRECISION,
    PRIMARY KEY (date, ticker)
);

-- ----------------------------------------------------------------------------
-- Short interest / borrow rate (squeeze setup).
-- Endpoint: /shorts/{ticker}/data — UW polls this every ~30 min.
-- We keep all snapshots; queries pick the most recent per ticker.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uw_short_data (
    ts                       TIMESTAMPTZ NOT NULL,
    ticker                   TEXT NOT NULL,
    short_shares_available   BIGINT,
    fee_rate                 DOUBLE PRECISION,
    rebate_rate              DOUBLE PRECISION,
    PRIMARY KEY (ts, ticker)
);
CREATE INDEX IF NOT EXISTS idx_uw_short_ticker_ts
    ON uw_short_data (ticker, ts DESC);

-- ----------------------------------------------------------------------------
-- Aggregate greek exposure (dealer positioning proxy).
-- Endpoint: /stock/{ticker}/greek-exposure — daily call/put delta/gamma/charm/vanna.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uw_greek_exposure (
    date         DATE NOT NULL,
    ticker       TEXT NOT NULL,
    call_delta   DOUBLE PRECISION,
    put_delta    DOUBLE PRECISION,
    call_gamma   DOUBLE PRECISION,
    put_gamma    DOUBLE PRECISION,
    call_charm   DOUBLE PRECISION,
    put_charm    DOUBLE PRECISION,
    call_vanna   DOUBLE PRECISION,
    put_vanna    DOUBLE PRECISION,
    PRIMARY KEY (date, ticker)
);

-- ----------------------------------------------------------------------------
-- ETF creation / redemption flow (sector rotation signal).
-- Endpoint: /etfs/{etf}/in-outflow — daily share + premium creation/redemption.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uw_etf_flow (
    date              DATE NOT NULL,
    ticker            TEXT NOT NULL,
    close             DOUBLE PRECISION,
    volume            BIGINT,
    change_shares     BIGINT,                    -- + = creation, - = redemption
    change_prem       DOUBLE PRECISION,          -- $ creation (+) / redemption (-)
    expiration_cycle  TEXT,
    is_fomc           BOOLEAN,
    PRIMARY KEY (date, ticker)
);

-- ----------------------------------------------------------------------------
-- Insider transactions (Form 4) — smart-money positioning.
-- Endpoint: /insider/transactions?ticker_symbol=X
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uw_insider_transactions (
    id                    TEXT PRIMARY KEY,      -- UW's UUID per filing entry
    transaction_date      DATE NOT NULL,
    filing_date           DATE,
    ticker                TEXT NOT NULL,
    owner_name            TEXT,
    transaction_code      TEXT,                  -- 'P' (purchase), 'S' (sale), 'A' (award), 'M' (option exercise), etc.
    amount                DOUBLE PRECISION,      -- signed share count (negative = sale)
    transactions          INTEGER,
    price                 DOUBLE PRECISION,
    is_director           BOOLEAN,
    is_officer            BOOLEAN,
    is_ten_percent_owner  BOOLEAN,
    is_10b5_1             BOOLEAN,
    security_title        TEXT,
    formtype              TEXT,
    payload               JSONB
);
CREATE INDEX IF NOT EXISTS idx_uw_insider_ticker_date
    ON uw_insider_transactions (ticker, transaction_date DESC);

-- ----------------------------------------------------------------------------
-- Congressional trades (sentiment / signal of last resort).
-- Endpoint: /congress/recent-trades
-- No stable id from UW; use natural composite key.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uw_congress_trades (
    id                BIGSERIAL PRIMARY KEY,
    politician_id     TEXT NOT NULL,
    transaction_date  DATE NOT NULL,
    ticker            TEXT,                      -- nullable: some entries are 'undisclosed'
    txn_type          TEXT,                      -- 'Buy', 'Sell', 'Star Catcher', etc.
    amounts           TEXT,                      -- '$15,001 - $50,000'
    name              TEXT,
    member_type       TEXT,                      -- 'house' | 'senate'
    issuer            TEXT,
    filed_at_date     DATE,
    notes             TEXT
);
-- COALESCE in a UNIQUE INDEX expression is fine (not allowed in PRIMARY KEY).
CREATE UNIQUE INDEX IF NOT EXISTS uq_uw_congress_trade
    ON uw_congress_trades (
        politician_id,
        transaction_date,
        COALESCE(ticker, ''),
        COALESCE(txn_type, ''),
        COALESCE(amounts, '')
    );
CREATE INDEX IF NOT EXISTS idx_uw_congress_ticker_date
    ON uw_congress_trades (ticker, transaction_date DESC);
