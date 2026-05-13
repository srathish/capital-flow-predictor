"""Migration runner tests.

Covers: migration discovery, idempotency, and the actual SQL parses on a
real DB when DATABASE_URL is set. Without a DB, only the discovery path runs.
"""

from __future__ import annotations

import os

import pytest
from cfp_jobs.migrate import apply_all, find_migrations_dir


def test_find_migrations_dir_resolves() -> None:
    p = find_migrations_dir()
    assert p.exists()
    assert p.is_dir()
    assert (p / "0001_init.sql").exists()


def test_migrations_are_lexicographically_ordered() -> None:
    p = find_migrations_dir()
    files = sorted(p.glob("*.sql"))
    names = [f.name for f in files]
    # Filename prefix must be a zero-padded integer so sorted == numerical order.
    nums = [int(n.split("_", 1)[0]) for n in names]
    assert nums == sorted(nums)
    # Every migration must declare IF NOT EXISTS or DO $$ … $$ to be idempotent.
    for f in files:
        txt = f.read_text().lower()
        if "if not exists" not in txt and "do $$" not in txt and "or replace" not in txt:
            raise AssertionError(f"migration {f.name} is not idempotent — missing IF NOT EXISTS")


@pytest.mark.skipif(
    not os.getenv("DATABASE_URL"),
    reason="DATABASE_URL not set; skipping live migration apply",
)
def test_apply_all_is_idempotent() -> None:
    url = os.environ["DATABASE_URL"]
    first = apply_all(url)
    second = apply_all(url)
    assert first == second
    assert len(first) >= 14
