from __future__ import annotations

import numpy as np
import pandas as pd
from cfp_models.targets import compute_targets


def _prices_long(seed: int = 0) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    idx = pd.date_range("2024-01-02", periods=100, freq="B")
    rows = []
    for sym, vol in [("SPY", 0.01), ("XLK", 0.013), ("XLE", 0.018)]:
        rets = rng.normal(0, vol, size=len(idx))
        close = 100 * np.exp(np.cumsum(rets))
        for ts, c in zip(idx, close, strict=True):
            rows.append({"ts": ts, "symbol": sym, "close": float(c)})
    return pd.DataFrame(rows)


def test_target_is_relative_to_spy() -> None:
    df = _prices_long()
    targets = compute_targets(df, target_symbols=["XLK", "XLE"], horizons=(5,))
    # Manual check: pivot, compute, compare
    px = df.pivot(index="ts", columns="symbol", values="close").sort_index()
    expected = (px["XLK"].shift(-5) / px["XLK"] - 1) - (px["SPY"].shift(-5) / px["SPY"] - 1)
    expected = expected.dropna()
    got = targets[targets["symbol"] == "XLK"].set_index("ts")["target"]
    pd.testing.assert_series_equal(
        got.sort_index(), expected.sort_index(), check_names=False, atol=1e-12, rtol=1e-12
    )


def test_no_lookahead_in_target() -> None:
    """The last N business days must have no target (we can't see N days ahead)."""
    df = _prices_long()
    targets = compute_targets(df, target_symbols=["XLK"], horizons=(5, 10, 20))
    px_dates = pd.Index(sorted(df["ts"].unique()))
    for n in (5, 10, 20):
        h = targets[targets["horizon_d"] == n]
        last_valid = h["ts"].max()
        # The last valid target must be at least n business days before the end
        assert last_valid <= px_dates[-(n + 1)]


def test_missing_benchmark_raises() -> None:
    df = _prices_long().query("symbol != 'SPY'")
    try:
        compute_targets(df, target_symbols=["XLK"])
    except ValueError:
        return
    raise AssertionError("expected ValueError when benchmark is absent")
