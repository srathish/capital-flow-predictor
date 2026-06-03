"""Talon v2 scanner — runs v1 first, then enriches with all v2 phases.

Phase map (all shipped):
  1.1 chart structure   talon_v2_chart       ATR + vol + MA + coiled
  1.2 earnings window   talon_v2_catalysts   dte_to_earnings, earnings_risk
  1.3 whale concentration talon_v2_whale     top strike $, concentration, score
  2.1 MA-gate           (in this file)        v1 grade adjusted by MA structure
  2.2 short interest    talon_v2_context     si_pct_float, days_to_cover, squeeze
  2.3 analyst ratings   talon_v2_context     consensus PT vs spot, skew
  3.1 insider           talon_v2_context     cluster buy flag
  3.2 base patterns     talon_v2_patterns    flat_base / htf / cup-handle / pullback
  3.3 fundamentals      talon_v2_fundamentals rev_growth, gross_margin, D/E, quality

Each phase is independent. If a UW endpoint returns null for a ticker, the
row just lacks that signal — the scan keeps going for the other 503.

The v1 flow gates and grade stay UNCHANGED. v2's only effect on grade is
Phase 2.1 — a small ±5pt adjustment based on MA structure (above 50d = +,
below = -). The other signals are surfaced as fields, not graded.
"""
from __future__ import annotations

import logging
import threading
import uuid
from datetime import UTC, datetime
from typing import Any

import pandas as pd

from cfp_api import (
    talon_scanner,
    talon_v2_block,
    talon_v2_catalysts,
    talon_v2_chart,
    talon_v2_context,
    talon_v2_float,
    talon_v2_fundamentals,
    talon_v2_macro,
    talon_v2_news,
    talon_v2_patterns,
    talon_v2_squeeze,
    talon_v2_whale,
)

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Per-phase enable flags. Toggle off via env if a specific UW endpoint is
# misbehaving and you want to keep the scanner working without it.
# ---------------------------------------------------------------------------
import os

_PHASE_ENABLED = {
    "chart":        os.environ.get("TALON_V2_CHART", "1") != "0",
    "catalysts":    os.environ.get("TALON_V2_CATALYSTS", "1") != "0",
    "whale":        os.environ.get("TALON_V2_WHALE", "1") != "0",
    "short":        os.environ.get("TALON_V2_SHORT", "1") != "0",
    "analyst":      os.environ.get("TALON_V2_ANALYST", "1") != "0",
    "insider":      os.environ.get("TALON_V2_INSIDER", "1") != "0",
    "patterns":     os.environ.get("TALON_V2_PATTERNS", "1") != "0",
    "fundamentals": os.environ.get("TALON_V2_FUNDAMENTALS", "1") != "0",
    # Phase 4 additions
    "news":         os.environ.get("TALON_V2_NEWS", "1") != "0",
    "block":        os.environ.get("TALON_V2_BLOCK", "1") != "0",
    "macro":        os.environ.get("TALON_V2_MACRO", "1") != "0",
    "float":        os.environ.get("TALON_V2_FLOAT", "1") != "0",
    "squeeze":      os.environ.get("TALON_V2_SQUEEZE", "1") != "0",
}


# ---------------------------------------------------------------------------
# Scan-in-progress state
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


# ---------------------------------------------------------------------------
# Phase 2.1 — MA structure as a soft grade modifier
# ---------------------------------------------------------------------------
def _apply_ma_gate(row: dict, sig: dict) -> None:
    """Adjust row['grade'] in place by ±5 based on MA structure.

    Above 50d AND above 200d = +3 (long-term trend intact)
    Above 20d only            = +1 (short-term momentum)
    Below 20d AND 50d         = -3 (structure compromised)
    """
    grade = row.get("grade")
    if grade is None:
        return
    above_20 = sig.get("above_20d")
    above_50 = sig.get("above_50d")
    above_200 = sig.get("above_200d")
    adjust = 0
    if above_200 == 1 and above_50 == 1:
        adjust += 3
    if above_20 == 1:
        adjust += 1
    if above_20 == 0 and above_50 == 0:
        adjust -= 3
    if adjust != 0:
        row["grade_v1"] = grade
        row["grade"] = max(0.0, min(100.0, round(grade + adjust, 1)))
        row["ma_gate_adjust"] = adjust


