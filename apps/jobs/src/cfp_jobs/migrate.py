from __future__ import annotations

from pathlib import Path

from cfp_jobs.db import connect


def find_migrations_dir() -> Path:
    """Walk up from this file until we find infra/migrations/."""
    here = Path(__file__).resolve()
    for parent in here.parents:
        candidate = parent / "infra" / "migrations"
        if candidate.exists():
            return candidate
    raise FileNotFoundError("infra/migrations not found in any parent directory")


def apply_all(database_url: str) -> list[str]:
    """Apply every .sql file in infra/migrations/ in lexicographic order.

    All migrations use IF NOT EXISTS / idempotent constructs, so this is safe to re-run.
    """
    migrations_dir = find_migrations_dir()
    files = sorted(migrations_dir.glob("*.sql"))
    applied: list[str] = []
    with connect(database_url) as conn:
        for f in files:
            sql = f.read_text()
            with conn.cursor() as cur:
                cur.execute(sql)
            applied.append(f.name)
        conn.commit()
    return applied
