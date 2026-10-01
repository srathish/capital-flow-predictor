#!/usr/bin/env python3
"""Read a Discord channel through YOUR logged-in Chrome (CDP), no bot/API needed.

Prereq (once): launch Chrome with remote debugging and log into Discord in it:
  open -na "Google Chrome" --args --remote-debugging-port=9222 --user-data-dir="$HOME/chrome-cdp"

Usage:
  python3 discord_read.py "https://discord.com/channels/<guild>/<channel>" --scrolls 40 --out posts.json
Output: JSON list of {id, author, time, text, attachments[], reactions} oldest→newest, plus a .md twin.
"""
import argparse, json, re, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument("url")
ap.add_argument("--scrolls", type=int, default=30, help="page-ups to load history (≈50 msgs each)")
ap.add_argument("--out", default="discord_posts.json")
ap.add_argument("--cdp", default="http://localhost:9222")
ap.add_argument("--download", default=None, help="directory to save image attachments into (via the logged-in session)")
ap.add_argument("--max-images", type=int, default=400)
a = ap.parse_args()

JS_EXTRACT = r"""
() => {
  const items = [...document.querySelectorAll('li[id^="chat-messages-"]')];
  let lastAuthor = null;
  return items.map(li => {
    const id = li.id.split('-').pop();   // id = chat-messages-<channel>-<message>; keep the message snowflake
    const authorEl = li.querySelector('[class*="username"]');
    const author = authorEl ? authorEl.textContent.trim() : null;      // null on grouped follow-up messages
    const t = li.querySelector('time[datetime]');
    const text = [...li.querySelectorAll('[id^="message-content-"]')].map(e => e.innerText).join('\n').trim();
    const attachments = [...li.querySelectorAll('a[href*="cdn.discordapp.com"], a[href*="media.discordapp.net"], img[src*="discordapp"]')]
      .map(e => e.href || e.src).filter(Boolean);
    const reactions = [...li.querySelectorAll('[class*="reaction"] [class*="reactionCount"]')].map(e => e.textContent.trim());
    const embeds = [...li.querySelectorAll('[class*="embedTitle"], [class*="embedDescription"]')].map(e => e.innerText.trim());
    return { id, author, time: t ? t.getAttribute('datetime') : null, text, attachments: [...new Set(attachments)], reactions, embeds };
  });
}
"""

