from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.exception_handlers import http_exception_handler
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse

from cfp_api import __version__
from cfp_api.auth import require_api_key
from cfp_api.db import check_db_connection, close_pool, init_pool
from cfp_api.logging_setup import RequestContextMiddleware, configure_logging
from cfp_api.metrics import (
    MetricsMiddleware,
    auth_failures_total,
    rate_limit_hits_total,
    render_metrics,
)
from cfp_api.migrations import apply_pending_migrations
from cfp_api.routes import (
    admin_explosive,
    agents,
    assistant,
    backtest,
    backtest_lab,
    catalysts,
    chat,
    cohorts,
    confluence,
    conviction,
    delphi,
    discord,
    earnings,
    explosive,
    flow,
    gex,
    halts,
    health,
    institutional,
    intraday_gex,
    macro,
    network,
    news,
    reddit,
    replay,
    scorecard,
    sectors,
    smart_money,
    stage,
    stocks,
    talon,
    watchlist,
)
from cfp_api.settings import settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    import asyncio
    from cfp_api import discord_background, flow_background

    configure_logging(settings.log_level)
    await apply_pending_migrations(settings.database_url)
    await init_pool(settings.database_url)
    loop = asyncio.get_running_loop()
    bg_tasks = discord_background.start(loop)
    flow_bg_tasks = flow_background.start(loop)
    try:
        yield
    finally:
        await discord_background.stop(bg_tasks)
        await flow_background.stop(flow_bg_tasks)
        await close_pool()


app = FastAPI(
    title="Bellwether API",
    version=__version__,
    lifespan=lifespan,
    description=(
        "Capital Flow Predictor inference API. Auth via Authorization: Bearer "
        "<API_KEY> or X-API-Key header; rate-limited per identity. "
        "See docs/API.md for examples."
    ),
)

# Order matters: outermost middleware runs first on the request path. We want
# structured logging + metrics to wrap everything, including auth failures.
app.add_middleware(RequestContextMiddleware)
app.add_middleware(MetricsMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["*", "Authorization", "X-API-Key", "X-Request-ID"],
)


@app.exception_handler(Exception)
async def _unhandled(request: Request, exc: Exception):  # type: ignore[override]
    # The middleware already logged the access line. Re-raise structured.
    import logging as _l
    _l.getLogger("cfp_api").exception(
        "unhandled",
        extra={
            "request_id": getattr(request.state, "request_id", None),
            "path": request.url.path,
        },
    )
    return JSONResponse(status_code=500, content={"detail": "internal_server_error"})


# Auth applies to every /v1/* router. Health, root, /metrics, /healthz/db are open.
PROTECTED = [Depends(require_api_key)]

