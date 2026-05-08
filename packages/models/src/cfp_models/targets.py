"""Construct prediction targets: next-N-day relative strength vs benchmark (DESIGN.md §7.1).

target(t, sym, N) = (sym_{t+N}/sym_t - 1) - (spy_{t+N}/spy_t - 1)

Forward-looking: only valid where t+N is observed. Rows past the dataset edge
get NaN and must not be used as training examples.
"""

from __future__ import annotations

import pandas as pd

DEFAULT_HORIZONS: tuple[int, ...] = (5, 10, 20)


def compute_targets(
    prices_long: pd.DataFrame,
    target_symbols: list[str],
    benchmark: str = "SPY",
    horizons: tuple[int, ...] = DEFAULT_HORIZONS,
    calendar_symbol: str = "SPY",
) -> pd.DataFrame:
    """Returns long-format DataFrame: ts, symbol, horizon_d, target.

    Targets are computed on the calendar-symbol's trading days only (default SPY),
    so weekend BTC bars don't shift horizons.
    """
    if not {"ts", "symbol", "close"}.issubset(prices_long.columns):
        raise ValueError(f"prices_long missing required columns: {prices_long.columns!r}")

    px = (
        prices_long.pivot(index="ts", columns="symbol", values="close")
        .sort_index()
    )
    if calendar_symbol in px.columns:
        px = px.loc[px[calendar_symbol].notna()]
    if benchmark not in px.columns:
        raise ValueError(f"benchmark {benchmark!r} not in prices")

    spy = px[benchmark]
    rows: list[pd.DataFrame] = []
    for sym in target_symbols:
        if sym not in px.columns:
            continue
        s = px[sym]
        for n in horizons:
            future_sym = s.shift(-n) / s - 1.0
            future_spy = spy.shift(-n) / spy - 1.0
            rs = (future_sym - future_spy).dropna()
            if rs.empty:
                continue
            rows.append(
                pd.DataFrame(
                    {
                        "ts": rs.index,
                        "symbol": sym,
                        "horizon_d": n,
                        "target": rs.to_numpy(),
                    }
                )
            )
    if not rows:
        return pd.DataFrame(columns=["ts", "symbol", "horizon_d", "target"])
    return pd.concat(rows, ignore_index=True)