def _run_v2_inner(
    scan_date: str | None, scan_id: str, started_at: datetime
) -> dict[str, Any]:
    # Step 1: v1
    v1 = talon_scanner.run_scan(scan_date)
    universe = talon_scanner.load_universe()
    client = talon_scanner._get_live_client()  # noqa: SLF001
    scan_date_obj = (
        datetime.fromisoformat(v1["scan_date"]).date()
        if v1.get("scan_date")
        else datetime.now(UTC).date()
    )

    # Build the row map we'll enrich
    v1_rows_by_ticker: dict[str, dict] = {}
    for r in v1.get("actionable", []):
        v1_rows_by_ticker[r["ticker"]] = r
    for r in v1.get("watchlist", []):
        v1_rows_by_ticker[r["ticker"]] = r

    chart_only_rows: list[dict] = []

    # -----------------------------------------------------------------------
    # Prewarm + compute helper — runs a batch fetch with progress, then
    # per-ticker compute that writes into v1_rows_by_ticker.
    # -----------------------------------------------------------------------
    def _on(done, _total, last):
        _set_v2_progress(phase_progress=done, current_ticker=last)

    # Phase 1.1 — chart structure
    candles_by_ticker: dict[str, list[dict] | None] = {}
    if client is not None and _PHASE_ENABLED["chart"]:
        _set_v2_progress(phase="prewarm_candles", phase_progress=0,
                         phase_total=len(universe), current_ticker=None)
        candles_by_ticker = client.candles_batch(universe, days=60, on_progress=_on)
        _set_v2_progress(phase="chart_signals", phase_progress=0,
                         phase_total=len(universe))
        for i, t in enumerate(universe):
            _set_v2_progress(phase_progress=i, current_ticker=t)
            sig = talon_v2_chart.compute_chart_signals(candles_by_ticker.get(t))
            row = v1_rows_by_ticker.get(t)
            if row is not None:
                row.update(sig)
                _apply_ma_gate(row, sig)  # Phase 2.1
            elif sig.get("coiled"):
                chart_only_rows.append({
                    "ticker": t,
                    "theme": talon_scanner._theme_for(t),  # noqa: SLF001
                    "grade": None,
                    "direction": None,
                    "chart_only": True,
                    **sig,
                })

    # Phase 1.2 — earnings calendar
    if client is not None and _PHASE_ENABLED["catalysts"]:
        _set_v2_progress(phase="prewarm_earnings", phase_progress=0,
                         phase_total=len(universe), current_ticker=None)
        earnings_by_ticker = client.earnings_batch(universe, on_progress=_on)
        _set_v2_progress(phase="catalyst_signals", phase_progress=0,
                         phase_total=len(universe))
        for i, t in enumerate(universe):
            _set_v2_progress(phase_progress=i, current_ticker=t)
            sig = talon_v2_catalysts.compute_catalyst_signals(
                earnings_by_ticker.get(t), scan_date_obj
            )
            row = v1_rows_by_ticker.get(t)
            if row is not None:
                row.update(sig)

    # Phase 1.3 — whale concentration
    if client is not None and _PHASE_ENABLED["whale"]:
        _set_v2_progress(phase="prewarm_flow_alerts", phase_progress=0,
                         phase_total=len(universe), current_ticker=None)
        # Only fetch flow alerts for tickers v1 surfaced — saves 504->~300 calls.
        # max_dte=75 covers the 1-2 month swing window the picker actually
        # wants. Default UW limit is 35 (too short — biases to weeklies).
        whale_universe = list(v1_rows_by_ticker.keys()) or universe
        flow_by_ticker = client.flow_alerts_batch(
            whale_universe, max_dte=75, on_progress=_on
        )
        _set_v2_progress(phase="whale_signals", phase_progress=0,
                         phase_total=len(whale_universe))
        for i, t in enumerate(whale_universe):
            _set_v2_progress(phase_progress=i, current_ticker=t)
            sig = talon_v2_whale.compute_whale_signals(flow_by_ticker.get(t))
            row = v1_rows_by_ticker.get(t)
            if row is not None:
                row.update(sig)

    # Phase 2.2 — short
    if client is not None and _PHASE_ENABLED["short"]:
        _set_v2_progress(phase="prewarm_short", phase_progress=0,
                         phase_total=len(universe), current_ticker=None)
        short_by_ticker = client.short_batch(universe, on_progress=_on)
        _set_v2_progress(phase="short_signals", phase_progress=0,
                         phase_total=len(universe))
        for i, t in enumerate(universe):
            _set_v2_progress(phase_progress=i, current_ticker=t)
            sig = talon_v2_context.compute_short_signals(short_by_ticker.get(t))
            row = v1_rows_by_ticker.get(t)
            if row is not None:
                row.update(sig)

    # Phase 2.3 — analyst (needs spot price from v1 row, none for chart-only)
    if client is not None and _PHASE_ENABLED["analyst"]:
        _set_v2_progress(phase="prewarm_analyst", phase_progress=0,
                         phase_total=len(universe), current_ticker=None)
        analyst_by_ticker = client.analyst_batch(universe, on_progress=_on)
        _set_v2_progress(phase="analyst_signals", phase_progress=0,
                         phase_total=len(universe))
        for i, t in enumerate(universe):
            _set_v2_progress(phase_progress=i, current_ticker=t)
            row = v1_rows_by_ticker.get(t)
            # Try to get spot from candles we already pulled
            spot = None
            cs = candles_by_ticker.get(t)
            if cs:
                df = pd.DataFrame(cs[-1:]) if cs else None
                if df is not None and "close" in df:
                    try:
                        spot = float(df["close"].iloc[-1])
                    except (ValueError, IndexError):
                        spot = None
            sig = talon_v2_context.compute_analyst_signals(
                analyst_by_ticker.get(t), spot
            )
            if row is not None:
                row.update(sig)

    # Phase 3.1 — insider
    if client is not None and _PHASE_ENABLED["insider"]:
        _set_v2_progress(phase="prewarm_insider", phase_progress=0,
                         phase_total=len(universe), current_ticker=None)
        insider_by_ticker = client.insider_batch(universe, on_progress=_on)
        _set_v2_progress(phase="insider_signals", phase_progress=0,
                         phase_total=len(universe))
        for i, t in enumerate(universe):
            _set_v2_progress(phase_progress=i, current_ticker=t)
            sig = talon_v2_context.compute_insider_signals(insider_by_ticker.get(t))
            row = v1_rows_by_ticker.get(t)
            if row is not None:
                row.update(sig)

    # Phase 3.2 — patterns (reads candles already fetched)
    if _PHASE_ENABLED["patterns"]:
        _set_v2_progress(phase="pattern_signals", phase_progress=0,
                         phase_total=len(universe), current_ticker=None)
        for i, t in enumerate(universe):
            _set_v2_progress(phase_progress=i, current_ticker=t)
            sig = talon_v2_patterns.compute_pattern_signals(candles_by_ticker.get(t))
            row = v1_rows_by_ticker.get(t)
            if row is not None:
                row.update(sig)

    # Phase 3.3 — fundamentals
    if client is not None and _PHASE_ENABLED["fundamentals"]:
        _set_v2_progress(phase="prewarm_fundamentals", phase_progress=0,
                         phase_total=len(universe), current_ticker=None)
        fund_by_ticker = client.fundamentals_batch(universe, on_progress=_on)
        _set_v2_progress(phase="fundamentals_signals", phase_progress=0,
                         phase_total=len(universe))
        for i, t in enumerate(universe):
            _set_v2_progress(phase_progress=i, current_ticker=t)
            sig = talon_v2_fundamentals.compute_fundamentals_signals(
                fund_by_ticker.get(t)
            )
            row = v1_rows_by_ticker.get(t)
            if row is not None:
                row.update(sig)

    # -----------------------------------------------------------------------
    # Phase 4 additions — explosive-play detection
    # -----------------------------------------------------------------------

    # Phase 4.3 — macro regime (one global query; applied per row at the end)
    macro_regime: dict | None = None
    if _PHASE_ENABLED["macro"]:
        _set_v2_progress(phase="macro_regime", phase_progress=0, phase_total=1)
        macro_regime = talon_v2_macro.load_regime()
        _set_v2_progress(phase_progress=1)

    # Phase 4.1 — news catalysts (only for tickers v1 surfaced; news fetch is
    # the slowest external call so we narrow the universe)
    news_universe = list(v1_rows_by_ticker.keys()) or universe
    if _PHASE_ENABLED["news"]:
        _set_v2_progress(phase="news_signals", phase_progress=0,
                         phase_total=len(news_universe), current_ticker=None)
        news_by_ticker = talon_v2_news.fetch_and_compute_batch(
            news_universe, on_progress=_on
        )
        for t in news_universe:
            row = v1_rows_by_ticker.get(t)
            sig = news_by_ticker.get(t)
            if row is not None and sig:
                row.update(sig)

    # Phase 4.2 — dark pool block accumulation (one DB query)
    if _PHASE_ENABLED["block"]:
        _set_v2_progress(phase="block_accumulation", phase_progress=0,
                         phase_total=len(news_universe))
        block_by_ticker = talon_v2_block.fetch_aggregates(news_universe)
        for t in news_universe:
            row = v1_rows_by_ticker.get(t)
            sig = block_by_ticker.get(t)
            if row is not None and sig:
                row.update(sig)
        _set_v2_progress(phase_progress=len(news_universe))

    # Phase 4.4 — float / share structure (yfinance batched)
    if _PHASE_ENABLED["float"]:
        _set_v2_progress(phase="float_signals", phase_progress=0,
                         phase_total=len(news_universe), current_ticker=None)
        float_by_ticker = talon_v2_float.fetch_batch(
            news_universe, on_progress=_on
        )
        for t in news_universe:
            row = v1_rows_by_ticker.get(t)
            sig = float_by_ticker.get(t)
            if row is not None and sig:
                row.update(sig)

    # Phase 4.5 — gamma squeeze trigger (uses strike_gex already cached
    # for whale phase; one UW call per ticker but cached when whale ran)
    if client is not None and _PHASE_ENABLED["squeeze"]:
        _set_v2_progress(phase="squeeze_signals", phase_progress=0,
                         phase_total=len(news_universe), current_ticker=None)
        for i, t in enumerate(news_universe):
            _set_v2_progress(phase_progress=i, current_ticker=t)
            row = v1_rows_by_ticker.get(t)
            if row is None:
                continue
            try:
                strike_rows = client.strike_gex(t) or []
            except Exception:  # noqa: BLE001
                strike_rows = []
            # Best-effort spot from candles already fetched in chart phase
            spot = None
            cs = candles_by_ticker.get(t) if candles_by_ticker else None
            if cs:
                try:
                    spot = float(cs[-1].get("close")) if cs[-1].get("close") else None
                except (ValueError, IndexError):
                    spot = None
            sig = talon_v2_squeeze.compute_squeeze_signals(
                strike_rows, spot, row, row.get("gamma_now")
            )
            row.update(sig)

    # Phase 4.3 application — apply regime multipliers to every row's grade
    # AFTER all other phases, so the multiplier acts on the v1+MA-gate grade.
    if macro_regime is not None:
        for row in v1_rows_by_ticker.values():
            talon_v2_macro.apply_regime_to_row(row, macro_regime)

    # -----------------------------------------------------------------------
    # Aggregate themes (uses chart coiled signals only — themes care about
    # basket structure, not single-name fundamentals)
    # -----------------------------------------------------------------------
    all_rows_for_themes: list[dict] = list(v1_rows_by_ticker.values()) + chart_only_rows
    themes_summary = talon_v2_chart.aggregate_themes(
        all_rows_for_themes, talon_scanner.THEMES
    )

    # Coiled tier sort
    coiled_setups = [r for r in all_rows_for_themes if r.get("coiled")]
    coiled_setups.sort(
        key=lambda r: (r.get("coiled_score") or 0, r.get("grade") or 0),
        reverse=True,
    )

    # Whale-flagged tier — highest-conviction single-strike accumulation
    whale_setups = [
        r for r in v1_rows_by_ticker.values()
        if r.get("whale_flag")
    ]
    whale_setups.sort(key=lambda r: r.get("whale_score") or 0, reverse=True)

    # Pattern setups — anything with a detected pattern
    pattern_setups = [r for r in v1_rows_by_ticker.values() if r.get("pattern")]
    pattern_setups.sort(key=lambda r: r.get("pattern_score") or 0, reverse=True)

    # Phase 4 tiers
    catalyst_setups = [r for r in v1_rows_by_ticker.values() if r.get("news_flag")]
    catalyst_setups.sort(key=lambda r: r.get("news_catalyst_score") or 0, reverse=True)

    block_setups = [r for r in v1_rows_by_ticker.values() if r.get("dp_block_flag")]
    block_setups.sort(key=lambda r: r.get("dp_buy_notional_5d") or 0, reverse=True)

    squeeze_setups = [r for r in v1_rows_by_ticker.values() if r.get("squeeze_trigger_flag")]
    squeeze_setups.sort(key=lambda r: r.get("squeeze_score") or 0, reverse=True)

    small_float_setups = [r for r in v1_rows_by_ticker.values() if r.get("small_float_flag")]
    small_float_setups.sort(
        key=lambda r: (r.get("explosiveness_factor") or 0, r.get("grade") or 0),
        reverse=True,
    )

    # Re-sort actionable/watchlist after MA-gate AND macro-regime adjustments
    actionable = [r for r in v1_rows_by_ticker.values() if (r.get("grade") or 0) >= 70]
    watchlist = [r for r in v1_rows_by_ticker.values() if 55 <= (r.get("grade") or 0) < 70]
    actionable.sort(key=lambda r: r.get("grade") or 0, reverse=True)
    watchlist.sort(key=lambda r: r.get("grade") or 0, reverse=True)

    completed_at = datetime.now(UTC)
    elapsed = round((completed_at - started_at).total_seconds(), 1)

    result = {
        **v1,
        # Override with re-graded lists (MA gate may have shifted boundaries)
        "actionable": actionable,
        "watchlist": watchlist[:100],
        "actionable_count": len(actionable),
        "watchlist_count": len(watchlist),
        # v2 metadata
        "v2": True,
        "v2_scan_id": scan_id,
        "v2_generated_at": completed_at.isoformat(),
        "v2_elapsed_seconds": elapsed,
        "v2_phases_enabled": [p for p, on in _PHASE_ENABLED.items() if on],
        "v2_phases_disabled": [p for p, on in _PHASE_ENABLED.items() if not on],
        # New tiers
        "themes_summary": themes_summary,
        "coiled_themes": [t for t, s in themes_summary.items() if s.get("coiled_basket")],
        "coiled_setups": coiled_setups,
        "coiled_count": len(coiled_setups),
        "whale_setups": whale_setups,
        "whale_count": len(whale_setups),
        "pattern_setups": pattern_setups,
        "pattern_count": len(pattern_setups),
        # Phase 4 tiers
        "catalyst_setups": catalyst_setups,
        "catalyst_count": len(catalyst_setups),
        "block_setups": block_setups,
        "block_count": len(block_setups),
        "squeeze_setups": squeeze_setups,
        "squeeze_count": len(squeeze_setups),
        "small_float_setups": small_float_setups,
        "small_float_count": len(small_float_setups),
        "market_regime": macro_regime,
        "chart_only_coiled": [r["ticker"] for r in chart_only_rows],
        "v2_notes": (
            "Phases shipped: 1.1 chart, 1.2 earnings, 1.3 whale, 2.1 MA-gate, "
            "2.2 short, 2.3 analyst, 3.1 insider, 3.2 patterns, 3.3 fundamentals, "
            "4.1 news, 4.2 block, 4.3 macro-regime, 4.4 float, 4.5 squeeze. "
            "v1 flow gates unchanged; grade may be ±5 from v1 due to MA-gate, "
            "and ±20% due to macro-regime multiplier (see grade_v1 + ma_gate_adjust "
            "+ regime_grade_multiplier on row)."
        ),
    }
    _set_v2_progress(
        status="complete",
        completed_at=completed_at.isoformat(),
        phase="done",
        current_ticker=None,
    )
    return result
