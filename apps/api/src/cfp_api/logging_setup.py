"""Structured JSON logging.

Stdlib-only — emits one JSON object per line so Railway/Grafana can index by
field. Includes a per-request middleware that adds ``request_id`` and timing.
"""

from __future__ import annotations

import json
import logging
import sys
import time
import uuid
from typing import Any

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        # Anything passed via extra={"k": v} is attached to the record dict.
        for k, v in record.__dict__.items():
            if k in payload or k.startswith("_"):
                continue
            if k in {
                "args", "msg", "levelname", "levelno", "pathname", "filename",
                "module", "exc_info", "exc_text", "stack_info", "lineno",
                "funcName", "created", "msecs", "relativeCreated", "thread",
                "threadName", "processName", "process", "name", "message",
                "asctime", "taskName",
            }:
                continue
            try:
                json.dumps(v)
                payload[k] = v
            except (TypeError, ValueError):
                payload[k] = repr(v)
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def configure_logging(level: str = "INFO") -> None:
    root = logging.getLogger()
    # Avoid double-handlers if uvicorn already configured one.
    for h in list(root.handlers):
        root.removeHandler(h)
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root.addHandler(handler)
    root.setLevel(level.upper())
    # Quiet a few noisy loggers.
    for name in ("uvicorn.access", "asyncio"):
        logging.getLogger(name).setLevel(logging.WARNING)


class RequestContextMiddleware(BaseHTTPMiddleware):
    """Attach a request_id to logs + emit one access log line per request."""

    async def dispatch(self, request: Request, call_next):  # type: ignore[override]
        rid = request.headers.get("X-Request-ID") or uuid.uuid4().hex[:12]
        start = time.perf_counter()
        request.state.request_id = rid
        response: Response | None = None
        status = 500
        try:
            response = await call_next(request)
            status = response.status_code
            return response
        finally:
            elapsed_ms = (time.perf_counter() - start) * 1000.0
            logging.getLogger("cfp_api.access").info(
                "request",
                extra={
                    "request_id": rid,
                    "method": request.method,
                    "path": request.url.path,
                    "query": request.url.query,
                    "status": status,
                    "duration_ms": round(elapsed_ms, 2),
                },
            )
            if response is not None:
                response.headers["X-Request-ID"] = rid
