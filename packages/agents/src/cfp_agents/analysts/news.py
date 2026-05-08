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

from cfp_agents.base import BaseAnalyst, clamp, score_to_signal
from cfp_agents.state import AgentSignal, AnalysisState


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
            return AgentSignal(
                agent=self.name,
                signal="neutral",
                confidence=0.0,
                rationale=f"{ticker}: no news in last 5d",
                payload={"n_headlines_5d": 0},
            )

        # Re-score with is_major weighting (the bundle's sentiment_score_5d is
        # unweighted — major headlines should count 2x).
        weighted_score = 0.0
        weight_total = 0.0
        n_major = 0
        for h in headlines:
            w = 2.0 if h.is_major else 1.0
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
