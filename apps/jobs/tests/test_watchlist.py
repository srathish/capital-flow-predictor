"""Tests for the Phase 4e watchlist orchestrator.

These exercise the orchestration logic without hitting the LLM or real DB —
patches `agents_runner.run_analysts` to return canned PM summaries, and patches
the `connect()` / `_attach_pm_payload` helpers so we can verify the rank/upsert
flow in isolation.

DB-roundtripped behavior (predictions/holdings reads, agent_signals
backfetching) is left to the live verification step.
"""

from __future__ import annotations

from unittest.mock import patch

from cfp_jobs.watchlist import _pm_to_watchlist_row, _signal_to_final


def test_signal_to_final_mapping() -> None:
    assert _signal_to_final("bullish") == "long"
    assert _signal_to_final("bearish") == "short"
    assert _signal_to_final("neutral") == "avoid"
    assert _signal_to_final("unknown") == "avoid"


def _pm_summary(signal: str = "bullish", confidence: float = 0.7) -> dict:
    return {
        "signals": [
            {"agent": "fundamentals", "signal": "bullish", "confidence": 0.6, "rationale": "x", "kind": "analyst"},
            {"agent": "buffett", "signal": "bullish", "confidence": 0.7, "rationale": "y", "kind": "persona"},
            {
                "agent": "portfolio_manager",
                "signal": signal,
                "confidence": confidence,
                "rationale": "Approved long, 7% weight",
                "kind": "synthesis",
            },
        ]
    }


def test_pm_to_watchlist_row_extracts_pm_signal() -> None:
    import datetime as dt

    run_ts = dt.datetime(2026, 5, 8, tzinfo=dt.UTC)
    row = _pm_to_watchlist_row(_pm_summary(), sector="XLK", ticker="NVDA", run_ts=run_ts)
    assert row is not None
    assert row["sector"] == "XLK"
    assert row["ticker"] == "NVDA"
    assert row["final_signal"] == "long"
    assert row["final_confidence"] == 0.7
    assert row["rationale"]["summary"] == "Approved long, 7% weight"


def test_pm_to_watchlist_row_returns_none_when_pm_missing() -> None:
    import datetime as dt

    run_ts = dt.datetime(2026, 5, 8, tzinfo=dt.UTC)
    summary = {"signals": [{"agent": "fundamentals", "signal": "bullish", "confidence": 0.6, "rationale": "x", "kind": "analyst"}]}
    assert _pm_to_watchlist_row(summary, sector="XLK", ticker="NVDA", run_ts=run_ts) is None


def test_signal_routing_short_and_avoid() -> None:
    import datetime as dt

    run_ts = dt.datetime(2026, 5, 8, tzinfo=dt.UTC)
    short_row = _pm_to_watchlist_row(_pm_summary(signal="bearish"), "XLE", "XOM", run_ts)
    assert short_row["final_signal"] == "short"

    avoid_row = _pm_to_watchlist_row(_pm_summary(signal="neutral"), "XLE", "XOM", run_ts)
    assert avoid_row["final_signal"] == "avoid"


def test_ranking_within_sector_by_confidence_times_weight() -> None:
    """build_watchlist sorts within sector by confidence * target_weight desc."""
    import datetime as dt

    from cfp_jobs import watchlist as wl

    fake_run_ts = dt.datetime(2026, 5, 8, tzinfo=dt.UTC)

    # 3 fake constituents with different PM weights
    fake_pm_summaries = {
        "AAA": _pm_summary(signal="bullish", confidence=0.7),  # weight will be 0.05 -> score 0.035
        "BBB": _pm_summary(signal="bullish", confidence=0.8),  # weight 0.08 -> score 0.064 (best)
        "CCC": _pm_summary(signal="bullish", confidence=0.5),  # weight 0.03 -> score 0.015
    }
    fake_weights = {"AAA": 0.05, "BBB": 0.08, "CCC": 0.03}

    def fake_run_analysts(database_url, ticker, sector, include_personas):
        return fake_pm_summaries[ticker]

    def fake_attach_pm_payload(conn, row, run_ts):
        # Simulate the DB-side payload pull
        row["target_weight"] = fake_weights[row["ticker"]]
        row["rationale"] = {**row["rationale"], "target_weight": fake_weights[row["ticker"]]}

    captured_rows: list[list[dict]] = []

    class FakeCursor:
        def __enter__(self): return self
        def __exit__(self, *args): return False
        def execute(self, sql, params=None): self._sql = sql
        def fetchone(self): return (fake_run_ts,)

    class FakeConn:
        def __enter__(self): return self
        def __exit__(self, *args): return False
        def cursor(self): return FakeCursor()
        def commit(self): pass

    def fake_connect(database_url):
        return FakeConn()

    def fake_load_top(conn, *, horizon, model, n_top):
        return ["XLK"]

    def fake_load_constituents(conn, sector, k):
        return ["AAA", "BBB", "CCC"]

    def fake_upsert(conn, rows):
        captured_rows.append([dict(r) for r in rows])
        return len(rows)

    with patch.object(wl, "connect", fake_connect), \
         patch.object(wl, "_load_top_sectors_for_latest_target_ts", fake_load_top), \
         patch.object(wl, "_load_constituents", fake_load_constituents), \
         patch.object(wl, "_attach_pm_payload", fake_attach_pm_payload), \
         patch.object(wl, "upsert_watchlist", fake_upsert), \
         patch.object(wl.agents_runner, "run_analysts", fake_run_analysts):
        out = wl.build_watchlist("fake://db", n_top_sectors=1, k_per_sector=3)

    assert out["n_sectors"] == 1
    assert out["n_tickers"] == 3
    assert out["n_rows"] == 3

    # Verify ranking: BBB (0.064) -> rank 1, AAA (0.035) -> rank 2, CCC (0.015) -> rank 3
    rows = captured_rows[0]
    by_ticker = {r["ticker"]: r["rank"] for r in rows}
    assert by_ticker == {"BBB": 1, "AAA": 2, "CCC": 3}
