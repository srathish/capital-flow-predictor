import importlib

import pytest


@pytest.fixture()
def brain_env(tmp_path, monkeypatch):
    """Point BRAIN_HOME at a tmp dir and reload config-dependent modules."""
    monkeypatch.setenv("BRAIN_HOME", str(tmp_path))
    from brain import config, dedupe, frontmatter, index, vault

    for mod in (config, vault, index):
        importlib.reload(mod)
    yield config, dedupe, frontmatter, index, vault
    monkeypatch.delenv("BRAIN_HOME")
    for mod in (config, vault, index):
        importlib.reload(mod)


def _write(vault_mod, fm_mod, dd_mod, title, body, tier, category="market-structure"):
    url = f"https://example.com/{title.replace(' ', '-')}"
    meta = {
        "title": title,
        "source_url": url,
        "source_domain": "example.com",
        "fetched_at": fm_mod.now_iso(),
        "trust_tier": tier,
        "category": category,
        "topics": ["gamma"],
        "summary": fm_mod.summarize(body),
        "url_sha1": dd_mod.url_sha1(url),
        "simhash": str(dd_mod.simhash64(body)),
        "ingested_by": "ingest",
    }
    return vault_mod.write_doc(meta, body, status="vault")


def test_tier_ordering(brain_env):
    _config, dedupe, frontmatter, index, vault = brain_env
    _write(vault, frontmatter, dedupe, "Generic gamma flip explainer",
           "The gamma flip level is where dealer gamma changes sign. " * 10, tier=3)
    _write(vault, frontmatter, dedupe, "My validated gamma flip rules",
           "Validated finding: gamma flip behaves differently on SPXW 0dte. " * 10, tier=1,
           category="my-findings")
    index.reindex(rebuild=True)
    hits = index.search("gamma flip", log_gap=False)
    assert len(hits) == 2
    assert hits[0].trust_tier == 1
    assert hits[1].trust_tier == 3


def test_gap_logged_on_weak_search(brain_env):
    _config, _dedupe, _frontmatter, index, _vault = brain_env
    index.reindex(rebuild=True)
    hits = index.search("vanna charm decay into opex", log_gap=True)
    assert hits == []
    gaps = index.open_gaps()
    assert len(gaps) == 1
    assert "vanna" in gaps[0]["query"]
    index.resolve_gap(gaps[0]["id"])
    assert index.open_gaps() == []


def test_reingest_is_idempotent(brain_env):
    _config, dedupe, frontmatter, index, vault = brain_env
    _write(vault, frontmatter, dedupe, "Pin risk basics", "Pin risk near expiry. " * 20, tier=3)
    _write(vault, frontmatter, dedupe, "Pin risk basics", "Pin risk near expiry, updated. " * 20, tier=3)
    count = index.reindex(rebuild=True)
    assert count == 1
    hits = index.search("pin risk", log_gap=False)
    assert len(hits) == 1


def test_question_tokenization(brain_env):
    _config, _dedupe, _frontmatter, index, _vault = brain_env
    q = index.fts_query("What does the dealer gamma flip mean for 0DTE SPX?")
    assert '"gamma"' in q and '"flip"' in q and '"0dte"' in q and '"spx"' in q
    assert '"what"' not in q and '"the"' not in q
