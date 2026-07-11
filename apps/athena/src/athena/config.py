"""Athena configuration: watchlist, limits, feature flags. Limits are code, not vibes."""

from __future__ import annotations

import os
from pathlib import Path

import yaml

PACKAGE_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = Path(__file__).resolve().parents[4]
DATA_DIR = Path(os.environ.get("ATHENA_HOME", PACKAGE_ROOT / "data"))
JOURNAL_DB = DATA_DIR / "journal.db"
KILL_FILE = DATA_DIR / "KILL"  # presence blocks every alert — the kill switch

UW_BASE = "https://api.unusualwhales.com"
UW_TOKEN_ENV = "UNUSUAL_WHALES_API_KEY"  # same env var the rest of the repo uses

ANTHROPIC_MODEL = os.environ.get("ATHENA_MODEL", "claude-sonnet-5")
DISCORD_WEBHOOK_ENV = "DISCORD_WEBHOOK_URL"

# v1 universe: indexes only (user rule: 0DTE scope = SPXW/SPY/QQQ; stocks are v2,
# gated on the paper record).
DEFAULT_WATCHLIST = ["SPXW", "SPY", "QQQ"]

# Risk gatekeeper limits — every rejection is journaled with its reason.
CONVICTION_FLOOR = 0.65  # theses below this never alert
MAX_ALERTS_PER_DAY = 6
DATA_STALENESS_MAX_S = 300  # halt if perception data is older than this
MAX_RISK_PCT_PER_PLAY = 3.0  # size guidance cap (% of account), advisory only

# Orchestrator cadence
CYCLE_MINUTES = 15
MARKET_OPEN = (9, 31)  # ET
MARKET_CLOSE = (16, 0)

# Perception cache TTLs (seconds) — UW data costs money; cache aggressively.
TTL = {
    "spot_exposures_strike": 60,
    "greek_exposure": 300,
    "flow_alerts": 60,
    "net_prem_ticks": 60,
    "market_tide": 120,
    "ohlc": 60,
    "stock_state": 30,
}


def watchlist() -> list[str]:
    path = Path(__file__).with_name("watchlist.yaml")
    if path.exists():
        loaded = yaml.safe_load(path.read_text()) or {}
        return list(loaded.get("tickers", DEFAULT_WATCHLIST))
    return list(DEFAULT_WATCHLIST)


def uw_token() -> str:
    token = os.environ.get(UW_TOKEN_ENV, "")
    if not token:
        raise RuntimeError(f"{UW_TOKEN_ENV} is not set (check .env at the repo root)")
    return token
