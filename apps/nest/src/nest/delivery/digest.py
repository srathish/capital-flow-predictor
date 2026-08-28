"""Morning digest — the one scheduled Sonnet call per day (premarket). Summarizes
overnight signals, the current conviction book, yesterday's grades, and the regime dial.
Falls back to a plain-text roll-up if no LLM is available; it is informational, never an
alert, so it never counts against the Call budget.
"""

from __future__ import annotations

import os
from datetime import UTC, datetime, timedelta

from nest import config
from nest.events.log import EventLog
from nest.tracker import grader


def _book(log: EventLog, tickers: list[str]) -> list[tuple[str, float, str]]:
    book = []
    for t in tickers:
        s = log.latest_score(t)
        if s:
            book.append((t, s.conviction, s.direction))
    book.sort(key=lambda x: x[1], reverse=True)
    return book


def build(log: EventLog, tickers: list[str], now: datetime | None = None) -> str:
    now = now or datetime.now(UTC)
    since = (now - timedelta(hours=18)).isoformat()
    overnight = log.signals_since(since)
    book = _book(log, tickers)
    cal = grader.calibration(log, "5d")
    lines = [f"**🪶 Nest digest — {now.date().isoformat()}**"]
    lines.append(f"Overnight signals: {len(overnight)}  ·  watched: {len(tickers)}")
    lines.append("\n__Conviction book__")
    for t, conv, direction in book[:10]:
        arrow = "🟢" if direction == "bull" else "🔴"
        lines.append(f"{arrow} {t}: {conv:.0f}")
    lines.append("\n__5d calibration__")
    for key, b in cal.buckets.items():
        if b["hit_rate"] is not None:
            lines.append(f"{key}: {b['hit_rate']:.0%} hit (n={b['n']}, avg {b['avg_ret']:+.1f}%)")
    plain = "\n".join(lines)

    if not os.environ.get(config.ANTHROPIC_KEY_ENV):
        return plain
    try:
        import anthropic

        client = anthropic.Anthropic()
        resp = client.messages.create(
            model=config.DIGEST_MODEL,
            max_tokens=500,
            messages=[{"role": "user", "content":
                       "You are the Nest's morning digest voice. In <=6 sentences, "
                       "synthesize this overnight roll-up into what the operator should "
                       "watch today. Be concrete and skeptical; flag anything the "
                       "calibration says to distrust.\n\n" + plain}],
        )
        text = "".join(b.text for b in resp.content if getattr(b, "type", "") == "text")
        return plain + "\n\n__Read__\n" + text.strip()
    except Exception:  # noqa: BLE001
        return plain
