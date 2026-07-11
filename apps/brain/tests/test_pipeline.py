import importlib

import pytest

HTML = """<html><head><title>Gamma Walls Explained</title></head><body>
<article><h1>Gamma Walls Explained</h1>
<p>{}</p></article></body></html>""".format(
    "Large open interest at a strike creates a gamma wall where dealer hedging "
    "dampens price movement and pins the index. " * 15
)


@pytest.fixture()
def brain_env(tmp_path, monkeypatch):
    monkeypatch.setenv("BRAIN_HOME", str(tmp_path))
    from brain import config, fetch, index, pipeline, vault

    for mod in (config, vault, index, pipeline):
        importlib.reload(mod)
    yield fetch, index, pipeline
    monkeypatch.delenv("BRAIN_HOME")
    for mod in (config, vault, index, pipeline):
        importlib.reload(mod)


def _mock_fetch(monkeypatch, pipeline, html=HTML, reason="ok"):
    from brain.fetch import FetchResult

    def fake(url, fetcher="plain", rate_s=0):
        if reason != "ok":
            return FetchResult(url, 0, None, reason=reason)
        return FetchResult(url, 200, html)

    monkeypatch.setattr(pipeline.fetch, "fetch", fake)


def test_ingest_url_happy_path(brain_env, monkeypatch):
    _fetch, index, pipeline = brain_env
    _mock_fetch(monkeypatch, pipeline)
    res = pipeline.ingest_url("https://example.com/gamma-walls", tier=3, category="market-structure")
    assert res.reason == "ok"
    assert res.path is not None and res.path.exists()
    hits = index.search("gamma wall dealer hedging", log_gap=False)
    assert hits and hits[0].title == "Gamma Walls Explained"


def test_ingest_idempotent(brain_env, monkeypatch):
    _fetch, index, pipeline = brain_env
    _mock_fetch(monkeypatch, pipeline)
    r1 = pipeline.ingest_url("https://example.com/a", tier=3, category="technicals")
    r2 = pipeline.ingest_url("https://example.com/a?utm_source=x", tier=3, category="technicals")
    assert r1.reason == "ok" and r2.reason == "ok"
    assert index.reindex(rebuild=True) == 1


def test_near_dup_routes_to_inbox(brain_env, monkeypatch):
    _fetch, _index, pipeline = brain_env
    _mock_fetch(monkeypatch, pipeline)
    pipeline.ingest_url("https://example.com/original", tier=3, category="market-structure")
    res = pipeline.ingest_url("https://mirror.example.org/copy", tier=4, category="market-structure")
    assert res.reason == "ok_near_dup_inbox"
    assert "inbox" in str(res.path)


def test_fetch_error_isolated(brain_env, monkeypatch):
    _fetch, _index, pipeline = brain_env
    _mock_fetch(monkeypatch, pipeline, reason="robots_blocked")
    res = pipeline.ingest_url("https://example.com/blocked", tier=3, category="technicals")
    assert res.reason == "robots_blocked"
    assert res.path is None


def test_promote_and_reject(brain_env, monkeypatch):
    _fetch, index, pipeline = brain_env
    _mock_fetch(monkeypatch, pipeline)
    res = pipeline.ingest_url("https://example.com/inboxed", tier=4,
                              category="market-structure", to="inbox")
    hash8 = res.path.stem.rsplit("--", 1)[-1]
    new_path = pipeline.promote(hash8, "market-structure")
    assert "vault" in str(new_path) and new_path.exists()
    hits = index.search("gamma wall dealer hedging", log_gap=False)
    assert any(str(new_path) == h.path for h in hits)
