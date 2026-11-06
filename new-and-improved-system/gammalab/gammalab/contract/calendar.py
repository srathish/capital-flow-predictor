"""Minimal NYSE session calendar for 2023-2026: full holidays and 13:00 ET early closes.

Only what the contract needs to judge whether a timestamp is inside a regular session. Extend the tables before using
dates outside the covered years; `session()` raises for an uncovered year rather than guessing.
"""
from __future__ import annotations

from datetime import date, datetime, time, timezone
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
COVERED = range(2023, 2027)

HOLIDAYS = {
    "2023-01-02", "2023-01-16", "2023-02-20", "2023-04-07", "2023-05-29", "2023-06-19", "2023-07-04", "2023-09-04",
    "2023-11-23", "2023-12-25",
    "2024-01-01", "2024-01-15", "2024-02-19", "2024-03-29", "2024-05-27", "2024-06-19", "2024-07-04", "2024-09-02",
    "2024-11-28", "2024-12-25",
    "2025-01-01", "2025-01-09", "2025-01-20", "2025-02-17", "2025-04-18", "2025-05-26", "2025-06-19", "2025-07-04",
    "2025-09-01", "2025-11-27", "2025-12-25",
    "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07",
    "2026-11-26", "2026-12-25",
}
EARLY_CLOSES = {
    "2023-07-03", "2023-11-24", "2024-07-03", "2024-11-29", "2024-12-24", "2025-07-03", "2025-11-28", "2025-12-24",
    "2026-11-27", "2026-12-24",
}


class UncoveredDate(LookupError): ...


def session(d: date) -> tuple[datetime, datetime] | None:
    """(open, close) in UTC for a trading day, or None if the exchange is closed."""
    if d.year not in COVERED:
        raise UncoveredDate(d.isoformat())
    if d.weekday() >= 5 or d.isoformat() in HOLIDAYS:
        return None
    close = time(13, 0) if d.isoformat() in EARLY_CLOSES else time(16, 0)
    return (datetime.combine(d, time(9, 30), ET).astimezone(timezone.utc),
            datetime.combine(d, close, ET).astimezone(timezone.utc))


def in_session(t: datetime) -> bool:
    s = session(t.astimezone(ET).date())
    return s is not None and s[0] <= t < s[1]
