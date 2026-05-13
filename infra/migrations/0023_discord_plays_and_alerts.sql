-- Discord alert plays, notification rules, and notification dispatch log.
--
-- Three tables, three responsibilities:
--
-- 1. discord_alert_plays       — parsed trades extracted from a Discord
--                                message. Populated lazily by the API the
--                                first time a message is read; price
--                                snapshots + P&L are filled in by the
--                                score_discord_plays job in apps/jobs.
--
-- 2. discord_notification_rules — user-defined push rules. "When a captured
--                                 alert hits confluence >= N (optionally
--                                 filtered by tickers), POST to this
--                                 webhook." Targets: ntfy.sh, Discord
--                                 webhook URL, browser (later).
--
-- 3. discord_notifications     — dispatch log. PK on (message_id, ticker,
--                                rule_id) so we never double-fire the same
--                                rule for the same alert.

CREATE TABLE IF NOT EXISTS discord_alert_plays (
    message_id           BIGINT NOT NULL,
    ticker               TEXT NOT NULL,
    side                 TEXT NOT NULL,                  -- 'call' | 'put' | 'long' | 'short' | 'unknown'
    strike               DOUBLE PRECISION,                -- nullable: many plays don't state one
    expiry               DATE,                            -- nullable
    entry_price          DOUBLE PRECISION,                -- option price the author stated, if any
    entry_underlying     DOUBLE PRECISION,                -- spot at capture (filled by worker)
    current_underlying   DOUBLE PRECISION,                -- latest spot (updated by worker)
    pnl_pct_underlying   DOUBLE PRECISION,                -- direction-adjusted % move in spot
    status               TEXT NOT NULL DEFAULT 'open',    -- 'open' | 'win_itm' | 'loss_otm' | 'expired_unknown'
    captured_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    marked_at            TIMESTAMPTZ,                     -- last time the worker touched current_underlying
    PRIMARY KEY (message_id, ticker)
);

CREATE INDEX IF NOT EXISTS idx_discord_alert_plays_open
    ON discord_alert_plays (status, captured_at DESC)
    WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_discord_alert_plays_ticker
    ON discord_alert_plays (ticker, captured_at DESC);


CREATE TABLE IF NOT EXISTS discord_notification_rules (
    id              BIGSERIAL PRIMARY KEY,
    name            TEXT NOT NULL,
    min_confluence  SMALLINT NOT NULL DEFAULT 3,         -- bull_count OR bear_count must clear this
    tickers         TEXT[],                              -- NULL/empty = any ticker
    channel         TEXT NOT NULL,                       -- 'ntfy' | 'discord_webhook'
    target          TEXT NOT NULL,                       -- URL (ntfy topic URL, or Discord webhook URL)
    enabled         BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);


CREATE TABLE IF NOT EXISTS discord_notifications (
    message_id   BIGINT NOT NULL,
    ticker       TEXT NOT NULL,
    rule_id      BIGINT NOT NULL REFERENCES discord_notification_rules(id) ON DELETE CASCADE,
    dispatched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ok           BOOLEAN NOT NULL,
    detail       TEXT,                                   -- error body if ok=false
    PRIMARY KEY (message_id, ticker, rule_id)
);
