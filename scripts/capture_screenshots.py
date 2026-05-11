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

        # 1. Home / sector heatmap.
        await shoot(page, f"{BASE}/", "01-sector-heatmap")

        # 2. Sector detail (constituent holdings).
        await page.goto(f"{BASE}/", wait_until="networkidle")
        await page.wait_for_selector("a[href^='/sectors/']", timeout=8000)
        sector_href = await page.eval_on_selector(
            "a[href^='/sectors/']", "a => a.getAttribute('href')"
        )
        if sector_href:
            await shoot(page, BASE + sector_href, "02-sector-holdings")

        # Pick a ticker from that sector page for the agents view.
        ticker = None
        try:
            await page.wait_for_selector("a[href^='/agents/']", timeout=8000)
            ticker_href = await page.eval_on_selector(
                "a[href^='/agents/']", "a => a.getAttribute('href')"
            )
            if ticker_href:
                ticker = ticker_href.rstrip("/").split("/")[-1]
        except Exception:
            pass

        # 3. Agents ensemble view — use a ticker that has signals.
        await shoot(page, f"{BASE}/agents/NVDA", "03-agents-nvda", settle_ms=3000)

        # 4. Watchlist.
        await shoot(page, f"{BASE}/watchlist", "04-watchlist")

        # 5. Network (correlation).
        await shoot(page, f"{BASE}/network", "05-network", settle_ms=3000)

        # 6. Catalysts.
        await shoot(page, f"{BASE}/catalysts", "06-catalysts")

        # 7. Reddit chatter.
        await shoot(page, f"{BASE}/reddit", "07-reddit")

        # 8. Flow — unusual options activity.
        await shoot(page, f"{BASE}/flow", "08-flow", settle_ms=2500)

        await browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
