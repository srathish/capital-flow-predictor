"""Flow analyst — Unusual Whales options + dark pool + insider rollup.

Reads the canonical EvidenceBundle at state["evidence"] and produces a
tri-state signal with a payload personas can cite. Same data every persona
sees in their lens, just scored into a single tri-state output here.

Heuristics (rule-based, transparent — no LLM call):
  + Net call premium > net put premium, with >=60% lifted at ask    -> bullish lean
  + LEAP (>90 DTE) call premium dominant + sticky in OI             -> strong bullish
  + Aggressive insider buys (transaction_code = P) in last 30d      -> mild bullish
  - Net put premium dominates                                       -> bearish lean
  - LEAP put premium dominant + sticky in OI                        -> strong bearish
  - High short fee rate (> 5%) + heavy call sweeps                  -> squeeze setup
                                                                      (bullish, flagged)

Stickiness penalty: transient premium (flow that vanished from OI next day)
gets discounted vs sticky premium (absorbed into OI). A $20M call sweep that
got closed the next day is worth less than one that added $20M to OI.

Earnings-proximity dampening: if the next earnings is within 7 days, LEAP
weight is halved. Pre-earnings option buying is often event hedging, not
thesis positioning.

Confidence reflects (a) magnitude of premium imbalance and (b) corroboration
across two-or-more sub-signals.
"""

from __future__ import annotations

from cfp_agents.base import BaseAnalyst, clamp, score_to_signal
from cfp_agents.state import AgentSignal, AnalysisState


