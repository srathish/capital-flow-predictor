"""Market regime detection.

Labels each trading day as one of {bull, bear, chop} from VIX level + SPY
trend + breadth. The label is point-in-time: only past observations are used,
so it can be fed into the ensemble as a feature without lookahead.

Inputs:
    px_wide: DataFrame indexed by ts, must include ``SPY``. Optional ``^VIX``.
    breadth: optional DataFrame indexed by ts with column ``pct_above_50d``
             (fraction of S&P constituents above their 50-day MA, 0..1).

Decision rule (deliberately simple — interpretable beats a black box for
a regime label that drives risk-on/off across personas):

    bull  := VIX < 18 AND SPY > 50d MA AND breadth > 0.55
    bear  := VIX > 25 OR  SPY < 200d MA OR breadth < 0.30
    chop  := neither of the above

When VIX or breadth is missing, the rule falls back to SPY trend alone.

Returns a DataFrame with columns:
    regime          — categorical {'bull','bear','chop'}
    vix_level       — float
    spy_above_50d   — int 0/1
    spy_above_200d  — int 0/1
    breadth_50d     — float 0..1
    risk_multiplier — 1.0 / 0.5 / 0.0 mapping for position sizing
"""

from __future__ import annotations

import numpy as np
import pandas as pd

_RISK_MULT = {"bull": 1.0, "chop": 0.5, "bear": 0.0}


def label_regimes(
    px_wide: pd.DataFrame,
    breadth: pd.DataFrame | None = None,
    *,
    vix_low: float = 18.0,
    vix_high: float = 25.0,
    breadth_high: float = 0.55,
    breadth_low: float = 0.30,
) -> pd.DataFrame:
    if "SPY" not in px_wide.columns:
        raise ValueError("regime detection requires SPY in px_wide")

    out = pd.DataFrame(index=px_wide.index)
    spy = px_wide["SPY"]
    ma50 = spy.rolling(50, min_periods=50).mean()
    ma200 = spy.rolling(200, min_periods=200).mean()
    out["spy_above_50d"] = (spy > ma50).astype("Int8")
    out["spy_above_200d"] = (spy > ma200).astype("Int8")

    vix = px_wide.get("^VIX")
    out["vix_level"] = vix if vix is not None else np.nan

    if breadth is not None and "pct_above_50d" in breadth.columns:
        b = breadth["pct_above_50d"].reindex(out.index).ffill()
        out["breadth_50d"] = b
    else:
        out["breadth_50d"] = np.nan

    def _row_label(r: pd.Series) -> str:
        spy50 = r["spy_above_50d"]
        spy200 = r["spy_above_200d"]
        v = r["vix_level"]
        b = r["breadth_50d"]
        # Bear conditions: any decisive risk-off signal.
        if (pd.notna(v) and v > vix_high) or spy200 == 0 or (pd.notna(b) and b < breadth_low):
            return "bear"
        # Bull conditions: all-clear.
        vix_ok = pd.isna(v) or v < vix_low
        breadth_ok = pd.isna(b) or b > breadth_high
        if vix_ok and spy50 == 1 and breadth_ok and spy200 == 1:
            return "bull"
        return "chop"

    out["regime"] = out.apply(_row_label, axis=1)
    out["risk_multiplier"] = out["regime"].map(_RISK_MULT).astype(float)
    return out
