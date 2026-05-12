"""LLM client wrapper with pluggable provider support.

Two providers, both producing structured Pydantic outputs:

  - "anthropic" — official Anthropic SDK, ``messages.parse()``. Default.
  - "moonshot"  — OpenAI-compatible SDK pointed at api.moonshot.cn.
                  Uses ``beta.chat.completions.parse()``.

Provider is chosen via the ``LLM_PROVIDER`` env var ("anthropic" by default).
The same ``LlmClient.parse(...)`` interface dispatches to the right backend so
persona and synthesizer code doesn't care which provider is in use.
"""

from __future__ import annotations

import os
from typing import TYPE_CHECKING, Any, Literal, TypeVar

from pydantic import BaseModel, Field, model_validator

from cfp_agents.observability import extract_usage, trace_generation

if TYPE_CHECKING:
    pass

T = TypeVar("T", bound=BaseModel)

DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5"
DEFAULT_MOONSHOT_MODEL = "moonshot-v1-32k"
DEFAULT_MOONSHOT_BASE_URL = "https://api.moonshot.cn/v1"

Signal = Literal["bullish", "bearish", "neutral"]


class PersonaOutput(BaseModel):
    """Structured response every persona returns."""

    signal: Signal = Field(description="Overall verdict: bullish, bearish, or neutral.")
    confidence: float = Field(
        ge=0.0,
        le=1.0,
        description="0..1 confidence in the signal. 0.5 = uncertain, 1.0 = high conviction.",
    )
    thesis: str = Field(description="One- to two-sentence headline rationale.")
    key_evidence: list[str] = Field(
        default_factory=list,
        description="3-5 bullet points the persona leaned on most.",
    )
    concerns: list[str] = Field(
        default_factory=list,
        description="0-3 bullet points of what could be wrong with the call.",
    )
    hedge_justification: str = Field(
        default="",
        description=(
            "REQUIRED if confidence is between 0.40 and 0.60 (the hedged "
            "middle). Must explicitly name which specific evidence on the "
            "bull side AND which specific evidence on the bear side would "
            "need to flip to push you off neutral. Vague 'mixed signals' "
            "or 'I want more data' is NOT acceptable. If you're picking "
            "a clear side (confidence outside 0.40-0.60), leave this empty."
        ),
    )

    @model_validator(mode="after")
    def _enforce_hedge_justification(self) -> PersonaOutput:
        """Force conviction: lazy 0.5-confidence answers must do extra work.

        RLHF-trained models default to balanced/hedged responses. This
        validator imposes a real cost on the hedge: if you sit in
        [0.40, 0.60], you must articulate the specific evidence on both
        sides that would flip you. Most of the time the model finds it
        easier to just pick a side, which is the desired behavior."""
        if 0.40 <= self.confidence <= 0.60:
            text = (self.hedge_justification or "").strip()
            if len(text) < 30:
                raise ValueError(
                    "Confidence in [0.40, 0.60] requires a non-trivial "
                    "hedge_justification (>=30 chars) that names the "
                    "specific evidence on the bull side AND bear side "
                    "that would flip you. Either write it, or pick a "
                    "side and adjust confidence outside the hedge band."
                )
        return self


