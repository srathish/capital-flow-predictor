"""Base class shared by all persona LLM agents.

Each persona subclasses this, supplies a ``name`` and ``system_prompt``, and
inherits the rest: state -> user-prompt assembly, LLM invocation, structured
output -> AgentSignal mapping, and graceful "no API key" fallback.

LangGraph node compatibility: ``__call__(state)`` returns
``{"persona_signals": [signal]}`` so the framework's reducer appends to the
persona list.
"""

from __future__ import annotations

from abc import ABC
from datetime import UTC, datetime
from typing import ClassVar

from cfp_shared import EvidenceBundle, Instrument

from cfp_agents.bundle_compute import compute_fundamentals_ctx, compute_price_context
from cfp_agents.llm import LlmClient, PersonaOutput
from cfp_agents.personas.examples import EXAMPLES
from cfp_agents.state import AgentSignal, AnalysisState, llm_override_for


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


def _render_flow_block(bundle) -> str:
    """Render UW flow / dark pool / positioning / smart money / catalysts as
    raw bullet-point evidence. Personas read this and apply their own lens —
    no analyst conclusions are passed through."""
    opt = bundle.options_flow
    dp = bundle.dark_pool
    pos = bundle.positioning
    smart = bundle.smart_money
    cat = bundle.catalysts

    sections: list[str] = []

    # Options flow
    if opt.alert_count_5d > 0:
        opt_lines = [
            f"- {opt.alert_count_5d} alerts in 5d",
            f"- Net call premium 5d: {_fmt(opt.net_call_premium_5d, currency=True)}, "
            f"net put: {_fmt(opt.net_put_premium_5d, currency=True)}",
            f"- LEAP (>90 DTE) call premium 5d: {_fmt(opt.leap_call_premium_5d, currency=True)}, "
            f"LEAP put: {_fmt(opt.leap_put_premium_5d, currency=True)}",
            f"- At-ask fraction: calls {opt.call_at_ask_pct * 100:.0f}%, puts {opt.put_at_ask_pct * 100:.0f}%",
            f"- Sticky vs transient: {opt.sticky_pct * 100:.0f}% absorbed into OI next day",
        ]
        if opt.top_trades:
            opt_lines.append("- Top trades:")
            for t in opt.top_trades[:5]:
                strike_s = f"${t.strike:.0f}" if t.strike is not None else "?"
                exp_s = t.expiry.isoformat() if t.expiry else "?"
                prem_s = _fmt(t.total_premium, currency=True)
                ask_s = _fmt(t.ask_prem, currency=True)
                opt_lines.append(
                    f"    {t.type or '?'} {strike_s} exp {exp_s} — total {prem_s}, "
                    f"at-ask {ask_s} ({t.alert or '?'})"
                )
        sections.append("Options flow (5d):\n" + "\n".join(opt_lines))

    # Dark pool
    if dp.prints_5d > 0:
        sections.append(
            "Dark pool (5d):\n"
            f"- {dp.prints_5d} prints, {_fmt(dp.premium_5d, currency=True)} total\n"
            f"- {dp.above_vwap_pct * 100:.0f}% of $ traded above NBBO midpoint"
        )

    # Positioning (short + dealer GEX)
    pos_lines: list[str] = []
    if pos.fee_rate is not None:
        pos_lines.append(f"- Borrow fee rate: {pos.fee_rate:.2f}%")
    if pos.short_shares_available is not None:
        pos_lines.append(f"- Short shares available: {pos.short_shares_available:,}")
    if pos.gex_total is not None:
        regime = "positive (mean-reverting / supportive)" if pos.gex_total > 0 else "negative (trending / pro-cyclical)"
        pos_lines.append(f"- Aggregate dealer GEX: {pos.gex_total:+.2e} -> {regime}")

    # skylit.ai / Heatseeker structural snapshot (per-strike dealer levels).
    # ~70% of intraday moves anchor on these nodes (gexester 60-day study).
    if pos.skylit_spot is not None:
        spot = pos.skylit_spot
        pos_lines.append(
            f"- skylit spot: {spot:.2f}"
            + (f" | exp {pos.skylit_expiration}" if pos.skylit_expiration else "")
        )
        if pos.skylit_regime_score is not None:
            sign = "long-gamma (mean-revert)" if pos.skylit_regime_score > 0 else "short-gamma (trending)"
            pos_lines.append(
                f"- skylit regime: {pos.skylit_regime_score:+.2f} ({sign})"
            )
        if pos.skylit_king_strike is not None:
            side = "above" if pos.skylit_king_strike > spot else "below" if pos.skylit_king_strike < spot else "at"
            kg = pos.skylit_king_gamma or 0.0
            kind = "pika ceiling" if kg > 0 else "barney magnet"
            pos_lines.append(
                f"- King node: {pos.skylit_king_strike:.2f} {side} spot ({kind}, gamma={kg:+.2e})"
            )
        if pos.skylit_floor_strike is not None:
            sig = pos.skylit_floor_significance or 0.0
            pos_lines.append(f"- Floor (pika below): {pos.skylit_floor_strike:.2f} (rel_sig {sig:.2%})")
        if pos.skylit_ceiling_strike is not None:
            sig = pos.skylit_ceiling_significance or 0.0
            pos_lines.append(f"- Ceiling (pika above): {pos.skylit_ceiling_strike:.2f} (rel_sig {sig:.2%})")
        if pos.skylit_liquidity_vacuums:
            for v in pos.skylit_liquidity_vacuums[:2]:
                pos_lines.append(
                    f"- Liquidity vacuum: {v.get('low'):.2f}–{v.get('high'):.2f} "
                    f"(span {v.get('span'):.2f}) — fast moves likely once breached"
                )
        elif pos.skylit_air_pockets:
            for ap in pos.skylit_air_pockets[:2]:
                pos_lines.append(f"- Air pocket: {ap.get('low'):.2f}–{ap.get('high'):.2f}")

    # 0DTE Trinity (SPY/QQQ/SPX/SPXW only)
    if pos.trinity_classification:
        line = f"- 0DTE Trinity: {pos.trinity_classification}"
        if pos.trinity_direction and pos.trinity_direction != "informational_only":
            line += f" -> {pos.trinity_direction}"
        if pos.trinity_avg_bias is not None:
            line += f" | avg_bias={pos.trinity_avg_bias:+.0f}"
        if pos.trinity_spread is not None:
            line += f" spread={pos.trinity_spread:.0f}"
        if pos.trinity_age_minutes is not None:
            line += f" ({pos.trinity_age_minutes:.0f}m old)"
        pos_lines.append(line)
        if pos.trinity_whipsaw:
            pos_lines.append("- Trinity whipsaw flag active — directional setups deprioritized")
        bias_parts = []
        if pos.trinity_bias_spx is not None: bias_parts.append(f"SPX={pos.trinity_bias_spx:+.0f}")
        if pos.trinity_bias_spy is not None: bias_parts.append(f"SPY={pos.trinity_bias_spy:+.0f}")
        if pos.trinity_bias_qqq is not None: bias_parts.append(f"QQQ={pos.trinity_bias_qqq:+.0f}")
        if bias_parts:
            pos_lines.append(f"    components: {' '.join(bias_parts)}")

    if pos_lines:
        sections.append("Positioning:\n" + "\n".join(pos_lines))

    # Smart money
    sm_lines: list[str] = []
    if smart.insider_buys_30d > 0 or smart.insider_sells_30d > 0:
        # Two-line summary: counts + signed net on the first line; gross
        # buy / gross sell + unique-actor counts on the second so personas can
        # see asymmetry — "$5M bought / $4.8M sold, net only +$200k but heavy
        # 2-way flow" reads very differently from "$5M net buying, single
        # buyer." Top actors are listed under the headline so big single
        # filers are visible by name + title.
        sm_lines.append(
            f"- Insider 30d: {smart.insider_buys_30d} buys / {smart.insider_sells_30d} sells, "
            f"net {_fmt(smart.insider_net_amount_30d, currency=True)}"
        )
        if smart.insider_total_buy_amount_30d > 0 or smart.insider_total_sell_amount_30d > 0:
            sm_lines.append(
                f"    Gross: {_fmt(smart.insider_total_buy_amount_30d, currency=True)} bought "
                f"by {smart.insider_unique_buyers_30d} insider(s), "
                f"{_fmt(smart.insider_total_sell_amount_30d, currency=True)} sold "
                f"by {smart.insider_unique_sellers_30d} insider(s)"
            )
        if smart.top_insider_buyers:
            for a in smart.top_insider_buyers[:3]:
                sm_lines.append(
                    f"      BUY  {a.filer} ({a.title or 'Insider'}): "
                    f"{_fmt(a.total_amount, currency=True)} across {a.txn_count} txn"
                )
        if smart.top_insider_sellers:
            for a in smart.top_insider_sellers[:3]:
                sm_lines.append(
                    f"      SELL {a.filer} ({a.title or 'Insider'}): "
                    f"{_fmt(a.total_amount, currency=True)} across {a.txn_count} txn"
                )
    if smart.congress_trades:
        sm_lines.append(f"- {len(smart.congress_trades)} recent congressional trades")
        for ct in smart.congress_trades[:3]:
            sm_lines.append(
                f"    {ct.name or '?'} ({ct.chamber or '?'}): {ct.type or '?'} {ct.amount_band or '?'} on {ct.transaction_date or '?'}"
            )
    if sm_lines:
        sections.append("Smart money:\n" + "\n".join(sm_lines))

    # Catalysts
    cat_lines: list[str] = []
    if cat.next_earnings_date:
        proximity_note = " (within 7 days — pre-earnings hedging confounds flow signal)" if cat.earnings_proximity else ""
        cat_lines.append(f"- Next earnings: {cat.next_earnings_date.isoformat()}{proximity_note}")
    if cat.news_5d:
        cat_lines.append(f"- {len(cat.news_5d)} news headlines 5d:")
        # Sentiment rollup BEFORE the headlines so personas read the tilt
        # first ("3 pos / 1 neu / 0 neg, net bullish") and the individual
        # headlines second. Saves them from re-counting from the list.
        pos5 = cat.news_sentiment_positive_5d
        neu5 = cat.news_sentiment_neutral_5d
        neg5 = cat.news_sentiment_negative_5d
        if pos5 + neu5 + neg5 > 0:
            net = pos5 - neg5
            if net >= 2:
                tilt = "bullish tilt"
            elif net <= -2:
                tilt = "bearish tilt"
            else:
                tilt = "balanced/mixed"
            cat_lines.append(
                f"    Sentiment: {pos5} positive / {neu5} neutral / {neg5} negative ({tilt})"
            )
        for h in cat.news_5d[:5]:
            sent = f"[{h.sentiment}]" if h.sentiment else ""
            major = "*MAJOR*" if h.is_major else ""
            cat_lines.append(f'    {h.ts.date()} {sent}{major} {h.source or "?"}: "{h.headline[:120]}"')
    if cat_lines:
        sections.append("Catalysts:\n" + "\n".join(cat_lines))

    # Reddit chatter — confluence layer. Surface only when there's
    # something asymmetric to say (mention spike, contrarian warning,
    # or stealth flag). Otherwise stays out of the prompt to save tokens.
    reddit = bundle.reddit
    if reddit.has_data and (
        (reddit.spike_ratio is not None and (reddit.spike_ratio > 2.0 or reddit.spike_ratio < 0.5))
        or reddit.is_contrarian_warning
        or reddit.is_stealth
        or (reddit.rank_today is not None and reddit.rank_today <= 30)
    ):
        rd_lines: list[str] = []
        spike_s = f"{reddit.spike_ratio:.1f}x avg" if reddit.spike_ratio is not None else "n/a"
        rank_s = f"#{reddit.rank_today}" if reddit.rank_today is not None else "unranked"
        rd_lines.append(
            f"- Reddit: {reddit.mentions_today} mentions today ({spike_s}), rank {rank_s} (Apewisdom all-stocks)"
        )
        if reddit.is_contrarian_warning:
            rd_lines.append("- Contrarian-warning flag: high chatter — retail likely caught up, move may be late")
        if reddit.is_stealth:
            rd_lines.append("- Stealth flag: very low chatter — institutional setup unnoticed by retail")
        if reddit.by_subreddit:
            wsb = next((s for s in reddit.by_subreddit if s.subreddit == "wallstreetbets"), None)
            stocks = next((s for s in reddit.by_subreddit if s.subreddit == "stocks"), None)
            if wsb or stocks:
                parts = []
                if wsb:
                    parts.append(f"WSB {wsb.mentions}")
                if stocks:
                    parts.append(f"r/stocks {stocks.mentions}")
                rd_lines.append(f"- Per-subreddit: {', '.join(parts)}")
        # Post excerpts — actual content from the catalyst feed so personas
        # can distinguish substance ("data center growth thesis with sources")
        # from spam ("🚀🚀🚀 to the moon"). Only surface posts with at least
        # SOME engagement OR a non-empty body; bare title-only posts add
        # noise. Capped at 3 here even though we collect 5 — keeps the
        # prompt tight on chatty days.
        substantive_excerpts = [
            e for e in (reddit.recent_post_excerpts or [])
            if e.body_excerpt or (e.upvotes or 0) >= 10 or (e.num_comments or 0) >= 5
        ][:3]
        if substantive_excerpts:
            rd_lines.append("- Recent catalyst-feed posts (what people are actually saying):")
            for e in substantive_excerpts:
                meta = []
                if e.upvotes is not None:
                    meta.append(f"{e.upvotes}↑")
                if e.num_comments is not None:
                    meta.append(f"{e.num_comments} comments")
                if e.keywords:
                    meta.append(f"tags: {', '.join(e.keywords[:4])}")
                meta_str = f" [{' · '.join(meta)}]" if meta else ""
                rd_lines.append(f'    r/{e.subreddit}: "{e.title}"{meta_str}')
                if e.body_excerpt:
                    rd_lines.append(f"      → {e.body_excerpt}")
        sections.append("Reddit chatter (confluence layer, NOT primary signal):\n" + "\n".join(rd_lines))

    if not sections:
        return "Flow / positioning / catalysts: no Unusual Whales data available for this ticker yet."
    return "\n\n".join(sections)


