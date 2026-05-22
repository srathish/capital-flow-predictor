"""Top-level assistant chat — natural-language UI on top of the whole app.

POST /v1/assistant/chat   — SSE stream of text + tool_call + tool_result events

Runs a Moonshot/OpenAI-compatible tool-calling loop. The assistant has access
to a small set of tools that wrap the existing APIs:

  - get_rankings(horizon)      — sector ETFs ranked by N-day realized return
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


class PageContext(BaseModel):
    """Snapshot of what the user is currently looking at in the frontend.

    Sent on every chat request so the assistant can resolve deictic references
    ("this ticker", "here", "current sector") without forcing the user to
    re-type the symbol that's already on screen.
    """

    route: str | None = None  # e.g. "/agents/NVDA", "/sectors/XLK"
    ticker: str | None = None  # active stock/ETF from /agents/[ticker]
    etf: str | None = None  # active sector ETF from /sectors/[etf]
    tab: str | None = None  # active sub-tab within a page if any
    query: dict[str, str] | None = None  # current URL search params


class AssistantChatRequest(BaseModel):
    messages: list[ChatTurn] = Field(min_length=1, max_length=40)
    context: PageContext | None = None


# ---------- system prompt ----------

_SYSTEM_PROMPT = """\
You are Bellwether's assistant — a portfolio analyst that drives the dashboard
for the user via natural language. You have a small set of tools to fetch
data and trigger ensemble runs. Use them aggressively when the user asks a
factual question; never make up numbers.

Style:
- Crisp, factual, sector-rotation-aware. No fluff, no disclaimers.
- When the user asks "what's hot" / "show me sectors" → get_rankings or get_sectors_heatmap.
- When the user mentions a ticker → get_agents_for_ticker for the latest ensemble verdict.
- When the user asks "biggest bets" / "where's the whale flow" / "who's loading up" → get_whale_bets.
- When the user asks "any sweeps on X" / "unusual flow today" / "biggest IV jumps" → get_flow_events.
- When the user asks "movers in XLK" / "what's hot in the tech sector" → get_sector_holdings.
- When the user asks "Reddit trending" / "what's WSB chattering about" → get_reddit_mentions.
- When the user asks "top picks" / "watchlist" / "what should I look at" → get_watchlist.
- When the user asks "which personas are good" / "track record" / "scorecard" → get_scorecard.
- When the user asks "best options ideas" / "screen the universe" / "long candidates" → get_stocks_screener.
- When the user asks to RUN an ensemble → run_ensemble. Don't just describe.
- When the user wants to navigate ("open NVDA", "show catalysts") → navigate.
- After tool calls, summarize results in 2-3 sentences with the most actionable insight,
  then offer one follow-up the user might want.

Available navigation paths:
  /                     dashboard (sector heatmap)
  /sectors/<ETF>        single-sector holdings table (XLK, XLE, ARKK, ...)
  /agents/<TICKER>      ensemble grid view for a ticker
  /agents/<TICKER>/v2   office sprite view of the same
  /network              correlation network
  /reddit               apewisdom mentions
  /catalysts            reddit RSS catalyst feed
  /flow                 unusual options-activity feed
  /watchlist            top sectors x top names

Page context:
- A second system message titled "[Page context]" tells you which page the
  user is currently viewing and the active ticker / ETF / tab on that page.
- When the user says "this", "this ticker", "here", "current", "the one I'm
  looking at", or otherwise refers to context without naming a symbol,
  default to the active ticker/ETF from page context.
- Don't ask the user to re-state what's already on screen. Just use it.
- Page context can be missing or partial — if it is, fall back to asking
  the user for the symbol.
