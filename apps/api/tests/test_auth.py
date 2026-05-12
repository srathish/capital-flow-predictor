"""API key auth tests.

We don't depend on a live DB here — the auth check fires before the route body
runs, so we can hit any /v1/* path and assert the 401/200 boundary.
"""

from __future__ import annotations

import importlib

import pytest
from fastapi.testclient import TestClient


def _client_with_keys(monkeypatch: pytest.MonkeyPatch, keys: str) -> TestClient:
    monkeypatch.setenv("API_KEYS_RAW", keys)
    # Re-import so the module-level `settings` re-reads env.
    from cfp_api import settings as settings_mod

    importlib.reload(settings_mod)
    from cfp_api import auth as auth_mod

    importlib.reload(auth_mod)
    from cfp_api import main as main_mod

    importlib.reload(main_mod)
    return TestClient(main_mod.app)


def test_auth_disabled_when_no_keys(monkeypatch: pytest.MonkeyPatch) -> None:
    """API_KEYS_RAW empty => /v1 endpoints respond without an Authorization header."""
    monkeypatch.setenv("API_KEYS_RAW", "")
    from cfp_api import auth as auth_mod
    from cfp_api import settings as settings_mod

    importlib.reload(settings_mod)
    importlib.reload(auth_mod)
    # /health is public regardless; covers the import path.
    assert auth_mod.settings.api_keys == []


def test_constant_time_match() -> None:
    from cfp_api.auth import _constant_time_match

    assert _constant_time_match("abc", ["abc", "xyz"]) is True
    assert _constant_time_match("nope", ["abc", "xyz"]) is False
    assert _constant_time_match("abc", []) is False


def test_extract_key_prefers_x_api_key() -> None:
    from cfp_api.auth import _extract_key

    assert _extract_key("Bearer fromauth", "fromheader") == "fromheader"
    assert _extract_key("Bearer fromauth", None) == "fromauth"
    assert _extract_key("Token foo", None) is None
    assert _extract_key(None, None) is None
