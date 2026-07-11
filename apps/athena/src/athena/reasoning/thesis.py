"""LLM thesis synthesis. The model reasons over pre-computed features + vault
knowledge; it never does arithmetic on raw prices. Web search is enabled so
Athena can check for real-world invalidators it can't see in the data.
"""

from __future__ import annotations

import json
from pathlib import Path

from pydantic import BaseModel, Field, field_validator

from athena import config
from athena.signals.features import FeatureVector

PROMPT_PATH = Path(__file__).with_name("prompts") / "thesis_v1.md"


class Thesis(BaseModel):
    """direction, conviction, invalidation, rationale are load-bearing (the gatekeeper
    reads them) and stay required; presentation fields default empty."""

    ticker: str
    direction: str = Field(description="long | short | stand_aside")
    conviction: float = Field(ge=0.0, le=1.0)
    invalidation: str
    rationale: str
    regime_read: str = ""
    catalyst: str = ""
    structure: str = Field("", description="instrument/structure, e.g. 'SPXW 0DTE call debit spread'")
    entry_zone: str = ""
    exit_nodes: str = ""
    size_guidance: str = ""
    cited_sources: list[str]

    @field_validator("cited_sources", mode="before")
    @classmethod
    def _coerce_sources(cls, v):
        # models sometimes emit a joined string instead of a list
        if isinstance(v, str):
            return [s.strip() for s in v.split(";" if ";" in v else ",") if s.strip()]
        return v


EMIT_THESIS_TOOL = {
    "name": "emit_thesis",
    "description": "Emit the final structured trade thesis. Call exactly once.",
    "input_schema": Thesis.model_json_schema(),
}

WEB_SEARCH_TOOL = {"type": "web_search_20250305", "name": "web_search", "max_uses": 3}


def synthesize(features: FeatureVector, knowledge_context: str) -> Thesis:
    import anthropic

    client = anthropic.Anthropic()
    system = PROMPT_PATH.read_text(encoding="utf-8")
    user = (
        f"<feature_vector>\n{features.model_dump_json(indent=2)}\n</feature_vector>\n\n"
        f"<knowledge>\n{knowledge_context}\n</knowledge>\n\n"
        f"Produce the thesis for {features.ticker} now."
    )
    messages: list[dict] = [{"role": "user", "content": user}]
    for _ in range(5):
        resp = client.messages.create(
            model=config.ANTHROPIC_MODEL,
            max_tokens=4000,
            system=system,
            tools=[EMIT_THESIS_TOOL, WEB_SEARCH_TOOL],
            messages=messages,
        )
        emit = next(
            (b for b in resp.content if b.type == "tool_use" and b.name == "emit_thesis"), None
        )
        if emit is not None:
            try:
                return Thesis.model_validate(emit.input)
            except Exception as exc:
                # self-repair: hand the validation error back and let the model retry
                messages.append({"role": "assistant", "content": resp.content})
                messages.append({
                    "role": "user",
                    "content": [{
                        "type": "tool_result",
                        "tool_use_id": emit.id,
                        "is_error": True,
                        "content": f"Schema validation failed: {exc}. "
                                   "Call emit_thesis again with corrected input.",
                    }],
                })
                continue
        # no emit_thesis this turn (e.g. web_search ran, or plain text) — nudge
        messages.append({"role": "assistant", "content": resp.content})
        messages.append({"role": "user", "content": "Call emit_thesis now with the final thesis."})
    raise RuntimeError("model never emitted a valid thesis after 5 turns")


def thesis_summary(t: Thesis) -> str:
    return (
        f"{t.ticker} {t.direction.upper()} ({t.conviction:.2f}) — {t.structure}\n"
        f"regime: {t.regime_read}\nentry: {t.entry_zone}\nexits: {t.exit_nodes}\n"
        f"invalidation: {t.invalidation}\nsize: {t.size_guidance}\n{t.rationale}"
    )


def to_json(t: Thesis) -> str:
    return json.dumps(t.model_dump(), indent=2)