"""


def _format_page_context(ctx: PageContext | None) -> str | None:
    """Render the user's current page state as a compact system message.

    Returns None if there is no useful context to send.
    """
    if ctx is None:
        return None
    lines: list[str] = []
    if ctx.route:
        lines.append(f"route: {ctx.route}")
    if ctx.ticker:
        lines.append(f"active_ticker: {ctx.ticker.upper()}")
    if ctx.etf:
        lines.append(f"active_sector_etf: {ctx.etf.upper()}")
    if ctx.tab:
        lines.append(f"active_tab: {ctx.tab}")
    if ctx.query:
        q = ", ".join(f"{k}={v}" for k, v in ctx.query.items() if v)
        if q:
            lines.append(f"query: {q}")
    if not lines:
        return None
    return "[Page context] The user is currently viewing:\n" + "\n".join(lines)


# ---------- tool definitions (OpenAI/Moonshot tool-call schema) ----------

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_rankings",
            "description": "Sector ETFs (11 SPDRs) ranked by their realized N-day return ending today. Returns rank, symbol, return percent.",
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
            "description": "Sector ETF heatmap: last close + 1d/5d/20d returns per ETF, ranked by 1d return.",
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
    {
        "type": "function",
        "function": {
            "name": "get_whale_bets",
            "description": "Top tickers right now where the options flow is loud, opening, lifted, and corroborated by insiders/dark pool/Congress. Each bet has a 0-100 conviction score plus 'reasons' explaining why. Powered by whale_conviction_signals.",
            "parameters": {
                "type": "object",
                "properties": {
                    "window_hours": {"type": "integer", "enum": [4, 24], "default": 4},
                    "direction": {"type": "string", "enum": ["bull", "bear"], "description": "Optional side filter."},
                    "min_score": {"type": "number", "default": 50, "description": "Conviction-score floor (0-100)."},
                    "limit": {"type": "integer", "default": 12},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_flow_events",
            "description": "Unusual options-activity events: mega sweeps, block buys, ask aggression, repeated hits, IV jumps, vol/OI explosions, daily call/put skew. Use for 'what's lighting up on options', 'any big flow on X', or 'biggest sweeps today'.",
            "parameters": {
                "type": "object",
                "properties": {
                    "lookback_hours": {"type": "integer", "default": 24, "description": "1-168."},
                    "ticker": {"type": "string", "description": "Optional ticker filter."},
                    "kind": {
                        "type": "string",
                        "enum": ["mega_sweep", "block_buy", "ask_aggression", "repeated_hits", "iv_expansion", "oi_explosion", "daily_skew"],
                        "description": "Optional anomaly-kind filter.",
                    },
                    "min_premium": {"type": "number", "default": 250000},
                    "limit": {"type": "integer", "default": 25},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_sector_holdings",
            "description": "Constituent table for a sector ETF: per-name 1d/5d/20d/60d returns, weight, call/put ratio, bullish %. Sortable. Use when the user wants the top movers inside a sector.",
            "parameters": {
                "type": "object",
                "properties": {
                    "etf": {"type": "string", "description": "ETF ticker (XLK, ARKK, XLE, ...)."},
                    "sort": {
                        "type": "string",
                        "enum": ["return_1d", "return_5d", "return_20d", "return_60d", "weight", "call_put_ratio", "bullish_pct"],
                        "default": "weight",
                    },
                    "limit": {"type": "integer", "default": 25},
                },
                "required": ["etf"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_reddit_mentions",
            "description": "Top tickers by Reddit chatter (Apewisdom). Includes 24h-rank delta, per-subreddit breakdown, and asymmetry flags (is_contrarian_warning, is_stealth).",
            "parameters": {
                "type": "object",
                "properties": {
                    "sort": {
                        "type": "string",
                        "enum": ["mentions", "rank_change", "spike"],
                        "default": "mentions",
                    },
                    "limit": {"type": "integer", "default": 15},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_watchlist",
            "description": "Current top-sector x top-name watchlist with Portfolio Manager rationale per ticker. Use when the user asks 'what should I look at' or 'top picks today'.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_scorecard",
            "description": "Per-agent track record: hit rate, IC (signed-confidence vs forward-return), avg forward return at the chosen horizon. Use when the user asks which personas are good/bad lately.",
            "parameters": {
                "type": "object",
                "properties": {
                    "horizon": {"type": "integer", "enum": [5, 10, 20, 60], "default": 20},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_stocks_screener",
            "description": "Ranked options-trade candidate list across the universe. Pre-filtered by combined flow + sentiment + technical + macro score. Use when the user wants 'best options ideas' or 'screen the universe'.",
            "parameters": {
                "type": "object",
                "properties": {
                    "direction": {"type": "string", "enum": ["bull", "bear"], "description": "Optional side filter."},
                    "limit": {"type": "integer", "default": 15},
                },
            },
        },
    },
]


# ---------- tool implementations ----------


async def _tool_get_rankings(args: dict[str, Any]) -> dict[str, Any]:
    """Rank the 11 sector SPDRs by their realized N-day return ending today.

    Was previously XGB-prediction-driven; switched to honest return-momentum
    after a 90-day audit confirmed the predictions table had a single stale
    run with no decision value.
    """
    horizon = int(args.get("horizon", 1))
    if horizon not in (1, 5, 10, 20):
        return {"error": f"horizon must be 1, 5, 10, or 20 (got {horizon})"}
    from cfp_shared import SECTORS

    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            WITH ranked AS (
                SELECT symbol, ts::date AS d, close,
                       ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY ts DESC) AS day_rank
                FROM prices_daily
                WHERE symbol = ANY($1::text[]) AND close IS NOT NULL
            )
            SELECT a.symbol, a.close AS c_now, b.close AS c_back, a.d AS as_of
            FROM ranked a
            LEFT JOIN ranked b ON b.symbol = a.symbol AND b.day_rank = $2 + 1
            WHERE a.day_rank = 1
            """,
            list(SECTORS), horizon,
        )
    entries = []
    as_of = None
    for r in rows:
        as_of = r["as_of"]
        c_now = float(r["c_now"]) if r["c_now"] is not None else None
        c_back = float(r["c_back"]) if r["c_back"] is not None else None
        if c_now is None or c_back is None or c_back <= 0:
            continue
        entries.append({"symbol": r["symbol"], "return": (c_now / c_back) - 1.0})
    entries.sort(key=lambda x: -x["return"])
    return {
        "horizon_d": horizon,
        "as_of": as_of.isoformat() if as_of else None,
        "rankings": [
            {"rank": i + 1, "symbol": e["symbol"], "return_pct": round(e["return"] * 100, 3)}
            for i, e in enumerate(entries)
        ],
    }


