"""Tests for the pairwise persona comparison endpoint.

Gated on DATABASE_URL like the other live tests.
"""

from __future__ import annotations

import os

import pytest
from cfp_api.main import app
from fastapi.testclient import TestClient

pytestmark = pytest.mark.skipif(
    not os.getenv("DATABASE_URL"),
    reason="DATABASE_URL not set",
)


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def test_comparison_rejects_identical_personas(client: TestClient) -> None:
    r = client.get("/v1/agents/NVDA/comparison", params={"left": "buffett", "right": "buffett"})
    assert r.status_code == 400


def test_comparison_returns_two_snapshots(client: TestClient) -> None:
    r = client.get("/v1/agents/NVDA/comparison", params={"left": "buffett", "right": "burry"})
    # Either succeeds or returns empty snapshots — never 500.
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ticker"] == "NVDA"
    assert body["left"]["persona"] == "buffett"
    assert body["right"]["persona"] == "burry"
    assert "summary" in body
    assert isinstance(body["agree"], bool)


def test_comparison_missing_persona_returns_null_snapshot(client: TestClient) -> None:
    r = client.get(
        "/v1/agents/NVDA/comparison",
        params={"left": "buffett", "right": "definitely_not_a_persona"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["right"]["signal"] is None
    assert body["right"]["confidence"] is None
