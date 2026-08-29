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
PRIOR_OVERRIDES = DATA_DIR / "prior_overrides.json"  # human-APPROVED prior changes (learn loop)
PROPOSALS_FILE = DATA_DIR / "proposals.json"  # the learn loop's pending prior proposals

# --- external services -------------------------------------------------------
UW_BASE = "https://api.unusualwhales.com"
UW_TOKEN_ENV = "UNUSUAL_WHALES_API_KEY"  # same env var the rest of the repo uses
DISCORD_WEBHOOK_ENV = "DISCORD_WEBHOOK_URL"
ANTHROPIC_KEY_ENV = "ANTHROPIC_API_KEY"

# LLM policy — LOCAL-FIRST. All analysis is mechanical (see ui.state.local_read); the LLM is
# an OPT-IN premium layer, OFF by default even if an API key exists. Turn it on only when you
# want it, with NEST_LLM=on, and even then it's rate-limited + only fires on gated picks.
LLM_ENABLED = os.environ.get("NEST_LLM", "off").lower() in ("1", "on", "true", "yes")
SYNTH_MODEL = os.environ.get("NEST_MODEL", "claude-haiku-4-5-20251001")  # cheap, gated, cached
DIGEST_MODEL = os.environ.get("NEST_DIGEST_MODEL", "claude-sonnet-5")    # once/day when enabled

# --- alert policy (scarcity) -------------------------------------------------
CONVICTION_FLOOR = 70  # 0-100; scores below this never become a Call
MAX_CALLS_PER_DAY = 3
COOLDOWN_SESSIONS = 5  # per-ticker cooldown unless conviction jumps by...
COOLDOWN_OVERRIDE_DELTA = 15  # ...this many points on new evidence

# --- direction vs confirmation (evidence-based) ------------------------------
# Backtest + repo both say: only these DIRECTION sources predict which-way (momentum/
# quality/catalyst/insider). Everything else LOCATES or CONFIRMS (GEX=map, flow=47% coin
# flip) — it can confirm or veto a direction, it cannot create one. So conviction is driven
# by the direction sources; confirmation sources only modulate it (bounded bonus / veto).
DIRECTION_SOURCES = {
    "uw_momentum", "uw_chart", "uw_breakout", "uw_fundamentals", "uw_margins",
    "uw_fda", "uw_earnings", "uw_theme", "uw_insider", "edgar_offering",
}
CONFIRM_BONUS_CAP = 0.5    # most a confirming stack can add to the direction magnitude
CONFIRM_VETO_SCALE = 0.7   # how hard opposing confirmation (e.g. flow against) pulls down

# --- gate (anti-noise) -------------------------------------------------------
GATE_MIN_DIRECTION = 0.35  # need a real DIRECTION signal of at least this net magnitude
GATE_WINDOW_HOURS = 72     # rolling window signals must fall inside

# --- Layer 1 mechanical accumulation -----------------------------------------
# conviction = 100 * (1 - exp(-effective / SCORE_SCALE)); effective = direction magnitude +
# bounded confirmation. Tuned so a strong momentum + quality + catalyst stack (~1.6) reaches
# ~80, momentum + quality (~1.1) ~67, momentum alone (~0.6) ~45.
SCORE_SCALE = 1.0

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
    "uw_sweep": "flow",
    "uw_netprem": "flow",
    "uw_gex": "levels",
    "uw_vex": "levels",
    "uw_charm": "levels",
    "uw_maxpain": "levels",
    "uw_oi": "positioning",
    "uw_short": "positioning",
    "uw_insider": "positioning",
    "uw_congress": "positioning",
    "uw_analyst": "filings",
    "uw_news": "filings",
    "web_news": "filings",
    "edgar_offering": "filings",
    "reddit_velocity": "social",
    "stocktwits": "social",
    "wiki_attention": "social",
    # discord callers are dynamic: "discord:<caller>" -> social (see family_of)
    "uw_momentum": "chart",
    "uw_chart": "chart",
    "uw_breakout": "chart",
    "uw_volsurge": "chart",
    "uw_fundamentals": "fundamental",
    "uw_margins": "fundamental",
    "uw_fda": "catalyst",
    "uw_earnings": "catalyst",
    "uw_theme": "catalyst",
}

# Emergent universe: ingestion is market-wide (one call → signals for every ticker),
# so the watchlist is not curated — any name a feed surfaces starts accumulating. To
# bound the expensive per-ticker GEX enrichment, only the top-N most-active names each
# cycle get enriched. ETFs are excluded from stock signals (issue_type gate).
ENRICH_TOP_N = 40
EXCLUDE_ISSUE_TYPES = {"ETF", "ETN", "Index"}
# Names always enriched regardless of feed activity (pin your conviction core here).
PINNED = ["IREN", "MU", "MARA", "HIMS", "PYPL", "NKE", "AAPL", "AMD", "CRDO", "MRVL"]

