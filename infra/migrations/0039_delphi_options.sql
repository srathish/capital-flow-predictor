-- 0039_delphi_options.sql
--
-- Per-prediction option suggestion + EV calculation.
--
-- Today Delphi predicts on the underlying — "NVDA bullish 1w, target 158".
-- A trader has to manually pick a contract, look up the live price, and
-- estimate the $ payoff if the prediction hits. This migration adds the
-- data plane for doing that automatically:
--
-- 1. For each new delphi_prediction (v0.3 onward), the delphi-options-suggest
--    job picks a candidate contract (strike near target, expiry matching
--    horizon), pulls the freshest available mid price, models Black-Scholes
--    value at target and at invalidation, and writes one row here.
-- 2. The Delphi tab adds a new column that surfaces:
--       NVDA 158C exp 2026-06-13 @ $4.20 mid · EV +$185/contract (44%)
-- 3. Conviction Board / Earnings Radar reuse the same table.
--
-- Pure data — no algorithm change to the rank itself.

BEGIN;

CREATE TABLE IF NOT EXISTS delphi_option_suggestions (
    prediction_id           TEXT PRIMARY KEY
        REFERENCES delphi_predictions(prediction_id) ON DELETE CASCADE,
    suggested_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Contract identity
    contract_symbol         TEXT,                       -- OCC-style or UW chain id
    underlying              TEXT NOT NULL,
    option_type             TEXT NOT NULL,              -- 'C' or 'P'
    strike                  DOUBLE PRECISION NOT NULL,
    expiry                  DATE NOT NULL,
    days_to_expiry          INTEGER NOT NULL,

    -- Current pricing snapshot. NULL when no fresh data was available
    -- (e.g. weekend; we kept the BS theoretical for value modeling and
    --  surface that via theo_price_now).
    current_mid             DOUBLE PRECISION,
    current_bid             DOUBLE PRECISION,
    current_ask             DOUBLE PRECISION,
    current_iv              DOUBLE PRECISION,
    current_delta           DOUBLE PRECISION,
    price_source            TEXT,                       -- 'uw_chain'|'uw_flow'|'uw_history'|'bs_theo'
    price_as_of             TIMESTAMPTZ,

    -- Modeled value at the two outcome anchors
    theo_price_now          DOUBLE PRECISION,           -- BS at current spot, today
    value_at_target         DOUBLE PRECISION,           -- BS if underlying hits primary_target at horizon
    value_at_invalidation   DOUBLE PRECISION,           -- BS if underlying hits invalidation at horizon

    -- The output number the trader actually wants
    ev_per_contract         DOUBLE PRECISION,           -- p*(val_tgt - cost) + (1-p)*(val_inv - cost)
    ev_pct_of_cost          DOUBLE PRECISION,           -- ev / cost
    breakeven_probability   DOUBLE PRECISION,           -- p needed for EV=0 given val_tgt/val_inv

    -- Sizing helper
    contracts_at_kelly      INTEGER,                    -- floor(kelly_fraction * $10k / (100 * mid))

    rationale               TEXT,
    payload                 JSONB                       -- full pricing breakdown for debugging
);

CREATE INDEX IF NOT EXISTS idx_delphi_opt_sugg_by_underlying
    ON delphi_option_suggestions (underlying, suggested_at DESC);

COMMIT;
