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
