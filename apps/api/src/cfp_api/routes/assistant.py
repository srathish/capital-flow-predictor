"""Top-level assistant chat — natural-language UI on top of the whole app.

POST /v1/assistant/chat   — SSE stream of text + tool_call + tool_result events

Runs a Moonshot/OpenAI-compatible tool-calling loop. The assistant has access
to a small set of tools that wrap the existing APIs:

  - get_rankings(horizon)      — latest XGB sector ranks
  - get_sectors_heatmap()      — sector tile data with returns
  - get_agents_for_ticker(t)   — full 25-agent ensemble verdict for a ticker
  - get_catalysts(hours, ...)  — recent reddit catalyst posts
  - run_ensemble(t)            — kick off a fresh ensemble run, returns run_ts
  - navigate(path)             — emit a frontend-honored navigation event

The frontend dock listens to the SSE stream and renders text tokens,
tool-call cards (with live progress), and navigation events.

Why streaming SSE: tool-calling loops are inherently iterative — the user
sees the model reasoning, calling tools, and incorporating their results
in real time, rather than waiting for the final answer.
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import UTC, datetime
from typing import Any, Literal

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from cfp_api.db import get_pool
from cfp_api.settings import settings

log = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/assistant", tags=["assistant"])


# ---------- request schema ----------


class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class AssistantChatRequest(BaseModel):
    messages: list[ChatTurn] = Field(min_length=1, max_length=40)


# ---------- system prompt ----------

_SYSTEM_PROMPT = """\
You are Bellwether's assistant — a portfolio analyst that drives the dashboard
for the user via natural language. You have a small set of tools to fetch
data and trigger ensemble runs. Use them aggressively when the user asks a
factual question; never make up numbers.

Style:
- Crisp, factual, sector-rotation-aware. No fluff, no disclaimers.
- When the user asks "what's hot" or "show me sectors", call get_rankings or
  get_sectors_heatmap and answer with concrete tickers + scores.
- When the user mentions a ticker, call get_agents_for_ticker to fetch the
  latest ensemble verdict before answering.
- When the user asks to RUN something, call run_ensemble — don't just describe.
- When the user wants to navigate ("open NVDA", "show catalysts"), call the
  navigate tool with the right path (e.g. /agents/NVDA, /catalysts, /network).
- After tool calls, summarize results in 2-3 sentences with the most
  actionable insight, then offer one follow-up the user might want.

Available navigation paths:
  /                     dashboard (sector heatmap)
  /sectors/<ETF>        single-sector holdings table (XLK, XLE, ARKK, ...)
  /agents/<TICKER>      ensemble grid view for a ticker
  /agents/<TICKER>/v2   office sprite view of the same
  /network              correlation network
  /reddit               apewisdom mentions
  /catalysts            reddit RSS catalyst feed
  /watchlist            top sectors x top names
