"""Bridge to the gexester-vexster Node CLIs (skylit.ai / Heatseeker).

Exposes two helpers used by agents_runner._collect_evidence:

  - fetch_structure(ticker) -> dict | None
      Calls scripts/structure-snapshot.js for a fresh per-strike dealer-level
      structural picture (floor / ceiling / king / air pockets / regime).
      ~70% of intraday moves happen at structural nodes (gexester findings),
      so this is meaningfully richer than UW's daily aggregate gex_total.

  - fetch_trinity(max_age_min=30) -> dict | None
      Reads scripts/trinity-latest.js — latest 0DTE Trinity classification
      across SPX/SPY/QQQ from the live poller's SQLite store. Only meaningful
      when reasoning about index-class names (SPY/QQQ/SPX/SPXW).

Both are best-effort: if the gexester repo is missing, auth has expired, the
poller hasn't run, or the call times out, they return None and the caller
proceeds without skylit context. We never fail an agent run because of skylit.

Configuration (env):
  GEXESTER_VEXSTER_DIR  Path to gexester-vexster checkout. Defaults to
                        ~/gexester vexster (matches skylit_login default).
  SKYLIT_FETCH_TIMEOUT  Per-call timeout in seconds. Default 25.
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
import time
from pathlib import Path

log = logging.getLogger(__name__)

DEFAULT_GEXESTER_DIR = Path.home() / "gexester vexster"
DEFAULT_TIMEOUT_S = 25.0
_STRUCTURE_TTL_S = 300.0  # 5-min in-process cache; agent runs may touch a ticker repeatedly

_structure_cache: dict[tuple[str, bool], tuple[float, dict | None]] = {}
_trinity_cache: tuple[float, dict | None] | None = None


def _gexester_dir() -> Path:
    return Path(os.environ.get("GEXESTER_VEXSTER_DIR") or DEFAULT_GEXESTER_DIR).expanduser()


def _timeout_s() -> float:
    try:
        return float(os.environ.get("SKYLIT_FETCH_TIMEOUT") or DEFAULT_TIMEOUT_S)
    except ValueError:
        return DEFAULT_TIMEOUT_S


def _run_node_cli(script_rel: str, args: list[str]) -> dict | None:
    repo = _gexester_dir()
    script = repo / script_rel
    if not script.exists():
        log.debug("skylit bridge: %s not found, skipping", script)
        return None
    # gexester logger writes to stdout at info+ level; silence everything but
    # errors so we get clean JSON. Bridge also tolerates leading log lines by
    # parsing the last non-empty stdout line.
    env = {**os.environ, "LOG_LEVEL": "error"}
    try:
        proc = subprocess.run(
            ["node", str(script), *args],
            cwd=str(repo),
            capture_output=True,
            text=True,
            timeout=_timeout_s(),
            check=False,
            env=env,
        )
    except FileNotFoundError:
        log.warning("skylit bridge: `node` not on PATH")
        return None
    except subprocess.TimeoutExpired:
        log.warning("skylit bridge: %s timed out", script_rel)
        return None

    if proc.returncode != 0 and proc.stderr:
        log.info("skylit bridge: %s stderr: %s", script_rel, proc.stderr.strip()[:200])

    out = (proc.stdout or "").strip()
    if not out:
        return None
    # The CLIs always emit a single JSON line at the END; tolerate any log
    # noise that might leak before it.
    last = out.splitlines()[-1].strip()
    try:
        data = json.loads(last)
    except json.JSONDecodeError:
        log.warning("skylit bridge: %s emitted non-JSON: %s", script_rel, last[:120])
        return None
    return data if isinstance(data, dict) and data else None


def fetch_structure(ticker: str, *, all_expirations: bool = True) -> dict | None:
    """Fresh structural snapshot for `ticker`. 5-min in-process cache.

    With ``all_expirations=True`` (default), the Node script returns the
    primary near-expiry shape plus an `expiry_views` array spanning every
    expiration the Heatseeker feed exposes (0DTE → weekly → LEAP). The
    GexAnalyst uses this to reason about term structure.
    """
    key = ticker.upper()
    cache_key = (key, bool(all_expirations))
    now = time.time()
    cached = _structure_cache.get(cache_key)
    if cached and (now - cached[0]) < _STRUCTURE_TTL_S:
        return cached[1]

    args = [f"--ticker={key}"]
    if all_expirations:
        args.append("--all-expirations")
    data = _run_node_cli("scripts/structure-snapshot.js", args)
    _structure_cache[cache_key] = (now, data)
    return data


def fetch_trinity(max_age_min: int = 30) -> dict | None:
    """Latest Trinity row from the live poller's SQLite. Returns None if stale/empty."""
    global _trinity_cache
    now = time.time()
    if _trinity_cache and (now - _trinity_cache[0]) < 60.0:  # 1-min cache
        return _trinity_cache[1]

    data = _run_node_cli("scripts/trinity-latest.js", [f"--max-age-min={max_age_min}"])
    if data and data.get("stale"):
        data = None
    _trinity_cache = (now, data)
    return data