app.include_router(watchlist.router, dependencies=PROTECTED)
app.include_router(agents.router, dependencies=PROTECTED)
app.include_router(chat.router, dependencies=PROTECTED)
app.include_router(scorecard.router, dependencies=PROTECTED)
app.include_router(sectors.router, dependencies=PROTECTED)
app.include_router(cohorts.router, dependencies=PROTECTED)
app.include_router(network.router, dependencies=PROTECTED)
app.include_router(reddit.router, dependencies=PROTECTED)
app.include_router(flow.router, dependencies=PROTECTED)
app.include_router(assistant.router, dependencies=PROTECTED)
app.include_router(stocks.router, dependencies=PROTECTED)
app.include_router(backtest.router, dependencies=PROTECTED)
app.include_router(replay.router, dependencies=PROTECTED)
# STAGE Scanner — BCS/HFS detection ported from the TradingView Pine Script.
# yfinance-backed, so the only deploy-time cost is the extra dep.
app.include_router(stage.router, dependencies=PROTECTED)
# Explosive options tab: catalyst-aware unusual-options scanner.
# Reads explosive_scores written by `cfp-jobs explosive-score`.
app.include_router(explosive.router, dependencies=PROTECTED)
# Manual rescore trigger — runs score_explosive in-process, bypasses GHA cron.
app.include_router(admin_explosive.router, dependencies=PROTECTED)
app.include_router(delphi.router, dependencies=PROTECTED)
# Cross-tab confluence — lazy aggregate over Explosive + Delphi + Whale +
# Reddit + Flow. Scanner fans out to /v1/confluence/batch on each refresh.
app.include_router(confluence.router, dependencies=PROTECTED)
# gexester-vexster integration: feed mirror + skylit auth status + reauth queue.
# Mounted under PROTECTED so gexester needs the API key to write status/feed,
# and the daemon needs it to long-poll the reauth queue. Same surface as
# everything else.
app.include_router(gex.router, dependencies=PROTECTED)
# Catalyst calendar: earnings (pre/post), dividends, splits, analyst events,
# economic calendar. Feeds the /explosive scoring + per-ticker drilldown.
app.include_router(catalysts.router, dependencies=PROTECTED)
# Multi-source news aggregator (FMP + Polygon + yfinance + Yahoo/Google/SA
# RSS). Lazy: fetched on demand, cached 10 min in-process. Powers the
# chatter leaderboard composite + per-ticker evidence drawer on /reddit.
app.include_router(news.router, dependencies=PROTECTED)
# Phase C: live trading halts feed (uw_trading_halts, populated by uw_socket).
app.include_router(halts.router, dependencies=PROTECTED)
# Intraday 1-min spot-GEX series per ticker (migration 0029). Complements
# the apps/gex Heatseeker monitor for non-SPY/QQQ/SPX names.
app.include_router(intraday_gex.router, dependencies=PROTECTED)
# Institutional flow & ownership rollups (migration 0030). Smart-money
# confirmation layer for the /explosive scanner; standalone screener too.
app.include_router(institutional.router, dependencies=PROTECTED)
# Talon scanner — Phase 3-validated flow gates over 504-ticker universe.
# Library lives in cfp_api.talon_scanner; reads GEX cache, produces ranked setups.
app.include_router(talon.router, dependencies=PROTECTED)
# Delphi v0.2 surface — 5 new tabs share these routes.
app.include_router(smart_money.router, dependencies=PROTECTED)
app.include_router(macro.router, dependencies=PROTECTED)
app.include_router(earnings.router, dependencies=PROTECTED)
app.include_router(conviction.router, dependencies=PROTECTED)
app.include_router(backtest_lab.router, dependencies=PROTECTED)
app.include_router(discord.router, dependencies=PROTECTED)
# SSE stream uses query-param auth (EventSource can't set headers) — it
# does its own validation against settings.api_keys_raw inside the handler.
app.include_router(discord.stream_router)
# Health stays open — used by load balancers and the FE landing page.
app.include_router(health.router)


@app.get("/")
async def root() -> dict:
    return {
        "service": "capital-flow-predictor-api",
        "version": __version__,
        "status": "ok",
    }


@app.get("/health")
async def health_basic() -> dict:
    return {"status": "ok"}


@app.get("/metrics", response_class=PlainTextResponse)
async def metrics() -> str:
    return render_metrics()


@app.get("/healthz/db")
async def healthz_db():
    ok, detail = await check_db_connection(settings.database_url)
    if not ok:
        return JSONResponse(status_code=503, content={"status": "error", "detail": detail})
    return {"status": "ok"}


# Bookkeeping: count auth failures and rate-limit rejections after dispatch.
@app.exception_handler(HTTPException)
async def _http_exc(request: Request, exc: HTTPException):  # type: ignore[override]
    if exc.status_code == 401:
        auth_failures_total.inc(reason="invalid_or_missing_key")
    elif exc.status_code == 429:
        bucket = "run" if "/run" in request.url.path or "/chat" in request.url.path else "default"
        rate_limit_hits_total.inc(bucket=bucket)
    return await http_exception_handler(request, exc)
