"""Ticker universes for the STAGE scanner.

`focus` mirrors the names called out in the project spec (miners + AI infra +
quantum + semis + megacaps). It's the default because it's small enough to
scan in seconds and covers what the user actually trades.

`sp500` is served from a vendored static list (`stage_sp500_static.py`).
Wikipedia's HTML scraper blocks pandas' default User-Agent now, and the
list churns slowly enough that runtime scraping isn't worth the fragility.
Set `STAGE_SP500_FROM_WIKIPEDIA=1` to opt back into the scrape with a
browser User-Agent.
"""

from __future__ import annotations

import logging
import os
import threading

from .stage_sp500_static import SP500_TICKERS

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
    """Return the S&P 500 constituent list.

    Default: vendored static list (deterministic, no network). Set
    `STAGE_SP500_FROM_WIKIPEDIA=1` to fetch from Wikipedia at runtime with
    a browser User-Agent — useful if you want fresh data and accept the
    occasional 403/timeout."""
    if os.environ.get("STAGE_SP500_FROM_WIKIPEDIA") != "1":
        return list(SP500_TICKERS)

    global _sp500_cache
    if _sp500_cache:
        return _sp500_cache
    with _sp500_lock:
        if _sp500_cache:
            return _sp500_cache
        try:
            import urllib.request  # noqa: PLC0415
            import pandas as pd  # noqa: PLC0415

            # Wikipedia blocks pandas' default UA; send a real one.
            req = urllib.request.Request(
                "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies",
                headers={"User-Agent": "Mozilla/5.0 (compatible; cfp-scanner/1.0)"},
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                html = resp.read().decode("utf-8")
            df = pd.read_html(html)[0]
            symbols = [str(s).strip().replace(".", "-") for s in df["Symbol"].tolist()]
            _sp500_cache = symbols
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "Wikipedia S&P 500 scrape failed (%s); falling back to vendored list.",
                exc,
            )
            return list(SP500_TICKERS)
    return _sp500_cache or list(SP500_TICKERS)


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
