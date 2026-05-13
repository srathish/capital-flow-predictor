"""Pre-market brief.

Composes a structured "what to look at this morning" summary and POSTs it to
a webhook (Slack/Discord/etc) when configured. Designed to be invoked from
the GitHub Actions data-refresh cron at 09:00 ET on trading days.

Sections (each best-effort — sections fail soft, the brief still ships):
  1. Top 5 rank-change tickers (XGB delta day-over-day)
  2. PM watchlist deltas — new long/short calls since yesterday
  3. Stale tables — anything flagged by /v1/health/detailed.stale_tables
  4. Earnings on the calendar today / tomorrow
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from typing import Any

import httpx

from cfp_jobs.db import connect

log = logging.getLogger(__name__)


def _section_rank_movers(conn) -> list[dict]:
    """Top 5 sectors by absolute change in XGB rank over the last two prediction runs."""
    with conn.cursor() as cur:
        cur.execute(
            """
            WITH ranks AS (
                SELECT run_ts, symbol, rank,
                       ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY run_ts DESC) AS rn
                FROM predictions
                WHERE rank IS NOT NULL
                  AND horizon_d = 10
                  AND run_ts > NOW() - INTERVAL '7 days'
            )
            SELECT cur.symbol,
                   cur.rank AS rank_now,
                   prev.rank AS rank_prev,
                   (prev.rank - cur.rank) AS delta
            FROM ranks cur
            LEFT JOIN ranks prev ON prev.symbol = cur.symbol AND prev.rn = cur.rn + 1
            WHERE cur.rn = 1 AND prev.rank IS NOT NULL
            ORDER BY ABS(prev.rank - cur.rank) DESC
            LIMIT 5
            """
        )
        return [
            {"ticker": r[0], "rank_now": r[1], "rank_prev": r[2], "delta": r[3]}
            for r in cur.fetchall()
        ]


def _section_watchlist_deltas(conn) -> list[dict]:
    """New PM long/short calls since the prior latest run."""
    with conn.cursor() as cur:
        cur.execute(
            """
            WITH latest AS (
                SELECT MAX(run_ts) AS rt FROM agent_signals WHERE agent = 'portfolio_manager'
            ),
            prev AS (
                SELECT MAX(run_ts) AS rt FROM agent_signals
                WHERE agent = 'portfolio_manager' AND run_ts < (SELECT rt FROM latest)
            ),
            cur_signals AS (
                SELECT ticker, signal, confidence
                FROM agent_signals WHERE agent = 'portfolio_manager'
                  AND run_ts = (SELECT rt FROM latest)
            ),
            prev_signals AS (
                SELECT ticker, signal FROM agent_signals
                WHERE agent = 'portfolio_manager' AND run_ts = (SELECT rt FROM prev)
            )
            SELECT cur_signals.ticker, cur_signals.signal, cur_signals.confidence,
                   prev_signals.signal AS prev_signal
            FROM cur_signals LEFT JOIN prev_signals USING (ticker)
            WHERE cur_signals.signal != COALESCE(prev_signals.signal, '_none_')
              AND cur_signals.confidence >= 0.55
            ORDER BY cur_signals.confidence DESC
            LIMIT 10
            """
        )
        return [
            {"ticker": r[0], "signal": r[1], "confidence": float(r[2] or 0), "prev_signal": r[3]}
            for r in cur.fetchall()
        ]


def _section_stale_tables(conn) -> list[dict]:
    """Mirror of /v1/health/detailed.stale_tables, but on the jobs side."""
    checks = [
        ("prices_daily", "ts", 36),
        ("agent_signals", "run_ts", 48),
        ("news_items", "published_at", 12),
        ("reddit_mentions", "ts", 12),
        ("uw_flow_alerts", "created_at", 36),
        ("uw_insider_transactions", "transaction_date", 48),
    ]
    out: list[dict] = []
    with conn.cursor() as cur:
        for table, col, thresh in checks:
            try:
                cur.execute(f"SELECT MAX({col}) FROM {table}")
                max_ts = cur.fetchone()[0]
                if max_ts is None:
                    out.append({"table": table, "max_ts": None, "age_hours": None})
                    continue
                if isinstance(max_ts, datetime):
                    age_h = (datetime.now(UTC) - (max_ts if max_ts.tzinfo else max_ts.replace(tzinfo=UTC))).total_seconds() / 3600
                else:
                    age_h = (datetime.now(UTC) - datetime(max_ts.year, max_ts.month, max_ts.day, tzinfo=UTC)).total_seconds() / 3600
                if age_h > thresh:
                    out.append({"table": table, "age_hours": round(age_h, 1), "threshold": thresh})
            except Exception as e:
                log.debug("stale-check %s failed: %s", table, e)
    return out


def _section_earnings_today_tomorrow(conn) -> list[dict]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT ticker, report_date, expected_move_perc
            FROM uw_earnings
            WHERE report_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 1
            ORDER BY report_date, ticker
            LIMIT 30
            """
        )
        return [
            {
                "ticker": r[0],
                "report_date": r[1].isoformat() if r[1] else None,
                "expected_move_pct": float(r[2]) * 100 if r[2] is not None else None,
            }
            for r in cur.fetchall()
        ]