# EVIDENCE-BASED PRIORS. Two independent bodies of evidence set these, not intuition:
#   (1) our own lookahead-safe backtest (research/backtest.py): cross-sectional MOMENTUM/
#       QUALITY predicts 20d forward excess return (IC ~0.17, t~3.7, top-decile +2.7%/mo,
#       11/12 OOS). This is the one selection signal that survives OOS.
#   (2) the repo's five permutation-tested systems (gex/talon/falcon/whale-plays): GEX &
#       flow predict WHERE/HOW-MUCH (reach, pins, exits) — NEVER direction ("every scalar
#       GEX conditioner rejected"; "flow 47% coin flip"; direction OOS-AUC ~0.51).
# So: DIRECTION/SELECTION sources (momentum, quality, catalyst, insider) get HIGH priors;
# MAP/CONFIRMATION sources (GEX, flow, dark pool) get LOW priors — they confirm/locate, they
# don't pick the name. The tracker still adjusts all of these from live grades.
SOURCE_PRIOR: dict[str, float] = {
    # --- direction / selection (validated) — HIGH ---
    "uw_momentum": 0.65,       # whole-universe 52w-momentum (screener) — the finder
    "uw_chart": 0.65,          # vol-adj 3-6mo momentum + trend (backtest IC ~0.17 @20d)
    "uw_breakout": 0.45,       # range breakout on volume (momentum companion)
    "uw_insider": 0.55,        # Form-4 open-market buys — best positioning base rate
    "uw_fundamentals": 0.45,   # revenue growth + profitability (quality)
    "uw_margins": 0.45,        # margin expansion (quality)
    "uw_fda": 0.55,            # resolved FDA outcome — a hard binary catalyst
    "uw_earnings": 0.45,       # earnings-proximity catalyst (why-now)
    "uw_theme": 0.40,          # sector/theme breadth — cohort tailwind (whale-plays)
    "edgar_offering": 0.45,    # 424B/S-1/S-3 dilution — reliably bearish
    # --- confirmation / map (NOT directional per repo) — LOW ---
    "uw_flow": 0.18,           # flow = confirmation only, never thesis (47% coin flip)
    "uw_sweep": 0.20,
    "uw_darkpool": 0.12,       # "retire dark-pool as a signal" — magnet, not direction
    "uw_netprem": 0.15,
    "uw_oi": 0.20,
    "uw_gex": 0.15,            # a MAP (levels/exits), not a direction — every conditioner rejected
    "uw_vex": 0.10,            # vanna = weak confirm/veto at best (corr +0.11)
    "uw_charm": 0.08,
    "uw_maxpain": 0.15,
    "uw_short": 0.25,          # squeeze fuel — bidirectional
    "uw_analyst": 0.30,        # ratings — modest
    "uw_news": 0.18,           # sentiment — noisy
    "web_news": 0.18,          # Google-News headline sentiment — noisy, confirmation only
    "uw_congress": 0.15,
    "uw_volsurge": 0.25,
    # --- social (retail context) — LOW ---
    "reddit_velocity": 0.15,
    "stocktwits": 0.15,
    "wiki_attention": 0.15,
}
DEFAULT_PRIOR = 0.20  # anything unseen (e.g. a brand-new discord caller)


def family_of(source: str) -> str:
    """Family for a source id. discord:<caller> collapses to the social family, but
    each caller keeps its own weight — see engine.weights.source_weight."""
    if source.startswith("discord:"):
        return "social"
    return SOURCE_FAMILY.get(source, "flow")


# --- runtime prior overrides (the learn loop's human-gated output) ----------
# The proposer writes suggestions to proposals.json; a human runs `nest learn apply`, which
# lands APPROVED priors here. prior_of() layers these over the code defaults, so an approved
# change takes effect on the next cycle WITHOUT a code deploy — and the code default stays the
# audited baseline. Cached with an mtime check so the hot loop doesn't stat/parse every call.
_OVR_CACHE: tuple[float, dict[str, float]] = (-1.0, {})


def load_prior_overrides() -> dict[str, float]:
    """Approved prior overrides from disk, mtime-cached. Empty if none/malformed."""
    global _OVR_CACHE
    import json

    try:
        mtime = PRIOR_OVERRIDES.stat().st_mtime
    except OSError:
        _OVR_CACHE = (-1.0, {})
        return {}
    if mtime == _OVR_CACHE[0]:
        return _OVR_CACHE[1]
    try:
        data = json.loads(PRIOR_OVERRIDES.read_text())
        data = {str(k): float(v) for k, v in data.items()}
    except (ValueError, OSError, TypeError):
        data = {}
    _OVR_CACHE = (mtime, data)
    return data


def save_prior_overrides(overrides: dict[str, float]) -> None:
    import json

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    PRIOR_OVERRIDES.write_text(json.dumps(overrides, indent=2, sort_keys=True))
    global _OVR_CACHE
    _OVR_CACHE = (-1.0, {})  # invalidate so the next read reloads


def prior_of(source: str) -> float:
    ovr = load_prior_overrides()
    if source in ovr:
        return ovr[source]
    if source.startswith("discord:"):
        return DEFAULT_PRIOR
    return SOURCE_PRIOR.get(source, DEFAULT_PRIOR)


def uw_token() -> str:
    token = os.environ.get(UW_TOKEN_ENV, "")
    if not token:
        raise RuntimeError(f"{UW_TOKEN_ENV} is not set (check .env at the repo root)")
    return token
