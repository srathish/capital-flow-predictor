"""API key authentication.

Single shared-secret model: a comma-separated list of valid keys lives in
``API_KEYS`` (env). Clients send ``Authorization: Bearer <key>`` or
``X-API-Key: <key>``. If ``API_KEYS`` is unset, auth is disabled — this keeps
local dev frictionless. Public endpoints (root, /health, /metrics, /v1/health/detailed,
/healthz/db) bypass via the route-level skip below.
"""

from __future__ import annotations

import hmac
import logging

from fastapi import Header, HTTPException, status

from cfp_api.settings import settings

log = logging.getLogger(__name__)


def _extract_key(authorization: str | None, x_api_key: str | None) -> str | None:
    if x_api_key:
        return x_api_key.strip()
    if authorization:
        parts = authorization.split(None, 1)
        if len(parts) == 2 and parts[0].lower() == "bearer":
            return parts[1].strip()
    return None


def _constant_time_match(presented: str, valid_keys: list[str]) -> bool:
    # Use hmac.compare_digest to avoid timing oracles, even though our keys are
    # short. Loop over all keys (no early-exit) so probe attempts can't measure
    # which prefix matches.
    matched = False
    for k in valid_keys:
        if hmac.compare_digest(presented, k):
            matched = True
    return matched


async def require_api_key(
    authorization: str | None = Header(default=None),
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
) -> None:
    """FastAPI dependency. Raises 401 unless the request carries a valid key.

    Disabled when ``API_KEYS`` env is empty so local dev works without keys."""
    keys = settings.api_keys
    if not keys:
        return  # auth disabled
    presented = _extract_key(authorization, x_api_key)
    if not presented:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="missing api key (Authorization: Bearer or X-API-Key)",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not _constant_time_match(presented, keys):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid api key",
            headers={"WWW-Authenticate": "Bearer"},
        )
