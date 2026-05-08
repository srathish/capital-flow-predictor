"""Point-in-time correctness invariant.

The features at any date T must depend only on data with ts <= T.
We verify this by computing the same features on (a) a panel ending at T and
(b) a panel ending at T + K (with K extra days of future data), then asserting
that all per-row feature values for ts <= T are bit-equal.

If any feature peeks at the future, the values for older timestamps will
shift when more data is appended, and this test catches it.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from cfp_features import pipeline


def _synthetic_long(seed: int = 7) -> tuple[pd.DataFrame, pd.DataFrame]:
    rng = np.random.default_rng(seed)
    n_days = 320
    idx = pd.date_range("2024-01-02", periods=n_days, freq="B")
    # SPY = calendar; XLK + XLF = prediction targets; ^VIX = cross-asset
    symbols = {
        "SPY": (450.0, 0.010),
        "XLK": (180.0, 0.013),
        "XLF": (38.0, 0.012),
        "^VIX": None,
    }
    rows = []
    for sym, params in symbols.items():
        if params is None:
            close = rng.uniform(12, 24, n_days)
        else:
            start, vol = params
            rets = rng.normal(0.0, vol, size=n_days)
            close = start * np.exp(np.cumsum(rets))
        for ts, c in zip(idx, close, strict=True):
            rows.append(
                {
                    "ts": ts,
                    "symbol": sym,
                    "open": c * 0.999,
                    "high": c * 1.005,
                    "low": c * 0.995,
                    "close": c,
                    "volume": int(rng.integers(1_000_000, 5_000_000)),
                }
            )
    prices = pd.DataFrame(rows)

    macro_rows = []
    for ts in idx:
        macro_rows.append(
            {"ts": ts, "series_id": "DGS10", "value": float(rng.uniform(3.5, 5.0))}
        )
    macro = pd.DataFrame(macro_rows)
    return prices, macro


def test_point_in_time_invariance() -> None:
    prices, macro = _synthetic_long()

    # Pick a cutoff near the middle so both halves have enough rolling history
    all_dates = sorted(prices["ts"].unique())
    cutoff = all_dates[200]

    early_prices = prices[prices["ts"] <= cutoff]
    early_macro = macro[macro["ts"] <= cutoff]

    cross_early, sector_early = pipeline.build(
        early_prices, early_macro, target_symbols=["XLK", "XLF"]
    )
    cross_full, sector_full = pipeline.build(
        prices, macro, target_symbols=["XLK", "XLF"]
    )

    # Restrict the full-panel results to the same dates as the early panel
    cross_full_trim = cross_full.loc[cross_full.index <= pd.Timestamp(cutoff)]
    sector_full_trim = sector_full[sector_full["ts"] <= pd.Timestamp(cutoff)].reset_index(drop=True)
    sector_early = sector_early.reset_index(drop=True)

    # Must align exactly
    assert cross_early.shape == cross_full_trim.shape
    pd.testing.assert_frame_equal(
        cross_early.sort_index(), cross_full_trim.sort_index(),
        check_dtype=False, check_exact=False, atol=1e-10, rtol=1e-10,
    )

    # Sector frame: sort by (symbol, ts) for deterministic compare
    cols_to_compare = [c for c in sector_early.columns if c not in {"ts", "symbol"}]
    sort_cols = ["symbol", "ts"]
    a = sector_early.sort_values(sort_cols).reset_index(drop=True)
    b = sector_full_trim.sort_values(sort_cols).reset_index(drop=True)
    assert a[sort_cols].equals(b[sort_cols])
    pd.testing.assert_frame_equal(
        a[cols_to_compare], b[cols_to_compare],
        check_dtype=False, check_exact=False, atol=1e-10, rtol=1e-10,
    )
