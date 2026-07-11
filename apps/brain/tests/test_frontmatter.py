from brain import frontmatter


def test_build_parse_roundtrip():
    meta = {
        "title": "Dealer gamma flip",
        "source_url": "https://example.com/a",
        "trust_tier": 2,
        "category": "market-structure",
        "topics": ["gamma", "0dte"],
        "url_sha1": "abc123",
    }
    doc = frontmatter.build(meta, "# Heading\n\nBody text here.")
    parsed, body = frontmatter.parse(doc)
    assert parsed["title"] == "Dealer gamma flip"
    assert parsed["topics"] == ["gamma", "0dte"]
    assert parsed["trust_tier"] == 2
    assert body.startswith("# Heading")


def test_parse_no_frontmatter():
    meta, body = frontmatter.parse("just some text")
    assert meta == {}
    assert body == "just some text"


def test_filename_for():
    name = frontmatter.filename_for("Dealer Gamma & The 0DTE Feedback Loop!", "deadbeefcafe")
    assert name == "dealer-gamma-the-0dte-feedback-loop--deadbeef.md"


def test_summarize_skips_headings():
    body = "# Title\n\n## Sub\n\n" + ("A sentence about gamma exposure and dealers. " * 5)
    s = frontmatter.summarize(body)
    assert "gamma exposure" in s
    assert not s.startswith("#")
