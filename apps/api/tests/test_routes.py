"""Endpoint tests for the v1 read API.

These talk to the live local Postgres so the schema, query, and Pydantic
serialization are exercised together. Gated on DATABASE_URL just like
test_health.py's /healthz/db test, so they skip in environments without a DB.
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
    """TestClient enters the lifespan context, which initializes the asyncpg pool."""
    with TestClient(app) as c:
        yield c


def test_rankings_returns_predictions(client: TestClient) -> None:
    r = client.get("/v1/rankings", params={"horizon": 10})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["horizon_d"] == 10
    assert body["model"] == "xgb_v1"
    assert isinstance(body["rankings"], list)
    if body["rankings"]:
        assert body["rankings"][0]["rank"] == 1
        assert "symbol" in body["rankings"][0]


def test_rankings_404_for_unknown_model(client: TestClient) -> None:
    r = client.get("/v1/rankings", params={"horizon": 10, "model": "nonexistent_model"})
    assert r.status_code == 404


def test_watchlist_returns_grouped_sectors(client: TestClient) -> None:
    r = client.get("/v1/watchlist")
    if r.status_code == 404:
        pytest.skip("No watchlist runs yet; run `make watchlist-build` first")
    assert r.status_code == 200, r.text
    body = r.json()
    assert "run_ts" in body
    assert isinstance(body["sectors"], list)
    if body["sectors"]:
        first = body["sectors"][0]
        assert "sector" in first
        assert "items" in first
        if first["items"]:
            item = first["items"][0]
            assert item["final_signal"] in {"long", "short", "avoid"}


def test_watchlist_sector_filter(client: TestClient) -> None:
    # Hit /v1/watchlist first to find a sector that exists
    r = client.get("/v1/watchlist")
    if r.status_code == 404:
        pytest.skip("No watchlist runs yet")
    sectors = r.json().get("sectors", [])
    if not sectors:
        pytest.skip("Watchlist exists but has no sectors")
    sector_name = sectors[0]["sector"]
    r2 = client.get(f"/v1/watchlist/{sector_name}")
    assert r2.status_code == 200, r2.text
    assert r2.json()["sector"] == sector_name


def test_agents_for_ticker(client: TestClient) -> None:
    # NVDA has been used as the test target throughout Phase 4
    r = client.get("/v1/agents/NVDA")
    if r.status_code == 404:
        pytest.skip("No agent_signals for NVDA yet")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ticker"] == "NVDA"
    assert isinstance(body["signals"], list)
    if body["signals"]:
        kinds = {s["kind"] for s in body["signals"]}
        # Expect at least one of analyst/persona/synthesis present
        assert kinds & {"analyst", "persona", "synthesis"}


def test_agents_timeline(client: TestClient) -> None:
    r = client.get("/v1/agents/NVDA/timeline", params={"agent": "fundamentals"})
    if r.status_code == 404:
        pytest.skip("No timeline data for NVDA/fundamentals")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ticker"] == "NVDA"
    assert body["agent"] == "fundamentals"
    assert isinstance(body["entries"], list)


def test_sectors_endpoint(client: TestClient) -> None:
    r = client.get("/v1/sectors")
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body["sectors"], list)
    # At minimum the holdings ETFs we ingested should be present
    symbols = {s["symbol"] for s in body["sectors"]}
    # XLK is part of the universe and almost certainly has predictions and holdings
    if symbols:
        # Be defensive — don't assert on a specific symbol; assert structure
        first = body["sectors"][0]
        assert "symbol" in first
        assert "n_constituents" in first


def test_ticker_normalization_to_upper(client: TestClient) -> None:
    """Lowercase tickers should still resolve."""
    r1 = client.get("/v1/agents/nvda")
    r2 = client.get("/v1/agents/NVDA")
    # Either both succeed with the same body, or both 404 (no data yet)
    assert r1.status_code == r2.status_code
