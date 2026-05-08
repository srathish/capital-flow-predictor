"""Base class shared by all persona LLM agents.

Each persona subclasses this, supplies a ``name`` and ``system_prompt``, and
inherits the rest: state -> user-prompt assembly, LLM invocation, structured
output -> AgentSignal mapping, and graceful "no API key" fallback.

LangGraph node compatibility: ``__call__(state)`` returns
``{"persona_signals": [signal]}`` so the framework's reducer appends to the
persona list.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import ClassVar

import pandas as pd

from cfp_agents.llm import LlmClient, PersonaOutput
from cfp_agents.personas.examples import EXAMPLES
from cfp_agents.state import AgentSignal, AnalysisState


def _latest_metric(fundamentals: pd.DataFrame, metric: str) -> float | None:
    if fundamentals is None or fundamentals.empty:
        return None
    sel = fundamentals[
        (fundamentals["metric"] == metric) & (fundamentals["period_type"] == "A")
    ]
    if sel.empty:
        return None
    sel = sel.sort_values("fiscal_period")
    return float(sel.iloc[-1]["value"])


def _fmt(value: float | None, *, pct: bool = False, currency: bool = False) -> str:
    if value is None:
        return "—"
    if pct:
        return f"{value * 100:.1f}%"
    if currency:
        if abs(value) >= 1e9:
            return f"${value / 1e9:.1f}B"
        if abs(value) >= 1e6:
            return f"${value / 1e6:.1f}M"
        return f"${value:,.0f}"
    return f"{value:.2f}"


class BasePersona(ABC):
    """Common LLM-persona plumbing.

    Subclasses set ``name`` (e.g. ``"buffett"``) and ``system_prompt``.
    """

    name: ClassVar[str] = "base_persona"
    system_prompt: ClassVar[str] = ""

    def __init__(self, llm: LlmClient | None = None) -> None:
        self._llm = llm or LlmClient()

    def __call__(self, state: AnalysisState) -> dict:
        signal = self.analyze(state)
        return {"persona_signals": [signal]}

    @abstractmethod
    def extra_context(self, state: AnalysisState) -> str:
        """Hook for persona-specific data the user prompt should surface."""

    def analyze(self, state: AnalysisState) -> AgentSignal:
        ticker = state.get("ticker", "?")

        if not self._llm.available:
            return AgentSignal(
                agent=self.name,
                signal="neutral",
                confidence=0.0,
                rationale=f"{ticker}: LLM provider {self._llm.provider!r} unavailable (missing API key); persona LLM call skipped",
                payload={"stub": True, "reason": "no_api_key", "provider": self._llm.provider},
            )

        user_prompt = self._build_user_prompt(state)

        # Inject the persona's few-shot example (if any) into the system prompt
        # at request time, rather than baking into the SYSTEM_PROMPT constants —
        # keeps base prompts portable and the example registry centralized.
        full_system = self.system_prompt + EXAMPLES.get(self.name, "")

        try:
            parsed: PersonaOutput | None = self._llm.invoke_persona(
                system_prompt=full_system, user_prompt=user_prompt
            )
        except Exception as e:
            return AgentSignal(
                agent=self.name,
                signal="neutral",
                confidence=0.0,
                rationale=f"{ticker}: persona LLM call failed: {type(e).__name__}: {e}",
                payload={"error": str(e)},
            )

        if parsed is None:
            return AgentSignal(
                agent=self.name,
                signal="neutral",
                confidence=0.0,
                rationale=f"{ticker}: empty LLM response",
            )

        return AgentSignal(
            agent=self.name,
            signal=parsed.signal,
            confidence=parsed.confidence,
            rationale=parsed.thesis,
            payload={
                "key_evidence": parsed.key_evidence,
                "concerns": parsed.concerns,
                "model": self._llm.model,
            },
        )

    def _build_user_prompt(self, state: AnalysisState) -> str:
        ticker = state.get("ticker", "?")
        sector = state.get("sector", "")
        fundamentals = state.get("fundamentals")
        analyst_signals = state.get("analyst_signals", []) or []

        # --- fundamentals snapshot ---
        has_fundamentals = fundamentals is not None and not fundamentals.empty
        rev = _latest_metric(fundamentals, "revenue") if has_fundamentals else None
        roe = _latest_metric(fundamentals, "roe") if has_fundamentals else None
        fcf = _latest_metric(fundamentals, "free_cash_flow") if has_fundamentals else None
        de = _latest_metric(fundamentals, "debt_to_equity") if has_fundamentals else None
        pe = _latest_metric(fundamentals, "pe_ratio") if has_fundamentals else None
        pb = _latest_metric(fundamentals, "price_to_book") if has_fundamentals else None
        gm = _latest_metric(fundamentals, "gross_margin") if has_fundamentals else None
        nm = _latest_metric(fundamentals, "net_margin") if has_fundamentals else None
        mc = _latest_metric(fundamentals, "market_cap") if has_fundamentals else None

        if has_fundamentals:
            fund_lines = (
                f"- Revenue (latest annual): {_fmt(rev, currency=True)}\n"
                f"- Market cap: {_fmt(mc, currency=True)}\n"
                f"- ROE: {_fmt(roe, pct=True)}, ROA n/a — gross margin {_fmt(gm, pct=True)}, net margin {_fmt(nm, pct=True)}\n"
                f"- Free cash flow: {_fmt(fcf, currency=True)}\n"
                f"- Debt/Equity: {_fmt(de)}, P/E: {_fmt(pe)}, P/B: {_fmt(pb)}"
            )
        else:
            fund_lines = (
                f"- Fundamentals data is not yet ingested for {ticker} (the data pipeline "
                "hasn't pulled this name's financials yet — this is a data-availability "
                "limitation, NOT a signal that the company is unusual).\n"
                f"- {ticker} IS a publicly traded operating company. Do NOT assume it is "
                "an ETF, fund, or basket — that would be incorrect. Reason from price "
                "action and analyst signals; explicitly note that fundamental review is "
                "deferred."
            )

        # --- analyst signals ---
        if analyst_signals:
            analyst_lines = "\n".join(
                f"- {s.agent}: {s.signal} (conf {s.confidence:.2f}) — {s.rationale}"
                for s in analyst_signals
            )
        else:
            analyst_lines = "- (no analyst signals available)"

        # --- persona-specific extras (technicals, macro, vol, etc.) ---
        extras = self.extra_context(state).strip()
        extra_block = f"\n\nAdditional context:\n{extras}" if extras else ""

        return (
            f"Analyze {ticker} (sector: {sector or 'unspecified'}).\n\n"
            f"Latest annual fundamentals:\n{fund_lines}\n\n"
            f"Quantitative analyst signals:\n{analyst_lines}"
            f"{extra_block}\n\n"
            "Provide your verdict in the structured output format.\n\n"
            "Quality bar — non-negotiable:\n"
            "- thesis: 2-3 complete sentences explaining your specific reasoning "
            "from your investing framework. NOT a one-word label or category. "
            "Cite at least one concrete fact (a number, a competitive position, "
            "or a macro condition).\n"
            "- key_evidence: 3-5 bullets. Each must reference a SPECIFIC data "
            "point from above (revenue growth %, ROE %, FCF, P/E, RSI, "
            "trend, vol). Avoid vague platitudes.\n"
            "- concerns: 1-3 specific risks that would invalidate this call. "
            "Tie each to your framework, not generic 'market volatility'."
        )
