"""Startup migration applier.

Scans the configured migrations directory for ``NNNN_*.sql`` files in
lexicographic order and applies any that aren't recorded in the
``schema_migrations`` tracking table. Existing migrations are written with
``IF NOT EXISTS`` guards so the first run after this lands is a no-op apart
from populating the tracking table.

Concurrent replicas are serialized via a Postgres advisory lock so two
processes can't double-apply the same file. The applier opens its own
short-lived asyncpg connection so a slow/blocked migration can't starve the
request pool.

Disable via ``BELLWETHER_AUTO_MIGRATE=0`` if you want to gate migrations on
a separate ``make migrate`` step in production.
"""

from __future__ import annotations

import logging
import os
import re
from pathlib import Path

import asyncpg

from cfp_api.db import to_asyncpg_url

log = logging.getLogger(__name__)

# Stable lock key for the migration runner. Any 64-bit int is fine; this one
# was picked at random and should never be reused for another purpose.
_ADVISORY_LOCK_KEY = 7268342195431122  # CRC32("cfp_api.migrations") padded

_MIGRATION_FILENAME = re.compile(r"^\d{4}_[A-Za-z0-9_]+\.sql$")


def _default_migrations_dir() -> Path:
    """Locate ``infra/migrations`` by walking up from the package install path.

    Works in three layouts:
      - dev tree:      <repo>/apps/api/src/cfp_api/migrations.py
      - Docker image:  /app/apps/api/src/cfp_api/migrations.py (with /app/infra/...)
      - editable wheel from a different cwd

    Override with ``BELLWETHER_MIGRATIONS_DIR`` if neither applies.
    """
    env = os.environ.get("BELLWETHER_MIGRATIONS_DIR")
    if env:
        return Path(env)
    here = Path(__file__).resolve()
    for ancestor in here.parents:
        candidate = ancestor / "infra" / "migrations"
        if candidate.is_dir():
            return candidate
    return Path("infra/migrations")


async def apply_pending_migrations(database_url: str) -> list[str]:
    """Apply any unapplied SQL files. Returns the list of newly-applied names.

    Raises if a migration file fails — the caller (FastAPI lifespan) should let
    that propagate so the process exits noisily instead of booting with a
    partial schema.
    """
    if os.environ.get("BELLWETHER_AUTO_MIGRATE", "1") == "0":
        log.info("auto_migrate_disabled (BELLWETHER_AUTO_MIGRATE=0)")
        return []

    mdir = _default_migrations_dir()
    if not mdir.is_dir():
        log.warning("migrations_dir_missing dir=%s", mdir)
        return []

    files = sorted(
        p for p in mdir.iterdir()
        if p.is_file() and _MIGRATION_FILENAME.match(p.name)
    )
    if not files:
        log.info("no_migration_files dir=%s", mdir)
        return []

    conn = await asyncpg.connect(to_asyncpg_url(database_url))
    applied: list[str] = []
    try:
        # Serialize across replicas. pg_advisory_lock blocks until acquired;
        # for a multi-replica boot the second process will simply wait, then
        # find every migration already recorded and no-op out.
        await conn.execute("SELECT pg_advisory_lock($1)", _ADVISORY_LOCK_KEY)
        try:
            tracking_existed = await conn.fetchval(
                "SELECT to_regclass('public.schema_migrations') IS NOT NULL"
            )
            await conn.execute(
                """
                CREATE TABLE IF NOT EXISTS schema_migrations (
                    name        TEXT PRIMARY KEY,
                    applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
            # First-time install on a DB that's already been migrated by
            # `make migrate`: backfill the tracking table from observed schema
            # state instead of re-running every file. The IF NOT EXISTS guards
            # would make re-running safe, but the log noise on every fresh
            # boot would be misleading.
            if not tracking_existed:
                pre_migrated = await conn.fetchval(
                    "SELECT to_regclass('public.predictions') IS NOT NULL"
                )
                if pre_migrated:
                    for f in files:
                        await conn.execute(
                            "INSERT INTO schema_migrations (name) VALUES ($1) "
                            "ON CONFLICT (name) DO NOTHING",
                            f.name,
                        )
                    log.info("backfilled_schema_migrations count=%d", len(files))
                    return []

            recorded = {
                r["name"] for r in await conn.fetch("SELECT name FROM schema_migrations")
            }
            for f in files:
                if f.name in recorded:
                    continue
                sql = f.read_text()
                log.info("applying_migration name=%s bytes=%d", f.name, len(sql))
                async with conn.transaction():
                    await conn.execute(sql)
                    await conn.execute(
                        "INSERT INTO schema_migrations (name) VALUES ($1)",
                        f.name,
                    )
                applied.append(f.name)
        finally:
            await conn.execute("SELECT pg_advisory_unlock($1)", _ADVISORY_LOCK_KEY)
    finally:
        await conn.close()

    if applied:
        log.info("applied_migrations count=%d names=%s", len(applied), applied)
    return applied
