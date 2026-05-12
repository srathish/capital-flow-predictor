"""Smoke tests for the prometheus text renderer."""

from __future__ import annotations

from cfp_api.metrics import (
    auth_failures_total,
    ensemble_runs_total,
    http_request_duration_seconds,
    http_requests_total,
    rate_limit_hits_total,
    render_metrics,
)


def test_render_includes_help_and_type() -> None:
    http_requests_total.inc(method="GET", path="/v1/rankings", status="200")
    out = render_metrics()
    assert "# HELP cfp_http_requests_total" in out
    assert "# TYPE cfp_http_requests_total counter" in out
    assert 'method="GET"' in out
    assert 'path="/v1/rankings"' in out


def test_histogram_buckets_present() -> None:
    http_request_duration_seconds.observe(0.123, method="GET", path="/v1/sectors")
    out = render_metrics()
    assert "cfp_http_request_duration_seconds_bucket" in out
    assert 'le="0.25"' in out
    assert 'le="+Inf"' in out
    assert "cfp_http_request_duration_seconds_sum" in out
    assert "cfp_http_request_duration_seconds_count" in out


def test_counters_render() -> None:
    ensemble_runs_total.inc(ticker="NVDA")
    auth_failures_total.inc(reason="invalid_or_missing_key")
    rate_limit_hits_total.inc(bucket="run")
    out = render_metrics()
    assert "cfp_ensemble_runs_total" in out
    assert "cfp_auth_failures_total" in out
    assert "cfp_rate_limit_hits_total" in out
