"""The cycle loop: perceive -> features -> knowledge -> thesis -> risk -> journal -> alert.

Control flows down through risk; nothing alerts without passing every check.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime
from zoneinfo import ZoneInfo

from athena import config
from athena.alert import discord
from athena.journal import store
from athena.perception.uw_client import UWClient
from athena.reasoning import knowledge
from athena.reasoning import thesis as thesis_mod
from athena.risk import gatekeeper
from athena.signals import features as features_mod

log = logging.getLogger(__name__)
ET = ZoneInfo("America/New_York")


def run_cycle(ticker: str, client: UWClient | None = None, no_llm: bool = False) -> dict:
    """One full decision cycle for one ticker. Returns a summary dict."""
    client = client or UWClient()
    try:
        features = features_mod.build(client, ticker)
    except Exception as exc:
        log.exception("perception failed for %s", ticker)
        store.record(ticker, "{}", None, None, [], False, error=f"perception: {exc}")
        return {"ticker": ticker, "stage": "perception", "error": str(exc)}

    if no_llm:
        store.record(ticker, features.model_dump_json(), None, None,
                     ["no-llm run"], False)
        return {"ticker": ticker, "stage": "features", "features": features.model_dump()}

    try:
        queries = [
            f"{features.regime} regime 0dte",
            "gamma flip dealer positioning exits",
            f"{ticker} structure rules",
        ]
        context = knowledge.context_for(queries)
        t = thesis_mod.synthesize(features, context)
    except Exception as exc:
        log.exception("reasoning failed for %s", ticker)
        store.record(ticker, features.model_dump_json(), None, None, [], False,
                     error=f"reasoning: {exc}")
        return {"ticker": ticker, "stage": "reasoning", "error": str(exc)}

    verdict = gatekeeper.check(t, features.as_of, store.alerts_today())
    alerted = False
    if verdict.approved:
        alerted = discord.send(t)
    cycle_id = store.record(
        ticker,
        features.model_dump_json(),
        thesis_mod.to_json(t),
        verdict.approved,
        verdict.reasons,
        alerted,
    )
    store.record_king_obs(cycle_id, features.model_dump())
    log.info("%s: %s conviction=%.2f approved=%s alerted=%s",
             ticker, t.direction, t.conviction, verdict.approved, alerted)
    return {
        "ticker": ticker,
        "stage": "complete",
        "thesis": t.model_dump(),
        "approved": verdict.approved,
        "gate_reasons": verdict.reasons,
        "alerted": alerted,
    }


def market_open_now(now: datetime | None = None) -> bool:
    now = now or datetime.now(ET)
    if now.weekday() >= 5:
        return False
    open_t = now.replace(hour=config.MARKET_OPEN[0], minute=config.MARKET_OPEN[1], second=0)
    close_t = now.replace(hour=config.MARKET_CLOSE[0], minute=config.MARKET_CLOSE[1], second=0)
    return open_t <= now <= close_t


def loop() -> None:
    """Market-hours loop at the configured cadence. Ctrl-C to stop."""
    client = UWClient()
    log.info("Athena loop: watchlist=%s cadence=%dm", config.watchlist(), config.CYCLE_MINUTES)
    while True:
        if market_open_now():
            for ticker in config.watchlist():
                try:
                    run_cycle(ticker, client)
                except Exception:
                    log.exception("cycle crashed for %s", ticker)
        else:
            log.info("market closed — idle")
        time.sleep(config.CYCLE_MINUTES * 60)
