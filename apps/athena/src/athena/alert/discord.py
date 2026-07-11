"""Discord alerting via webhook — same pattern as apps/gex/src/discord/webhook.js."""

from __future__ import annotations

import logging
import os

import httpx

from athena import config
from athena.reasoning.thesis import Thesis

log = logging.getLogger(__name__)


def send(thesis: Thesis) -> bool:
    url = os.environ.get(config.DISCORD_WEBHOOK_ENV, "")
    if not url:
        log.warning("no %s set — alert not sent", config.DISCORD_WEBHOOK_ENV)
        return False
    color = 0x2ECC71 if thesis.direction == "long" else 0xE74C3C
    payload = {
        "embeds": [
            {
                "title": f"Athena: {thesis.ticker} {thesis.direction.upper()} "
                f"({thesis.conviction:.0%})",
                "description": thesis.rationale[:1500],
                "color": color,
                "fields": [
                    {"name": "Structure", "value": thesis.structure[:200] or "—", "inline": True},
                    {"name": "Regime", "value": thesis.regime_read[:200] or "—", "inline": True},
                    {"name": "Entry", "value": thesis.entry_zone[:200] or "—"},
                    {"name": "Exit nodes", "value": thesis.exit_nodes[:200] or "—"},
                    {"name": "Invalidation", "value": thesis.invalidation[:200] or "—"},
                    {"name": "Size", "value": thesis.size_guidance[:200] or "—"},
                ],
                "footer": {"text": "ADVISORY ONLY — you execute. Athena places no orders."},
            }
        ]
    }
    try:
        resp = httpx.post(url, json=payload, timeout=15)
        resp.raise_for_status()
        return True
    except httpx.HTTPError:
        log.exception("discord alert failed")
        return False
