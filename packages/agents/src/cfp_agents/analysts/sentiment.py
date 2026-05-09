"""Sentiment analyst — Reddit chatter intensity from Apewisdom.

The asymmetry matters more than the raw direction:

  - High mentions + bullish setup elsewhere = CONTRARIAN WARNING
    (WSB caught up, the move is likely late). Score nudges bearish on
    confluence, NOT because Reddit is right but because the asymmetry
    inverts when retail piles in.

  - Low mentions + bullish setup elsewhere = STEALTH SETUP
    (institutional flow / insider activity nobody on Reddit has noticed).
    Score nudges bullish on confluence as a quiet-conviction signal.

  - Mention spike with no other signals = noise, neutral.

This replaces the prior 'no Reddit feed connected' stub. The scoring is
intentionally conservative — Reddit is a confluence layer, not a primary
signal.
"""

from __future__ import annotations

from cfp_agents.base import BaseAnalyst, score_to_signal
from cfp_agents.state import AgentSignal, AnalysisState


class SentimentAnalyst(BaseAnalyst):
    name = "sentiment"

    def analyze(self, state: AnalysisState) -> AgentSignal:
        ticker = state.get("ticker", "?")
        bundle = state.get("evidence")
        if bundle is None or not bundle.reddit.has_data:
            return AgentSignal(
                agent=self.name,
                signal="neutral",
                confidence=0.0,
                rationale=f"{ticker}: no Reddit chatter data (run `cfp-jobs reddit`)",
                payload={"stub": True},
            )

        r = bundle.reddit

        # Baseline score component from raw chatter intensity.
        # Spike ratio > 3.0 = elevated chatter; < 0.5 = quiet.
        score = 0.0
        if r.spike_ratio is not None:
            if r.spike_ratio > 3.0:
                # Elevated chatter — likely late, contrarian lean.
                score -= min(0.4, (r.spike_ratio - 3.0) * 0.05)
            elif r.spike_ratio < 0.5 and r.mentions_today < 5:
                # Quiet — slight stealth lean (institutional setup nobody sees).
                score += 0.15

        # Asymmetry flags from the bundle (already computed conservatively).
        if r.is_contrarian_warning:
            score -= 0.2
        if r.is_stealth:
            score += 0.1

        # Confidence is low by design — Reddit is a confluence layer, not a
        # primary signal. Capped at 0.4 so Trader/PM weight it lightly.
        confidence = min(0.4, abs(score) * 1.5 + 0.05) if score != 0 else 0.05

        spike_str = f"{r.spike_ratio:.1f}x" if r.spike_ratio is not None else "n/a"
        rank_str = f"#{r.rank_today}" if r.rank_today is not None else "unranked"
        flags: list[str] = []
        if r.is_contrarian_warning:
            flags.append("contrarian-warning")
        if r.is_stealth:
            flags.append("stealth")

        rationale = (
            f"{ticker}: {r.mentions_today} mentions today vs {r.mentions_7d_avg:.1f} 7d avg "
            f"({spike_str}), rank {rank_str}"
            + (f" [{', '.join(flags)}]" if flags else "")
        )

        return AgentSignal(
            agent=self.name,
            signal=score_to_signal(score, neutral_band=0.05),
            confidence=confidence,
            rationale=rationale,
            payload={
                "score": score,
                "mentions_today": r.mentions_today,
                "mentions_7d_avg": r.mentions_7d_avg,
                "spike_ratio": r.spike_ratio,
                "rank_today": r.rank_today,
                "rank_change_7d": r.rank_change_7d,
                "contrarian_warning": r.is_contrarian_warning,
                "stealth": r.is_stealth,
                "by_subreddit": [
                    {"subreddit": s.subreddit, "mentions": s.mentions, "rank": s.rank}
                    for s in r.by_subreddit
                ],
            },
        )