class LlmClient:
    """Pluggable LLM client. Construct once per process; safe to share across threads.

    Resolves provider/model/key from explicit args first, then env vars. If the
    chosen provider's SDK or key is missing, ``available`` is False and ``parse``
    returns None — callers fall back to a neutral AgentSignal with a clear reason.
    """

    def __init__(
        self,
        *,
        provider: str | None = None,
        api_key: str | None = None,
        model: str | None = None,
        base_url: str | None = None,
    ) -> None:
        self.provider = (provider or os.environ.get("LLM_PROVIDER", "anthropic")).lower()
        self._client: object | None = None

        if self.provider == "anthropic":
            self._api_key = api_key or os.environ.get("ANTHROPIC_API_KEY", "")
            self.model = model or os.environ.get("LLM_MODEL", DEFAULT_ANTHROPIC_MODEL)
            self.base_url = base_url
            if self._api_key:
                try:
                    import anthropic

                    self._client = anthropic.Anthropic(api_key=self._api_key)
                except ImportError:
                    self._client = None

        elif self.provider == "moonshot":
            self._api_key = api_key or os.environ.get("MOONSHOT_API_KEY", "")
            self.model = model or os.environ.get("MOONSHOT_MODEL", DEFAULT_MOONSHOT_MODEL)
            self.base_url = base_url or os.environ.get(
                "MOONSHOT_BASE_URL", DEFAULT_MOONSHOT_BASE_URL
            )
            if self._api_key:
                try:
                    from openai import OpenAI

                    self._client = OpenAI(api_key=self._api_key, base_url=self.base_url)
                except ImportError:
                    self._client = None

        else:
            raise ValueError(f"Unknown LLM_PROVIDER: {self.provider!r}")

    @property
    def available(self) -> bool:
        return self._client is not None

    def _get_alt_client(self, provider: str) -> tuple[object | None, str | None]:
        """Lazily build and cache a secondary SDK client for ``provider``.

        Used when a per-call override targets a different provider than the
        one this LlmClient was constructed for (e.g. default Kimi but the
        Deep Analysis button asks for Anthropic on a single run)."""
        if not hasattr(self, "_alt_clients"):
            self._alt_clients: dict[str, tuple[object | None, str | None]] = {}
        if provider in self._alt_clients:
            return self._alt_clients[provider]

        client: object | None = None
        key: str | None = None
        if provider == "anthropic":
            key = os.environ.get("ANTHROPIC_API_KEY", "")
            if key:
                try:
                    import anthropic
                    client = anthropic.Anthropic(api_key=key)
                except ImportError:
                    client = None
        elif provider == "moonshot":
            key = os.environ.get("MOONSHOT_API_KEY", "")
            base = os.environ.get("MOONSHOT_BASE_URL", DEFAULT_MOONSHOT_BASE_URL)
            if key:
                try:
                    from openai import OpenAI
                    client = OpenAI(api_key=key, base_url=base)
                except ImportError:
                    client = None
        else:
            raise ValueError(f"Unknown provider: {provider!r}")

        self._alt_clients[provider] = (client, key)
        return client, key

    def parse(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        output_format: type[T],
        max_tokens: int = 1024,
        trace_name: str = "llm.parse",
        trace_metadata: dict[str, Any] | None = None,
        provider_override: str | None = None,
        model_override: str | None = None,
    ) -> T | None:
        """Provider-dispatched structured-output call. Returns None if unavailable.

        ``trace_name`` and ``trace_metadata`` flow through to Langfuse so the
        per-persona trace is visible (no-op when Langfuse isn't configured).

        ``provider_override`` / ``model_override`` let a single call escape the
        process-wide default — used by the Deep Analysis button to run a
        specific ticker on Claude while the rest of the app stays on Kimi."""
        provider = (provider_override or self.provider).lower()
        model = model_override or (self.model if provider == self.provider else None)
        if provider != self.provider:
            client, _ = self._get_alt_client(provider)
            if model is None:
                model = (
                    DEFAULT_ANTHROPIC_MODEL if provider == "anthropic"
                    else DEFAULT_MOONSHOT_MODEL
                )
        else:
            client = self._client

        if client is None:
            return None

        with trace_generation(
            name=trace_name,
            model=model,
            input_data={"system": system_prompt, "user": user_prompt},
            metadata={"provider": provider, **(trace_metadata or {})},
        ) as gen:
            try:
                if provider == "anthropic":
                    response = client.messages.parse(  # type: ignore[union-attr]
                        model=model,
                        max_tokens=max_tokens,
                        system=[
                            {
                                "type": "text",
                                "text": system_prompt,
                                "cache_control": {"type": "ephemeral"},
                            }
                        ],
                        messages=[{"role": "user", "content": user_prompt}],
                        output_format=output_format,
                    )
                    parsed = response.parsed_output  # type: ignore[union-attr]
                elif provider == "moonshot":
                    # OpenAI-compatible: system + user as plain messages, beta.parse()
                    # for client-side Pydantic validation against the response.
                    response = client.beta.chat.completions.parse(  # type: ignore[union-attr]
                        model=model,
                        max_tokens=max_tokens,
                        messages=[
                            {"role": "system", "content": system_prompt},
                            {"role": "user", "content": user_prompt},
                        ],
                        response_format=output_format,
                    )
                    parsed = response.choices[0].message.parsed
                else:
                    raise ValueError(f"Unknown provider: {provider!r}")

                usage = extract_usage(response, provider)
                gen.update(
                    output=parsed.model_dump() if isinstance(parsed, BaseModel) else parsed,
                    usage_details=usage,
                )
                return parsed  # type: ignore[no-any-return]
            except Exception as e:
                gen.update(output={"error": f"{type(e).__name__}: {e}"})
                raise

    def invoke_persona(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        max_tokens: int = 1024,
        trace_name: str = "persona.parse",
        trace_metadata: dict[str, Any] | None = None,
        provider_override: str | None = None,
        model_override: str | None = None,
    ) -> PersonaOutput | None:
        """Backwards-compat wrapper for the persona path. Calls ``parse`` with PersonaOutput."""
        return self.parse(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            output_format=PersonaOutput,
            max_tokens=max_tokens,
            trace_name=trace_name,
            trace_metadata=trace_metadata,
            provider_override=provider_override,
            model_override=model_override,
        )

    # ------- async streaming chat (used by the API's /chat/* endpoints) -------

    async def stream_chat(
        self,
        *,
        system_prompt: str,
        messages: list[dict],
        max_tokens: int = 2000,
    ):
        """Yield text tokens from the LLM as they arrive.

        ``messages`` is a list of ``{"role": "user"|"assistant", "content": "..."}``
        dicts forming the chat history. The system prompt is prepended automatically.
        """
        if not self._api_key:
            raise RuntimeError(f"LLM provider {self.provider!r} unavailable (missing API key)")

        if self.provider == "moonshot":
            from openai import AsyncOpenAI

            client = AsyncOpenAI(api_key=self._api_key, base_url=self.base_url)
            full_messages: list[dict] = [
                {"role": "system", "content": system_prompt},
                *messages,
            ]
            stream = await client.chat.completions.create(
                model=self.model,
                max_tokens=max_tokens,
                messages=full_messages,  # type: ignore[arg-type]
                stream=True,
            )
            async for chunk in stream:
                content = chunk.choices[0].delta.content
                if content:
                    yield content
            return

        if self.provider == "anthropic":
            import anthropic

            client = anthropic.AsyncAnthropic(api_key=self._api_key)
            async with client.messages.stream(
                model=self.model,
                max_tokens=max_tokens,
                system=[
                    {
                        "type": "text",
                        "text": system_prompt,
                        "cache_control": {"type": "ephemeral"},
                    }
                ],
                messages=messages,  # type: ignore[arg-type]
            ) as stream:
                async for text in stream.text_stream:
                    yield text
            return

        raise ValueError(f"Unknown provider: {self.provider!r}")
