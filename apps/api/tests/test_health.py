import os

import pytest
from cfp_api.main import app
from fastapi.testclient import TestClient

client = TestClient(app)


def test_root() -> None:
    r = client.get("/")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["service"] == "capital-flow-predictor-api"


def test_health() -> None:
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


@pytest.mark.skipif(
    not os.getenv("DATABASE_URL"),
    reason="DATABASE_URL not set; skipping DB connectivity test",
)
def test_healthz_db() -> None:
    r = client.get("/healthz/db")
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "ok"


def test_metrics_endpoint_responds() -> None:
    r = client.get("/metrics")
    assert r.status_code == 200
    # Metrics start emitting once at least one request has fired through the middleware.
    body = r.text
    assert "cfp_http_requests_total" in body
    assert body.endswith("\n")


@pytest.mark.skipif(
    not os.getenv("DATABASE_URL"),
    reason="DATABASE_URL not set; /v1/health/detailed needs the pool",
)
def test_detailed_health_returns_table_freshness() -> None:
    with TestClient(app) as c:  # enter lifespan -> pool initialized
        r = c.get("/v1/health/detailed")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] in {"ok", "degraded"}
        assert isinstance(body["tables"], list)
        assert isinstance(body["stale_tables"], list)
        # At least the prices_daily entry should be present (table created in migration 0001).
        assert any(t["table"] == "prices_daily" for t in body["tables"])
