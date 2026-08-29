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


def send_proposal(record: dict) -> bool:
    """Post the learning loop's monthly result — actionable prior proposals (need a human
    `nest learn apply`) and any watch-list divergences that aren't yet significant."""
    props = record.get("proposals", [])
    watch = record.get("watch", [])
    if not props and not watch:
        lines = [f"🧠 **Nest learning — {record.get('ts','')[:10]}**",
                 (f"Re-ran the backtest ({record.get('window','')}). "
                  "No material prior divergence — the model stands.")]
        return _post({"content": "\n".join(lines)[:1900]})
    fields = []
    if props:
        fields.append({"name": f"⚠️ Prior proposals ({len(props)}) — need approval",
                       "value": "\n".join(f"• `{p['source']}` {p['current_prior']:.2f}→"
                                          f"{p['suggested_prior']:.2f} ({p['rationale']})"
                                          for p in props[:6])[:1024]})
    if watch:
        fields.append({"name": f"👁 Watch ({len(watch)}) — divergence, not yet significant",
                       "value": "\n".join(f"• `{w['source']}` {w['rationale']}"
                                          for w in watch[:6])[:1024]})
    payload = {"embeds": [{
        "title": f"🧠 NEST learning loop — {record.get('window','')}",
        "description": ("The monthly self-check re-measured each selection signal's forward "
                        "edge. Proposals are ADVISORY — run `nest learn apply` to approve."),
        "color": 0xF1C40F if props else 0x95A5A6,
        "fields": fields,
        "footer": {"text": "The Nest never rewrites its own priors — a human approves every change."},
    }]}
    return _post(payload)