"""


# ---------- tool definitions (OpenAI/Moonshot tool-call schema) ----------

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_rankings",
            "description": "Latest XGB sector-ETF rankings. Returns rank, symbol, score for the prediction universe (~26 ETFs).",
            "parameters": {
                "type": "object",
                "properties": {
                    "horizon": {
                        "type": "integer",
                        "enum": [5, 10, 20],
                        "description": "Forward-return horizon in trading days.",
                        "default": 10,
                    },
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_sectors_heatmap",
            "description": "Sector ETF heatmap with 1d/5d/20d returns and current XGB rank per sector.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_agents_for_ticker",
            "description": "Latest 25-agent ensemble verdict for a ticker (5 analysts + 13 personas + 2 rebuttals + 2 researchers + 3 synthesis). Returns each agent's signal, confidence, and rationale.",
            "parameters": {
                "type": "object",
                "properties": {
                    "ticker": {"type": "string", "description": "Stock or ETF ticker, uppercase."},
                },
                "required": ["ticker"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_catalysts",
            "description": "Recent Reddit catalyst posts — posts mentioning a known ticker AND a catalyst keyword (partnership, leak, FDA, acquisition, beat, guidance, insider, ...).",
            "parameters": {
                "type": "object",
                "properties": {
                    "hours": {"type": "integer", "default": 48, "description": "Lookback window."},
                    "min_score": {"type": "number", "default": 0.15, "description": "Catalyst score floor (0-1)."},
                    "ticker": {"type": "string", "description": "Optional: filter to one ticker."},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_ensemble",
            "description": "Kick off a fresh full ensemble run for a ticker. Returns the run_ts. The run completes asynchronously in ~30-60s; don't poll inside this turn.",
            "parameters": {
                "type": "object",
                "properties": {
                    "ticker": {"type": "string", "description": "Stock or ETF ticker, uppercase."},
                },
                "required": ["ticker"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "navigate",
            "description": "Tell the frontend to navigate to a different page. Use only when the user explicitly asks to open/show/go to a view.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Frontend route, e.g. /agents/NVDA or /catalysts."},
                },
                "required": ["path"],
            },
        },
    },
]


# ---------- tool implementations ----------


async def _tool_get_rankings(args: dict[str, Any]) -> dict[str, Any]:
    horizon = int(args.get("horizon", 10))
    if horizon not in (5, 10, 20):
        return {"error": f"horizon must be 5, 10, or 20 (got {horizon})"}
    pool = get_pool()
    # Each (run_ts, horizon) writes predictions for many target_ts (one per
    # walk-forward fold's test window). The most recent prediction set is
    # (latest run_ts, latest target_ts within that run) — without the second
    # filter we'd return ~1000 rows, blowing past the LLM's context window
    # on the follow-up summarization turn.
    sql = """
        WITH latest_run AS (
            SELECT MAX(run_ts) AS run_ts FROM predictions WHERE horizon_d = $1
        ),
        latest_target AS (
            SELECT MAX(target_ts) AS target_ts
            FROM predictions, latest_run
            WHERE horizon_d = $1 AND predictions.run_ts = latest_run.run_ts
        )
        SELECT p.symbol, p.score, p.rank, p.target_ts
        FROM predictions p, latest_run, latest_target
        WHERE p.horizon_d = $1
          AND p.run_ts = latest_run.run_ts
          AND p.target_ts = latest_target.target_ts
        ORDER BY p.rank ASC
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, horizon)
    return {
        "horizon_d": horizon,
        "as_of": rows[0]["target_ts"].isoformat() if rows else None,
        "rankings": [
            {"rank": r["rank"], "symbol": r["symbol"], "score": float(r["score"] or 0)}
            for r in rows
        ],
    }


async def _tool_get_sectors_heatmap(_args: dict[str, Any]) -> dict[str, Any]:
    """Tile data: latest close + 1d/5d/20d returns + most-recent XGB rank per ETF."""
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            WITH latest_pred AS (
                SELECT DISTINCT ON (symbol) symbol, rank, score
                FROM predictions
                WHERE horizon_d = 10
                ORDER BY symbol, run_ts DESC
            ),
            latest_close AS (
                SELECT DISTINCT ON (symbol) symbol, ts, close
                FROM prices_daily
                ORDER BY symbol, ts DESC
            )
            SELECT lc.symbol, lc.close, lp.rank, lp.score
            FROM latest_close lc
            LEFT JOIN latest_pred lp ON lp.symbol = lc.symbol
            WHERE lp.rank IS NOT NULL
            ORDER BY lp.rank
            """
        )
    return {
        "sectors": [
            {
                "symbol": r["symbol"],
                "rank": r["rank"],
                "score": float(r["score"] or 0),
                "last_close": float(r["close"] or 0),
            }
            for r in rows
        ],
    }


async def _tool_get_agents_for_ticker(args: dict[str, Any]) -> dict[str, Any]:
    ticker = (args.get("ticker") or "").upper().strip()
    if not ticker:
        return {"error": "ticker is required"}
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT agent, signal, confidence, rationale
            FROM agent_signals
            WHERE ticker = $1
              AND run_ts = (
                  SELECT MAX(run_ts) FROM agent_signals
                  WHERE ticker = $1 AND agent = 'portfolio_manager'
              )
            ORDER BY agent
            """,
            ticker,
        )
    if not rows:
        return {"ticker": ticker, "signals": [], "note": "No completed ensemble runs yet — call run_ensemble first."}
    return {
        "ticker": ticker,
        "signals": [
            {
                "agent": r["agent"],
                "signal": r["signal"],
                "confidence": float(r["confidence"] or 0.0),
                "rationale": (r["rationale"] or "")[:400],
            }
            for r in rows
        ],
    }


