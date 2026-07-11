from brain import dedupe


def test_canonicalize_strips_tracking():
    a = dedupe.canonicalize_url("https://Example.com/Article/?utm_source=x&id=2#frag")
    b = dedupe.canonicalize_url("https://example.com/Article?id=2")
    assert a == b


def test_url_sha1_stable():
    assert dedupe.url_sha1("https://example.com/a/") == dedupe.url_sha1("https://EXAMPLE.com/a")


def test_simhash_near_dup():
    base = "dealer gamma exposure pins the index near large strikes into expiry " * 20
    tweaked = base.replace("pins", "anchors", 1)
    different = "momentum breadth thrust small caps russell rotation earnings " * 20
    s1, s2, s3 = (dedupe.simhash64(t) for t in (base, tweaked, different))
    assert dedupe.hamming(s1, s2) <= dedupe.NEAR_DUP_HAMMING
    assert dedupe.hamming(s1, s3) > dedupe.NEAR_DUP_HAMMING


def test_is_near_dup():
    body = "gamma walls act as support and resistance for spx price action " * 20
    sim = dedupe.simhash64(body)
    assert dedupe.is_near_dup(sim, {"other": sim}) == "other"
    assert dedupe.is_near_dup(sim, {"other": dedupe.simhash64("totally unrelated words " * 30)}) is None
