"""Talon v2 Phase 1.2 — earnings calendar window.

Adds an earnings-window flag so contracts you might buy don't get blindsided
by an IV crush. We compute:

  next_earnings_date   : "YYYY-MM-DD" or None
  dte_to_earnings      : int days from scan date; negative = past
  earnings_risk        : "imminent" (<=7d) | "near" (<=21d) | "clear" (>21d) | "unknown"

UW returns earnings dates under a few different shapes; we defensively pluck
the next-scheduled date out and fall back to None on any unexpected payload.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any


def _parse_iso(s: Any) -> date | None:
    if not s or not isinstance(s, str):
        return None
    try:
        return datetime.fromisoformat(s.split("T")[0]).date()
    except (ValueError, AttributeError):
        return None


def compute_catalyst_signals(payload: dict | None, scan_date: date) -> dict:
    out: dict = {
        "next_earnings_date": None,
        "dte_to_earnings": None,
        "earnings_risk": "unknown",
    }
    if not payload:
        return out

    # UW shapes we've seen:
    #   {"data": {"date": "2026-08-03", "time": "AMC", ...}}
    #   {"data": [{"date": "...", ...}, ...]}
    #   {"date": "..."}
    candidate = None
    if isinstance(payload, dict):
        data = payload.get("data", payload)
        if isinstance(data, dict):
            candidate = data.get("date") or data.get("next_earnings_date") or data.get("report_date")
        elif isinstance(data, list) and data:
            # Pick the next upcoming date >= scan_date
            future = []
            for r in data:
                d = _parse_iso(r.get("date") or r.get("report_date"))
                if d and d >= scan_date:
                    future.append((d, r))
            if future:
                future.sort(key=lambda x: x[0])
                candidate = future[0][1].get("date") or future[0][1].get("report_date")
    d = _parse_iso(candidate)
    if d is None:
        return out
    dte = (d - scan_date).days
    out["next_earnings_date"] = d.isoformat()
    out["dte_to_earnings"] = dte
    if dte < 0:
        out["earnings_risk"] = "past"
    elif dte <= 7:
        out["earnings_risk"] = "imminent"
    elif dte <= 21:
        out["earnings_risk"] = "near"
    else:
        out["earnings_risk"] = "clear"
    return out
