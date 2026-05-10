-- Capital Flow Predictor — Catalyst-keyword Reddit feed
--
-- Stores Reddit posts that match catalyst keywords (partnership, leak,
-- rumor, FDA, acquisition, beat, guidance, insider) AND mention at least
-- one ticker. Designed to surface AAPL/INTC partnership-style
-- pre-announcement chatter — the signal that mention-count alone misses.
--
-- Source: Reddit RSS feeds (r/stocks, r/investing, r/wallstreetbets,
-- r/options) — no OAuth needed.

CREATE TABLE IF NOT EXISTS reddit_posts (
    id              TEXT PRIMARY KEY,           -- Reddit post id (t3_xxxxx)
    created_at      TIMESTAMPTZ NOT NULL,
    subreddit       TEXT NOT NULL,
    author          TEXT,
    title           TEXT NOT NULL,
    body            TEXT,                       -- selftext, may be empty
    permalink       TEXT,
    url             TEXT,
    upvotes         INT,                        -- best-effort from RSS
    num_comments    INT,
    flair           TEXT,
    -- catalyst extraction
    tickers         TEXT[] NOT NULL DEFAULT '{}',
    keywords        TEXT[] NOT NULL DEFAULT '{}',
    catalyst_score  DOUBLE PRECISION,           -- 0..1, weights # tickers x # keywords x recency
    last_fetched    TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reddit_posts_created_at
    ON reddit_posts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reddit_posts_tickers_gin
    ON reddit_posts USING GIN (tickers);
CREATE INDEX IF NOT EXISTS idx_reddit_posts_keywords_gin
    ON reddit_posts USING GIN (keywords);
CREATE INDEX IF NOT EXISTS idx_reddit_posts_score
    ON reddit_posts (catalyst_score DESC NULLS LAST, created_at DESC);
