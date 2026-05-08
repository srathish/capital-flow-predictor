-- Capital Flow Predictor — Agent evaluation scaffolding
--
-- For every agent_signals row that's older than max(forward_horizons), join
-- to prices_daily to compute forward returns. After 60-90 days of data, we
-- get real per-persona track records: hit-rate per regime, IC vs forward
-- returns, pairwise agreement matrix.
--
-- Without this you can't answer "is Burry's bear lens earning its slot" or
-- "is Cathie just an aggressive long-bias generator." The eval is the only
-- thing that turns the ensemble from theater into a system.

CREATE TABLE IF NOT EXISTS agent_eval (
    run_ts            TIMESTAMPTZ NOT NULL,
    ticker            TEXT NOT NULL,
    agent             TEXT NOT NULL,
    -- snapshot of the agent's call at run time
    signal            TEXT NOT NULL,                 -- 'bullish' | 'bearish' | 'neutral'
    confidence        DOUBLE PRECISION,
    -- forward returns vs SPY (relative strength) at multiple horizons
    fwd_return_5d     DOUBLE PRECISION,
    fwd_return_10d    DOUBLE PRECISION,
    fwd_return_20d    DOUBLE PRECISION,
    fwd_return_60d    DOUBLE PRECISION,
    -- regime context at run time (for conditional hit-rate analysis)
    regime_at_run     TEXT,                          -- 'bull' | 'bear' | 'chop'
    -- "was the call right" derived flags, computed once at eval time
    hit_5d            BOOLEAN,
    hit_10d           BOOLEAN,
    hit_20d           BOOLEAN,
    hit_60d           BOOLEAN,
    last_evaluated    TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (run_ts, ticker, agent)
);

CREATE INDEX IF NOT EXISTS idx_agent_eval_agent_run
    ON agent_eval (agent, run_ts DESC);

CREATE INDEX IF NOT EXISTS idx_agent_eval_ticker
    ON agent_eval (ticker, run_ts DESC);
