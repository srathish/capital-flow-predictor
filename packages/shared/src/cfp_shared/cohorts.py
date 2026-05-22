"""Sub-industry cohorts for pair/spread analysis.

A *cohort* is a tight group of 3-6 tickers that share the same end-market
or business driver — much narrower than a sector ETF. The point of grouping
this way is that within a cohort, the *spread* between names tends to
mean-revert because the macro/sector driver is shared and only idiosyncratic
news pulls them apart.

This file is a curated starter list, not exhaustive. Edit freely — anything
that imports `COHORTS` will pick up new entries automatically. Keep each
cohort tight (skip "all of FAANG" — they don't actually share a business
driver). When in doubt, ask: "if I shorted name A and longed name B in this
cohort, what would I expect to converge?"
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Cohort:
    key: str          # url-safe slug, also the storage id
    label: str        # human-readable name shown in UI
    members: tuple[str, ...]
    description: str  # one-liner on what binds them


COHORTS: tuple[Cohort, ...] = (
    Cohort(
        key="memory_semis",
        label="Memory semis",
        members=("MU", "WDC", "STX"),
        description="Commodity memory + storage — same DRAM/NAND/HDD cycle.",
    ),
    Cohort(
        key="ai_semi",
        label="AI compute semis",
        members=("NVDA", "AMD", "AVGO", "MRVL"),
        description="Data-center AI accelerators + custom silicon — hyperscaler capex driven.",
    ),
    Cohort(
        key="semi_equipment",
        label="Semi capital equipment",
        members=("AMAT", "LRCX", "KLAC"),
        description="Wafer-fab equipment — TSMC/Samsung/Intel capex cycle.",
    ),
    Cohort(
        key="megacap_cloud",
        label="Megacap cloud platforms",
        members=("MSFT", "GOOGL", "AMZN"),
        description="Hyperscaler cloud (Azure / GCP / AWS) — same enterprise IT spend.",
    ),
    Cohort(
        key="refiners",
        label="Refiners",
        members=("VLO", "MPC", "PSX"),
        description="Crack-spread driven — crude → gasoline/diesel margin.",
    ),
    Cohort(
        key="integrated_oil",
        label="Integrated oil majors",
        members=("XOM", "CVX", "COP", "OXY"),
        description="Upstream E&P + integrated — crude price + production growth.",
    ),
    Cohort(
        key="megabanks",
        label="US megabanks",
        members=("JPM", "BAC", "C", "WFC"),
        description="G-SIBs — NII + trading + IB fees, same rate/credit cycle.",
    ),
    Cohort(
        key="regional_banks",
        label="Regional banks",
        members=("RF", "ZION", "CFG", "KEY"),
        description="Mid-cap regionals — NIM + CRE exposure dominant.",
    ),
    Cohort(
        key="big_box_retail",
        label="Big-box / discount retail",
        members=("WMT", "COST", "TGT"),
        description="Mass-market consumer staples retail — same trip frequency / ticket.",
    ),
    Cohort(
        key="streaming",
        label="Streaming / DTC content",
        members=("NFLX", "DIS", "SPOT"),
        description="Subscriber-driven content platforms — ARPU + churn dynamics.",
    ),
    Cohort(
        key="airlines",
        label="US airlines",
        members=("DAL", "UAL", "AAL", "LUV"),
        description="Domestic + intl capacity — jet-fuel + RASM exposure.",
    ),
    Cohort(
        key="hmos",
        label="Managed-care HMOs",
        members=("UNH", "ELV", "CI", "HUM"),
        description="Health-insurance + PBM — Medicare Advantage + MLR pressure.",
    ),
)


COHORTS_BY_KEY: dict[str, Cohort] = {c.key: c for c in COHORTS}


def cohorts_containing(ticker: str) -> list[Cohort]:
    """Return cohorts that include the given ticker (case-insensitive)."""
    upper = ticker.upper()
    return [c for c in COHORTS if upper in c.members]


def all_cohort_members() -> set[str]:
    """Flat set of every ticker referenced in COHORTS. Useful for warming
    a price cache or scoping a nightly cohort-scoring job."""
    return {m for c in COHORTS for m in c.members}
