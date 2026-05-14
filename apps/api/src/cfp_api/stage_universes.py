"""Ticker universes for the STAGE scanner.

`focus` mirrors the names called out in the project spec (miners + AI infra +
quantum + semis + megacaps). It's the default because it's small enough to
scan in seconds and covers what the user actually trades.

`sp500` is loaded lazily on demand from Wikipedia via pandas; cached for the
process lifetime so we don't re-scrape per request.
"""

from __future__ import annotations

import logging
import threading

logger = logging.getLogger(__name__)


# Hand-curated based on the project context — miners, AI infra, quantum, semis,
# megacaps the user actively trades. Keep this list short and obvious; users
# can ask for specific symbols via the `tickers=` query param.
FOCUS_LIST: list[str] = [
    # BTC / HPC miners
    "IREN", "CIFR", "MARA", "RIOT", "WULF", "HUT", "CLSK", "BITF", "BTBT",
    # AI infrastructure / neo-clouds
    "NBIS", "CRWV", "APLD", "GDS", "NVDA", "SMCI", "DELL", "ANET",
    # Quantum
    "IONQ", "RGTI", "QBTS", "QUBT",
    # Semis
    "AMD", "ALAB", "CRDO", "AVGO", "MU", "TSM",
    # Megacaps (only flag when truly setting up)
    "GOOGL", "AMZN", "META", "MSFT", "AAPL",
    # Misc names called out in validation set
    "INTC", "RKLB", "SATL",
]


_sp500_cache: list[str] | None = None
_sp500_lock = threading.Lock()


def sp500() -> list[str]:
    """Lazy-load the S&P 500 constituent list from Wikipedia. We use pandas'
    `read_html` because it's already a transitive dep of yfinance; no need to
    add another scraping library."""
    global _sp500_cache
    if _sp500_cache is not None:
        return _sp500_cache
    with _sp500_lock:
        if _sp500_cache is not None:
            return _sp500_cache
        try:
            import pandas as pd  # noqa: PLC0415

            tables = pd.read_html(
                "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies"
            )
            df = tables[0]
            symbols = [
                # Wikipedia uses BRK.B; Yahoo wants BRK-B. Same for BF.B.
                str(s).strip().replace(".", "-")
                for s in df["Symbol"].tolist()
            ]
            _sp500_cache = symbols
        except Exception as exc:  # noqa: BLE001
            logger.warning("Failed to load S&P 500 list, returning empty: %s", exc)
            _sp500_cache = []
    return _sp500_cache


UNIVERSES = {
    "focus": lambda: FOCUS_LIST,
    "sp500": sp500,
    "all": lambda: list(dict.fromkeys(FOCUS_LIST + sp500())),
}


def resolve(name: str) -> list[str]:
    """Resolve a universe name to a ticker list. Unknown names return []."""
    key = name.lower().strip()
    fn = UNIVERSES.get(key)
    if fn is None:
        return []
    return fn()
