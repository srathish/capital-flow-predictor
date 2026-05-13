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
            # Quiet on Reddit IS a data point for a confluence layer: it means
            # no froth, no contrarian-warning trigger, no stealth signal. We
            # report this transparently as "signal dark, weight others" rather
            # than blaming the user to refresh a job — the synthesizer should
            # downweight this analyst when stub=True instead of treating the
            # 0.0 confidence as ambiguous.
            return AgentSignal(
                agent=self.name,
                signal="neutral",
                confidence=0.0,
                rationale=(
                    f"{ticker}: no Reddit chatter detected (zero Apewisdom mentions, "
                    f"zero catalyst-feed posts in 7d) — sentiment layer dark for this "
                    f"name; absence of froth is itself a (weak) signal, but neither "
                    f"contrarian-warning nor stealth flags are active"
                ),
                payload={"stub": True, "reason": "no_reddit_data"},
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

        # Catalyst-feed posts (reddit_posts table). A ticker can be absent from
        # Apewisdom's top-150 yet have several tagged catalyst posts (BTBT, small
        # caps). Net bullish/bearish keyword tilt nudges the score the same
        # direction the chatter is leaning.
        if r.catalyst_posts_7d > 0:
            net_kw = r.catalyst_posts_bullish_7d - r.catalyst_posts_bearish_7d
            if net_kw != 0:
                # ±0.05 per net post, capped at ±0.2 — same magnitude band as
                # the spike/asymmetry signals, so catalyst chatter can't
                # dominate by itself.
                score += max(-0.2, min(0.2, net_kw * 0.05))

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

        # Rationale: lead with Apewisdom when present, but fall through to the
        # catalyst feed when it's the only thing we've got — explains BTBT-style
        # "showed up on /reddit but agent said no data" cases.
        if r.mentions_today > 0 or r.rank_today is not None:
            rationale = (
                f"{ticker}: {r.mentions_today} mentions today vs {r.mentions_7d_avg:.1f} 7d avg "
                f"({spike_str}), rank {rank_str}"
            )
        else:
            rationale = (
                f"{ticker}: no Apewisdom top-150 chatter, but {r.catalyst_posts_7d} catalyst "
                f"post(s) tagged this ticker in the last 7d"
            )
        if r.catalyst_posts_7d > 0:
            rationale += (
                f" · {r.catalyst_posts_7d} catalyst post(s)"
                f" ({r.catalyst_posts_bullish_7d}↑/{r.catalyst_posts_bearish_7d}↓)"
            )
        # Surface up to 2 top post titles in the rationale so downstream
        # synthesizers (and humans reading the analyst signal) see WHAT the
        # chatter is about, not just the count. Personas already get richer
        # excerpts via base.py — this is the short version for the analyst
        # signal trail.
        top_excerpts = (r.recent_post_excerpts or [])[:2]
        if top_excerpts:
            titles = " | ".join(f'"{e.title[:70]}"' for e in top_excerpts)
            rationale += f" · top posts: {titles}"
        if flags:
            rationale += f" [{', '.join(flags)}]"

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
                "catalyst_posts_7d": r.catalyst_posts_7d,
                "catalyst_posts_bullish_7d": r.catalyst_posts_bullish_7d,
                "catalyst_posts_bearish_7d": r.catalyst_posts_bearish_7d,
                "by_subreddit": [
                    {"subreddit": s.subreddit, "mentions": s.mentions, "rank": s.rank}
                    for s in r.by_subreddit
                ],
                "recent_post_excerpts": [
                    {
                        "subreddit": e.subreddit,
                        "title": e.title,
                        "upvotes": e.upvotes,
                        "num_comments": e.num_comments,
                        "keywords": e.keywords,
                    }
                    for e in (r.recent_post_excerpts or [])[:3]
                ],
            },
        )
