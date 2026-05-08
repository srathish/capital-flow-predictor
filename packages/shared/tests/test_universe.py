from cfp_shared.universe import (
    BENCHMARKS,
    CROSS_ASSET,
    FRED_SERIES,
    PREDICTION_TARGETS,
    SECTORS,
    THEMES,
    all_yfinance_symbols,
)


def test_no_duplicates() -> None:
    symbols = all_yfinance_symbols()
    assert len(symbols) == len(set(symbols)), "duplicate symbol in universe"


def test_sizes() -> None:
    assert len(SECTORS) == 11
    assert len(THEMES) == 15
    assert len(BENCHMARKS) == 2
    assert len(PREDICTION_TARGETS) == 26
    flat_cross = [s for group in CROSS_ASSET.values() for s in group]
    assert len(flat_cross) == 15
    assert len(all_yfinance_symbols()) == 43


def test_fred_series() -> None:
    assert "DGS10" in FRED_SERIES
    assert len(FRED_SERIES) >= 5
