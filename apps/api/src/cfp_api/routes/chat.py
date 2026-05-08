"""Streaming chat endpoints — talk to the ensemble or to a specific persona.

POST /v1/agents/{ticker}/chat/ensemble       — synthesizer voice, has all 17 signals as context
POST /v1/agents/{ticker}/chat/persona/{name} — talk to one persona in their voice

Both stream tokens via Server-Sent Events. The frontend uses EventSource (or
streaming fetch) to render text as it arrives.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from cfp_api.db import get_pool

log = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/agents", tags=["chat"])


# Lazy import the LLM client — keeps the module-load fast on cold start.
def _get_llm_client():
    from cfp_agents.llm import LlmClient

    return LlmClient()


# ---------- request schema ----------


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=40)
    run_ts: datetime | None = Field(
        default=None,
        description="If set, ground the chat on this specific run; otherwise the latest run for the ticker.",
    )


# ---------- helpers ----------


def _parse_payload(raw: Any) -> dict[str, Any]:
    if raw is None:
        return {}
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return {}
    return {}


async def _load_signals(ticker: str, run_ts: datetime | None) -> tuple[datetime, list[dict]]:
    """Fetch the signals for the requested (or latest) run."""
    pool = get_pool()
    if run_ts is None:
        sql = """
            SELECT run_ts, agent, signal, confidence, rationale, payload
            FROM agent_signals
            WHERE ticker = $1
              AND run_ts = (SELECT MAX(run_ts) FROM agent_signals WHERE ticker = $1)
            ORDER BY agent
        """
        async with pool.acquire() as conn:
            rows = await conn.fetch(sql, ticker)
    else:
        sql = """
            SELECT run_ts, agent, signal, confidence, rationale, payload
            FROM agent_signals
            WHERE ticker = $1 AND run_ts = $2
            ORDER BY agent
        """
        async with pool.acquire() as conn:
            rows = await conn.fetch(sql, ticker, run_ts)
    if not rows:
        raise HTTPException(
            status_code=404,
            detail=f"No agent signals for {ticker}; run an ensemble first.",
        )
    resolved_run_ts: datetime = rows[0]["run_ts"]
    parsed = [
        {
            "agent": r["agent"],
            "signal": r["signal"],
            "confidence": float(r["confidence"] or 0.0),
            "rationale": r["rationale"] or "",
            "payload": _parse_payload(r["payload"]),
        }
        for r in rows
    ]
    return resolved_run_ts, parsed


def _format_signals_for_context(signals: list[dict]) -> str:
    """Render the agent verdicts as a compact table the LLM can cite from."""
    if not signals:
        return "(no signals available)"
    rows = []
    for s in signals:
        rows.append(
            f"  - {s['agent']}: {s['signal']} (conf {s['confidence']:.2f}) — {s['rationale']}"
        )
    return "\n".join(rows)


ENSEMBLE_SYSTEM_TEMPLATE = """\
You are the synthesis layer of the Capital Flow Predictor — a multi-agent ensemble that
produced a verdict on {ticker}{sector_part}.

The 17-agent ensemble produced these verdicts (run timestamp {run_ts}):

{signals_table}

