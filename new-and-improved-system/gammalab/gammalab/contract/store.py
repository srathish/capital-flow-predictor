"""Append-only point-in-time stores (PRD §6.2).

- Snapshots are immutable: re-adding an id with a different content hash raises (a vendor revision must use a new revision_id).
- `asof(symbol, T)` returns the latest snapshot with available_at <= T; never anything published after T.
- A snapshot older than `ttl` at T is stale: fail closed (raise), never silently reused.
"""
from __future__ import annotations

import bisect
from datetime import datetime, timedelta

from .events import MapSnapshot, PriceBar, Provenance, SignConvention


class StaleSnapshot(LookupError): ...
class NoSnapshot(LookupError): ...
class ImmutableViolation(ValueError): ...
class ConventionMismatch(ValueError): ...


class SnapshotStore:
    def __init__(self, convention: SignConvention):
        self.convention = convention
        self._by_symbol: dict[str, list[tuple[datetime, str]]] = {}
        self._snaps: dict[str, MapSnapshot] = {}

    def add(self, s: MapSnapshot) -> None:
        if s.convention != self.convention:
            raise ConventionMismatch(f"store holds {self.convention.value}, got {s.convention.value}")
        prev = self._snaps.get(s.snapshot_id)
        if prev is not None:
            if prev.raw_hash != s.raw_hash:
                raise ImmutableViolation(f"{s.snapshot_id} re-added with different content")
            return
        self._snaps[s.snapshot_id] = s
        bisect.insort(self._by_symbol.setdefault(s.symbol, []), (s.available_at, s.snapshot_id))

    def asof(self, symbol: str, t: datetime, ttl: timedelta, allow_reconstructed: bool = True) -> MapSnapshot:
        idx = self._by_symbol.get(symbol, [])
        i = bisect.bisect_right(idx, (t, "￿")) - 1
        if i < 0:
            raise NoSnapshot(f"no {symbol} snapshot available at or before {t}")
        s = self._snaps[idx[i][1]]
        if t - s.available_at > ttl:
            raise StaleSnapshot(f"{symbol} latest snapshot {s.available_at} is older than ttl {ttl} at {t}")
        if not allow_reconstructed and s.provenance == Provenance.RECONSTRUCTED:
            raise LookupError("reconstructed snapshot not allowed for evidence")
        return s

    def __len__(self):
        return len(self._snaps)


class BarStore:
    def __init__(self):
        self._bars: dict[str, list[PriceBar]] = {}

    def add_many(self, bars: list[PriceBar]) -> None:
        for b in bars:
            self._bars.setdefault(b.symbol, []).append(b)
        for v in self._bars.values():
            v.sort(key=lambda b: b.ts_open)

    def known_at(self, symbol: str, t: datetime) -> list[PriceBar]:
        """All bars a consumer could know at t (available_at <= t)."""
        return [b for b in self._bars.get(symbol, []) if b.available_at <= t]

    def last_closed(self, symbol: str, t: datetime, max_age: timedelta) -> PriceBar:
        known = self.known_at(symbol, t)
        if not known:
            raise NoSnapshot(f"no {symbol} bar closed by {t}")
        b = known[-1]
        if t - b.available_at > max_age:
            raise StaleSnapshot(f"{symbol} last bar closed {b.available_at}, older than {max_age} at {t}")
        return b
