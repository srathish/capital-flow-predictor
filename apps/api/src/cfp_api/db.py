from __future__ import annotations

import contextlib

import asyncpg
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

# Module-level pool managed by the FastAPI lifespan; routes import via get_pool().
_pool: asyncpg.Pool | None = None


def to_async_url(url: str) -> str:
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url


def to_asyncpg_url(url: str) -> str:
    """Strip the SQLAlchemy '+asyncpg' suffix; asyncpg itself wants vanilla postgres://."""
    if url.startswith("postgresql+asyncpg://"):
        return url.replace("postgresql+asyncpg://", "postgresql://", 1)
    return url


async def init_pool(database_url: str, *, min_size: int = 1, max_size: int = 10) -> asyncpg.Pool:
    global _pool
    if _pool is not None:
        return _pool
    _pool = await asyncpg.create_pool(
        to_asyncpg_url(database_url),
        min_size=min_size,
        max_size=max_size,
    )
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


def get_pool() -> asyncpg.Pool:
    """Dependency target for FastAPI routes. Raises if the pool isn't initialized."""
    if _pool is None:
        raise RuntimeError("Database pool not initialized — was the app's lifespan run?")
    return _pool


# Legacy helper retained for /healthz/db (uses SQLAlchemy because that's what was here).
async def check_db_connection(database_url: str) -> tuple[bool, str | None]:
    try:
        engine = create_async_engine(to_async_url(database_url), pool_pre_ping=True)
    except Exception as e:
        return False, f"{type(e).__name__}: {e}"

    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        return True, None
    except Exception as e:
        return False, f"{type(e).__name__}: {e}"
    finally:
        with contextlib.suppress(Exception):
            await engine.dispose()
