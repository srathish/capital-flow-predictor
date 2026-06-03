"""Talon v2 Phase 4.4 — float / share structure.

Pulls float + insider% + short% per ticker from yfinance (the closest free
source). Then computes an "explosiveness factor" that's the lever we've
been missing: a setup on a $500M name with a 50M float can move 5x faster
than the same setup on a $30B name with 1B float.

Per ticker:

  shares_outstanding       : float, NaN-safe
  float_shares             : public float
  float_pct_of_so          : float / shares_outstanding (lower = more held)
  short_pct_of_float       : short interest as % of float
  insider_pct              : insider holding %
  inst_pct                 : institutional holding %
  explosiveness_factor     : log10-scaled inverse of float (in millions),
                             1.0 = ~100M float, >1.5 = small float,
                             0.5 = mega cap
  small_float_flag         : True if float < 50M shares

The explosiveness factor isn't a grade modifier in v2 — it's a sort key
the UI can use to surface small-float candidates AT THE SAME signal
strength. (We don't auto-boost the grade because mega-caps with real
flow are still valid trades; we let the user pivot the sort.)
"""
from __future__ import annotations

import logging
import math
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

log = logging.getLogger(__name__)


def _safe_float(x: Any) -> float | None:
    if x is None:
        return None
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    if v != v:  # NaN
        return None
    return v


def _one(ticker: str) -> dict[str, Any]:
    out: dict[str, Any] = {
        "shares_outstanding": None,
        "float_shares": None,
        "float_pct_of_so": None,
        "short_pct_of_float": None,
        "insider_pct": None,
        "inst_pct": None,
        "explosiveness_factor": None,
        "small_float_flag": False,
    }
    try:
        import yfinance as yf
        info = yf.Ticker(ticker).info or {}
    except Exception as e:  # noqa: BLE001
        log.debug("yfinance info fetch failed for %s: %s", ticker, e)
        return out

    so = _safe_float(info.get("sharesOutstanding"))
    fl = _safe_float(info.get("floatShares"))
    si_pct = _safe_float(info.get("shortPercentOfFloat"))
    ins_pct = _safe_float(info.get("heldPercentInsiders"))
    inst_pct = _safe_float(info.get("heldPercentInstitutions"))

    out["shares_outstanding"] = so
    out["float_shares"] = fl
    if so and so > 0 and fl is not None:
        out["float_pct_of_so"] = round(fl / so, 4)
    # yfinance returns percentages as 0-1 fractions; surface as percent
    if si_pct is not None:
        out["short_pct_of_float"] = round(si_pct * 100, 2)
    if ins_pct is not None:
        out["insider_pct"] = round(ins_pct * 100, 2)
    if inst_pct is not None:
        out["inst_pct"] = round(inst_pct * 100, 2)

    if fl and fl > 0:
        # Explosiveness factor: inverse-log of float in millions.
        # ~100M float → 1.0; ~50M → ~1.3; ~10M → ~2.0; 1B → 0.5
        fl_mm = fl / 1_000_000
        out["explosiveness_factor"] = round(2.0 - math.log10(max(fl_mm, 1)), 4)
        out["small_float_flag"] = fl < 50_000_000
    return out


def fetch_batch(
    tickers: list[str],
    concurrency: int = 8,
    on_progress=None,
) -> dict[str, dict]:
    """Parallel yfinance info fetch. Bounded concurrency so we don't get
    rate-limited."""
    out: dict[str, dict] = {}
    if not tickers:
        return out
    total = len(tickers)
    done = 0
    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        futures = {pool.submit(_one, t): t for t in tickers}
        for fut in as_completed(futures):
            t = futures[fut]
            try:
                out[t] = fut.result()
            except Exception as e:  # noqa: BLE001
                log.warning("v2 float fetch failed for %s: %s", t, e)
                out[t] = {}
            done += 1
            if on_progress is not None:
                try:
                    on_progress(done, total, t)
                except Exception:  # noqa: BLE001
                    pass
    return out
