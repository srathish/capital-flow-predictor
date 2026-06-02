"""Talon v2 scanner — runs v1 first, then enriches with chart signals.

Phase 1.1 (this build): adds ATR + Volume contraction + MA structure per
ticker, computes a coiled_score, aggregates to theme level.

Phase 1.2 (next): earnings window flag.
Phase 1.3 (next): whale order concentration.
Phase 2: insider, analyst, short interest, MA structure as gates not just signals.
Phase 3: base-pattern detection, fundamentals.

Architecture: v2 is a *superset* of v1. It reuses v1's UW prewarm + flow
metrics + theme coherence + grade, then adds new signals and a coiled tier.
v1 keeps running unchanged — every existing /v1/talon/* endpoint still works.
"""
from __future__ import annotations

import logging
import threading
import uuid
from datetime import UTC, datetime
from typing import Any

import pandas as pd

from cfp_api import talon_scanner, talon_uw_client as uw_client, talon_v2_chart

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Scan-in-progress state (v2 has its own — runs in parallel with v1's)
# ---------------------------------------------------------------------------
_V2_SCAN_LOCK = threading.Lock()
_V2_PROGRESS_LOCK = threading.Lock()
_V2_SCAN_STATE: dict[str, Any] = {
    "status": "idle",
    "scan_id": None,
    "started_at": None,
    "completed_at": None,
    "phase": None,
    "phase_progress": 0,
    "phase_total": 0,
    "current_ticker": None,
    "last_error": None,
}


def get_v2_scan_progress() -> dict[str, Any]:
    with _V2_PROGRESS_LOCK:
        return dict(_V2_SCAN_STATE)


def _set_v2_progress(**kwargs) -> None:
    with _V2_PROGRESS_LOCK:
        _V2_SCAN_STATE.update(kwargs)


def run_v2_scan(scan_date: str | None = None) -> dict[str, Any]:
    """Run a full Talon v2 scan.

    Steps:
      1. Run v1 scan (flow gates → grades for the full universe)
      2. Fan out candle fetches for the universe (parallel)
      3. Compute chart signals per ticker
      4. Merge chart signals into the v1 result rows
      5. Aggregate themes for coiled-basket detection
      6. Return augmented result with new fields:
         - per-ticker: atr_ratio, vol_ratio, above_*d, coiled_score, coiled
         - per-theme: themes_summary[theme] = {n_coiled, mean_coiled_score, coiled_basket}
         - new tier: coiled_setups (the names that pass the chart filter)
    """
    with _V2_SCAN_LOCK:
        scan_id = uuid.uuid4().hex[:12]
        started_at = datetime.now(UTC)
        _set_v2_progress(
            status="running",
            scan_id=scan_id,
            started_at=started_at.isoformat(),
            completed_at=None,
            phase="v1_scan",
            phase_progress=0,
            phase_total=0,
            current_ticker=None,
            last_error=None,
        )
        try:
            return _run_v2_inner(scan_date, scan_id, started_at)
        except Exception as e:
            log.exception("Talon v2 scan failed")
            _set_v2_progress(
                status="error",
                last_error=str(e),
                completed_at=datetime.now(UTC).isoformat(),
            )
            raise


def _run_v2_inner(
    scan_date: str | None, scan_id: str, started_at: datetime
) -> dict[str, Any]:
    # Step 1: delegate to v1 for the flow side
    v1 = talon_scanner.run_scan(scan_date)

    universe = talon_scanner.load_universe()
    client = talon_scanner._get_live_client()  # noqa: SLF001 — intentional cross-module reuse

    # Step 2: prewarm candles for every name in the universe
    candles_by_ticker: dict[str, list[dict] | None] = {}
    if client is not None:
        _set_v2_progress(
            phase="prewarm_candles",
            phase_progress=0,
            phase_total=len(universe),
            current_ticker=None,
        )

        def _on_progress(done: int, total: int, last_ticker: str) -> None:
            _set_v2_progress(phase_progress=done, current_ticker=last_ticker)

        candles_by_ticker = client.candles_batch(universe, days=60, on_progress=_on_progress)
        _set_v2_progress(phase_progress=len(universe), current_ticker=None)

    # Step 3+4: compute chart signals and merge into v1 rows
    _set_v2_progress(
        phase="chart_signals",
        phase_progress=0,
        phase_total=len(universe),
        current_ticker=None,
    )
    # Build a map keyed by ticker for all v1 output rows (actionable + watchlist),
    # so we can enrich each tier in place.
    v1_rows_by_ticker: dict[str, dict] = {}
    for r in v1.get("actionable", []):
        v1_rows_by_ticker[r["ticker"]] = r
    for r in v1.get("watchlist", []):
        v1_rows_by_ticker[r["ticker"]] = r

    # Also build chart-only rows for tickers v1 skipped (no GEX data) — they
    # may still be valid coiled setups even when the flow side is silent.
    chart_only_rows: list[dict] = []

    for i, t in enumerate(universe):
        _set_v2_progress(phase_progress=i, current_ticker=t)
        candles = candles_by_ticker.get(t)
        sig = talon_v2_chart.compute_chart_signals(candles)
        v1_row = v1_rows_by_ticker.get(t)
        if v1_row is not None:
            # Enrich the v1 row with chart signals
            v1_row.update(sig)
        elif sig.get("coiled"):
            # No flow data, but coiled per chart — surface anyway in coiled_setups
            chart_only_rows.append({
                "ticker": t,
                "theme": talon_scanner._theme_for(t),  # noqa: SLF001
                "grade": None,  # no v1 grade
                "direction": None,
                "chart_only": True,
                **sig,
            })
    _set_v2_progress(phase_progress=len(universe), current_ticker=None)

    # Step 5: theme-level aggregation
    all_rows_for_themes: list[dict] = list(v1_rows_by_ticker.values()) + chart_only_rows
    themes_summary = talon_v2_chart.aggregate_themes(
        all_rows_for_themes, talon_scanner.THEMES
    )

    # Coiled tier: names with coiled=True, sorted by coiled_score then v1 grade
    coiled_setups = [
        r for r in all_rows_for_themes
        if r.get("coiled")
    ]
    coiled_setups.sort(
        key=lambda r: (
            r.get("coiled_score") or 0,
            r.get("grade") or 0,
        ),
        reverse=True,
    )

    completed_at = datetime.now(UTC)
    elapsed = round((completed_at - started_at).total_seconds(), 1)

    result = {
        **v1,  # carry every v1 field through unchanged
        "v2": True,
        "v2_scan_id": scan_id,
        "v2_generated_at": completed_at.isoformat(),
        "v2_elapsed_seconds": elapsed,
        "v2_phases_added": ["prewarm_candles", "chart_signals"],
        # Theme-level coiled aggregation
        "themes_summary": themes_summary,
        "coiled_themes": [t for t, s in themes_summary.items() if s.get("coiled_basket")],
        # Per-ticker coiled tier
        "coiled_setups": coiled_setups,
        "coiled_count": len(coiled_setups),
        # Chart-only rows kept separately so v1 consumers don't see them in `watchlist`
        "chart_only_coiled": [r["ticker"] for r in chart_only_rows],
        "v2_notes": (
            "v2 Phase 1.1 — adds ATR / volume / MA structure per ticker plus a "
            "composite coiled_score. A theme is `coiled_basket` if ≥3 members "
            "score ≥0.65. v1 flow gates and grade are unchanged."
        ),
    }
    _set_v2_progress(
        status="complete",
        completed_at=completed_at.isoformat(),
        phase="done",
        current_ticker=None,
    )
    return result
