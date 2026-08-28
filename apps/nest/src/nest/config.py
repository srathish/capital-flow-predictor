"""Nest configuration: paths, source taxonomy, priors, and the alert budget.

The scarcity mechanics (conviction floor, max calls/day, per-ticker cooldown) and the
LLM rate limit are code here, not prompt discipline — a budget is a property of the
system. Storage is local SQLite (repo doctrine: no Postgres), same as apps/athena.
"""

from __future__ import annotations

import os
from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = Path(__file__).resolve().parents[4]
DATA_DIR = Path(os.environ.get("NEST_HOME", PACKAGE_ROOT / "data"))
EVENT_DB = DATA_DIR / "nest.db"  # the append-only event spine
KILL_FILE = DATA_DIR / "KILL"  # presence blocks every Call — the kill switch

# --- external services -------------------------------------------------------
UW_BASE = "https://api.unusualwhales.com"
UW_TOKEN_ENV = "UNUSUAL_WHALES_API_KEY"  # same env var the rest of the repo uses
DISCORD_WEBHOOK_ENV = "DISCORD_WEBHOOK_URL"
ANTHROPIC_KEY_ENV = "ANTHROPIC_API_KEY"

# Layer 3 synthesis is Haiku (cheap, gated, cached); the once-a-day digest is Sonnet.
SYNTH_MODEL = os.environ.get("NEST_MODEL", "claude-haiku-4-5-20251001")
DIGEST_MODEL = os.environ.get("NEST_DIGEST_MODEL", "claude-sonnet-5")

# --- alert policy (scarcity) -------------------------------------------------
CONVICTION_FLOOR = 70  # 0-100; scores below this never become a Call
MAX_CALLS_PER_DAY = 3
COOLDOWN_SESSIONS = 5  # per-ticker cooldown unless conviction jumps by...
COOLDOWN_OVERRIDE_DELTA = 15  # ...this many points on new evidence

# --- convergence gate (anti-noise) -------------------------------------------
# A score alone never triggers. The gate needs enough independent evidence.
GATE_MIN_SIGNALS = 3  # live contributing signals agreeing on direction
GATE_MIN_FAMILIES = 2  # from at least this many independent source families
GATE_WINDOW_HOURS = 72  # rolling window signals must fall inside

# --- Layer 1 mechanical accumulation -----------------------------------------
# conviction = 100 * (1 - exp(-|net_raw| / SCORE_SCALE)); SCORE_SCALE tunes how much
# weighted evidence saturates the scale. ~2 units of net evidence -> ~74.
SCORE_SCALE = 1.5

# --- Layer 3 rate limiter (load-bearing: the only way to blow the budget is
# letting the LLM into the hot loop) -----------------------------------------
LLM_MIN_INTERVAL_S = 20  # min seconds between synthesis calls
LLM_MAX_PER_DAY = 40  # hard daily ceiling on synthesis calls

# --- source taxonomy ---------------------------------------------------------
# Families are what the convergence gate counts for independence: three signals
# from one family (three whale prints) is NOT convergence.
FAMILIES = ("flow", "levels", "positioning", "filings", "social", "macro",
            "chart", "fundamental", "catalyst")

SOURCE_FAMILY: dict[str, str] = {
    "uw_darkpool": "flow",
    "uw_flow": "flow",
    "uw_lit_flow": "flow",
    "uw_gex": "levels",
    "gexclaw": "levels",
    "uw_oi": "positioning",
    "uw_short": "positioning",
    "uw_insider": "positioning",
    "uw_congress": "positioning",
    "uw_institutional": "positioning",
    "uw_analyst": "filings",
    "uw_news": "filings",
    "edgar_8k": "filings",
    "edgar_s1": "filings",
    "reddit_velocity": "social",
    # discord callers are dynamic: "discord:<caller>" -> social (see family_of)
    "kalshi": "macro",
    "polymarket": "macro",
    "uw_chart": "chart",
    "uw_fundamentals": "fundamental",
    "uw_fda": "catalyst",
}

# Emergent universe: ingestion is market-wide (one call → signals for every ticker),
# so the watchlist is not curated — any name a feed surfaces starts accumulating. To
# bound the expensive per-ticker GEX enrichment, only the top-N most-active names each
# cycle get enriched. ETFs are excluded from stock signals (issue_type gate).
ENRICH_TOP_N = 40
EXCLUDE_ISSUE_TYPES = {"ETF", "ETN", "Index"}
# Names always enriched regardless of feed activity (pin your conviction core here).
PINNED = ["IREN", "MU", "MARA", "HIMS", "PYPL", "NKE", "AAPL", "AMD", "CRDO", "MRVL"]

# New sources start at a low prior weight and earn their way up via the tracker;
# a bad feed decays toward zero and costs nothing but a config line.
SOURCE_PRIOR: dict[str, float] = {
    "uw_darkpool": 0.35,
    "uw_flow": 0.30,
    "uw_lit_flow": 0.25,
    "uw_gex": 0.40,
    "gexclaw": 0.45,
    "uw_oi": 0.35,
    "uw_short": 0.30,   # squeeze fuel — real but bidirectional; earns its keep on setups
    "uw_insider": 0.55,  # Form-4 opening buys have the best base rate
    "uw_congress": 0.30,
    "uw_institutional": 0.30,
    "uw_analyst": 0.20,
    "uw_news": 0.20,
    "edgar_8k": 0.40,
    "edgar_s1": 0.25,
    "reddit_velocity": 0.15,
    "kalshi": 0.20,
    "polymarket": 0.20,
    "uw_chart": 0.40,          # trend/momentum — a solid confirmation source
    "uw_fundamentals": 0.35,   # valuation/growth — slow-moving context
    "uw_fda": 0.45,            # resolved FDA outcome — a hard binary catalyst
}
DEFAULT_PRIOR = 0.20  # anything unseen (e.g. a brand-new discord caller)


def family_of(source: str) -> str:
    """Family for a source id. discord:<caller> collapses to the social family, but
    each caller keeps its own weight — see engine.weights.source_weight."""
    if source.startswith("discord:"):
        return "social"
    return SOURCE_FAMILY.get(source, "flow")


def prior_of(source: str) -> float:
    if source.startswith("discord:"):
        return DEFAULT_PRIOR
    return SOURCE_PRIOR.get(source, DEFAULT_PRIOR)


def uw_token() -> str:
    token = os.environ.get(UW_TOKEN_ENV, "")
    if not token:
        raise RuntimeError(f"{UW_TOKEN_ENV} is not set (check .env at the repo root)")
    return token