class FlowAnalyst(BaseAnalyst):
    name = "flow"

    def analyze(self, state: AnalysisState) -> AgentSignal:
        ticker = state.get("ticker", "?")
        bundle = state.get("evidence")

        if bundle is None:
            return AgentSignal(
                agent=self.name,
                signal="neutral",
                confidence=0.0,
                rationale=f"{ticker}: no evidence bundle in state",
                payload={"stub": True},
            )

        opt = bundle.options_flow
        dp = bundle.dark_pool
        pos = bundle.positioning
        smart = bundle.smart_money
        cat = bundle.catalysts

        # If no flow data has landed yet, neutral with a clear "no data" rationale.
        if opt.alert_count_5d == 0 and dp.prints_5d == 0 and (pos.fee_rate is None):
            return AgentSignal(
                agent=self.name,
                signal="neutral",
                confidence=0.0,
                rationale=f"{ticker}: no Unusual Whales data ingested yet (run `cfp-jobs flow {ticker}`)",
                payload={"stub": True},
            )

        net_call_prem = float(opt.net_call_premium_5d)
        net_put_prem = float(opt.net_put_premium_5d)
        leap_call_prem = float(opt.leap_call_premium_5d)
        leap_put_prem = float(opt.leap_put_premium_5d)
        call_at_ask_pct = float(opt.call_at_ask_pct)
        put_at_ask_pct = float(opt.put_at_ask_pct)
        n_alerts = int(opt.alert_count_5d)
        sticky_pct = float(opt.sticky_pct)

        dp_above_vwap_pct = float(dp.above_vwap_pct)
        dp_premium_5d = float(dp.premium_5d)

        fee_rate = float(pos.fee_rate or 0.0)
        gex_total = pos.gex_total  # signed; positive GEX = mean-reverting regime

        insider_net_30d = float(smart.insider_net_amount_30d)
        insider_buys_30d = int(smart.insider_buys_30d)
        insider_sells_30d = int(smart.insider_sells_30d)

        earnings_proximity = bool(cat.earnings_proximity)

        # --- score components ---
        # (1) net premium imbalance, normalized so ±$10M -> ±1
        total_prem = abs(net_call_prem) + abs(net_put_prem) + 1.0  # avoid /0
        net_imbalance = (net_call_prem - net_put_prem) / total_prem
        # (2) LEAP imbalance — institutional bet weight
        leap_total = abs(leap_call_prem) + abs(leap_put_prem) + 1.0
        leap_imbalance = (leap_call_prem - leap_put_prem) / leap_total
        # (3) aggressiveness — at-ask % minus baseline 50%
        aggressiveness = (call_at_ask_pct - 0.5) - (put_at_ask_pct - 0.5)
        # (4) dark pool tone — fraction of $ traded above VWAP
        dp_tone = (dp_above_vwap_pct - 0.5) * 2.0  # -1..+1
        # (5) insider net (signed)
        insider_signal = clamp(insider_net_30d / 1e7, -1.0, 1.0)  # ±$10M -> ±1

        # Stickiness multiplier — sharper now. Heavily transient flow (<25%
        # absorbed into OI next day) is barely a signal; heavily sticky flow
        # (>75% absorbed) is amplified. Maps sticky_pct -> [0.3, 1.7].
        stickiness_mul = 0.3 + sticky_pct * 1.4

        # Earnings-proximity dampening: pre-earnings LEAPs are usually event
        # hedges, not theses. Halve LEAP weight if next earnings within 7d.
        leap_weight = 0.30 if not earnings_proximity else 0.15

        # Weighted aggregate. LEAPs lead, near-term confirms.
        score = (
            leap_weight * leap_imbalance * stickiness_mul
            + 0.25 * net_imbalance * stickiness_mul
            + 0.15 * aggressiveness
            + 0.15 * dp_tone
            + 0.15 * insider_signal
        )
        score = clamp(score, -1.0, 1.0)

        # Confidence rises with magnitude AND with how many sub-signals corroborate.
        # Bumped multiplier so a meaningful score (|s|>0.2) gets a meaningful
        # confidence floor (>0.25). Was producing too many low-conf neutrals.
        sub_components = [leap_imbalance, net_imbalance, aggressiveness, dp_tone, insider_signal]
        non_zero = sum(1 for x in sub_components if abs(x) > 0.05)
        confidence = clamp(abs(score) * (0.9 + 0.12 * non_zero))

        # If short fee is high AND calls are loud, flag squeeze setup.
        squeeze_flag = fee_rate > 5.0 and call_at_ask_pct > 0.6 and net_call_prem > 0
        if squeeze_flag:
            confidence = clamp(confidence + 0.15)

        rationale_parts: list[str] = []
        # Net imbalance — surface the SIGNED direction explicitly. The raw
        # numbers can mislead because net_put_prem can be negative (aggressive
        # put selling = bullish), which the imbalance ratio handles correctly
        # but the bare $ display does not.
        if abs(net_imbalance) > 0.1:
            direction = "BULLISH net flow" if net_imbalance > 0 else "BEARISH net flow"
            rationale_parts.append(
                f"{direction} (calls {_fmt_signed_dollars(net_call_prem)} vs "
                f"puts {_fmt_signed_dollars(net_put_prem)}, imb {net_imbalance:+.2f})"
            )
        if abs(leap_imbalance) > 0.1:
            direction = "BULLISH LEAP" if leap_imbalance > 0 else "BEARISH LEAP"
            rationale_parts.append(
                f"{direction} (>90 DTE: calls {_fmt_signed_dollars(leap_call_prem)}, "
                f"puts {_fmt_signed_dollars(leap_put_prem)}, imb {leap_imbalance:+.2f})"
            )
        if abs(aggressiveness) > 0.05:
            tone = "lifted at ask" if aggressiveness > 0 else "hit at bid"
            rationale_parts.append(f"flow {tone} ({call_at_ask_pct * 100:.0f}% calls / {put_at_ask_pct * 100:.0f}% puts at ask)")
        if abs(dp_tone) > 0.1:
            rationale_parts.append(
                f"dark pool {dp_above_vwap_pct * 100:.0f}% of {_fmt_dollars(dp_premium_5d)} above VWAP (5d)"
            )
        if insider_buys_30d > 0 or insider_sells_30d > 0:
            net_word = "net buy" if insider_net_30d > 0 else "net sell"
            rationale_parts.append(
                f"insiders 30d: {insider_buys_30d} buys / {insider_sells_30d} sells, {net_word} {_fmt_dollars(abs(insider_net_30d))}"
            )
        if squeeze_flag:
            rationale_parts.append(f"short fee {fee_rate:.1f}%, possible squeeze setup")
        if sticky_pct > 0.6:
            rationale_parts.append(f"flow sticky in OI ({sticky_pct * 100:.0f}%)")
        elif sticky_pct < 0.4 and total_prem > 1.0:
            rationale_parts.append(f"flow transient (only {sticky_pct * 100:.0f}% absorbed)")
        if earnings_proximity:
            rationale_parts.append("earnings within 7d (LEAP weight halved)")
        if not rationale_parts:
            rationale_parts.append(f"{n_alerts} alerts in 5d, no decisive imbalance")

        rationale = f"{ticker}: " + "; ".join(rationale_parts) + f" -> score={score:+.2f}"

        return AgentSignal(
            agent=self.name,
            signal=score_to_signal(score, neutral_band=0.08),
            confidence=confidence,
            rationale=rationale,
            payload={
                "score": score,
                "leap_imbalance": leap_imbalance,
                "net_imbalance": net_imbalance,
                "aggressiveness": aggressiveness,
                "dp_tone": dp_tone,
                "insider_signal": insider_signal,
                "stickiness_mul": stickiness_mul,
                "sticky_pct": sticky_pct,
                "squeeze_flag": squeeze_flag,
                "earnings_proximity": earnings_proximity,
                "n_alerts_5d": n_alerts,
                "gex_total": gex_total,
            },
        )


def _fmt_dollars(v: float) -> str:
    if v == 0:
        return "$0"
    a = abs(v)
    if a >= 1e9:
        return f"${a / 1e9:.1f}B"
    if a >= 1e6:
        return f"${a / 1e6:.1f}M"
    if a >= 1e3:
        return f"${a / 1e3:.0f}K"
    return f"${a:.0f}"


def _fmt_signed_dollars(v: float) -> str:
    """Like _fmt_dollars but preserves the sign so negative net premium
    (aggressive sell-side) is visually distinct from positive (buy-side).
    Crucial for the flow rationale — `puts -$2.6M` (selling, bullish) vs
    `puts +$2.6M` (buying, bearish) tell opposite stories."""
    if v == 0:
        return "$0"
    sign = "+" if v > 0 else "-"
    a = abs(v)
    if a >= 1e9:
        return f"{sign}${a / 1e9:.1f}B"
    if a >= 1e6:
        return f"{sign}${a / 1e6:.1f}M"
    if a >= 1e3:
        return f"{sign}${a / 1e3:.0f}K"
    return f"{sign}${a:.0f}"
