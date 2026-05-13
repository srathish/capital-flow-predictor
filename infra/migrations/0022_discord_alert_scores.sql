-- Per-(message, ticker) verification cache.
--
-- We score each extracted ticker against 4 signal sources (flow / gex /
-- whale / reddit). Results are cached here so the dashboard doesn't re-run
-- the same DB queries on every refresh. The API treats anything older than
-- 10 minutes as stale and recomputes.
--
-- A message can mention multiple tickers, so the PK is (message_id, ticker).
-- Verdicts are stored as TEXT to keep the column human-readable in psql; the
-- valid values are 'bull' | 'bear' | 'neutral' | NULL (NULL = no data for
-- that signal, distinct from 'neutral' which means we have data and it's
-- inconclusive).

CREATE TABLE IF NOT EXISTS discord_alert_scores (
    message_id        BIGINT NOT NULL,
    ticker            TEXT NOT NULL,
    flow_verdict      TEXT,
    gex_verdict       TEXT,
    whale_verdict     TEXT,
    reddit_verdict    TEXT,
    cross_chat_count  INT NOT NULL DEFAULT 0,
    bull_count        SMALLINT NOT NULL DEFAULT 0,
    bear_count        SMALLINT NOT NULL DEFAULT 0,
    scored_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (message_id, ticker)
);

CREATE INDEX IF NOT EXISTS idx_discord_alert_scores_scored_at
    ON discord_alert_scores (scored_at DESC);
