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

        while time.monotonic() < deadline:
            cookies = context.cookies()
            for c in cookies:
                # Clerk's __client cookie lives on the skylit.ai apex (or clerk.skylit.ai).
                if c.get("name") == "__client" and "skylit.ai" in (c.get("domain") or ""):
                    client_cookie = c.get("value")
                if c.get("name") == "__client_uat" and "skylit.ai" in (c.get("domain") or ""):
                    client_uat = c.get("value")

            if client_cookie and SKYLIT_DASHBOARD_HOST in (page.url or ""):
                # Authenticated AND landed back on app.skylit.ai
                break
            time.sleep(POLL_INTERVAL_S)
        else:
            browser.close()
            raise RuntimeError(
                f"Timed out after {timeout_s}s waiting for sign-in. "
                "Did Discord OAuth complete and redirect back to app.skylit.ai?"
            )

        # Pull the active session id from the in-page Clerk SDK so we don't
        # have to make a second API call. Falls back to /v1/client if needed.
        session_id: str | None = None
        try:
            session_id = page.evaluate(
                "() => window.Clerk?.client?.sessions?.[0]?.id ?? null"
            )
        except Exception as e:
            log.debug("window.Clerk.client lookup failed: %s — falling back to API", e)

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
