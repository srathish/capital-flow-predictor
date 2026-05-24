"""Capital Flow Predictor universe definitions (DESIGN.md §5.2).

Single source of truth for symbol lists, used by ingestion jobs and (later) the
inference API. Keep additions backward-compatible — historical features are
keyed by symbol.
"""

from __future__ import annotations

# 11 sector SPDR ETFs
SECTORS: list[str] = [
    "XLK", "XLF", "XLE", "XLV", "XLI",
    "XLU", "XLC", "XLY", "XLP", "XLB", "XLRE",
]

# 15 thematic ETFs (DESIGN.md §5.2)
THEMES: list[str] = [
    "SMH", "SOXX", "ARKK", "IBB", "KRE",
    "ITA", "JETS", "XBI", "XOP", "URA",
    "URNM", "REMX", "WCLD", "TAN", "LIT",
]

# Benchmarks used as relative-strength denominators / sanity checks
BENCHMARKS: list[str] = ["SPY", "QQQ"]

# Cross-asset features (input only, not predicted)
CROSS_ASSET: dict[str, list[str]] = {
    "equities": ["^VIX", "^VIX3M"],
    "fx_commodity": ["DX-Y.NYB", "GLD", "SLV", "USO", "UNG", "HG=F"],
    "rates_credit": ["TLT", "IEF", "SHY", "HYG", "LQD"],
    "crypto": ["BTC-USD", "ETH-USD"],
}

# Things we predict on (sectors + themes)
PREDICTION_TARGETS: list[str] = SECTORS + THEMES


def all_yfinance_symbols() -> list[str]:
    """Every Yahoo-fetched symbol: prediction targets + benchmarks + cross-asset."""
    flat_cross = [s for group in CROSS_ASSET.values() for s in group]
    # Include sub-industry cohort members (memory semis, refiners, regional
    # banks, etc.) so the daily yfinance pull covers everything the Cohorts
    # tab needs. Lazy import avoids an inter-package import-time cycle.
    from cfp_shared.cohorts import all_cohort_members
    base = PREDICTION_TARGETS + BENCHMARKS + flat_cross
    base_set = set(base)
    extra = sorted(s for s in all_cohort_members() if s not in base_set)
    return base + extra


# FRED macro series (DESIGN.md §6.1 implies these; Phase 1 baseline set)
FRED_SERIES: list[str] = [
    "DGS10",         # 10Y treasury yield
    "DGS2",          # 2Y treasury yield
    "T10Y2Y",        # 10Y minus 2Y spread
    "DTWEXBGS",      # Trade-weighted broad dollar index
    "DCOILWTICO",    # WTI crude
    "DHHNGSP",       # Henry Hub natural gas spot
    "DTB3",          # 3M T-bill secondary market rate
    "BAMLH0A0HYM2",  # ICE BofA US High Yield OAS
    "VIXCLS",        # CBOE Volatility Index. Required by delphi_regime.py
                     #   for vol_regime (low/normal/high/crisis). Without it
                     #   vol_regime falls back to 'normal' for every day.
    "DFF",           # Effective Federal Funds Rate. Required by delphi_regime.py
                     #   for macro_regime (risk_on/neutral/risk_off).
]
