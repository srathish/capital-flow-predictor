"""Long-polling daemon for UI-initiated skylit.ai re-auths.

Runs on the operator's laptop. Long-polls the Bellwether API for pending
re-auth requests, launches the existing Playwright OAuth flow when one
appears, writes the captured cookies to gexester's .env, and reports the
outcome back so the UI button shows "completed".

This is the missing piece that lets the operator click a button in the
Bellwether UI tab instead of dropping to the terminal to run skylit-login.

Why a daemon on the laptop (not on Railway):
  - Playwright needs a real desktop window for the user to click "Sign in
    with Discord" and complete OAuth. Containers on Railway have no display.
  - The cookies belong in gexester's .env on the same machine that runs
    gexester. Storing them in Postgres would mean both gexester and a
    central store would need to stay in sync — more moving parts, more
    failure modes.

Run:
    BELLWETHER_API_URL=https://... BELLWETHER_API_KEY=... \\
        uv run cfp-jobs skylit-watch

Stop with Ctrl-C. Reconnects on transient HTTP errors; exits on persistent
auth failure (operator must fix the API key).
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

log = logging.getLogger(__name__)

# Long-poll wait — matches the server-side cap. Beyond ~25s some HTTP proxies
# kill idle connections, so we re-issue rather than push higher.
_POLL_WAIT_S = 25
# Retry / backoff knobs for the outer loop when the API itself is down.
_INITIAL_BACKOFF_S = 2.0
_MAX_BACKOFF_S = 60.0


@dataclass
class WatchConfig:
    api_url: str
    api_key: str
    env_file: Path
    oauth_timeout_s: int = 300


def _http_client(cfg: WatchConfig) -> httpx.Client:
    """Long-lived sync client. We're a single-threaded daemon — async buys
    us nothing here and httpx.Client is simpler to reason about."""
    return httpx.Client(
        base_url=cfg.api_url.rstrip("/"),
        headers={"X-API-Key": cfg.api_key},
        # Wait long enough to absorb a full _POLL_WAIT_S long-poll plus
        # network latency; less than that risks tearing down a connection
        # the server is about to return on.
        timeout=httpx.Timeout(_POLL_WAIT_S + 15.0, connect=10.0),
    )


def _poll_pending(client: httpx.Client) -> dict | None:
    """GET /v1/skylit/reauth/pending?wait=N — returns the claimed row or None."""
    resp = client.get(f"/v1/skylit/reauth/pending?wait={_POLL_WAIT_S}")
    resp.raise_for_status()
    data = resp.json()
    # FastAPI returns the model as a dict; the optional-response shape means
    # null on no-pending-row, dict on claim.
    if data is None:
        return None
    return data


def _complete(client: httpx.Client, req_id: int, ok: bool, result: str) -> None:
    """POST /v1/skylit/reauth/complete/{id} with the outcome. Best-effort —
    if this fails the row stays in_progress and an operator can clean it up,
    but we should never raise out of the daemon loop just because of a
    reporting hiccup."""
    try:
        resp = client.post(
            f"/v1/skylit/reauth/complete/{req_id}",
            json={"ok": ok, "result": result[:500]},
        )
        resp.raise_for_status()
    except Exception as e:
        log.warning("skylit-watch: failed to report completion for req %s: %s", req_id, e)


def _handle_request(cfg: WatchConfig, client: httpx.Client, req: dict) -> None:
    """Run the Playwright OAuth flow for one claimed request."""
    req_id = req["id"]
    requested_by = req.get("requested_by", "?")
    log.info("skylit-watch: claimed req %s (requested_by=%s) — launching browser", req_id, requested_by)

    # Import lazily — Playwright pulls a heavy dep tree; we don't want to
    # require it just to import this module (e.g. for the CLI registration).
    from cfp_jobs import skylit_login

    try:
        creds = skylit_login.capture_clerk_cookies(timeout_s=cfg.oauth_timeout_s)
    except RuntimeError as e:
        log.error("skylit-watch: capture failed for req %s: %s", req_id, e)
        _complete(client, req_id, False, f"capture failed: {e}")
        return
    except Exception as e:  # playwright, network, anything else
        log.exception("skylit-watch: unexpected error for req %s", req_id)
        _complete(client, req_id, False, f"unexpected error: {type(e).__name__}: {e}")
        return

    try:
        skylit_login.write_to_env_file(cfg.env_file, creds)
    except Exception as e:
        log.exception("skylit-watch: cookie capture OK but env write failed for req %s", req_id)
        _complete(
            client, req_id, False,
            f"captured cookies but failed to write {cfg.env_file}: {e}",
        )
        return

    sid_short = creds["session_id"][:24]
    cookie_len = len(creds["client_cookie"])
    summary = f"captured session {sid_short}..., cookie len {cookie_len}, wrote to {cfg.env_file}"
    log.info("skylit-watch: req %s done — %s", req_id, summary)
    _complete(client, req_id, True, summary)


def run(cfg: WatchConfig) -> None:
    """Daemon main loop. Long-polls until Ctrl-C; backs off on API outages."""
    log.info(
        "skylit-watch: starting | api=%s env_file=%s oauth_timeout=%ds",
        cfg.api_url, cfg.env_file, cfg.oauth_timeout_s,
    )
    backoff = _INITIAL_BACKOFF_S

    with _http_client(cfg) as client:
        while True:
            try:
                req = _poll_pending(client)
                # Successful poll resets the backoff.
                backoff = _INITIAL_BACKOFF_S
            except httpx.HTTPStatusError as e:
                if e.response.status_code == 401:
                    # Auth misconfig — no point retrying.
                    log.error("skylit-watch: API rejected key (401). Check BELLWETHER_API_KEY.")
                    raise SystemExit(2) from e
                log.warning("skylit-watch: poll %s; backing off %.1fs", e, backoff)
                time.sleep(backoff)
                backoff = min(backoff * 2, _MAX_BACKOFF_S)
                continue
            except httpx.RequestError as e:
                log.warning("skylit-watch: poll network error %s; backing off %.1fs", e, backoff)
                time.sleep(backoff)
                backoff = min(backoff * 2, _MAX_BACKOFF_S)
                continue

            if req is None:
                # Empty long-poll — re-issue immediately. The server already
                # held the connection up to _POLL_WAIT_S, no extra sleep
                # needed here.
                continue

            _handle_request(cfg, client, req)


def cli_run(api_url: str, api_key: str, env_file: str | None, oauth_timeout: int) -> None:
    """Entrypoint called by cfp_jobs.cli — separated so the import-side of
    typer registration doesn't need to construct a WatchConfig."""
    from cfp_jobs import skylit_login

    target = Path(env_file).expanduser() if env_file else skylit_login.DEFAULT_ENV_FILE
    if not api_url:
        raise SystemExit("skylit-watch: --api-url / BELLWETHER_API_URL is required")
    if not api_key:
        raise SystemExit("skylit-watch: --api-key / BELLWETHER_API_KEY is required")

    cfg = WatchConfig(
        api_url=api_url, api_key=api_key, env_file=target, oauth_timeout_s=oauth_timeout,
    )
    run(cfg)
