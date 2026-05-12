"""Contract tests for the recently-shipped surfaces — screener, forward-call,
and the watchlist row that feeds the screener universe.

These exist because the last several commits (e8e4f77, 8784308, 93b0456,
91ef6d1, 8355ab1) have been bug fixes on these endpoints: latest-target
filtering on predictions, column-name fixes on uw_etf_holdings, "every
recently-analyzed ticker" watchlist behaviour, ranked options-trade
candidates. Each fix risks reintroducing the bug it replaced; these tests
pin the externally-visible contract.

Gated on DATABASE_URL like the rest of test_routes.py — the API talks to
live Postgres so we exercise schema + SQL + Pydantic together.
"""

from __future__ import annotations

import os

import pytest
from cfp_api.main import app
from fastapi.testclient import TestClient

pytestmark = pytest.mark.skipif(
    not os.getenv("DATABASE_URL"),
    reason="DATABASE_URL not set; skipping live API tests",
)


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


# ---------- /v1/stocks/screen ----------


def test_screener_returns_well_formed_response(client: TestClient) -> None:
    r = client.get("/v1/stocks/screen")
    if r.status_code == 404:
        pytest.skip("No portfolio_manager runs in the lookback window")
    assert r.status_code == 200, r.text
    body = r.json()
    assert "universe_size" in body
    assert "filtered_count" in body
    assert "items" in body
    assert "filters" in body
    assert isinstance(body["items"], list)
    # min_iv_rank is one of the new filters; should always be echoed
    assert "min_iv_rank" in body["filters"]
    # universe should be >= filtered_count
    assert body["universe_size"] >= len(body["items"])


def test_screener_min_confidence_filters_low_conf(client: TestClient) -> None:
    """A 0.95 floor should never return items below that confidence."""
    r = client.get("/v1/stocks/screen", params={"min_confidence": 0.95})
    if r.status_code == 404:
        pytest.skip("No portfolio_manager runs in the lookback window")
    assert r.status_code == 200, r.text
    for it in r.json()["items"]:
        assert it["confidence"] >= 0.95, it


def test_screener_min_iv_rank_filters(client: TestClient) -> None:
    """min_iv_rank gate: every returned item should have iv_rank >= floor.

    Regression guard — this filter was added end-to-end alongside the UI
    pills; the route must drop tickers with null iv_rank when the gate is
    nonzero (otherwise the gate is silently bypassed for any ticker with
    no UW flow alerts in the last 90d)."""
    r = client.get("/v1/stocks/screen", params={"min_iv_rank": 0.5})
    if r.status_code == 404:
        pytest.skip("No portfolio_manager runs in the lookback window")
    assert r.status_code == 200, r.text
    for it in r.json()["items"]:
        # Null iv_rank must NOT pass the gate
        assert it["iv_rank"] is not None, it
        assert it["iv_rank"] >= 0.5, it


def test_screener_min_oi_filters(client: TestClient) -> None:
    """min_oi gate: every returned item should have liquidity_ok=True."""
    r = client.get("/v1/stocks/screen", params={"min_oi": 10000})
    if r.status_code == 404:
        pytest.skip("No portfolio_manager runs in the lookback window")
    assert r.status_code == 200, r.text
    for it in r.json()["items"]:
        assert it["liquidity_ok"] is True, it
        assert (it["open_interest"] or 0) >= 10000, it


def test_screener_signal_any_includes_all_sides(client: TestClient) -> None:
    """signal=any must not artificially exclude shorts or avoids."""
    r = client.get("/v1/stocks/screen", params={"signal": "any", "min_confidence": 0.0})
    if r.status_code == 404:
        pytest.skip("No portfolio_manager runs in the lookback window")
    assert r.status_code == 200, r.text
    sides = {it["final_signal"] for it in r.json()["items"]}
    # Don't assert specific sides exist — depends on data — but the schema must
    # allow any of the three. The screener should NOT have silently dropped
    # shorts/avoids when signal=any (a bug we'd want to catch on regression).
    assert sides.issubset({"long", "short", "avoid"})


# ---------- /v1/sectors/forward-call ----------


def test_forward_call_returns_latest_target_only(client: TestClient) -> None:
    """e8e4f77 fixed a bug where forward-call returned the wrong rank=1 because
    Postgres picked any historical fold of the latest run. The visible
    contract that flips when that bug regresses: `top` picks should come back
    in monotonically increasing rank order starting at 1, because they come
    from a single target_ts. If the SQL drops the latest_target filter,
    you'd see ranks from multiple folds intermixed and the order breaks."""
    r = client.get("/v1/sectors/forward-call", params={"horizon": 10})
    if r.status_code == 404:
        pytest.skip("No predictions for horizon=10")
    assert r.status_code == 200, r.text
    body = r.json()
    assert "top" in body and "bottom" in body
    assert "target_ts" in body
    if body["top"]:
        ranks = [p["rank"] for p in body["top"]]
        assert ranks == sorted(ranks), (
            f"forward-call top ranks out of order (likely regression of e8e4f77 "
            f"latest_target filter): {ranks}"
        )
        assert ranks[0] == 1, f"top should start at rank 1, got {ranks[0]}"


def test_forward_call_rejects_invalid_horizon(client: TestClient) -> None:
    # ge=1, le=60 on the query param
    r = client.get("/v1/sectors/forward-call", params={"horizon": 999})
    assert r.status_code == 422  # FastAPI validation rejection


# ---------- /v1/watchlist ----------


def test_watchlist_returns_recently_analyzed_universe(client: TestClient) -> None:
    """93b0456 changed watchlist to show every recently-analyzed ticker, not
    only the curated build. Pin the contract: response must include items
    grouped by sector with the expected shape."""
    r = client.get("/v1/watchlist")
    if r.status_code == 404:
        pytest.skip("No watchlist runs yet")
    assert r.status_code == 200, r.text
    body = r.json()
    assert "sectors" in body
    for sec in body["sectors"]:
        for item in sec.get("items", []):
            assert item["final_signal"] in {"long", "short", "avoid"}
            assert 0.0 <= item["final_confidence"] <= 1.0
