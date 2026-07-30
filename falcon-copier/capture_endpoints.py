"""Capture the REAL Skylit data endpoints by watching the authenticated app's network traffic.
Blind REST probing hits catch-alls, so we load app.skylit.ai with the Clerk session cookie and record every
request the app actually makes — dark-pool, Flowseeker, SSE/WS streams, VIX. Run from apps/jobs so Playwright
is available:  cd apps/jobs && uv run python "../../falcon-copier/capture_endpoints.py"
"""
import re
from pathlib import Path
from playwright.sync_api import sync_playwright

ENV = Path("/Users/saiyeeshrathish/the final plan/apps/gex/research/stock-gex/session-b.env")
env = {}
for line in ENV.read_text().splitlines():
    s = line.strip()
    if "=" in s and not s.startswith("#"):
        k, v = s.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")

client, uat = env.get("CLERK_CLIENT_COOKIE"), env.get("CLERK_CLIENT_UAT")
INTEREST = re.compile(r"dark|flow|sse|nexus|tide|vix|greek|index-flow|fs-ws|live\.skylit|stream|seeker", re.I)
captured = []

with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True)
    ctx = browser.new_context()
    cookies = []
    for dom in [".skylit.ai", "clerk.skylit.ai", "app.skylit.ai"]:
        if client:
            cookies.append({"name": "__client", "value": client, "domain": dom, "path": "/", "secure": True})
        if uat:
            cookies.append({"name": "__client_uat", "value": uat, "domain": dom, "path": "/", "secure": True})
    ctx.add_cookies(cookies)
    page = ctx.new_page()
    page.on("request", lambda r: captured.append((r.method, r.url)) if (INTEREST.search(r.url) or "skylit.ai/api" in r.url or "live.skylit" in r.url) else None)
    page.on("websocket", lambda ws: captured.append(("WS", ws.url)))
    try:
        page.goto("https://app.skylit.ai/", wait_until="domcontentloaded", timeout=30000)
    except Exception as e:
        print("goto error:", e)
    page.wait_for_timeout(6000)
    print("landed on:", page.url, "| title:", (page.title() or "")[:60])
    # navigate DIRECTLY into each Flowseeker sub-page so it fires its data requests
    for route in ["/flow/live", "/flow/scanner", "/flow/compass", "/flow/dark"]:
        try:
            page.goto("https://app.skylit.ai" + route, wait_until="domcontentloaded", timeout=25000)
            page.wait_for_timeout(6000)
        except Exception as e:
            print("nav", route, "err:", str(e)[:50])
    browser.close()

seen, out = set(), []
for m, u in captured:
    key = (m, u.split("?")[0])
    if key in seen:
        continue
    seen.add(key)
    out.append(f"{m:5} {u[:150]}")
print("\n=== captured Skylit API / stream requests ===")
for line in sorted(out):
    print(" ", line)
print(f"\ntotal unique: {len(seen)}")
