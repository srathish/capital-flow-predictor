"""Headed-browser login helper for skylit.ai (Heatseeker / GEX data).

skylit.ai sits behind Clerk auth with Discord OAuth as the only practical
sign-in path for this user. Discord blocks programmatic password login
(captcha + ToS), so we drive a real Chromium window via Playwright:

  1. Open https://app.skylit.ai/sign-in
  2. User clicks "Sign in with Discord", solves any captcha/2FA themselves
  3. Discord redirects back to skylit.ai; Clerk drops the __client cookie
  4. We poll cookies until the __client appears, then read the active
     session id from window.Clerk.client.sessions[0].id
  5. Write CLERK_SESSION_ID, CLERK_CLIENT_COOKIE, CLERK_CLIENT_UAT into a
     target .env file (default: ../gexester vexster/.env)

After this, the gexester-vexster Clerk auto-refresh path keeps the JWT
fresh for months without touching the cookie again.

Run:
    cfp-jobs skylit-login
    cfp-jobs skylit-login --env-file /path/to/.env
"""

from __future__ import annotations

import logging
import re
import time
from pathlib import Path

log = logging.getLogger(__name__)

DEFAULT_ENV_FILE = Path.home() / "gexester vexster" / ".env"
SKYLIT_SIGNIN_URL = "https://app.skylit.ai/sign-in"
SKYLIT_DASHBOARD_HOST = "app.skylit.ai"
LOGIN_TIMEOUT_S = 300  # 5 min for user to complete Discord OAuth
POLL_INTERVAL_S = 1.0
# After landing back on the dashboard, Clerk's SDK needs a beat to hydrate
# (load session state, populate window.Clerk.client.sessions[]). The previous
# code polled once and bailed; we now keep polling for up to this many seconds
# for a real session id before giving up. 15s is comfortable headroom for a
# normally-loading page.
SESSION_HYDRATION_WAIT_S = 15.0
SESSION_HYDRATION_TICK_S = 0.5

# Path fragments that mean "still on the auth flow, not authenticated yet."
# We refuse to break the wait-loop while the page URL contains any of these,
# because Clerk drops a pre-auth __client cookie just from loading /sign-in
# and that cookie alone is NOT proof the user is signed in.
_AUTH_PATH_FRAGMENTS = ("/sign-in", "/sign-up", "/factor-", "/sso-callback", "/verify")


def _ensure_playwright() -> None:
    try:
        import playwright.sync_api  # noqa: F401
    except ImportError as e:
        raise RuntimeError(
            "Playwright is not installed. Run:\n"
            "    uv add --dev playwright --package cfp-jobs\n"
            "    uv run playwright install chromium"
        ) from e


