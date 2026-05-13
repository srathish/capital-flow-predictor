"""Unit tests for the GEX plan-outcome scorer.

Covers the two pure-Python halves (parser + replay loop) so we don't need
yfinance or a live database. The DB-touching `run()` entry point is left to
integration smoke; the parts most likely to drift are the regex and the
bar-walking logic.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pandas as pd

from cfp_jobs.score_gex_plans import (
    _parse_plans_from_field,
    _score_plan,
    _ticker_from_field_name,
    parse_feed_row,
)


def _bar_index(ts_list: list[str]) -> pd.DatetimeIndex:
    return pd.DatetimeIndex([pd.Timestamp(t, tz="UTC") for t in ts_list])


def _make_bars(rows: list[tuple[str, float, float, float, float]]) -> pd.DataFrame:
    """rows: (ts, open, high, low, close)."""
    idx = _bar_index([r[0] for r in rows])
    return pd.DataFrame(
        {
            "Open": [r[1] for r in rows],
            "High": [r[2] for r in rows],
            "Low": [r[3] for r in rows],
            "Close": [r[4] for r in rows],
        },
        index=idx,
    )


def test_parser_extracts_calls_and_puts():
    text = (
        "⬆ ABOVE `7410` → CALLS  →  target 7425, stop 7410.00, R:R 1.5\n"
        "⬇ BELOW `7375` → PUTS   →  target 7370, stop 7375.00, R:R 0.5\n"
    )
    plans = _parse_plans_from_field(text)
    assert len(plans) == 2
    assert plans[0] == {
        "side": "CALLS",
        "break_level": 7410.0,
        "target": 7425.0,
        "stop": 7410.0,
        "predicted_rr": 1.5,
    }
    assert plans[1]["side"] == "PUTS"
    assert plans[1]["break_level"] == 7375.0


def test_parser_ignores_unrelated_text():
    assert _parse_plans_from_field("no plan lines here") == []
    assert _parse_plans_from_field("") == []


def test_ticker_from_field_name():
    assert _ticker_from_field_name("SPXW  •  PIN_ZONE") == "SPXW"
    assert _ticker_from_field_name("SPY • TREND") == "SPY"
    assert _ticker_from_field_name("QQQ  •  monitor") == "QQQ"
    assert _ticker_from_field_name("AAPL • flow") is None
    assert _ticker_from_field_name(None) is None


def test_parse_feed_row_combines_ticker_and_plans():
    row = {
        "id": 99,
        "source": "brief",
        "created_at": datetime(2026, 5, 11, 13, 30, tzinfo=UTC),
        "fields": [
            {
                "name": "SPY  •  PIN_ZONE",
                "value": "⬆ ABOVE `585` → CALLS  →  target 588, stop 584, R:R 1.5",
            },
            {
                "name": "AAPL  •  ignored",
                "value": "⬆ ABOVE `200` → CALLS  →  target 205, stop 199, R:R 1.0",
            },
        ],
    }
    plans = parse_feed_row(row)
    assert len(plans) == 1
    assert plans[0]["ticker"] == "SPY"
    assert plans[0]["side"] == "CALLS"
    assert plans[0]["feed_id"] == 99
    assert plans[0]["source"] == "brief"


def test_score_plan_calls_target_first():
    plan = {
        "side": "CALLS",
        "break_level": 100.0,
        "target": 105.0,
        "stop": 99.0,
        "posted_at": datetime(2026, 5, 11, 13, 30, tzinfo=UTC),
    }
    bars = _make_bars([
        ("2026-05-11 13:30", 99.5, 99.8, 99.4, 99.7),   # before break
        ("2026-05-11 13:31", 99.8, 100.2, 99.8, 100.1),  # crosses break
        ("2026-05-11 13:32", 100.1, 105.1, 100.0, 105.0),  # target hit
    ])
    out = _score_plan(plan, bars)
    assert out["exit_reason"] == "target"
    assert out["hit_target"] is True
    assert out["hit_stop"] is False
    assert out["entered_spot"] == 100.0
    assert out["exited_spot"] == 105.0
    # realized R:R = (105 - 100) / (100 - 99) = 5.0
    assert abs(out["realized_rr"] - 5.0) < 1e-9


def test_score_plan_calls_stop_first():
    plan = {
        "side": "CALLS",
        "break_level": 100.0,
        "target": 105.0,
        "stop": 99.0,
        "posted_at": datetime(2026, 5, 11, 13, 30, tzinfo=UTC),
    }
    bars = _make_bars([
        ("2026-05-11 13:30", 99.5, 100.1, 99.4, 100.0),  # crosses break
        ("2026-05-11 13:31", 100.0, 100.5, 98.9, 99.0),  # stop hit
        ("2026-05-11 13:32", 99.0, 99.5, 98.0, 98.5),
    ])
    out = _score_plan(plan, bars)
    assert out["exit_reason"] == "stop"
    assert out["hit_stop"] is True
    assert out["hit_target"] is False


def test_score_plan_pending_when_break_not_crossed():
    plan = {
        "side": "CALLS",
        "break_level": 100.0,
        "target": 105.0,
        "stop": 99.0,
        "posted_at": datetime(2026, 5, 11, 13, 30, tzinfo=UTC),
    }
    bars = _make_bars([
        ("2026-05-11 13:30", 99.5, 99.8, 99.4, 99.6),
        ("2026-05-11 13:31", 99.6, 99.9, 99.5, 99.7),
    ])
    out = _score_plan(plan, bars)
    assert out["exit_reason"] == "pending"
    assert out["entered_at"] is None
    assert out["realized_rr"] is None
    # day OHLC still populated
    assert out["day_high"] == 99.9


def test_score_plan_puts_target_first():
    plan = {
        "side": "PUTS",
        "break_level": 100.0,
        "target": 95.0,
        "stop": 101.0,
        "posted_at": datetime(2026, 5, 11, 13, 30, tzinfo=UTC),
    }
    bars = _make_bars([
        ("2026-05-11 13:30", 100.5, 100.6, 99.9, 100.0),  # crosses below break
        ("2026-05-11 13:31", 100.0, 100.1, 94.8, 95.0),    # target hit
    ])
    out = _score_plan(plan, bars)
    assert out["exit_reason"] == "target"
    assert out["entered_spot"] == 100.0
    assert out["exited_spot"] == 95.0


def test_score_plan_bar_with_both_assumes_stop_first():
    """Conservative: if a single bar contains both target and stop, treat as stop hit."""
    plan = {
        "side": "CALLS",
        "break_level": 100.0,
        "target": 105.0,
        "stop": 99.0,
        "posted_at": datetime(2026, 5, 11, 13, 30, tzinfo=UTC),
    }
    bars = _make_bars([
        ("2026-05-11 13:30", 99.5, 100.5, 99.4, 100.0),  # entry
        ("2026-05-11 13:31", 100.0, 105.5, 98.5, 100.0),  # both stop and target inside
    ])
    out = _score_plan(plan, bars)
    assert out["exit_reason"] == "stop"
    assert out["hit_stop"] is True
    assert out["hit_target"] is False
