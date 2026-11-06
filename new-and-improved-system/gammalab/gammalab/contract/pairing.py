"""Map ↔ price pairing (PRD §6.2; fse levels.py idea, CC0).

A snapshot available at T is paired with the latest bar CLOSED by T (bar.available_at <= T). If that bar closed more than
`max_gap` before T the pair is rejected — the stale price is never reused.
"""
from __future__ import annotations

from datetime import timedelta

from .events import MapSnapshot, PriceBar
from .store import BarStore, StaleSnapshot


class PairingRejected(LookupError): ...


def pair(s: MapSnapshot, bars: BarStore, symbol: str | None = None, max_gap: timedelta = timedelta(seconds=120)) -> PriceBar:
    try:
        return bars.last_closed(symbol or s.symbol, s.available_at, max_gap)
    except (StaleSnapshot, LookupError) as e:
        raise PairingRejected(str(e)) from e


def earliest_execution(signal_bar: PriceBar) -> object:
    """A signal that needs a bar's close cannot fill inside that bar: the earliest fill is the next event after its close."""
    return signal_bar.available_at
