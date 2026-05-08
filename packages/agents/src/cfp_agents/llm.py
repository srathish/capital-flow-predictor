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
from typing import TYPE_CHECKING, Literal, TypeVar

from pydantic import BaseModel, Field

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

    def parse(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        output_format: type[T],
        max_tokens: int = 1024,
    ) -> T | None:
        """Provider-dispatched structured-output call. Returns None if unavailable."""
        if self._client is None:
            return None

        if self.provider == "anthropic":
            response = self._client.messages.parse(  # type: ignore[union-attr]
                model=self.model,
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
            return response.parsed_output  # type: ignore[no-any-return]

        if self.provider == "moonshot":
            # OpenAI-compatible: system + user as plain messages, beta.parse()
            # for client-side Pydantic validation against the response.
            response = self._client.beta.chat.completions.parse(  # type: ignore[union-attr]
                model=self.model,
                max_tokens=max_tokens,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                response_format=output_format,
            )
            return response.choices[0].message.parsed  # type: ignore[no-any-return]

        raise ValueError(f"Unknown provider: {self.provider!r}")

    def invoke_persona(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        max_tokens: int = 1024,
    ) -> PersonaOutput | None:
        """Backwards-compat wrapper for the persona path. Calls ``parse`` with PersonaOutput."""
        return self.parse(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            output_format=PersonaOutput,
            max_tokens=max_tokens,
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
