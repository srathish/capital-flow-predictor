"""Capture README screenshots of every Bellwether tab via Playwright.

Assumes the API is on http://localhost:8000 and the web app on http://localhost:3000.
Writes PNGs into docs/screenshots/.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

from playwright.async_api import async_playwright

OUT = Path(__file__).resolve().parent.parent / "docs" / "screenshots"
OUT.mkdir(parents=True, exist_ok=True)

BASE = "http://localhost:3000"


async def first_ticker(page) -> str | None:
    """Find a ticker link on the homepage so we can deep-link into the agents page."""
    try:
        await page.wait_for_selector("a[href^='/sectors/']", timeout=8000)
    except Exception:
        return None
    # Grab the first sector and pick a holding inside it.
    href = await page.eval_on_selector("a[href^='/sectors/']", "a => a.getAttribute('href')")
    if not href:
        return None
    await page.goto(BASE + href, wait_until="networkidle")
    try:
        await page.wait_for_selector("a[href^='/agents/']", timeout=8000)
        ticker_href = await page.eval_on_selector(
            "a[href^='/agents/']", "a => a.getAttribute('href')"
        )
        if ticker_href:
            # /agents/AAPL or similar
            return ticker_href.split("/")[-1]
    except Exception:
        pass
    return None


async def shoot(page, url: str, name: str, full_page: bool = True, settle_ms: int = 1500):
    print(f"→ {name:30s}  {url}")
    await page.goto(url, wait_until="networkidle")
    await page.wait_for_timeout(settle_ms)
    out = OUT / f"{name}.png"
    await page.screenshot(path=str(out), full_page=full_page)
    print(f"   saved {out.relative_to(OUT.parent.parent)}")


async def main() -> int:
    async with async_playwright() as pw:
        browser = await pw.chromium.launch()
        context = await browser.new_context(
            viewport={"width": 1440, "height": 900},
            device_scale_factor=2,
        )
        page = await context.new_page()

        # 1. Home / Sectors (heatmap view by default).
        await shoot(page, f"{BASE}/", "01-sector-heatmap")

        # 2. Sector detail (constituent holdings + laggards panel).
        await page.goto(f"{BASE}/", wait_until="networkidle")
        await page.wait_for_selector("a[href^='/sectors/']", timeout=8000)
        sector_href = await page.eval_on_selector(
            "a[href^='/sectors/']", "a => a.getAttribute('href')"
        )
        if sector_href:
            await shoot(page, BASE + sector_href, "02-sector-holdings")

        # 3. Agents ensemble view — use a ticker that has signals.
        await shoot(page, f"{BASE}/agents/NVDA", "03-agents-nvda", settle_ms=3000)

        # 4. Screener (replaces old Watchlist).
        await shoot(page, f"{BASE}/screener", "04-watchlist")

        # 5. Chatter board — reddit + catalysts + news, stacked.
        await shoot(page, f"{BASE}/reddit", "04-chatter")

        # 6. (legacy) Network view — captured by switching the Sectors pill
        #    to the network sub-view. Kept under 05-network so older
        #    snapshots in DESIGN.md don't break.
        await page.goto(f"{BASE}/", wait_until="networkidle")
        try:
            await page.get_by_role("button", name="Network").click(timeout=4000)
            await page.wait_for_timeout(2500)
            out = OUT / "05-network.png"
            await page.screenshot(path=str(out), full_page=True)
            print(f"→ 05-network                     /  (Network sub-view)")
        except Exception:
            print("   (Network sub-view not reachable, skipping)")

        # 7. Reddit chatter (same page, top-of-board crop). Keep filename
        #    so README links don't 404 if not yet swapped to 04-chatter.
        await shoot(page, f"{BASE}/reddit", "07-reddit")

        # 8. Flow — unusual options activity.
        await shoot(page, f"{BASE}/flow", "08-flow", settle_ms=2500)

        # 9. Lab — opportunity score + calibration + freshness.
        await shoot(page, f"{BASE}/lab", "09-lab", settle_ms=2500)

        # 10. Explosive — catalyst-aware Board.
        await shoot(page, f"{BASE}/explosive", "10-explosive", settle_ms=2500)

        # 11. Scanner — TradingView indicator port.
        await shoot(page, f"{BASE}/scanner", "11-scanner", settle_ms=2500)

        # 12. Discord Alerts.
        await shoot(page, f"{BASE}/discord", "12-discord", settle_ms=2500)

        await browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
