"""Talon v2 Phase 4.1 — news signal.

Wires the existing news_aggregator into the scanner. Each ticker gets:

  news_n_items_5d        : how many headlines in last 5 days
  news_catalyst_score    : weighted score from news_aggregator.score_news_catalyst
  news_top_category      : the dominant catalyst bucket (regulatory / mna /
                           partnership / product / leak / earnings / insider)
  news_top_headline      : a representative headline
  news_top_url           : link to the headline
  news_keywords          : up to 6 matched catalyst keywords (deduped)
  news_recency_hours     : hours since the most recent headline
  news_flag              : True if catalyst_score >= 60 AND news in last 24h

The flag is a high-signal "fresh catalyst" tell — combines recency with
catalyst keyword density.
"""
from __future__ import annotations

import asyncio
import logging
from collections import Counter
from datetime import UTC, datetime
from typing import Any

from cfp_api.news_aggregator import (
    classify_headline,
    fetch_news_for_tickers,
    score_news_catalyst,
)

log = logging.getLogger(__name__)

_LOOKBACK_HOURS = 5 * 24


def _hours_since(iso: str | None) -> float | None:
    if not iso:
        return None
    try:
        ts = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None
    now = datetime.now(ts.tzinfo or UTC)
    return (now - ts).total_seconds() / 3600


def _compute_for_ticker(items: list[Any]) -> dict[str, Any]:
    out: dict[str, Any] = {
        "news_n_items_5d": 0,
        "news_catalyst_score": 0.0,
        "news_top_category": None,
        "news_top_headline": None,
        "news_top_url": None,
        "news_keywords": [],
        "news_recency_hours": None,
        "news_flag": False,
    }
    if not items:
        return out

    # Filter to last 5 days
    fresh: list[tuple[Any, float]] = []
    for it in items:
        published = getattr(it, "published_at", None) or (
            it.get("published_at") if isinstance(it, dict) else None
        )
        hours = _hours_since(published) if isinstance(published, str) else _hours_since(
            published.isoformat() if hasattr(published, "isoformat") else None
        )
        if hours is None or hours > _LOOKBACK_HOURS:
            continue
        fresh.append((it, hours))

    if not fresh:
        return out

    # Sort by recency
    fresh.sort(key=lambda x: x[1])
    top_item, top_hours = fresh[0]

    # Classify and score each
    total_score = 0.0
    cat_counts: Counter[str] = Counter()
    all_keywords: list[str] = []
    for it, _hours in fresh:
        title = getattr(it, "title", None) or (it.get("title") if isinstance(it, dict) else "")
        summary = getattr(it, "summary", None) or (it.get("summary") if isinstance(it, dict) else "")
        text = f"{title or ''} {summary or ''}".strip()
        category, keywords = classify_headline(text)
        if category == "other" or not keywords:
            continue
        cat_counts[category] += 1
        all_keywords.extend(keywords)
        try:
            total_score += score_news_catalyst(it, keywords, n_tickers=1)
        except Exception:  # noqa: BLE001 — defensive
            pass

    if not cat_counts:
        return out

    top_cat = cat_counts.most_common(1)[0][0]
    out["news_n_items_5d"] = len(fresh)
    out["news_catalyst_score"] = round(total_score, 2)
    out["news_top_category"] = top_cat
    out["news_top_headline"] = (
        getattr(top_item, "title", None)
        or (top_item.get("title") if isinstance(top_item, dict) else None)
    )
    out["news_top_url"] = (
        getattr(top_item, "url", None)
        or (top_item.get("url") if isinstance(top_item, dict) else None)
    )
    out["news_recency_hours"] = round(top_hours, 1)
    # Dedupe keywords keep top 6
    seen: set[str] = set()
    deduped: list[str] = []
    for k in all_keywords:
        if k not in seen:
            seen.add(k)
            deduped.append(k)
        if len(deduped) >= 6:
            break
    out["news_keywords"] = deduped
    if total_score >= 60 and top_hours <= 24:
        out["news_flag"] = True
    return out


def fetch_and_compute_batch(
    tickers: list[str],
    per_ticker_limit: int = 12,
    concurrency: int = 6,
    on_progress=None,
) -> dict[str, dict]:
    """Fetch news per ticker and compute the signal dict.

    Runs the async fetch via asyncio.run because the scanner phase is
    synchronous (called via asyncio.to_thread). Bounded concurrency so we
    don't hammer the free-tier news sources.
    """
    if not tickers:
        return {}
    try:
        items_by_ticker = asyncio.run(
            fetch_news_for_tickers(tickers, per_ticker_limit=per_ticker_limit, concurrency=concurrency)
        )
    except Exception as e:  # noqa: BLE001
        log.warning("v2 news batch fetch failed: %s", e)
        return {}
    out: dict[str, dict] = {}
    for i, t in enumerate(tickers):
        items = items_by_ticker.get(t.upper(), [])
        out[t] = _compute_for_ticker(items)
        if on_progress is not None:
            try:
                on_progress(i + 1, len(tickers), t)
            except Exception:  # noqa: BLE001
                pass
    return out
