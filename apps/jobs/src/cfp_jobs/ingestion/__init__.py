"""Ingestion jobs — pull data from external sources into Postgres."""

from cfp_jobs.ingestion import (
    fmp,
    fundamentals,
    holdings,
    macro,
    prices,
    reddit_apewisdom,
    reddit_rss,
    unusualwhales,
)

__all__ = [
    "fmp",
    "fundamentals",
    "holdings",
    "macro",
    "prices",
    "reddit_apewisdom",
    "reddit_rss",
    "unusualwhales",
]
