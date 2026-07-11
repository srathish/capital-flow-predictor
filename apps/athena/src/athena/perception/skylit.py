"""Skylit GEX/VEX surface — the SAME source the apps/gex fire-loop trades on.

The user's T1 doctrine is calibrated to Skylit's surface, not UW's. We shell
out to apps/gex/scripts/surface-json.js so the existing heatseeker client owns
the Clerk auth dance (one session, one owner). UW remains the source for
flow/tide/price tape only.
"""

from __future__ import annotations

import json
import logging
import subprocess
import time
from dataclasses import dataclass

from athena import config
from athena.perception.models import StrikeExposure

log = logging.getLogger(__name__)

GEX_APP_DIR = config.REPO_ROOT / "apps" / "gex"
BRIDGE = GEX_APP_DIR / "scripts" / "surface-json.js"
TTL_S = 60

_cache: dict[str, tuple[float, SkylitSurface]] = {}


@dataclass
class SkylitSurface:
    ticker: str
    spot: float
    expiration: str | None  # nearest expiry = the live 0DTE chain
    rows: list[StrikeExposure]
    fetched_at_ms: int


def fetch_surface(ticker: str, timeout_s: int = 45) -> SkylitSurface:
    """Nearest-expiry Skylit surface as StrikeExposure rows (net gamma/vanna)."""
    hit = _cache.get(ticker)
    if hit and time.monotonic() - hit[0] < TTL_S:
        return hit[1]
    proc = subprocess.run(
        ["node", str(BRIDGE), ticker],
        cwd=GEX_APP_DIR,
        capture_output=True,
        text=True,
        timeout=timeout_s,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"skylit bridge failed for {ticker}: {proc.stderr.strip()[:200]}")
    if "__SURFACE_JSON__" not in proc.stdout:
        raise RuntimeError(f"skylit bridge emitted no surface for {ticker}")
    snap = json.loads(proc.stdout.rsplit("__SURFACE_JSON__", 1)[1])
    rows = [
        StrikeExposure(
            strike=float(s["strike"]),
            call_gamma_oi=float(s.get("gamma") or 0),  # net values ride the call_* slots
            call_vanna_oi=float(s.get("vanna") or 0),
        )
        for s in snap.get("strikes", [])
        if s.get("strike") is not None
    ]
    surface = SkylitSurface(
        ticker=ticker,
        spot=float(snap["spot"]),
        expiration=snap.get("expiration"),
        rows=rows,
        fetched_at_ms=int(snap.get("fetchedAtMs") or 0),
    )
    _cache[ticker] = (time.monotonic(), surface)
    return surface
