"""Headed-browser login helper for wellfound.com (job search).

Wellfound (formerly AngelList Talent) has its own auth stack — not Clerk — and,
like most job boards, restricts automated access in its ToS. So we do the
lowest-risk thing: drive a real Chromium window via Playwright, let the *human*
sign in manually (email/OAuth, captcha, 2FA all in the browser), then snapshot
the resulting session so later runs can reuse it without logging in again.

Unlike the skylit flow (which cherry-picks three named Clerk cookies), we don't
guess Wellfound's cookie names. We use Playwright's built-in storage_state(),
which captures *all* cookies + localStorage in one provider-agnostic blob:

  1. Open https://wellfound.com/login
  2. User signs in fully in the window (any method), then presses Enter in the
     terminal to signal "I'm in"
  3. We snapshot context.storage_state() to a JSON file
  4. Later runs load it via new_context(storage_state=<file>) to resume the
     session headless

Sessions expire faster than a Clerk __client JWT, so expect to re-run this
periodically. Keep usage human-paced and low-volume — reusing a captured
session to scrape or bulk-apply risks account suspension under Wellfound's ToS.

Run:
    cfp-jobs wellfound-login
    cfp-jobs wellfound-login --state-file /path/to/wellfound_state.json
"""

from __future__ import annotations

import logging
import time
from pathlib import Path

log = logging.getLogger(__name__)

DEFAULT_STATE_FILE = Path.home() / ".cfp-jobs" / "wellfound_state.json"
WELLFOUND_LOGIN_URL = "https://wellfound.com/login"
WELLFOUND_DOMAIN = "wellfound.com"
LOGIN_TIMEOUT_S = 300  # 5 min for the user to complete sign-in
POLL_INTERVAL_S = 1.0
# Once the "looks logged in" condition first holds, require it to stay true for
# this long before saving — avoids snapshotting mid-redirect, half-authenticated
# state right after an OAuth bounce.
STABILITY_S = 4.0


def _ensure_playwright() -> None:
    try:
        import playwright.sync_api  # noqa: F401
    except ImportError as e:
        raise RuntimeError(
            "Playwright is not installed. Run:\n"
            "    uv add --dev playwright --package cfp-jobs\n"
            "    uv run playwright install chromium"
        ) from e


def _wf_cookie_names(context) -> set[str]:
    """Current set of cookie names scoped to wellfound.com."""
    return {
        c.get("name")
        for c in context.cookies()
        if WELLFOUND_DOMAIN in (c.get("domain") or "") and c.get("name")
    }


def capture_session(
    state_path: Path, timeout_s: int = LOGIN_TIMEOUT_S
) -> dict[str, int]:
    """Open Chromium, auto-detect when the user has signed in, save storage state.

    No terminal interaction: the user just signs in in the browser window and we
    poll for the logged-in signal, so this can be launched non-interactively
    (e.g. from a background process). "Logged in" = the page has left the
    login/session URLs AND at least one new wellfound.com cookie has appeared
    since page load, held stable for STABILITY_S. Returns counts for reporting.
    Raises RuntimeError on timeout with no sign-in detected.
    """
    _ensure_playwright()
    from playwright.sync_api import sync_playwright

    state_path.parent.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=False)
        context = browser.new_context()
        page = context.new_page()
        log.info("Opening %s — sign in in the browser window.", WELLFOUND_LOGIN_URL)
        page.goto(WELLFOUND_LOGIN_URL)

        baseline = _wf_cookie_names(context)
        deadline = time.monotonic() + timeout_s
        stable_since: float | None = None
        last_log = 0.0

        while time.monotonic() < deadline:
            url = (page.url or "").lower()
            off_auth_pages = "/login" not in url and "/session" not in url
            new_cookies = _wf_cookie_names(context) - baseline
            looks_logged_in = off_auth_pages and bool(new_cookies)

            if looks_logged_in:
                if stable_since is None:
                    stable_since = time.monotonic()
                elif time.monotonic() - stable_since >= STABILITY_S:
                    break  # held stable long enough — treat as authenticated
            else:
                stable_since = None  # reset if we bounce back to a login page

            now = time.monotonic()
            if now - last_log > 15.0:
                log.info("Waiting for sign-in (url=%s, new_cookies=%d)",
                         url[:80], len(new_cookies))
                last_log = now
            time.sleep(POLL_INTERVAL_S)
        else:
            browser.close()
            raise RuntimeError(
                f"Timed out after {timeout_s}s with no sign-in detected. "
                "Did you complete login in the browser window?"
            )

        cookies = context.cookies()
        wf_cookies = [c for c in cookies if WELLFOUND_DOMAIN in (c.get("domain") or "")]
        context.storage_state(path=str(state_path))
        browser.close()

    log.info("Saved session state to %s", state_path)
    return {"cookies": len(cookies), "wellfound_cookies": len(wf_cookies)}


def new_logged_in_context(browser, state_path: Path = DEFAULT_STATE_FILE):
    """Build a Playwright context that reuses a previously captured session.

    Usage:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            ctx = new_logged_in_context(browser)
            page = ctx.new_page()
            page.goto("https://wellfound.com/jobs")

    Raises FileNotFoundError if the state file is missing (run wellfound-login
    first).
    """
    if not state_path.exists():
        raise FileNotFoundError(
            f"No saved session at {state_path}. Run `cfp-jobs wellfound-login` first."
        )
    return browser.new_context(storage_state=str(state_path))