async def _tool_get_sectors_heatmap(_args: dict[str, Any]) -> dict[str, Any]:
    """Sector tile data: last close + 1d/5d/20d return per ETF, ranked by 1d return.

    Was previously joined to XGB predictions; switched to pure-return ranking
    after the predictions table proved to be a single-run artifact.
    """
    from cfp_shared import SECTORS

    pool = get_pool()
    async with pool.acquire() as conn:
        # Walk back 30 calendar days per symbol so we have closes at offsets
        # 0 / 1 / 5 / 20 even when those fall on weekends/holidays.
        rows = await conn.fetch(
            """
            WITH ranked AS (
                SELECT symbol, ts::date AS d, close,
                       ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY ts DESC) AS day_rank
                FROM prices_daily
                WHERE symbol = ANY($1::text[]) AND close IS NOT NULL
            )
            SELECT
                r0.symbol,
                r0.close   AS c0,
                r1.close   AS c1,
                r5.close   AS c5,
                r20.close  AS c20,
                r0.d       AS as_of
            FROM ranked r0
            LEFT JOIN ranked r1  ON r1.symbol  = r0.symbol AND r1.day_rank  = 2
            LEFT JOIN ranked r5  ON r5.symbol  = r0.symbol AND r5.day_rank  = 6
            LEFT JOIN ranked r20 ON r20.symbol = r0.symbol AND r20.day_rank = 21
            WHERE r0.day_rank = 1
            """,
            list(SECTORS),
        )

    def _ret(now: Any, back: Any) -> float | None:
        if now is None or back is None or float(back) <= 0:
            return None
        return float(now) / float(back) - 1.0

    enriched = []
    for r in rows:
        ret1 = _ret(r["c0"], r["c1"])
        enriched.append({
            "symbol": r["symbol"],
            "last_close": float(r["c0"]) if r["c0"] is not None else None,
            "return_1d": ret1,
            "return_5d": _ret(r["c0"], r["c5"]),
            "return_20d": _ret(r["c0"], r["c20"]),
            "_sort": ret1 if ret1 is not None else -1e9,
        })
    enriched.sort(key=lambda x: -x["_sort"])
    return {
        "sectors": [
            {
                "rank": i + 1,
                "symbol": e["symbol"],
                "last_close": e["last_close"],
                "return_1d_pct": round(e["return_1d"] * 100, 3) if e["return_1d"] is not None else None,
                "return_5d_pct": round(e["return_5d"] * 100, 3) if e["return_5d"] is not None else None,
                "return_20d_pct": round(e["return_20d"] * 100, 3) if e["return_20d"] is not None else None,
            }
            for i, e in enumerate(enriched)
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


async def _tool_get_whale_bets(args: dict[str, Any]) -> dict[str, Any]:
    window_hours = int(args.get("window_hours", 4))
    if window_hours not in (4, 24):
        window_hours = 4
    direction = args.get("direction")
    min_score = float(args.get("min_score", 50))
    limit = max(1, min(50, int(args.get("limit", 12))))
    pool = get_pool()
    sql = """
        WITH latest AS (
            SELECT MAX(window_end) AS we
            FROM whale_conviction_signals
            WHERE window_hours = $1
              AND window_end >= NOW() - INTERVAL '6 hours'
        )
        SELECT
            ticker, direction, score,
            call_premium, put_premium, ask_side_premium,
            sweep_count, block_count, opening_share, vol_oi_max,
            dark_pool_above_mid_prem, insider_buy_7d, congress_buy_14d,
            iv_rank, against_tape, reasons
        FROM whale_conviction_signals, latest
        WHERE window_hours = $1
          AND window_end = latest.we
          AND score >= $2
          AND ($3::text IS NULL OR direction = $3)
        ORDER BY score DESC
        LIMIT $4
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, window_hours, min_score, direction, limit)
    bets = []
    for r in rows:
        raw_reasons = r["reasons"]
        if isinstance(raw_reasons, str):
            try:
                raw_reasons = json.loads(raw_reasons)
            except json.JSONDecodeError:
                raw_reasons = []
        bets.append(
            {
                "ticker": r["ticker"],
                "direction": r["direction"],
                "score": float(r["score"]),
                "call_premium": float(r["call_premium"] or 0),
                "put_premium": float(r["put_premium"] or 0),
                "ask_share": (
                    float(r["ask_side_premium"]) / float(r["call_premium"] if r["direction"] == "bull" else r["put_premium"])
                    if r["ask_side_premium"] and (r["call_premium"] or r["put_premium"])
                    else None
                ),
                "iv_rank": float(r["iv_rank"]) if r["iv_rank"] is not None else None,
                "against_tape": r["against_tape"],
                "reasons": list(raw_reasons or []),
            }
        )
    return {"window_hours": window_hours, "count": len(bets), "bets": bets}


async def _tool_get_flow_events(args: dict[str, Any]) -> dict[str, Any]:
    """Proxy to the flow.unusual endpoint shape, but returning a trimmed dict."""
    from cfp_api.routes.flow import get_unusual_flow

    lookback = int(args.get("lookback_hours", 24))
    ticker = (args.get("ticker") or "").upper().strip() or None
    kind = args.get("kind") or None
    min_premium = float(args.get("min_premium", 250_000))
    limit = max(1, min(50, int(args.get("limit", 25))))
    resp = await get_unusual_flow(
        lookback_hours=lookback,
        ticker=ticker,
        kind=kind,  # type: ignore[arg-type]
        min_premium=min_premium,
        limit=limit,
    )
    return {
        "as_of": resp.as_of,
        "lookback_hours": resp.lookback_hours,
        "count_by_kind": resp.count_by_kind,
        "events": [
            {
                "ticker": e.ticker,
                "kind": e.kind,
                "headline": e.headline,
                "premium": e.premium,
                "severity": round(e.severity, 2),
                "ts": e.ts,
            }
            for e in resp.events
        ],
    }


async def _tool_get_sector_holdings(args: dict[str, Any]) -> dict[str, Any]:
    etf = (args.get("etf") or "").upper().strip()
    if not etf:
        return {"error": "etf is required"}
    sort_key = (args.get("sort") or "weight").strip()
    if sort_key not in {"return_1d", "return_5d", "return_20d", "return_60d", "weight", "call_put_ratio", "bullish_pct"}:
        sort_key = "weight"
    limit = max(1, min(50, int(args.get("limit", 25))))
    from cfp_api.routes.sectors import get_etf_holdings

    try:
        resp = await get_etf_holdings(etf=etf, sort=sort_key, direction="desc", limit=limit)  # type: ignore[arg-type]
    except Exception as e:
        return {"error": f"holdings lookup failed: {type(e).__name__}: {e}"}
    return {
        "etf": etf,
        "sort": sort_key,
        "holdings": [
            {
                "ticker": h.ticker,
                "weight": h.weight,
                "return_5d": h.return_5d,
                "return_20d": h.return_20d,
                "call_put_ratio": h.call_put_ratio,
                "bullish_pct": h.bullish_pct,
            }
            for h in resp.holdings[:limit]
        ],
    }


async def _tool_get_reddit_mentions(args: dict[str, Any]) -> dict[str, Any]:
    sort_key = (args.get("sort") or "mentions").strip()
    if sort_key not in {"mentions", "rank_change", "spike"}:
        sort_key = "mentions"
    limit = max(1, min(50, int(args.get("limit", 15))))
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            WITH latest AS (
                SELECT MAX(snapshot_date) AS d FROM reddit_mentions
            )
            SELECT ticker, mentions, mentions_24h_ago, rank, rank_24h_ago, name
            FROM reddit_mentions, latest
            WHERE snapshot_date = latest.d
              AND subreddit = 'all-stocks'
            ORDER BY CASE
                WHEN $1 = 'mentions' THEN -mentions
                WHEN $1 = 'rank_change' THEN COALESCE(rank, 999) - COALESCE(rank_24h_ago, 999)
                WHEN $1 = 'spike' THEN -(mentions::float / NULLIF(mentions_24h_ago, 0))
                ELSE -mentions
            END
            LIMIT $2
            """,
            sort_key,
            limit,
        )
    return {
        "sort": sort_key,
        "mentions": [
            {
                "ticker": r["ticker"],
                "name": r["name"],
                "mentions_today": int(r["mentions"] or 0),
                "mentions_24h_ago": int(r["mentions_24h_ago"] or 0),
                "rank_today": r["rank"],
                "rank_24h_ago": r["rank_24h_ago"],
                "rank_delta": (
                    (r["rank_24h_ago"] or 0) - (r["rank"] or 0)
                    if r["rank"] and r["rank_24h_ago"]
                    else None
                ),
            }
            for r in rows
        ],
    }


async def _tool_get_watchlist(_args: dict[str, Any]) -> dict[str, Any]:
    from cfp_api.routes.watchlist import get_watchlist

    try:
        resp = await get_watchlist()
    except Exception as e:
        return {"error": f"watchlist lookup failed: {type(e).__name__}: {e}"}
    return {
        "run_ts": resp.run_ts,
        "sectors": [
            {
                "sector": s.sector,
                "items": [
                    {
                        "ticker": it.ticker,
                        "rank": it.rank,
                        "final_signal": it.final_signal,
                        "final_confidence": it.final_confidence,
                        "thesis": (
                            (it.rationale or {}).get("summary")
                            if isinstance(it.rationale, dict)
                            else None
                        ),
                    }
                    for it in s.items
                ],
            }
            for s in resp.sectors
        ],
    }


async def _tool_get_scorecard(args: dict[str, Any]) -> dict[str, Any]:
    horizon = int(args.get("horizon", 20))
    if horizon not in (5, 10, 20, 60):
        horizon = 20
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT agent,
                   COUNT(*) AS n,
                   AVG(CASE WHEN hit THEN 1.0 ELSE 0.0 END) AS hit_rate,
                   AVG(forward_return) AS avg_fwd,
                   CORR(signed_confidence, forward_return) AS ic
            FROM agent_eval
            WHERE horizon_d = $1 AND forward_return IS NOT NULL
            GROUP BY agent
            HAVING COUNT(*) >= 5
            ORDER BY ic DESC NULLS LAST
            LIMIT 50
            """,
            horizon,
        )
    return {
        "horizon_d": horizon,
        "agents": [
            {
                "agent": r["agent"],
                "n": int(r["n"]),
                "hit_rate": float(r["hit_rate"] or 0),
                "avg_forward_return": float(r["avg_fwd"] or 0),
                "ic": float(r["ic"] or 0) if r["ic"] is not None else None,
            }
            for r in rows
        ],
    }


async def _tool_get_stocks_screener(args: dict[str, Any]) -> dict[str, Any]:
    direction = args.get("direction") or "bull"
    limit = max(1, min(50, int(args.get("limit", 15))))
    signal = "short" if direction == "bear" else "long"
    from cfp_api.routes.stocks import screen_stocks

    try:
        resp = await screen_stocks(signal=signal, min_confidence=0.5, sector=None, min_oi=0, exclude_earnings_within_days=0, limit=limit, lookback_days=30)  # type: ignore[arg-type]
    except Exception as e:
        return {"error": f"screener failed: {type(e).__name__}: {e}"}
    items = list(getattr(resp, "items", []) or [])
    return {
        "direction": direction,
        "signal": signal,
        "universe_size": getattr(resp, "universe_size", None),
        "candidates": [
            {
                "ticker": it.ticker,
                "sector": it.sector,
                "final_signal": it.final_signal,
                "confidence": it.confidence,
                "composite_score": it.composite_score,
                "iv_rank": it.iv_rank,
                "days_to_earnings": it.days_to_earnings,
                "rationale": (it.rationale or "")[:300] if it.rationale else None,
            }
            for it in items[:limit]
        ],
    }


_TOOL_IMPLS: dict[str, Any] = {
    "get_rankings": _tool_get_rankings,
    "get_sectors_heatmap": _tool_get_sectors_heatmap,
    "get_agents_for_ticker": _tool_get_agents_for_ticker,
    "get_catalysts": _tool_get_catalysts,
    "run_ensemble": _tool_run_ensemble,
    "navigate": _tool_navigate,
    "get_whale_bets": _tool_get_whale_bets,
    "get_flow_events": _tool_get_flow_events,
    "get_sector_holdings": _tool_get_sector_holdings,
    "get_reddit_mentions": _tool_get_reddit_mentions,
    "get_watchlist": _tool_get_watchlist,
    "get_scorecard": _tool_get_scorecard,
    "get_stocks_screener": _tool_get_stocks_screener,
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


async def _run_assistant_loop(messages: list[ChatTurn], context: PageContext | None = None):
    """Stream the assistant turn — alternates LLM token-streams and tool calls
    until the model stops requesting tools or hits the cap."""

    model = "moonshot-v1-32k"
    history: list[dict[str, Any]] = [{"role": "system", "content": _SYSTEM_PROMPT}]
    ctx_msg = _format_page_context(context)
    if ctx_msg:
        history.append({"role": "system", "content": ctx_msg})
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
        _run_assistant_loop(req.messages, req.context),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
