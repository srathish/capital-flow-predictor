"""Optional Langfuse instrumentation for the agent ensemble.

Wraps every LLM call with a trace so per-agent cost, latency, input/output,
and (eventually) hit-rate are visible in the Langfuse UI.

Activation: set ``LANGFUSE_PUBLIC_KEY`` + ``LANGFUSE_SECRET_KEY`` (and
optionally ``LANGFUSE_HOST``, defaults to https://cloud.langfuse.com) in
the environment. With those unset, every helper here is a no-op — the
ensemble runs identically with zero overhead. With them set, the runner
emits one trace per ensemble run with one nested generation per LLM call.

Why hand-rolled rather than the OpenAI auto-wrap: we use both the
Anthropic SDK and the OpenAI-compatible Moonshot SDK. Manual instrumentation
is the portable choice and keeps the trace shape identical across providers.
"""

from __future__ import annotations

import logging
import os
from contextlib import contextmanager
from typing import Any

log = logging.getLogger(__name__)

_langfuse: Any | None = None
_initialized = False


def _init() -> Any | None:
    """Lazy-init the Langfuse client. Idempotent. Returns None if disabled."""
    global _langfuse, _initialized
    if _initialized:
        return _langfuse
    _initialized = True

    pk = os.environ.get("LANGFUSE_PUBLIC_KEY")
    sk = os.environ.get("LANGFUSE_SECRET_KEY")
    if not (pk and sk):
        return None

    try:
        from langfuse import Langfuse
    except ImportError:
        log.warning(
            "LANGFUSE_PUBLIC_KEY set but `langfuse` package not installed; tracing disabled. "
            "Install with `uv pip install langfuse` or add to deps."
        )
        return None

    try:
        _langfuse = Langfuse(
            public_key=pk,
            secret_key=sk,
            host=os.environ.get("LANGFUSE_HOST", "https://cloud.langfuse.com"),
        )
        log.info("Langfuse tracing enabled (host=%s)", _langfuse.host if hasattr(_langfuse, "host") else "default")
    except Exception as e:
        log.warning("Failed to initialize Langfuse: %s", e)
        _langfuse = None
    return _langfuse


def get_langfuse() -> Any | None:
    return _init()


class _NoopGeneration:
    """Drop-in replacement for a Langfuse generation when tracing is disabled."""

    def update(self, **_kwargs: Any) -> None:
        pass

    def end(self, **_kwargs: Any) -> None:
        pass


@contextmanager
def trace_generation(
    *,
    name: str,
    model: str,
    input_data: dict[str, Any] | None = None,
    metadata: dict[str, Any] | None = None,
):
    """Wrap a single LLM call as a Langfuse generation observation.

    Yields a context object with ``.update(output=..., usage_details=...)``.
    No-op when Langfuse isn't configured.

    Uses the Langfuse v4 unified observation API: ``start_as_current_observation``
    with ``as_type='generation'``. v3's ``start_as_current_generation`` was
    removed; calling it raises AttributeError. (Spotted in production after
    Phase 2 shipped silently no-op'd because of this rename.)
    """
    lf = get_langfuse()
    if lf is None:
        yield _NoopGeneration()
        return

    try:
        with lf.start_as_current_observation(
            name=name,
            as_type="generation",
            model=model,
            input=input_data,
            metadata=metadata or {},
        ) as gen:
            yield gen
    except Exception as e:
        # Never let tracing failures crash the actual LLM path.
        log.warning("Langfuse generation %s failed: %s", name, e)
        yield _NoopGeneration()


@contextmanager
def trace_run(
    *,
    name: str,
    metadata: dict[str, Any] | None = None,
):
    """Wrap an entire ensemble run as a Langfuse trace/span.

    All ``trace_generation`` calls inside the ``with`` block nest under this
    span, producing a single multi-level view per ticker run.
    No-op when Langfuse isn't configured.

    Same v4 API note as ``trace_generation`` — uses ``start_as_current_observation``
    with ``as_type='span'`` (the v3 ``start_as_current_span`` shortcut was removed).
    """
    lf = get_langfuse()
    if lf is None:
        yield None
        return

    try:
        with lf.start_as_current_observation(
            name=name,
            as_type="span",
            metadata=metadata or {},
        ) as span:
            yield span
    except Exception as e:
        log.warning("Langfuse run trace %s failed: %s", name, e)
        yield None


def extract_usage(response: Any, provider: str) -> dict[str, int] | None:
    """Pull token-usage fields out of a provider response so generations get
    proper input/output token counts. Returns None when fields aren't found
    (Langfuse will just store zero usage)."""
    try:
        if provider == "anthropic":
            usage = getattr(response, "usage", None)
            if usage is None:
                return None
            return {
                "input": int(getattr(usage, "input_tokens", 0) or 0),
                "output": int(getattr(usage, "output_tokens", 0) or 0),
            }
        if provider == "moonshot":
            # OpenAI-compatible usage shape: prompt_tokens / completion_tokens
            usage = getattr(response, "usage", None)
            if usage is None:
                return None
            return {
                "input": int(getattr(usage, "prompt_tokens", 0) or 0),
                "output": int(getattr(usage, "completion_tokens", 0) or 0),
            }
    except Exception:
        return None
    return None


def flush() -> None:
    """Force-flush pending events. Call before process exit so short-running
    CLI invocations don't lose traces."""
    lf = get_langfuse()
    if lf is None:
        return
    try:
        lf.flush()
    except Exception as e:
        log.warning("Langfuse flush failed: %s", e)
