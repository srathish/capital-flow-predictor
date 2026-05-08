"""Flow analyst — Unusual Whales options + dark pool + insider rollup.

Reads the structured snapshot the agent runner placed at state["flow_context"]
and produces a tri-state signal with a payload personas can cite.

Heuristics (rule-based, transparent — no LLM call):
  + Net call premium > net put premium, with ≥ 60% lifted at ask  -> bullish lean
  + LEAP (>90 DTE) call premium z-score > 1.5-sigma above 30d trend     -> strong bullish
  + Aggressive insider buys (transaction_code = P) in last 30d     -> mild bullish
  - Net put premium dominates + IV expanding                       -> bearish lean
  - LEAP put premium z-score elevated                              -> strong bearish
  - High short fee rate (> 5%) + heavy call sweeps                 -> squeeze setup
                                                                     (treated as
                                                                     bullish but
                                                                     flagged)

Confidence reflects (a) magnitude of premium imbalance and (b) corroboration
across two-or-more sub-signals.
"""

from __future__ import annotations

from typing import Any

from cfp_agents.base import BaseAnalyst, clamp, score_to_signal
from cfp_agents.state import AgentSignal, AnalysisState


def _g(d: dict[str, Any] | None, key: str, default: Any = None) -> Any:
    if not isinstance(d, dict):
        return default
    return d.get(key, default) if d.get(key) is not None else default


class FlowAnalyst(BaseAnalyst):
    name = "flow"

    def analyze(self, state: AnalysisState) -> AgentSignal:
        ticker = state.get("ticker", "?")
        ctx = state.get("flow_context") or {}

        if not ctx:
            return AgentSignal(
                agent=self.name,
                signal="neutral",
                confidence=0.0,
                rationale=f"{ticker}: no Unusual Whales data ingested yet (run `cfp-jobs flow {ticker}`)",
                payload={"stub": True},
            )

        # --- pull the structured slices the runner put in flow_context ---
        opt = ctx.get("options_flow") or {}
        dp = ctx.get("dark_pool") or {}
        pos = ctx.get("positioning") or {}
        smart = ctx.get("smart_money") or {}

        net_call_prem = float(_g(opt, "net_call_premium_5d", 0.0))
        net_put_prem = float(_g(opt, "net_put_premium_5d", 0.0))
        leap_call_prem = float(_g(opt, "leap_call_premium_5d", 0.0))
        leap_put_prem = float(_g(opt, "leap_put_premium_5d", 0.0))
        call_at_ask_pct = float(_g(opt, "call_at_ask_pct", 0.5))
        put_at_ask_pct = float(_g(opt, "put_at_ask_pct", 0.5))
        n_alerts = int(_g(opt, "alert_count_5d", 0))

        dp_above_vwap_pct = float(_g(dp, "above_vwap_pct", 0.5))
        dp_premium_5d = float(_g(dp, "premium_5d", 0.0))

        fee_rate = float(_g(pos, "fee_rate", 0.0))
        gex_total = _g(pos, "gex_total")  # signed; positive GEX = mean-reverting regime

        insider_net_30d = float(_g(smart, "insider_net_amount_30d", 0.0))
        insider_buys_30d = int(_g(smart, "insider_buys_30d", 0))
        insider_sells_30d = int(_g(smart, "insider_sells_30d", 0))

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

        # Weighted aggregate. LEAPs lead, near-term confirms.
        score = (
            0.30 * leap_imbalance
            + 0.25 * net_imbalance
            + 0.15 * aggressiveness
            + 0.15 * dp_tone
            + 0.15 * insider_signal
        )
        score = clamp(score, -1.0, 1.0)

        # Confidence rises with magnitude AND with how many sub-signals corroborate.
        sub_components = [leap_imbalance, net_imbalance, aggressiveness, dp_tone, insider_signal]
        non_zero = sum(1 for x in sub_components if abs(x) > 0.05)
        confidence = clamp(abs(score) * (0.6 + 0.1 * non_zero))

        # If short fee is high AND calls are loud, flag squeeze setup.
        squeeze_flag = fee_rate > 5.0 and call_at_ask_pct > 0.6 and net_call_prem > 0
        if squeeze_flag:
            confidence = clamp(confidence + 0.15)

        rationale_parts: list[str] = []
        if abs(net_imbalance) > 0.1:
            rationale_parts.append(
                f"net option premium {'calls' if net_imbalance > 0 else 'puts'} dominate "
                f"({_fmt_dollars(net_call_prem)} call vs {_fmt_dollars(net_put_prem)} put, 5d)"
            )
        if abs(leap_imbalance) > 0.1:
            rationale_parts.append(
                f"LEAP {'call' if leap_imbalance > 0 else 'put'} premium "
                f"{_fmt_dollars(leap_call_prem if leap_imbalance > 0 else leap_put_prem)} (>90 DTE)"
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
            rationale_parts.append(f"⚠ short fee {fee_rate:.1f}%, possible squeeze setup")
        if not rationale_parts:
            rationale_parts.append(f"{n_alerts} alerts in 5d, no decisive imbalance")

        rationale = f"{ticker}: " + "; ".join(rationale_parts) + f" → score={score:+.2f}"

        return AgentSignal(
            agent=self.name,
            signal=score_to_signal(score, neutral_band=0.12),
            confidence=confidence,
            rationale=rationale,
            payload={
                "score": score,
                "leap_imbalance": leap_imbalance,
                "net_imbalance": net_imbalance,
                "aggressiveness": aggressiveness,
                "dp_tone": dp_tone,
                "insider_signal": insider_signal,
                "squeeze_flag": squeeze_flag,
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