# ---- mapping helpers used by agents_runner -------------------------------------------------


def apply_structure_to_positioning(pos: dict, structure: dict | None) -> None:
    """Mutates `pos` in place with skylit_* fields from a structure-snapshot dict."""
    if not structure:
        return
    pos["skylit_spot"] = structure.get("spot")
    pos["skylit_regime_score"] = structure.get("regime_score")
    pos["skylit_signed_total_gamma"] = structure.get("signed_total_gamma")
    king = structure.get("king") or {}
    pos["skylit_king_strike"] = king.get("strike")
    pos["skylit_king_gamma"] = king.get("gamma")
    floor = structure.get("floor") or {}
    pos["skylit_floor_strike"] = floor.get("strike")
    pos["skylit_floor_significance"] = floor.get("relative_significance")
    ceiling = structure.get("ceiling") or {}
    pos["skylit_ceiling_strike"] = ceiling.get("strike")
    pos["skylit_ceiling_significance"] = ceiling.get("relative_significance")
    pos["skylit_air_pockets"] = structure.get("air_pockets") or None
    pos["skylit_liquidity_vacuums"] = structure.get("liquidity_vacuums") or None
    pos["skylit_expiration"] = structure.get("expiration")
    pos["skylit_fetched_at_ms"] = structure.get("fetched_at_ms")

    # Multi-expiration term-structure views. Each entry maps cleanly onto
    # cfp_shared.SkylitExpiryView; the bundle builder pydantic-validates.
    expiry_views_raw = structure.get("expiry_views") or []
    views: list[dict] = []
    for v in expiry_views_raw:
        if not isinstance(v, dict) or not v.get("expiration"):
            continue
        king_v = v.get("king") or {}
        floor_v = v.get("floor") or {}
        ceiling_v = v.get("ceiling") or {}
        views.append({
            "expiration": v["expiration"],
            "expiration_index": v.get("expiration_index"),
            "num_strikes": v.get("num_strikes") or 0,
            "total_abs_gamma": v.get("total_abs_gamma"),
            "signed_total_gamma": v.get("signed_total_gamma"),
            "regime_score": v.get("regime_score"),
            "king_strike": king_v.get("strike"),
            "king_gamma": king_v.get("gamma"),
            "floor_strike": floor_v.get("strike"),
            "floor_significance": floor_v.get("relative_significance"),
            "ceiling_strike": ceiling_v.get("strike"),
            "ceiling_significance": ceiling_v.get("relative_significance"),
            "air_pockets": v.get("air_pockets") or [],
            "liquidity_vacuums": v.get("liquidity_vacuums") or [],
        })
    pos["skylit_expiry_views"] = views


_INDEX_CLASS = {"SPY", "QQQ", "SPX", "SPXW", "IWM", "DIA"}


def apply_trinity_to_positioning(pos: dict, ticker: str, trinity: dict | None) -> None:
    """Only attaches Trinity when ticker is an index-class name the live poller covers."""
    if not trinity or ticker.upper() not in _INDEX_CLASS:
        return
    pos["trinity_classification"] = trinity.get("classification")
    pos["trinity_direction"] = trinity.get("direction")
    pos["trinity_avg_bias"] = trinity.get("avg_bias")
    pos["trinity_spread"] = trinity.get("spread")
    pos["trinity_bias_spx"] = trinity.get("bias_spx")
    pos["trinity_bias_spy"] = trinity.get("bias_spy")
    pos["trinity_bias_qqq"] = trinity.get("bias_qqq")
    pos["trinity_whipsaw"] = trinity.get("whipsaw_detected")
    pos["trinity_age_minutes"] = trinity.get("age_minutes")
