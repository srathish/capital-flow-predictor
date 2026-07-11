"""Paths, trust tiers, and crawl politeness constants.

Everything lives under apps/brain/ by default; set BRAIN_HOME to relocate the
vault/inbox/papers/index as a unit (e.g. for tests).
"""

from __future__ import annotations

import os
from pathlib import Path

# src/brain/config.py -> parents[2] == apps/brain, parents[4] == repo root
PACKAGE_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = Path(__file__).resolve().parents[4]

BRAIN_HOME = Path(os.environ.get("BRAIN_HOME", PACKAGE_ROOT))

VAULT_DIR = BRAIN_HOME / "vault"
INBOX_DIR = BRAIN_HOME / "inbox"
PAPERS_DIR = BRAIN_HOME / "papers"
INDEX_DB = BRAIN_HOME / "index.db"

CATEGORIES = [
    "my-findings",
    "0dte",
    "greeks-mechanics",
    "market-structure",
    "strategies",
    "technicals",
    "equities",
    "risk-management",
    "papers",
    "index-options",
]

# Trust tiers — lower wins. Assigned per-source in sources.yaml; unregistered
# domains default to T4.
TIER_OWN_FINDINGS = 1  # user's empirically validated research
TIER_PRIMARY = 2  # exchanges, academic, regulators
TIER_EDUCATION = 3  # established education sites
TIER_COMMUNITY = 4  # blogs, forums
DEFAULT_TIER = TIER_COMMUNITY

TIER_LABELS = {
    TIER_OWN_FINDINGS: "T1 own-findings",
    TIER_PRIMARY: "T2 primary/academic",
    TIER_EDUCATION: "T3 education",
    TIER_COMMUNITY: "T4 community",
}

# Crawl politeness
USER_AGENT = "BellwetherBrain/0.1 (personal trading research corpus; contact: saieagle@gmail.com)"
DEFAULT_RATE_SECONDS = 4.0  # per-domain minimum interval, jittered
FETCH_TIMEOUT_SECONDS = 30
MIN_EXTRACT_CHARS = 400  # below this, extraction is considered thin/failed

# A search that returns fewer than this many hits is logged as a knowledge gap
# for the sweep/learn loop to fill.
GAP_RESULT_THRESHOLD = 3
