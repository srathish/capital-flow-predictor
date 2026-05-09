-- Capital Flow Predictor — Reddit mention tracking via Apewisdom
--
-- Apewisdom (free, no OAuth) gives daily 24h mention counts + upvotes per
-- ticker per subreddit. We snapshot once a day per subreddit and store the
-- time series so we can compute spike ratios (today vs 7d avg) and detect
-- "stealth" vs "contrarian-warning" setups in the agent ensemble.

CREATE TABLE IF NOT EXISTS reddit_mentions (
    snapshot_date    DATE NOT NULL,
    ticker           TEXT NOT NULL,
    subreddit        TEXT NOT NULL,           -- 'all-stocks' | 'wallstreetbets' | 'stocks' | 'options' | 'investing'
    rank             INT,                     -- rank by mentions in this subreddit on this date
    mentions         INT,                     -- 24h mention count
    upvotes          BIGINT,                  -- 24h aggregate upvotes
    rank_24h_ago     INT,                     -- rank delta = rank_24h_ago - rank
    mentions_24h_ago INT,
    name             TEXT,                    -- company name from Apewisdom (NVDA -> "NVIDIA")
    last_fetched     TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (snapshot_date, ticker, subreddit)
);

CREATE INDEX IF NOT EXISTS idx_reddit_mentions_ticker_date
    ON reddit_mentions (ticker, snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_reddit_mentions_date_subreddit
    ON reddit_mentions (snapshot_date DESC, subreddit);