class BasePersona(ABC):  # noqa: B024 — kept abstract for taxonomy; subclasses override SYSTEM_PROMPT.
    """Common LLM-persona plumbing.

    Subclasses set ``name`` (e.g. ``"buffett"``) and ``system_prompt``.
    """

    name: ClassVar[str] = "base_persona"
    system_prompt: ClassVar[str] = ""

    # Per-persona Chain-of-Thought scaffolding. Each entry is one numbered
    # reasoning step the model walks through BEFORE writing the structured
    # verdict — shaped to the persona's investing framework, not generic
    # "think step by step" boilerplate (which defeats persona separation).
    # Empty default = persona doesn't yet have a CoT chain (legacy behavior).
    cot_steps: ClassVar[list[str]] = []

    def __init__(self, llm: LlmClient | None = None) -> None:
        self._llm = llm or LlmClient()

    def __call__(self, state: AnalysisState) -> dict:
        signal = self.analyze(state)
        return {"persona_signals": [signal]}

    def lens(self, state: AnalysisState) -> str:
        """Persona-specific lens — pick the 8-12 most relevant fields from
        state["evidence"] (the canonical EvidenceBundle) and render them as
        a context block.

        Default implementation returns an empty string; subclasses override
        to surface fields that match their investing framework. Personas
        DO NOT see analyst conclusions — they see raw bundle fields, which
        forces them to disagree rather than anchor on upstream analyst votes.
        """
        return ""

    # Legacy alias kept for any callers that haven't migrated. Prefer lens().
    def extra_context(self, state: AnalysisState) -> str:
        return self.lens(state)

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

        provider_override, model_override = llm_override_for(state)

        try:
            parsed: PersonaOutput | None = self._llm.invoke_persona(
                system_prompt=full_system,
                user_prompt=user_prompt,
                trace_name=f"persona.{self.name}",
                trace_metadata={"ticker": ticker, "kind": "persona", "agent": self.name},
                provider_override=provider_override,
                model_override=model_override,
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
        """Render the user prompt from raw EvidenceBundle fields ONLY.

        Personas do NOT see analyst conclusions (no 'technicals: bullish' line).
        That was creating groupthink — every persona anchored to the technicals
        analyst's verdict. Now each persona reads raw price + flow + insider
        evidence and applies their own lens, which forces real disagreement.
        """
        ticker = state.get("ticker", "?")
        bundle = state.get("evidence")

        if bundle is None:
            # Tests / direct callers without a bundle — synthesize a minimal
            # one from state["prices"] + state["fundamentals"] so the prompt
            # still renders. Lens calls that depend on flow / smart_money /
            # catalysts will see empty defaults.
            sector = state.get("sector") or "Unknown"
            bundle = EvidenceBundle(
                run_ts=datetime.now(UTC),
                instrument=Instrument(
                    ticker=ticker,
                    type="stock",
                    company_name=ticker,
                    sector=sector,
                ),
                price_context=compute_price_context(state.get("prices")),
                fundamentals=compute_fundamentals_ctx(state.get("fundamentals")),
            )

        inst = bundle.instrument
        pc = bundle.price_context
        fc = bundle.fundamentals

        company_name = inst.company_name or ticker
        is_etf = (inst.type or "stock").lower() == "etf"
        type_label = (
            "sector / thematic ETF (basket of stocks)"
            if is_etf
            else "publicly traded common stock (operating company)"
        )
        industry_part = f", industry: {inst.industry}" if inst.industry else ""
        size_part = f", marketcap-size: {inst.marketcap_size}" if inst.marketcap_size else ""
        earnings_part = (
            ""  # ETFs don't have earnings; only set for stocks
            if is_etf
            else (
                f", next earnings: {inst.next_earnings_date.isoformat()}"
                if inst.next_earnings_date
                else ""
            )
        )
        descr_part = f"\nDescription: {inst.short_description}" if inst.short_description else ""
        instrument_block = (
            f"Instrument: {company_name} ({inst.ticker}) — {type_label}, "
            f"sector: {inst.sector}{industry_part}{size_part}{earnings_part}.{descr_part}"
        )

        # ETF vs stock framing — your investing framework still applies, but
        # at the basket level for ETFs (sector beta, aggregate flow, regime
        # tailwinds) instead of the single-business level (moat, owner
        # earnings, management). Without this, value/quality personas (Buffett,
        # Lynch, Damodaran) drift into pitching ETFs as single companies with
        # CEOs and earnings calls. Critic-flagged from the prompt audit.
        if is_etf:
            instrument_framing = (
                "You are evaluating a SECTOR / THEMATIC ETF — a basket of stocks, NOT a single "
                "company. Apply your investing framework at the BASKET level: "
                "sector beta, aggregate flow regime, macro tailwind/headwind for the "
                "sector, relative strength vs SPY, dispersion across constituents. "
                "Do NOT discuss the ETF as if it had a CEO, an earnings call, "
                "a management team, owner earnings, a moat, or a product cycle — "
                "those concepts belong to individual companies, not baskets. "
                "Do NOT compute a P/E or DCF on the ETF; compute it on its "
                "underlying sector if at all. Use the price tape, flow data, "
                "and macro/regime evidence below as your primary inputs."
            )
        else:
            instrument_framing = (
                f"You are evaluating a SINGLE PUBLICLY TRADED COMPANY ({company_name}). "
                f"Reason about {company_name} as a real operating business — its "
                f"business model, industry dynamics, balance sheet, management, "
                f"customers, competitive position. Never describe a stock as a "
                f"'fund' or 'basket'."
            )

        # --- raw price context (what the tape looks like) ---
        if pc.bars_count > 0:
            ma50_s = f"{pc.ma50_dist * 100:+.1f}%" if pc.ma50_dist is not None else "—"
            ma200_s = f"{pc.ma200_dist * 100:+.1f}%" if pc.ma200_dist is not None else "—"
            rsi_s = f"{pc.rsi_14:.0f}" if pc.rsi_14 is not None else "—"
            r5_s = f"{pc.return_5d * 100:+.1f}%" if pc.return_5d is not None else "—"
            r20_s = f"{pc.return_20d * 100:+.1f}%" if pc.return_20d is not None else "—"
            rv_s = f"{pc.realized_vol_20d * 100:.1f}%" if pc.realized_vol_20d is not None else "—"
            volz_s = f"{pc.volume_z_20d:+.1f}" if pc.volume_z_20d is not None else "—"
            price_block = (
                f"Price tape ({pc.bars_count} bars, last close ${pc.last_close:.2f}):\n"
                f"- 5d return: {r5_s}, 20d return: {r20_s}\n"
                f"- distance from MA50: {ma50_s}, MA200: {ma200_s}\n"
                f"- RSI(14): {rsi_s}, realized vol (20d, ann.): {rv_s}, vol z-score: {volz_s}"
            )
        else:
            price_block = "Price tape: no bars available."

        # --- raw fundamentals ---
        if fc.has_data:
            fund_block = (
                "Fundamentals (latest annual):\n"
                f"- Revenue: {_fmt(fc.revenue, currency=True)}, Market cap: {_fmt(fc.market_cap, currency=True)}\n"
                f"- ROE: {_fmt(fc.roe, pct=True)}, ROIC: {_fmt(fc.roic, pct=True)}\n"
                f"- Gross margin: {_fmt(fc.gross_margin, pct=True)}, Net margin: {_fmt(fc.net_margin, pct=True)}\n"
                f"- Free cash flow: {_fmt(fc.free_cash_flow, currency=True)}\n"
                f"- Debt/Equity: {_fmt(fc.debt_to_equity)}, P/E: {_fmt(fc.pe_ratio)}, P/B: {_fmt(fc.price_to_book)}"
            )
        else:
            fund_block = (
                f"Fundamentals: not yet ingested for {ticker}. Reason from price tape, "
                f"flow data below, and {company_name}'s business description."
            )

        # --- raw flow / dark pool / positioning / smart money / catalysts ---
        flow_block = _render_flow_block(bundle)

        # --- persona-specific lens (selects 8-12 bundle fields most relevant) ---
        lens_text = self.lens(state).strip()
        lens_block = f"\n\n{self.name}-specific lens:\n{lens_text}" if lens_text else ""

        # --- persona-shaped Chain-of-Thought ---
        # Each step IS the persona's framework collapsed into a question.
        # Buffett walks through "do I understand this business" before "what's
        # the moat" before "what's the price"; Soros walks through "what's the
        # cycle stage" before "is positioning crowded". Generic CoT defeats
        # persona separation; persona-shaped CoT preserves it.
        if self.cot_steps:
            cot_lines = "\n".join(f"  {i + 1}. {step}" for i, step in enumerate(self.cot_steps))
            cot_block = (
                "\n\nReason through these steps internally BEFORE you write the "
                "structured verdict (you don't need to surface the steps in "
                "your output — they're scaffolding for your reasoning):\n"
                f"{cot_lines}"
            )
        else:
            cot_block = ""

        return (
            f"{instrument_block}\n\n"
            f"{price_block}\n\n"
            f"{fund_block}\n\n"
            f"{flow_block}"
            f"{lens_block}"
            f"{cot_block}\n\n"
            "Provide your verdict in the structured output format.\n\n"
            "Quality bar — non-negotiable:\n"
            f"- {instrument_framing}\n"
            "- thesis: 2-3 complete sentences explaining your specific reasoning "
            "from your investing framework. NOT a one-word label or category. "
            "Cite at least one concrete fact (a number, a competitive position, "
            "or a macro condition).\n"
            "- key_evidence: 3-5 bullets. Each must reference a SPECIFIC data "
            "point from above (revenue growth %, ROE %, FCF, P/E, RSI, "
            "trend, flow alert, insider activity, etc.). Avoid vague platitudes.\n"
            "- concerns: 1-3 specific risks that would invalidate this call. "
            "Tie each to your framework, not generic 'market volatility'.\n"
            "- CONVICTION RULE: confidence in [0.40, 0.60] is the hedged middle. "
            "If you land there, you MUST fill `hedge_justification` (>=30 chars) "
            "with the specific evidence on BOTH sides that would flip you. "
            "Vague 'mixed signals' or 'I want more data' will fail validation. "
            "Most of the time, picking a side and adjusting confidence outside "
            "[0.40, 0.60] is the right answer. The schema will REJECT a hedged "
            "answer that doesn't articulate the flip conditions."
        )
