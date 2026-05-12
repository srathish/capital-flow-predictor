-- 0015 — User-defined custom watchlists.
--
-- Session-keyed (no user accounts yet). The client generates a session_id and
-- sends it as a header; the server stores tickers per session. Trivial to
-- migrate to user_id when auth lands.

CREATE TABLE IF NOT EXISTS custom_watchlist (
    session_id  TEXT NOT NULL,
    ticker      TEXT NOT NULL,
    added_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    note        TEXT,
    PRIMARY KEY (session_id, ticker)
);

CREATE INDEX IF NOT EXISTS idx_custom_watchlist_session
    ON custom_watchlist (session_id, added_at DESC);