async def _tool_get_catalysts(args: dict[str, Any]) -> dict[str, Any]:
    hours = int(args.get("hours", 48))
    min_score = float(args.get("min_score", 0.15))
    ticker = (args.get("ticker") or "").upper().strip() or None
    pool = get_pool()
    if ticker:
        sql = """
            SELECT id, title, subreddit, catalyst_score, tickers, keywords, permalink, created_at
            FROM reddit_posts
            WHERE created_at >= NOW() - ($1 || ' hours')::interval
              AND catalyst_score >= $2
              AND $3 = ANY(tickers)
            ORDER BY catalyst_score DESC
            LIMIT 20
        """
        async with pool.acquire() as conn:
            rows = await conn.fetch(sql, str(hours), min_score, ticker)
    else:
        sql = """
            SELECT id, title, subreddit, catalyst_score, tickers, keywords, permalink, created_at
            FROM reddit_posts
            WHERE created_at >= NOW() - ($1 || ' hours')::interval
              AND catalyst_score >= $2
            ORDER BY catalyst_score DESC
            LIMIT 20
        """
        async with pool.acquire() as conn:
            rows = await conn.fetch(sql, str(hours), min_score)
    return {
        "hours": hours,
        "min_score": min_score,
        "ticker_filter": ticker,
        "posts": [
            {
                "title": r["title"],
                "subreddit": r["subreddit"],
                "score": float(r["catalyst_score"]),
                "tickers": list(r["tickers"] or []),
                "keywords": list(r["keywords"] or [])[:4],
                "permalink": r["permalink"],
            }
            for r in rows
        ],
    }


async def _tool_run_ensemble(args: dict[str, Any]) -> dict[str, Any]:
    """Kick off a fresh ensemble run via the existing background-task path."""
    ticker = (args.get("ticker") or "").upper().strip()
    if not ticker:
        return {"error": "ticker is required"}

    # Reuse the same scheduling pattern the /v1/agents/{T}/run endpoint uses,
    # but inline (no HTTP hop). Import lazily to avoid circular import at module load.
    from cfp_api.routes.agents import _running_tasks  # type: ignore[attr-defined]

    run_ts = datetime.now(UTC)

    async def _run() -> None:
        try:
            from cfp_jobs.agents_runner import run_analysts_streaming

            await asyncio.to_thread(
                run_analysts_streaming,
                settings.database_url,
                ticker,
                "",
                run_ts=run_ts,
                include_personas=True,
            )
        except Exception as e:
            log.warning("assistant.run_ensemble background task failed for %s: %s", ticker, e)

    task = asyncio.create_task(_run())
    _running_tasks.add(task)
    task.add_done_callback(_running_tasks.discard)

    return {
        "ticker": ticker,
        "run_ts": run_ts.isoformat(),
        "status": "started",
        "expected_total": 25,
        "note": f"Run kicked off; will complete in ~30-60s. Frontend can poll /v1/agents/{ticker}/runs/{run_ts.isoformat()} for live progress.",
    }


async def _tool_navigate(args: dict[str, Any]) -> dict[str, Any]:
    path = (args.get("path") or "").strip()
    if not path or not path.startswith("/"):
        return {"error": "path must start with /"}
    return {"navigated_to": path}


_TOOL_IMPLS: dict[str, Any] = {
    "get_rankings": _tool_get_rankings,
    "get_sectors_heatmap": _tool_get_sectors_heatmap,
    "get_agents_for_ticker": _tool_get_agents_for_ticker,
    "get_catalysts": _tool_get_catalysts,
    "run_ensemble": _tool_run_ensemble,
    "navigate": _tool_navigate,
}


# ---------- LLM client ----------


def _get_async_client():
    """Async OpenAI-compatible client. We hit Moonshot in prod, Anthropic
    if LLM_PROVIDER=anthropic. Tool-calling for Anthropic uses a different
    schema; for now we require an OpenAI-compatible provider."""
    import os

    provider = os.environ.get("LLM_PROVIDER", "moonshot").lower()
    if provider != "moonshot":
        # Anthropic SDK has its own tool format; we'd need a separate loop.
        # For v1 of the assistant, require Moonshot.
        raise RuntimeError(
            f"Assistant requires LLM_PROVIDER=moonshot (got {provider!r}). "
            "Anthropic tool-calling support is a follow-up."
        )

    from openai import AsyncOpenAI

    return AsyncOpenAI(
        api_key=os.environ.get("MOONSHOT_API_KEY", ""),
        base_url=os.environ.get("MOONSHOT_BASE_URL", "https://api.moonshot.cn/v1"),
    )


