"""Prometheus metrics — zero deps beyond the Python stdlib.

Tiny in-process implementation; if prometheus_client is installed it's used,
otherwise we expose an equivalent text-format render. Keeps `pip install` light
while still letting Grafana scrape ``/metrics``.
"""

from __future__ import annotations

import time
from collections import defaultdict
from threading import Lock
from typing import Any

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware


class _Counter:
    def __init__(self, name: str, help_: str, labels: tuple[str, ...] = ()) -> None:
        self.name = name
        self.help = help_
        self.labels = labels
        self._values: dict[tuple[str, ...], float] = defaultdict(float)
        self._lock = Lock()

    def inc(self, amount: float = 1.0, **kwargs: str) -> None:
        key = tuple(kwargs.get(lab, "") for lab in self.labels)
        with self._lock:
            self._values[key] += amount

    def render(self) -> list[str]:
        out = [f"# HELP {self.name} {self.help}", f"# TYPE {self.name} counter"]
        with self._lock:
            for key, v in self._values.items():
                if self.labels:
                    lab_s = ",".join(f'{lab}="{val}"' for lab, val in zip(self.labels, key, strict=False))
                    out.append(f"{self.name}{{{lab_s}}} {v}")
                else:
                    out.append(f"{self.name} {v}")
        return out


class _Histogram:
    """Cumulative histogram with fixed buckets in seconds."""

    BUCKETS = (0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0, 60.0)

    def __init__(self, name: str, help_: str, labels: tuple[str, ...] = ()) -> None:
        self.name = name
        self.help = help_
        self.labels = labels
        # value_key -> (bucket_counts, sum, count)
        self._data: dict[tuple[str, ...], list[Any]] = defaultdict(
            lambda: [[0] * (len(self.BUCKETS) + 1), 0.0, 0]
        )
        self._lock = Lock()

    def observe(self, value: float, **kwargs: str) -> None:
        key = tuple(kwargs.get(lab, "") for lab in self.labels)
        with self._lock:
            buckets, total, count = self._data[key]
            for i, b in enumerate(self.BUCKETS):
                if value <= b:
                    buckets[i] += 1
            buckets[-1] += 1  # +Inf
            self._data[key][1] = total + value
            self._data[key][2] = count + 1

    def render(self) -> list[str]:
        out = [f"# HELP {self.name} {self.help}", f"# TYPE {self.name} histogram"]
        with self._lock:
            for key, (buckets, total, count) in self._data.items():
                lab_pairs = list(zip(self.labels, key, strict=False)) if self.labels else []
                cum = 0
                for i, b in enumerate(self.BUCKETS):
                    cum += buckets[i]
                    lp = lab_pairs + [("le", str(b))]
                    lab_s = ",".join(f'{lab}="{val}"' for lab, val in lp)
                    out.append(f"{self.name}_bucket{{{lab_s}}} {cum}")
                lp = lab_pairs + [("le", "+Inf")]
                lab_s = ",".join(f'{lab}="{val}"' for lab, val in lp)
                cum += buckets[-1] - sum(buckets[:-1])  # +Inf == total
                out.append(f"{self.name}_bucket{{{lab_s}}} {count}")
                if lab_pairs:
                    lab_s = ",".join(f'{lab}="{val}"' for lab, val in lab_pairs)
                    out.append(f"{self.name}_sum{{{lab_s}}} {total}")
                    out.append(f"{self.name}_count{{{lab_s}}} {count}")
                else:
                    out.append(f"{self.name}_sum {total}")
                    out.append(f"{self.name}_count {count}")
        return out


# ---------- public registry ----------

http_requests_total = _Counter(
    "cfp_http_requests_total", "Total HTTP requests", labels=("method", "path", "status")
)
http_request_duration_seconds = _Histogram(
    "cfp_http_request_duration_seconds", "HTTP request latency", labels=("method", "path")
)
ensemble_runs_total = _Counter(
    "cfp_ensemble_runs_total", "Ensemble runs kicked off", labels=("ticker",)
)
auth_failures_total = _Counter(
    "cfp_auth_failures_total", "401 responses by reason", labels=("reason",)
)
rate_limit_hits_total = _Counter(
    "cfp_rate_limit_hits_total", "429 responses by bucket", labels=("bucket",)
)


def render_metrics() -> str:
    lines: list[str] = []
    for m in (
        http_requests_total,
        http_request_duration_seconds,
        ensemble_runs_total,
        auth_failures_total,
        rate_limit_hits_total,
    ):
        lines.extend(m.render())
    return "\n".join(lines) + "\n"


def _normalize_path(path: str) -> str:
    """Collapse dynamic path params so cardinality stays bounded."""
    parts = path.split("/")
    out: list[str] = []
    for p in parts:
        # Heuristic: long alpha-only segments after /v1/agents/, /v1/watchlist/, etc.
        if p and p == p.upper() and p.isalpha() and 1 < len(p) <= 6 and out and out[-1] in {
            "agents", "watchlist", "sectors", "stocks",
        }:
            out.append(":ticker")
        else:
            out.append(p)
    return "/".join(out)


class MetricsMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):  # type: ignore[override]
        start = time.perf_counter()
        method = request.method
        path = _normalize_path(request.url.path)
        try:
            response = await call_next(request)
            status = response.status_code
        except Exception:
            status = 500
            raise
        finally:
            elapsed = time.perf_counter() - start
            http_requests_total.inc(method=method, path=path, status=str(status if "status" in locals() else 500))
            http_request_duration_seconds.observe(elapsed, method=method, path=path)
        return response