def capture_clerk_cookies(timeout_s: int = LOGIN_TIMEOUT_S) -> dict[str, str]:
    """Open Chromium, wait for user to sign in, return Clerk cookies + session id.

    Returns a dict with keys: client_cookie, client_uat, session_id.
    Raises RuntimeError on timeout or if the post-login session is missing.
    """
    _ensure_playwright()
    from playwright.sync_api import sync_playwright

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=False)
        context = browser.new_context()
        page = context.new_page()
        log.info("Opening %s — sign in with Discord in the browser window.", SKYLIT_SIGNIN_URL)
        page.goto(SKYLIT_SIGNIN_URL)

        deadline = time.monotonic() + timeout_s
        client_cookie: str | None = None
        client_uat: str | None = None
        session_id: str | None = None

        # Wait for the user to actually sign in. The previous bug here:
        # Clerk drops an anonymous __client cookie just from loading /sign-in,
        # and the page URL contains "app.skylit.ai" from the moment the page
        # opens. So the old break condition fired in ~1 second, before the
        # user could click anything, and the daemon closed the browser before
        # any real session existed.
        #
        # Real signal that authentication completed: the page URL has moved
        # OFF the auth flow (no /sign-in, /sso-callback, etc.) AND Clerk's
        # in-page SDK reports at least one session with an id. Once we see
        # that, the cookie is the authenticated one and we can capture it.
        while time.monotonic() < deadline:
            url = page.url or ""
            on_auth_path = any(frag in url for frag in _AUTH_PATH_FRAGMENTS)
            on_host = SKYLIT_DASHBOARD_HOST in url

            if on_host and not on_auth_path:
                # Probably done with OAuth — confirm with the SDK before
                # touching cookies. Use a short eval so a stuck page doesn't
                # block the whole loop.
                try:
                    sid = page.evaluate(
                        "() => (window.Clerk?.client?.sessions || [])"
                        ".map(s => s && s.id).filter(Boolean)[0] || null"
                    )
                except Exception as e:
                    log.debug("Clerk SDK eval failed (page may be navigating): %s", e)
                    sid = None
                if sid:
                    session_id = sid
                    # Now grab the cookies — but only now, because earlier
                    # __client values may be pre-auth.
                    for c in context.cookies():
                        if "skylit.ai" not in (c.get("domain") or ""):
                            continue
                        if c.get("name") == "__client":
                            client_cookie = c.get("value")
                        elif c.get("name") == "__client_uat":
                            client_uat = c.get("value")
                    if client_cookie:
                        break  # done — got both session id and authenticated cookie
            time.sleep(POLL_INTERVAL_S)
        else:
            browser.close()
            raise RuntimeError(
                f"Timed out after {timeout_s}s waiting for sign-in. "
                "Did Discord OAuth complete and redirect back to app.skylit.ai? "
                "(The previous version of this code closed the browser too "
                "early — if that's what you saw, the timeout message is wrong "
                "and you should look at logs for 'Clerk SDK eval failed'.)"
            )

        # Belt-and-braces: if for some reason the SDK gave us a session id but
        # the in-page Clerk object regressed by the time we ask again (e.g.
        # navigation happened), keep polling for a few more seconds rather
        # than failing. Same goes for cookies — Clerk can rotate __client in
        # the moments right after sign-in and we'd rather grab the latest one.
        hydrate_deadline = time.monotonic() + SESSION_HYDRATION_WAIT_S
        while time.monotonic() < hydrate_deadline:
            for c in context.cookies():
                if "skylit.ai" not in (c.get("domain") or ""):
                    continue
                if c.get("name") == "__client" and c.get("value"):
                    client_cookie = c.get("value")
                elif c.get("name") == "__client_uat" and c.get("value"):
                    client_uat = c.get("value")
            try:
                sid = page.evaluate(
                    "() => (window.Clerk?.client?.sessions || [])"
                    ".map(s => s && s.id).filter(Boolean)[0] || null"
                )
                if sid:
                    session_id = sid
            except Exception:
                pass
            time.sleep(SESSION_HYDRATION_TICK_S)

        # API fallback only if the SDK never gave us anything — same shape as
        # before, just no longer the primary path.
        if not session_id:
            try:
                resp = page.request.get(
                    "https://clerk.skylit.ai/v1/client?_clerk_js_version=5.124.0",
                    headers={
                        "Origin": "https://app.skylit.ai",
                        "Referer": "https://app.skylit.ai/",
                    },
                )
                data = resp.json()
                sessions = (data.get("response") or {}).get("sessions") or data.get("sessions") or []
                if sessions:
                    session_id = sessions[0].get("id")
            except Exception as e:
                log.warning("Clerk /v1/client fallback failed: %s", e)

        browser.close()

    if not client_cookie:
        raise RuntimeError("Sign-in completed but __client cookie was never set.")
    if not session_id:
        raise RuntimeError(
            "Could not locate Clerk session id. The cookie was captured but "
            "session_id retrieval failed — open a github issue with the page state."
        )

    return {
        "client_cookie": client_cookie,
        "client_uat": client_uat or "",
        "session_id": session_id,
    }


def write_to_env_file(env_path: Path, values: dict[str, str]) -> None:
    """Update CLERK_* keys in the target .env file in-place; preserves all other lines."""
    mapping = {
        "CLERK_SESSION_ID": values["session_id"],
        "CLERK_CLIENT_COOKIE": values["client_cookie"],
        "CLERK_CLIENT_UAT": values["client_uat"],
    }

    if not env_path.exists():
        env_path.parent.mkdir(parents=True, exist_ok=True)
        env_path.write_text("")
    text = env_path.read_text()
    lines = text.splitlines()

    seen: set[str] = set()
    out: list[str] = []
    for line in lines:
        m = re.match(r"^([A-Z_][A-Z0-9_]*)=", line)
        if m and m.group(1) in mapping:
            key = m.group(1)
            out.append(f"{key}={mapping[key]}")
            seen.add(key)
        else:
            out.append(line)
    for key, val in mapping.items():
        if key not in seen:
            out.append(f"{key}={val}")
    env_path.write_text("\n".join(out) + "\n")
