"""The proposer — turns backtest measurements into human-gated prior proposals.

Each backtest signal maps to the config source(s) it informs. From a signal's measured 20d
edge we derive a SUGGESTED prior (a monotonic map of demonstrated IC), and — only when the
suggestion diverges materially from the live prior AND the evidence clears a trust bar —
emit a proposal. Proposals are written, never applied. `apply()` is the human gate: it moves
approved entries into prior_overrides.json, which config.prior_of layers over the code default.
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime

from nest import config
from nest.learn import backtest_core

log = logging.getLogger(__name__)

# which config sources each measured signal informs (backtest signal -> source keys)
SIGNAL_TO_SOURCES: dict[str, list[str]] = {
    "chart_combo": ["uw_chart", "uw_momentum"],
    "voladj_mom": ["uw_chart", "uw_momentum"],
    "breakout": ["uw_breakout"],
}
# trust bar: a proposal only fires if the 20d evidence clears ALL of these
MIN_ABS_T = 2.0
MIN_OOS_FRACTION = 0.65      # IC>0 on at least this share of OOS dates
MIN_DELTA = 0.10             # suggested prior must differ from live by at least this
_HORIZON = "20"              # the validated selection horizon


def _path_proposals():
    return config.PROPOSALS_FILE


def ic_to_prior(ic: float) -> float:
    """Monotonic map from demonstrated 20d IC to a prior in [0.20, 0.80]. Calibrated so the
    validated momentum edge (IC ~0.17) lands near its current 0.65 prior, IC 0 → 0.30 (a
    signal with no edge should sit low), and a strong IC ~0.25 saturates near 0.80."""
    return round(max(0.20, min(0.80, 0.30 + 2.0 * ic)), 2)


def _best_signal_for_source(sweep: dict, source: str) -> tuple[str, dict] | None:
    """The strongest measured signal (by 20d |IC|) that informs this source."""
    best = None
    for sig, srcs in SIGNAL_TO_SOURCES.items():
        if source not in srcs:
            continue
        stat = sweep["signals"].get(sig, {}).get(_HORIZON, {})
        if stat.get("mean_ic") is None:
            continue
        if best is None or abs(stat["mean_ic"]) > abs(best[1]["mean_ic"]):
            best = (sig, stat)
    return best


def propose(uw, now: datetime | None = None) -> dict:
    """Run the sweep, derive proposals, persist them. Returns the proposal record. Applies
    NOTHING — the record waits for `apply()`."""
    now = now or datetime.now(UTC)
    sweep = backtest_core.run_sweep(uw)
    if sweep.get("error") or not sweep.get("signals"):
        return {"ts": now.isoformat(timespec="seconds"), "error": sweep.get("error", "no signals"),
                "proposals": []}

    proposals, watch = [], []
    considered = sorted({s for srcs in SIGNAL_TO_SOURCES.values() for s in srcs})
    for source in considered:
        best = _best_signal_for_source(sweep, source)
        if not best:
            continue
        sig, stat = best
        live = config.prior_of(source)
        suggested = ic_to_prior(stat["mean_ic"])
        delta = round(suggested - live, 2)
        trusted = (abs(stat["t_stat"]) >= MIN_ABS_T
                   and stat["n_dates"] > 0
                   and stat["oos_pos"] / stat["n_dates"] >= MIN_OOS_FRACTION)
        material = abs(delta) >= MIN_DELTA
        direction = "raise" if delta > 0 else "lower"
        entry = {
            "source": source, "signal": sig,
            "current_prior": live, "suggested_prior": suggested, "delta": delta,
            "mean_ic": stat["mean_ic"], "t_stat": stat["t_stat"],
            "oos": f"{stat['oos_pos']}/{stat['n_dates']}", "ls_spread": stat["ls_spread"],
            "rationale": (f"{sig} measured 20d IC {stat['mean_ic']:+.3f} (t {stat['t_stat']:+.2f}, "
                          f"OOS {stat['oos_pos']}/{stat['n_dates']}, L-S {stat['ls_spread']}%) "
                          f"→ {direction} prior {live:.2f}→{suggested:.2f}"),
        }
        if trusted and material:
            proposals.append(entry)
        elif material:
            # divergence is real but not yet significant — surface it, don't act on it
            entry["note"] = "monitoring — divergence not yet significant (|t|<2 or thin OOS)"
            watch.append(entry)

    record = {
        "ts": now.isoformat(timespec="seconds"),
        "window": f"{sweep['n_dates']} dates × {sweep['n_names']} names",
        "sweep": sweep["signals"],
        "proposals": proposals,
        "watch": watch,
        "status": "pending" if proposals else "no-change",
    }
    _write(record)
    log.info("learn: %d prior proposal(s) written", len(proposals))
    return record


def _write(record: dict) -> None:
    try:
        config.DATA_DIR.mkdir(parents=True, exist_ok=True)
        _path_proposals().write_text(json.dumps(record, indent=2))
    except OSError:
        log.exception("could not write proposals.json")


def pending() -> dict:
    p = _path_proposals()
    if not p.exists():
        return {"proposals": [], "status": "none"}
    try:
        return json.loads(p.read_text())
    except (ValueError, OSError):
        return {"proposals": [], "status": "none"}


def apply(sources: list[str] | None = None) -> list[dict]:
    """THE HUMAN GATE. Merge approved proposals into prior_overrides.json (which config layers
    over the code defaults). sources=None applies all pending; else only the named sources.
    Returns the applied entries. Clears applied proposals from the pending record."""
    rec = pending()
    props = rec.get("proposals", [])
    if not props:
        return []
    applied, remaining = [], []
    overrides = config.load_prior_overrides()
    for pr in props:
        if sources is None or pr["source"] in sources:
            overrides[pr["source"]] = pr["suggested_prior"]
            applied.append(pr)
        else:
            remaining.append(pr)
    if applied:
        config.save_prior_overrides(overrides)
        rec["proposals"] = remaining
        rec["status"] = "pending" if remaining else "applied"
        _write(rec)
        log.info("learn: applied %d prior override(s)", len(applied))
    return applied