def _safe(conn, name: str, fn) -> Any:
    """Run a section with its own savepoint so a SQL error doesn't poison
    the rest of the connection. Returns [] / {} on failure."""
    try:
        with conn.transaction():
            return fn(conn)
    except Exception as e:
        log.warning("morning-brief %s failed: %s", name, e)
        return []


def build_brief(database_url: str) -> dict[str, Any]:
    """Assemble the structured brief. Pure function — no side effects."""
    with connect(database_url) as conn:
        return {
            "generated_at": datetime.now(UTC).isoformat(),
            "rank_movers": _safe(conn, "rank_movers", _section_rank_movers),
            "watchlist_deltas": _safe(conn, "watchlist_deltas", _section_watchlist_deltas),
            "stale_tables": _safe(conn, "stale_tables", _section_stale_tables),
            "earnings_today_tomorrow": _safe(conn, "earnings_today_tomorrow", _section_earnings_today_tomorrow),
        }


def _to_discord_blocks(brief: dict[str, Any]) -> dict:
    """Render the brief into a Discord-webhook-compatible body.

    Discord webhook accepts {"content": "..."} for plain text. Markdown
    works; rich embeds are optional. Keep it under the 2000-char content
    cap by trimming sections to top entries.
    """
    lines: list[str] = [f"**Bellwether morning brief** — {brief['generated_at'][:10]}", ""]

    if brief["rank_movers"]:
        lines.append("__Sector rank movers__")
        for m in brief["rank_movers"]:
            arrow = "▲" if (m["delta"] or 0) > 0 else "▼"
            lines.append(f"  {arrow} **{m['ticker']}**  {m['rank_prev']} → {m['rank_now']}  (Δ {m['delta']:+d})")
        lines.append("")

    if brief["watchlist_deltas"]:
        lines.append("__Watchlist deltas__")
        for d in brief["watchlist_deltas"][:6]:
            prev = d.get("prev_signal") or "(new)"
            lines.append(f"  **{d['ticker']}**  {prev} → **{d['signal']}**  ({d['confidence']:.2f})")
        lines.append("")

    if brief["earnings_today_tomorrow"]:
        lines.append("__Earnings today/tomorrow__")
        for e in brief["earnings_today_tomorrow"][:8]:
            em = f"  (expected move {e['expected_move_pct']:.1f}%)" if e.get("expected_move_pct") else ""
            lines.append(f"  • **{e['ticker']}**  {e['report_date']}{em}")
        lines.append("")

    if brief["stale_tables"]:
        lines.append("__⚠️ Stale tables__")
        for s in brief["stale_tables"]:
            t = s.get("threshold")
            lines.append(f"  `{s['table']}` — {s.get('age_hours','?')}h old (threshold {t}h)")
        lines.append("")

    content = "\n".join(lines)
    # Discord caps content at 2000 chars.
    return {"content": content[:1990]}


def send_brief(brief: dict[str, Any], webhook_url: str) -> int:
    """POST the brief to a Discord-compatible webhook. Returns HTTP status."""
    body = _to_discord_blocks(brief)
    r = httpx.post(webhook_url, json=body, timeout=10.0)
    return r.status_code


def run(database_url: str, webhook_url: str | None = None) -> dict[str, Any]:
    """Build + optionally post the brief. Returns the brief dict so tests can assert on it."""
    brief = build_brief(database_url)
    if webhook_url:
        try:
            status = send_brief(brief, webhook_url)
            log.info("morning-brief posted (HTTP %s)", status)
            brief["_post_status"] = status
        except Exception as e:
            log.error("morning-brief webhook post failed: %s", e)
            brief["_post_status"] = f"error: {e}"
    else:
        log.info("morning-brief built (no webhook configured; not posting)\n%s",
                 json.dumps(brief, indent=2, default=str))
    return brief
