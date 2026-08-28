"""Discord webhook delivery for Calls and the digest. Same pattern as
apps/athena/alert/discord.py and apps/gex/src/discord/webhook.js.
"""

from __future__ import annotations

import logging
import os

import httpx

from nest import config
from nest.events.schema import Call

log = logging.getLogger(__name__)


def _post(payload: dict) -> bool:
    url = os.environ.get(config.DISCORD_WEBHOOK_ENV, "")
    if not url:
        log.warning("no %s set — not delivered", config.DISCORD_WEBHOOK_ENV)
        return False
    try:
        resp = httpx.post(url, json=payload, timeout=15)
        resp.raise_for_status()
        return True
    except httpx.HTTPError:
        log.exception("discord delivery failed")
        return False


def send_call(call: Call) -> bool:
    color = 0x2ECC71 if call.direction == "bull" else 0xE74C3C
    stack = "\n".join(
        f"• `{s.get('source')}` ({s.get('direction')}, str {s.get('strength', 0):.2f})"
        for s in call.signals[:8]
    ) or "—"
    zone = f"{call.entry_zone[0]}–{call.entry_zone[1]}" if len(call.entry_zone) == 2 else "—"
    payload = {
        "embeds": [{
            "title": f"🪶 NEST: {call.ticker} {call.direction.upper()} "
                     f"(conviction {call.conviction:.0f})",
            "description": call.thesis[:1500],
            "color": color,
            "fields": [
                {"name": "Evidence stack", "value": stack[:1024]},
                {"name": "Entry zone", "value": zone, "inline": True},
                {"name": "Invalidation",
                 "value": str(call.invalidation) if call.invalidation else "—", "inline": True},
                {"name": "Ref price",
                 "value": str(call.ref_price) if call.ref_price else "—", "inline": True},
                {"name": "Calibration", "value": call.calibration_note or "—"},
            ],
            "footer": {"text": "ADVISORY ONLY — the Nest places no orders. Read the stack, "
                               "not the number."},
        }]
    }
    return _post(payload)


def send_digest(text: str) -> bool:
    return _post({"content": text[:1900]})
