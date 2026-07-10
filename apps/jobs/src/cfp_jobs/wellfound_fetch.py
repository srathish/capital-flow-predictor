"""Fetch Wellfound job-search results using a saved session, dump to disk.

Companion to wellfound_login.py. Given a captured session, this loads each
configured search page *logged in*, scrolls to trigger lazy-loading, and writes
three artifacts per search into a run directory:

  - <slug>.next.json   -- embedded __NEXT_DATA__ / Apollo state if present
                          (Wellfound is a Next/React app; this is the structured
                          goldmine when available)
  - <slug>.html        -- full rendered HTML (fallback for parsing)
  - <slug>.txt         -- visible innerText (human/LLM-readable fallback)

plus a manifest.json describing the run.

Design note: we deliberately do NOT try to parse job fields with brittle CSS
selectors here. Wellfound's markup is undocumented and changes. The contract is
narrow and durable: "get the logged-in search content onto disk." Parsing +
ranking against a resume happens downstream (by a human or an LLM reading these
files), where a layout change is a re-read, not a code break.

ToS caution: Wellfound restricts automated access. Keep runs small, human-paced,
and limited to your own filtered searches. This is a triage aid, not a scraper.

Run:
    cfp-jobs wellfound-fetch
    cfp-jobs wellfound-fetch --min-salary 200000 --max-scroll 6 --out ~/wf-run
"""

from __future__ import annotations

import json
import logging
import re
import time
from pathlib import Path

log = logging.getLogger(__name__)

DEFAULT_OUT_DIR = Path.home() / ".cfp-jobs" / "wellfound-runs"

# Default searches: SWE + Sales/Solutions Engineer, NYC + remote. Wellfound's
# role landing pages take a keyword slug; these are stable entry points. Tune
# freely — the fetch is agnostic to what URLs you hand it.
DEFAULT_SEARCHES: list[dict[str, str]] = [
    {"slug": "swe-nyc", "url": "https://wellfound.com/role/l/software-engineer/new-york"},
    {"slug": "swe-remote", "url": "https://wellfound.com/role/r/software-engineer"},
    {"slug": "fullstack-nyc", "url": "https://wellfound.com/role/l/full-stack-engineer/new-york"},
    {"slug": "fullstack-remote", "url": "https://wellfound.com/role/r/full-stack-engineer"},
    {"slug": "sales-engineer-nyc", "url": "https://wellfound.com/role/l/sales-engineer/new-york"},
    {"slug": "sales-engineer-remote", "url": "https://wellfound.com/role/r/sales-engineer"},
    {"slug": "solutions-engineer-remote", "url": "https://wellfound.com/role/r/solutions-engineer"},
]


def _ensure_playwright() -> None:
    try:
        import playwright.sync_api  # noqa: F401
    except ImportError as e:
        raise RuntimeError(
            "Playwright is not installed. Run:\n"
            "    uv add --dev playwright --package cfp-jobs\n"
            "    uv run playwright install chromium"
        ) from e


def _extract_next_data(html: str) -> dict | None:
    """Pull the __NEXT_DATA__ JSON blob out of a rendered Next.js page, if any."""
    m = re.search(
        r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>',
        html,
        re.DOTALL,
    )
    if not m:
        return None
    try:
        return json.loads(m.group(1))
    except json.JSONDecodeError:
        log.warning("Found __NEXT_DATA__ but could not parse it as JSON.")
        return None


def fetch_searches(
    state_path: Path,
    out_dir: Path,
    searches: list[dict[str, str]],
    max_scroll: int = 5,
    scroll_pause_s: float = 1.5,
    nav_timeout_ms: int = 45000,
) -> Path:
    """Load each search logged-in, scroll, and dump artifacts to a run dir.

    Returns the run directory path. Raises FileNotFoundError if the session
    file is missing.
    """
    _ensure_playwright()
    from playwright.sync_api import sync_playwright

    if not state_path.exists():
        raise FileNotFoundError(
            f"No saved session at {state_path}. Run `cfp-jobs wellfound-login` first."
        )

    out_dir.mkdir(parents=True, exist_ok=True)
    manifest: dict = {"searches": [], "state_file": str(state_path)}

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        context = browser.new_context(storage_state=str(state_path))
        context.set_default_navigation_timeout(nav_timeout_ms)
        page = context.new_page()

        for search in searches:
            slug, url = search["slug"], search["url"]
            entry: dict = {"slug": slug, "url": url, "ok": False}
            try:
                log.info("Fetching %s (%s)", slug, url)
                page.goto(url, wait_until="domcontentloaded")
                # Lazy-load: scroll to the bottom a few times so more cards render.
                for _ in range(max_scroll):
                    page.mouse.wheel(0, 20000)
                    time.sleep(scroll_pause_s)

                html = page.content()
                text = page.evaluate("() => document.body.innerText")
                next_data = _extract_next_data(html)

                (out_dir / f"{slug}.html").write_text(html, encoding="utf-8")
                (out_dir / f"{slug}.txt").write_text(text or "", encoding="utf-8")
                if next_data is not None:
                    (out_dir / f"{slug}.next.json").write_text(
                        json.dumps(next_data, indent=2), encoding="utf-8"
                    )
                    entry["has_next_data"] = True

                entry["ok"] = True
                entry["text_chars"] = len(text or "")
                # Cheap logged-out detector: search pages for signed-out users
                # tend to surface a login/signup wall.
                if text and re.search(r"\b(sign up|log in to see)\b", text, re.I):
                    entry["warning"] = "page may be showing a logged-out wall"
            except Exception as e:  # noqa: BLE001 - best-effort per search
                entry["error"] = str(e)
                log.warning("Search %s failed: %s", slug, e)

            manifest["searches"].append(entry)

        browser.close()

    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    log.info("Wrote run to %s", out_dir)
    return out_dir
