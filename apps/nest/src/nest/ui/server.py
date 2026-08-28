"""Live server — serves the field page and /api/state, and runs the market-clock
scheduler in a background thread so a single Railway service is both the daemon and its
window. Railway gives it a public URL; the page polls /api/state every few seconds.
"""

from __future__ import annotations

import logging
import os
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import HTMLResponse, JSONResponse

from nest.events.log import EventLog
from nest.ui.page import render_page
from nest.ui.pipeline import render_pipeline
from nest.ui.state import build_pipeline, build_state

log = logging.getLogger(__name__)
_scheduler_started = False


def _start_scheduler_once() -> None:
    global _scheduler_started
    if _scheduler_started:
        return
    _scheduler_started = True
    from nest import daemon

    t = threading.Thread(target=daemon.run, name="nest-scheduler", daemon=True)
    t.start()
    log.info("scheduler thread started")


@asynccontextmanager
async def _lifespan(app: FastAPI):
    # NEST_NO_SCHEDULER lets the page be served without the live loop (e.g. local preview).
    if not os.environ.get("NEST_NO_SCHEDULER"):
        _start_scheduler_once()
    yield


app = FastAPI(title="Conviction Nest", lifespan=_lifespan)


@app.get("/", response_class=HTMLResponse)
def index() -> str:
    log_db = EventLog()
    try:
        return render_pipeline(build_pipeline(log_db), poll_url="/api/pipeline")
    finally:
        log_db.close()


@app.get("/field", response_class=HTMLResponse)
def field() -> str:
    log_db = EventLog()
    try:
        return render_page(build_state(log_db), poll_url="/api/state")
    finally:
        log_db.close()


@app.get("/api/state")
def state() -> JSONResponse:
    log_db = EventLog()
    try:
        return JSONResponse(build_state(log_db))
    finally:
        log_db.close()


@app.get("/api/pipeline")
def pipeline() -> JSONResponse:
    log_db = EventLog()
    try:
        return JSONResponse(build_pipeline(log_db))
    finally:
        log_db.close()


@app.get("/healthz")
def healthz() -> dict:
    return {"ok": True}


def serve(port: int | None = None) -> None:
    import uvicorn

    port = port or int(os.environ.get("PORT", 8080))
    log.info("🪶 Nest serving on 0.0.0.0:%d", port)
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
