"""Push high-confluence Discord alerts to user-configured webhooks.

Pattern: poll discord_alert_scores for rows where (bull_count OR bear_count)
>= rule.min_confluence and we haven't yet dispatched that (message, ticker,
rule) tuple. For each match, POST to the rule's target URL.

Supported channels:
  - ntfy        — https://ntfy.sh/<topic> phone push (no auth, super easy)
  - discord_webhook — POST {"content": "..."} to a Discord channel webhook

The dispatcher is idempotent via the discord_notifications PK
(message_id, ticker, rule_id). A failed POST is recorded with ok=false so
we don't retry forever — the user can delete the row to retry.

Run via: ``cfp-jobs dispatch-discord-notifications [--lookback 30]``.
Designed for a Railway cron at 30s–60s cadence.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx

from cfp_jobs.db import connect

log = logging.getLogger(__name__)


@dataclass
class _Rule:
    id: int
    name: str
    min_confluence: int
    tickers: list[str] | None       # None or [] = any ticker
    channel: str
    target: str


@dataclass
class _Candidate:
    message_id: int
    ticker: str
    bull_count: int
    bear_count: int
    guild_name: str
    channel_name: str
    author_name: str
    content: str
    posted_at: datetime


def _format_payload(rule: _Rule, c: _Candidate) -> dict[str, Any]:
    direction = "🟢 bull" if c.bull_count >= c.bear_count else "🔴 bear"
    snippet = c.content.strip().replace("\n", " ")
    if len(snippet) > 280:
        snippet = snippet[:277] + "…"
    title = f"[{c.ticker}] {direction} — {c.guild_name}#{c.channel_name}"
    body = f"@{c.author_name}: {snippet}"
    if rule.channel == "discord_webhook":
        return {"content": f"**{title}**\n{body}"}
    # ntfy: title via header, body in payload — but for simplicity we POST a
    # JSON body and let ntfy auto-render. ntfy supports plain text POSTs
    # too; JSON works.
    return {
        "topic_message": True,
        "title": title,
        "message": body,
    }


def _dispatch(rule: _Rule, c: _Candidate) -> tuple[bool, str]:
    payload = _format_payload(rule, c)
    try:
        if rule.channel == "ntfy":
            # ntfy.sh accepts a simple POST of the message body. Title goes
            # in a header. Caller's target is the full topic URL.
            r = httpx.post(
                rule.target,
                data=payload["message"].encode("utf-8"),
                headers={
                    "Title": payload["title"],
                    "Priority": "high",
                    "Tags": c.ticker,
                },
                timeout=10.0,
            )
        else:
            # Discord webhook
            r = httpx.post(rule.target, json=payload, timeout=10.0)
        if r.status_code >= 400:
            return False, f"http {r.status_code}: {r.text[:200]}"
        return True, ""
    except Exception as e:
        return False, str(e)


def run(database_url: str, *, lookback_minutes: int = 30) -> dict[str, Any]:
    """Dispatch any undelivered high-confluence alerts captured in the
    lookback window. Returns counts for logging."""
    cutoff = datetime.now(UTC) - timedelta(minutes=lookback_minutes)
    seen = 0
    dispatched = 0
    failed = 0

    with connect(database_url) as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, name, min_confluence, tickers, channel, target
            FROM discord_notification_rules
            WHERE enabled = TRUE
            """
        )
        rules = [
            _Rule(
                id=int(r[0]),
                name=r[1],
                min_confluence=int(r[2]),
                tickers=list(r[3]) if r[3] else None,
                channel=r[4],
                target=r[5],
            )
            for r in cur.fetchall()
        ]
        if not rules:
            return {"seen": 0, "dispatched": 0, "failed": 0, "finished_at": datetime.now(UTC).isoformat()}

        for rule in rules:
            ticker_filter_sql = ""
            params: list[Any] = [rule.min_confluence, rule.min_confluence, rule.id, cutoff]
            if rule.tickers:
                ticker_filter_sql = "AND s.ticker = ANY(%s::TEXT[])"
                params.append(rule.tickers)
            cur.execute(
                f"""
                SELECT
                    s.message_id, s.ticker, s.bull_count, s.bear_count,
                    m.guild_name, m.channel_name, m.author_name, m.content, m.posted_at
                FROM discord_alert_scores s
                JOIN discord_messages m ON m.message_id = s.message_id
                LEFT JOIN discord_notifications n
                    ON n.message_id = s.message_id
                   AND n.ticker = s.ticker
                   AND n.rule_id = %s
                WHERE (s.bull_count >= %s OR s.bear_count >= %s)
                  AND n.message_id IS NULL
                  AND m.posted_at >= %s
                  {ticker_filter_sql}
                ORDER BY m.posted_at ASC
                LIMIT 50
                """,
                # Order of params matches the placeholders above:
                # rule.id, bull_min, bear_min, cutoff, [tickers]
                tuple([rule.id, rule.min_confluence, rule.min_confluence, cutoff] +
                      ([rule.tickers] if rule.tickers else [])),
            )

            for r in cur.fetchall():
                seen += 1
                cand = _Candidate(
                    message_id=int(r[0]),
                    ticker=r[1],
                    bull_count=int(r[2]),
                    bear_count=int(r[3]),
                    guild_name=r[4],
                    channel_name=r[5],
                    author_name=r[6],
                    content=r[7] or "",
                    posted_at=r[8],
                )
                ok, detail = _dispatch(rule, cand)
                cur.execute(
                    """
                    INSERT INTO discord_notifications
                        (message_id, ticker, rule_id, ok, detail)
                    VALUES (%s, %s, %s, %s, %s)
                    ON CONFLICT DO NOTHING
                    """,
                    (cand.message_id, cand.ticker, rule.id, ok, detail or None),
                )
                if ok:
                    dispatched += 1
                else:
                    failed += 1
                    log.warning(
                        "notification dispatch failed rule=%s msg=%s ticker=%s detail=%s",
                        rule.id, cand.message_id, cand.ticker, detail,
                    )

        conn.commit()

    return {
        "seen": seen,
        "dispatched": dispatched,
        "failed": failed,
        "finished_at": datetime.now(UTC).isoformat(),
    }