# ---------- streaming loop ----------


def _sse(event: dict[str, Any]) -> str:
    return f"data: {json.dumps(event)}\n\n"


async def _run_assistant_loop(messages: list[ChatTurn]):
    """Stream the assistant turn — alternates LLM token-streams and tool calls
    until the model stops requesting tools or hits the cap."""

    model = "moonshot-v1-32k"
    history: list[dict[str, Any]] = [{"role": "system", "content": _SYSTEM_PROMPT}]
    for m in messages:
        history.append({"role": m.role, "content": m.content})

    try:
        client = _get_async_client()
    except Exception as e:
        yield _sse({"type": "error", "message": str(e)})
        yield _sse({"type": "done"})
        return

    max_tool_turns = 6  # safety cap on tool-loop depth

    for turn in range(max_tool_turns + 1):
        # Stream the model's response. We need to gather the full assistant
        # message (including tool_calls) before we know whether to loop again.
        try:
            stream = await client.chat.completions.create(
                model=model,
                messages=history,  # type: ignore[arg-type]
                tools=TOOLS,  # type: ignore[arg-type]
                tool_choice="auto",
                stream=True,
                max_tokens=1500,
            )
        except Exception as e:
            yield _sse({"type": "error", "message": f"LLM call failed: {e}"})
            yield _sse({"type": "done"})
            return

        # Aggregate streamed deltas into one assistant message.
        full_text = ""
        tool_calls_acc: dict[int, dict[str, Any]] = {}

        async for chunk in stream:
            choice = chunk.choices[0]
            delta = choice.delta

            # Text token
            if delta.content:
                full_text += delta.content
                yield _sse({"type": "text", "content": delta.content})

            # Tool-call delta — Moonshot streams these incrementally
            for tc_delta in (delta.tool_calls or []):
                idx = tc_delta.index
                acc = tool_calls_acc.setdefault(
                    idx, {"id": "", "type": "function", "function": {"name": "", "arguments": ""}}
                )
                if tc_delta.id:
                    acc["id"] = tc_delta.id
                if tc_delta.function and tc_delta.function.name:
                    acc["function"]["name"] = tc_delta.function.name
                if tc_delta.function and tc_delta.function.arguments:
                    acc["function"]["arguments"] += tc_delta.function.arguments

        # Build the assistant message we'll feed back next turn.
        assistant_msg: dict[str, Any] = {"role": "assistant", "content": full_text or None}
        if tool_calls_acc:
            assistant_msg["tool_calls"] = [
                tool_calls_acc[i] for i in sorted(tool_calls_acc)
            ]
        history.append(assistant_msg)

        # No tool calls -> we're done.
        if not tool_calls_acc:
            yield _sse({"type": "done"})
            return

        if turn == max_tool_turns:
            yield _sse({"type": "text", "content": "\n\n[stopped: tool-loop depth limit reached]"})
            yield _sse({"type": "done"})
            return

        # Execute each tool call, stream tool_call + tool_result events,
        # and append tool messages to history for the next LLM turn.
        for idx in sorted(tool_calls_acc):
            tc = tool_calls_acc[idx]
            name = tc["function"]["name"]
            try:
                args = json.loads(tc["function"]["arguments"] or "{}")
            except json.JSONDecodeError:
                args = {}
            yield _sse({"type": "tool_call", "name": name, "args": args, "id": tc["id"]})

            impl = _TOOL_IMPLS.get(name)
            if impl is None:
                result: Any = {"error": f"unknown tool: {name}"}
            else:
                try:
                    result = await impl(args)
                except Exception as e:
                    result = {"error": f"{type(e).__name__}: {e}"}

            yield _sse({"type": "tool_result", "id": tc["id"], "name": name, "result": result})

            history.append(
                {
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "content": json.dumps(result),
                }
            )

    yield _sse({"type": "done"})


@router.post("/chat")
async def assistant_chat(req: AssistantChatRequest) -> StreamingResponse:
    """SSE stream: text tokens + tool_call events + tool_result events + done."""
    return StreamingResponse(
        _run_assistant_loop(req.messages),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