with sync_playwright() as p:
    browser = p.chromium.connect_over_cdp(a.cdp)
    ctx = browser.contexts[0]
    # Open our page FIRST, then close stale Discord tabs — Chrome must never reach zero pages
    # (a page-less browser makes later CDP connects fail with "Browser context management is not supported").
    page = ctx.new_page()
    for pg in list(ctx.pages):
        if pg is not page and "discord.com/channels" in pg.url:
            try: pg.close()
            except Exception: pass
    page.goto(a.url, wait_until="domcontentloaded")
    page.wait_for_selector('[data-list-id="chat-messages"]', timeout=60000)
    time.sleep(5)  # let Discord finish hydrating before we start scrolling
    seen = {}
    # The REAL scroller is the nearest ancestor that actually scrolls (overflow-y scroll/auto AND scrollHeight > clientHeight).
    # The list itself (OL.scrollerInner) has overflow: clip and never scrolls.
    JS_SCROLLER = """() => { let e = document.querySelector('[data-list-id="chat-messages"]'); while (e) { const o = getComputedStyle(e).overflowY; if ((o === 'scroll' || o === 'auto') && e.scrollHeight > e.clientHeight) return e; e = e.parentElement; } return null; }"""
    JS_TOP = """() => { let e = document.querySelector('[data-list-id="chat-messages"]'); while (e) { const o = getComputedStyle(e).overflowY; if ((o === 'scroll' || o === 'auto') && e.scrollHeight > e.clientHeight) { e.scrollTop = 0; return e.scrollHeight; } e = e.parentElement; } return -1; }"""
    JS_SCROLLER_BOX = """() => { let e = document.querySelector('[data-list-id="chat-messages"]'); while (e) { const o = getComputedStyle(e).overflowY; if ((o === 'scroll' || o === 'auto') && e.scrollHeight > e.clientHeight) { const r = e.getBoundingClientRect(); return {x: r.x, y: r.y, w: r.width, h: r.height}; } e = e.parentElement; } return null; }"""
    JS_AT_START = """() => { const l = document.querySelector('[data-list-id="chat-messages"]'); if (!l) return false; const t = l.innerText || ''; return /Welcome to|This is the (start|beginning) of/i.test(t.slice(0, 2000)); }"""
    # Discord's list is virtualized: older history only loads on REAL scroll input over the list. Use mouse-wheel
    # over the message area (plus a scrollTop reset), and judge progress by the OLDEST timestamp seen, not the count.
    # NEVER click inside the list (a click on an image opens Discord's lightbox and swallows every wheel event after it).
    # Hover only: wheel events go to the element under the cursor. Escape first in case anything modal is open.
    page.keyboard.press("Escape")
    box = page.evaluate(JS_SCROLLER_BOX) or page.query_selector('[data-list-id="chat-messages"]').bounding_box()
    vp = page.viewport_size or {"width": 1200, "height": 800}
    # hover over the ON-SCREEN part of the scroller (the list's own box can start thousands of px above the viewport)
    cx = box["x"] + box["w" if "w" in box else "width"] * 0.15
    cy = min(max(box["y"] + 40, 60), vp["height"] - 120)
    page.mouse.move(cx, cy)
    JS_MODAL = """() => !!document.querySelector('[role="dialog"], [class*="focusLock"] [class*="modal"], [class*="carouselModal"]')"""
    stale = 0; last_oldest = None; at_start = False
    for i in range(a.scrolls):
        for m in page.evaluate(JS_EXTRACT):
            seen[m["id"]] = m
        at_start = page.evaluate(JS_AT_START)
        oldest = min((m["time"] for m in seen.values() if m["time"]), default=None)
        stale = stale + 1 if oldest == last_oldest else 0
        last_oldest = oldest
        print(f"\rscroll {i+1}/{a.scrolls}  messages {len(seen)}  oldest {(oldest or '?')[:10]}  {'[START OF CHANNEL]' if at_start else ''}", end="", file=sys.stderr)
        # never stop in the first 10 iterations (Discord may still be fetching); need the start marker AND a settled oldest date
        if i >= 10 and at_start and stale >= 4: break
        if i >= 10 and stale >= 25: print("\n  (oldest date stopped moving after 25 scrolls — stopping)", file=sys.stderr); break
        if page.evaluate(JS_MODAL): page.keyboard.press("Escape"); time.sleep(0.3); page.mouse.move(cx, cy)
        for _ in range(6): page.mouse.wheel(0, -2500); time.sleep(0.15)
        page.evaluate(JS_TOP)
        time.sleep(1.5 if stale < 3 else 3.0)
    for m in page.evaluate(JS_EXTRACT):
        seen[m["id"]] = m

    msgs = sorted(seen.values(), key=lambda m: int(m["id"]))
    if a.download:
        d = Path(a.download); d.mkdir(parents=True, exist_ok=True)
        n = 0
        for m in msgs:
            m["images"] = []
            # real uploads only (cdn.discordapp.com/attachments/...); skip avatars/badges/emojis and the media.discordapp.net duplicate
            ups = [u for u in m["attachments"] if "/attachments/" in u and "media.discordapp.net" not in u]
            for i, u in enumerate(ups):
                ext = re.search(r"\.(png|jpe?g|webp|gif)(?:[?#]|$)", u, re.I)
                if not ext or n >= a.max_images: continue
                fn = d / f"{m['id']}_{i}.{ext.group(1).lower()}"
                if not fn.exists():
                    try:
                        r = ctx.request.get(u, timeout=30000)
                        if r.ok: fn.write_bytes(r.body())
                        else: continue
                    except Exception as e:
                        print(f"\n  skip {u[:60]}: {e}", file=sys.stderr); continue
                m["images"].append(str(fn)); n += 1
        print(f"\nimages saved: {n} → {d}", file=sys.stderr)
    page.goto("about:blank")  # keep a live page so the browser never becomes page-less; don't close it
# fill grouped-message authors (Discord omits the name on consecutive posts by the same user)
last = None
for m in msgs:
    if m["author"]: last = m["author"]
    else: m["author"] = last
Path(a.out).write_text(json.dumps(msgs, indent=1))
md = Path(a.out).with_suffix(".md")
with md.open("w") as f:
    for m in msgs:
        f.write(f"### {m['author']} — {m['time']}\n{m['text']}\n")
        for u in m["attachments"]: f.write(f"- attachment: {u}\n")
        for e in m["embeds"]: f.write(f"> {e}\n")
        if m["reactions"]: f.write(f"reactions: {' '.join(m['reactions'])}\n")
        f.write("\n")
print(f"\n{len(msgs)} messages → {a.out} and {md}", file=sys.stderr)
