"""Flow scoring — pure functions over UW flow alerts and net-premium ticks."""

from __future__ import annotations

from dataclasses import dataclass

from athena.perception.models import FlowAlert, NetPremTick


@dataclass
class FlowSummary:
    n_alerts: int
    net_ask_premium: float  # ask-side (aggressive buys) minus bid-side premium
    call_premium: float
    put_premium: float
    sweep_ratio: float  # fraction of alerts that swept
    opening_ratio: float  # fraction flagged all-opening
    direction: float  # -1..+1 normalized bullish/bearish premium tilt


def summarize_flow(alerts: list[FlowAlert]) -> FlowSummary:
    if not alerts:
        return FlowSummary(0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)
    net_ask = sum(a.total_ask_side_prem - a.total_bid_side_prem for a in alerts)
    calls = sum(a.total_premium for a in alerts if a.type == "call")
    puts = sum(a.total_premium for a in alerts if a.type == "put")
    sweeps = sum(1 for a in alerts if a.has_sweep)
    opening = sum(1 for a in alerts if a.all_opening_trades)
    # bullish premium = aggressive call buys + aggressive put sells; proxy with
    # ask-side call prem minus ask-side put prem
    bull = sum(a.total_ask_side_prem for a in alerts if a.type == "call")
    bear = sum(a.total_ask_side_prem for a in alerts if a.type == "put")
    total = bull + bear
    return FlowSummary(
        n_alerts=len(alerts),
        net_ask_premium=net_ask,
        call_premium=calls,
        put_premium=puts,
        sweep_ratio=sweeps / len(alerts),
        opening_ratio=opening / len(alerts),
        direction=(bull - bear) / total if total else 0.0,
    )


def tide_direction(ticks: list[NetPremTick], last_n: int = 12) -> float:
    """Net premium tilt over the most recent ticks, -1..+1."""
    recent = ticks[-last_n:]
    if not recent:
        return 0.0
    call = sum(t.net_call_premium for t in recent)
    put = sum(t.net_put_premium for t in recent)
    denom = abs(call) + abs(put)
    return (call - put) / denom if denom else 0.0