Answer the user's follow-up questions about this analysis. Rules:
- Cite specific agents by name when relevant (e.g. "Buffett flagged the rich P/E", "Taleb is bearish on tail risk").
- Stay grounded in what the agents actually said — do not invent new analysis they didn't surface.
- If the user asks about something the agents didn't cover, say so explicitly: "the ensemble didn't analyze that — but based on what they did say, ...".
- Be concise. Default to 2-4 sentences unless the user asks for depth.
- When discussing disagreement between agents, name both sides ("Wood and Druckenmiller see growth, while Burry and Klarman flag valuation").
"""


# ---------- ensemble chat ----------


@router.post("/{ticker}/chat/ensemble")
async def ensemble_chat(ticker: str, body: ChatRequest):
    ticker = ticker.upper()
    resolved_run_ts, signals = await _load_signals(ticker, body.run_ts)

    # Pull the sector hint out of any signal payload (PM has it, others may)
    sector = ""
    for s in signals:
        if s["agent"] == "portfolio_manager":
            # rarely populated this way; treat optimistically
            sector = s["payload"].get("sector", "") or sector
    sector_part = f" (sector: {sector})" if sector else ""

    system_prompt = ENSEMBLE_SYSTEM_TEMPLATE.format(
        ticker=ticker,
        sector_part=sector_part,
        run_ts=resolved_run_ts.isoformat(),
        signals_table=_format_signals_for_context(signals),
    )

    llm = _get_llm_client()
    if not llm.available:
        raise HTTPException(
            status_code=503,
            detail=f"LLM provider {llm.provider!r} unavailable (missing API key on the server).",
        )

    messages = [{"role": m.role, "content": m.content} for m in body.messages]

    async def event_stream():
        try:
            async for token in llm.stream_chat(
                system_prompt=system_prompt, messages=messages, max_tokens=1500
            ):
                yield f"data: {json.dumps({'type': 'token', 'content': token})}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
        except Exception as e:
            log.exception("ensemble chat failed: %s", e)
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


# ---------- persona chat ----------


PERSONA_NAMES = {
    "buffett",
    "burry",
    "druckenmiller",
    "taleb",
    "soros",
    "simons",
    "klarman",
    "greenblatt",
    "minervini",
    "cathie_wood",
    "damodaran",
    "lynch",
    "ackman",
}


def _persona_system_prompt(name: str) -> str:
    """Pull a persona's base system prompt from the cfp_agents package."""
    from cfp_agents.personas import (
        AckmanPersona,
        BuffettPersona,
        BurryPersona,
        CathieWoodPersona,
        DamodaranPersona,
        DruckenmillerPersona,
        GreenblattPersona,
        KlarmanPersona,
        LynchPersona,
        MinerviniPersona,
        SimonsPersona,
        SorosPersona,
        TalebPersona,
    )

    registry = {
        "buffett": BuffettPersona,
        "burry": BurryPersona,
        "druckenmiller": DruckenmillerPersona,
        "taleb": TalebPersona,
        "soros": SorosPersona,
        "simons": SimonsPersona,
        "klarman": KlarmanPersona,
        "greenblatt": GreenblattPersona,
        "minervini": MinerviniPersona,
        "cathie_wood": CathieWoodPersona,
        "damodaran": DamodaranPersona,
        "lynch": LynchPersona,
        "ackman": AckmanPersona,
    }
    cls = registry.get(name)
    if cls is None:
        raise HTTPException(status_code=404, detail=f"Unknown persona: {name}")
    return cls.system_prompt


PERSONA_FOLLOWUP_TEMPLATE = """\
{base_persona_prompt}

---

You're now in a follow-up conversation with the user about {ticker}.

Your most recent verdict on this stock (run timestamp {run_ts}):
- Signal: {signal}
- Confidence: {confidence:.2f}
- Thesis: {thesis}
{evidence_block}{concerns_block}

Stay in character. Answer the user's questions from your investment framework.
Be concise — 2-4 sentences default. Cite numbers when you can.
"""


@router.post("/{ticker}/chat/persona/{persona}")
async def persona_chat(ticker: str, persona: str, body: ChatRequest):
    ticker = ticker.upper()
    persona = persona.lower()
    if persona not in PERSONA_NAMES:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown persona '{persona}'. Valid: {sorted(PERSONA_NAMES)}",
        )

    resolved_run_ts, signals = await _load_signals(ticker, body.run_ts)
    persona_signal = next((s for s in signals if s["agent"] == persona), None)
    if persona_signal is None:
        raise HTTPException(
            status_code=404,
            detail=f"Persona {persona!r} hasn't run on {ticker} yet — run the full ensemble first.",
        )

    base = _persona_system_prompt(persona)
    payload = persona_signal["payload"] or {}
    evidence = payload.get("key_evidence") or []
    concerns = payload.get("concerns") or []
    evidence_block = (
        "\n- Key evidence:\n" + "\n".join(f"  - {e}" for e in evidence) if evidence else ""
    )
    concerns_block = (
        "\n- Concerns:\n" + "\n".join(f"  - {c}" for c in concerns) if concerns else ""
    )
    system_prompt = PERSONA_FOLLOWUP_TEMPLATE.format(
        base_persona_prompt=base,
        ticker=ticker,
        run_ts=resolved_run_ts.isoformat(),
        signal=persona_signal["signal"],
        confidence=persona_signal["confidence"],
        thesis=persona_signal["rationale"],
        evidence_block=evidence_block,
        concerns_block=concerns_block,
    )

    llm = _get_llm_client()
    if not llm.available:
        raise HTTPException(
            status_code=503,
            detail=f"LLM provider {llm.provider!r} unavailable (missing API key on the server).",
        )

    messages = [{"role": m.role, "content": m.content} for m in body.messages]

    async def event_stream():
        try:
            async for token in llm.stream_chat(
                system_prompt=system_prompt, messages=messages, max_tokens=1200
            ):
                yield f"data: {json.dumps({'type': 'token', 'content': token})}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
        except Exception as e:
            log.exception("persona chat failed: %s", e)
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
