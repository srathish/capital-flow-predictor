-- Capital Flow Predictor — Reddit outcome scorekeeping
--
-- Adds "what actually happened" columns to reddit_predictions and reddit_posts
-- so we can score the model in production, calibrate confidence, and feed
-- subreddit/author predictiveness back into the next train.
--
-- Filled in by `cfp-jobs reddit-backfill-outcomes` once 20 trading days have
-- passed since the row's anchor date. Until then the columns stay NULL.

-- reddit_predictions: realized 20d return vs the model's pred_return_20d
ALTER TABLE reddit_predictions
    ADD COLUMN IF NOT EXISTS realized_return_20d DOUBLE PRECISION;
ALTER TABLE reddit_predictions
    ADD COLUMN IF NOT EXISTS realized_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_reddit_predictions_unrealized
    ON reddit_predictions (snapshot_date)
    WHERE realized_return_20d IS NULL;


-- reddit_posts: realized 5d/20d return on the post's primary ticker
ALTER TABLE reddit_posts
    ADD COLUMN IF NOT EXISTS primary_ticker        TEXT;
ALTER TABLE reddit_posts
    ADD COLUMN IF NOT EXISTS realized_return_5d    DOUBLE PRECISION;
ALTER TABLE reddit_posts
    ADD COLUMN IF NOT EXISTS realized_return_20d   DOUBLE PRECISION;
ALTER TABLE reddit_posts
    ADD COLUMN IF NOT EXISTS realized_at           TIMESTAMPTZ;

-- Default primary_ticker = first element of tickers[]. Stored physically so
-- the outcome-backfill query stays cheap.
UPDATE reddit_posts
SET primary_ticker = tickers[1]
WHERE primary_ticker IS NULL AND COALESCE(array_length(tickers, 1), 0) >= 1;

CREATE INDEX IF NOT EXISTS idx_reddit_posts_primary_ticker
    ON reddit_posts (primary_ticker, created_at DESC)
    WHERE primary_ticker IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_reddit_posts_unrealized
    ON reddit_posts (created_at)
    WHERE realized_return_20d IS NULL AND primary_ticker IS NOT NULL;
