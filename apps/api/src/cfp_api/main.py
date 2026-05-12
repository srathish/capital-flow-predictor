from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.exception_handlers import http_exception_handler
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse

from cfp_api import __version__
from cfp_api.auth import require_api_key
from cfp_api.db import check_db_connection, close_pool, init_pool
from cfp_api.logging_setup import RequestContextMiddleware, configure_logging
from cfp_api.metrics import MetricsMiddleware, auth_failures_total, rate_limit_hits_total, render_metrics
from cfp_api.routes import (
    agents,
    assistant,
    chat,
    flow,
    health,
    network,
    rankings,
    reddit,
    scorecard,
    sectors,
    stocks,
    watchlist,
)
from cfp_api.settings import settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging(settings.log_level)
    await init_pool(settings.database_url)
    yield
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
    allow_methods=["GET", "POST", "OPTIONS"],
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

app.include_router(rankings.router, dependencies=PROTECTED)
app.include_router(watchlist.router, dependencies=PROTECTED)
app.include_router(agents.router, dependencies=PROTECTED)
app.include_router(chat.router, dependencies=PROTECTED)
app.include_router(scorecard.router, dependencies=PROTECTED)
app.include_router(sectors.router, dependencies=PROTECTED)
app.include_router(network.router, dependencies=PROTECTED)
app.include_router(reddit.router, dependencies=PROTECTED)
app.include_router(flow.router, dependencies=PROTECTED)
app.include_router(assistant.router, dependencies=PROTECTED)
app.include_router(stocks.router, dependencies=PROTECTED)
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
