"""News analyst — reads UW news headlines (with sentiment tags) from the
EvidenceBundle's catalysts slice.

Score:
  + sentiment_score = (positive - negative) / total over last 5 days
  + is_major-tagged headlines weighted 2x
  + no headlines -> neutral with explicit "no news"

This replaces the prior stub. UW's sentiment is rule-based, but it's good
enough for a first pass; we can add NLP later if needed.
"""

from __future__ import annotations

from datetime import UTC, datetime

from cfp_agents.base import BaseAnalyst, clamp, score_to_signal
from cfp_agents.state import AgentSignal, AnalysisState


def _recency_weight(headline_ts: datetime, now: datetime) -> float:
    """Linear age decay within the 5-day window. A headline from today gets
    weight 1.0; one from 5 days ago gets weight 0.4. Older market reactions
    are mostly priced in, so old headlines shouldn't carry equal weight with
    fresh ones in the sentiment aggregate.

    Note: fundamentals / technicals analysts are point-in-time snapshots
    (latest annual ROE, current MA200 distance) and don't have an event
    stream to decay — they are correctly weight-1. Flow analyst handles
    its within-window decay via stickiness (transient flow penalty), which
    is a different axis than time-decay (whether the trade persisted, not
    when it happened).
    """
    if headline_ts.tzinfo is None:
        headline_ts = headline_ts.replace(tzinfo=UTC)
    age_days = max(0.0, (now - headline_ts).total_seconds() / 86400.0)
    # 0d -> 1.0, 5d -> 0.4, beyond 5d clamped to 0.4 floor
    return max(0.4, 1.0 - 0.12 * age_days)


class NewsAnalyst(BaseAnalyst):
    name = "news"

    def analyze(self, state: AnalysisState) -> AgentSignal:
        ticker = state.get("ticker", "?")
        bundle = state.get("evidence")
        if bundle is None:
            return AgentSignal(
                agent=self.name,
                signal="neutral",
                confidence=0.0,
                rationale=f"{ticker}: no evidence bundle",
                payload={"stub": True},
            )

        cat = bundle.catalysts
        headlines = cat.news_5d
        if not headlines:
            # Fallback when no headlines: earnings proximity is itself a
            # catalyst signal. Within 7 days, the post-earnings move is the
            # dominant short-horizon risk — emit a low-confidence "catalyst
            # pending" rather than a flat neutral-stub so the synthesizer
            # has SOMETHING to weight from this analyst.
            if cat.earnings_proximity and cat.next_earnings_date and cat.days_to_earnings is not None:
                rationale = (
                    f"{ticker}: no headlines 5d, but earnings "
                    f"{cat.next_earnings_date.isoformat()} ({cat.days_to_earnings}d out) — "
                    "pre-earnings hedging usually dominates short-horizon flow; treat "
                    "as catalyst-pending, not neutral-on-fundamentals"
                )
                return AgentSignal(
                    agent=self.name,
                    signal="neutral",
                    confidence=0.15,
                    rationale=rationale,
                    payload={
                        "n_headlines_5d": 0,
                        "earnings_proximity": True,
                        "days_to_earnings": cat.days_to_earnings,
                        "fallback": "earnings_pending",
                    },
                )
            return AgentSignal(
                agent=self.name,
                signal="neutral",
                confidence=0.0,
                rationale=(
                    f"{ticker}: no headlines in last 5d and no near-term earnings — "
                    "news layer dark, downweight in synthesis"
                ),
                payload={"n_headlines_5d": 0, "stub": True, "reason": "no_headlines"},
            )

        # Re-score with is_major weighting (the bundle's sentiment_score_5d is
        # unweighted — major headlines should count 2x) AND age decay (a
        # 5-day-old headline is mostly priced in; a same-day one isn't).
        now = datetime.now(UTC)
        weighted_score = 0.0
        weight_total = 0.0
        n_major = 0
        for h in headlines:
            w = (2.0 if h.is_major else 1.0) * _recency_weight(h.ts, now)
            weight_total += w
            if h.sentiment == "positive":
                weighted_score += w * 1.0
            elif h.sentiment == "negative":
                weighted_score += w * -1.0
            if h.is_major:
                n_major += 1
        score = clamp(weighted_score / weight_total if weight_total > 0 else 0.0, -1.0, 1.0)

        confidence = clamp(abs(score) * (0.4 + 0.1 * min(len(headlines), 6)))

        # Rationale cites the most major headline.
        major = next((h for h in headlines if h.is_major), None)
        cite = (
            f' top: "{major.headline[:100]}{"…" if len(major.headline) > 100 else ""}"'
            if major
            else ""
        )

        return AgentSignal(
            agent=self.name,
            signal=score_to_signal(score, neutral_band=0.15),
            confidence=confidence,
            rationale=(
                f"{ticker}: {len(headlines)} headlines 5d ({n_major} major), "
                f"weighted sentiment {score:+.2f}.{cite}"
            ),
            payload={
                "score": score,
                "n_headlines_5d": len(headlines),
                "n_major_5d": n_major,
                "earnings_proximity": cat.earnings_proximity,
                "days_to_earnings": cat.days_to_earnings,
            },
        )
