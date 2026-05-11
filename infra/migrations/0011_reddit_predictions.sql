-- Capital Flow Predictor — Reddit-features ML predictions
--
-- Daily walk-forward predictions emitted by `cfp-jobs reddit-predict`. The
-- model is trained on (reddit_mentions snapshot features + price context)
-- → 20-trading-day forward return. Until ~30d of reddit_mentions history
-- accumulates this table will be empty; the API endpoint /v1/reddit/predict
-- treats absence as "model still calibrating".

CREATE TABLE IF NOT EXISTS reddit_predictions (
    snapshot_date    DATE NOT NULL,
    ticker           TEXT NOT NULL,
    model_version    TEXT NOT NULL,      -- e.g. 'xgb_reddit_v1'
    pred_return_20d  DOUBLE PRECISION,   -- expected % return at horizon
    pred_score       DOUBLE PRECISION,   -- model's calibrated 0..100 ranking score
    features         JSONB,              -- snapshot of inputs for traceability
    trained_at       TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (snapshot_date, ticker, model_version)
);

CREATE INDEX IF NOT EXISTS idx_reddit_predictions_date
    ON reddit_predictions (snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_reddit_predictions_ticker
    ON reddit_predictions (ticker, snapshot_date DESC);
