"""Point-in-time event types (PRD §6.1) and canonical content hashing.

Times are timezone-aware UTC datetimes. `available_at` is when a consumer could have known the record; `provider_ts` alone
never establishes availability (PRD §6.2).
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum


class SignConvention(str, Enum):
    """What a positive exposure number means. Values from different conventions must never be mixed."""
    SKYLIT_NET = "skylit_net"            # Skylit Heatseeker net value per strike (sign = Skylit's dealer-positioning model)
    UW_OI_CALLS_POS = "uw_oi_calls_pos"  # UW greek-exposure: call gamma positive, put gamma negative, from open interest
    UNKNOWN = "unknown"


class Provenance(str, Enum):
    LIVE_CAPTURE = "live_capture"            # recorded by us as it streamed
    ARCHIVED_SNAPSHOT = "archived_snapshot"  # vendor-stored historical snapshot, verified against live on a sample
    RECONSTRUCTED = "reconstructed"          # recomputed / of unknown archival nature — blocks evidence promotion


def canonical_hash(obj) -> str:
    """sha256 over canonical JSON (sorted keys, no whitespace, datetimes as ISO-8601 UTC)."""
    def enc(o):
        if isinstance(o, datetime):
            return o.astimezone(timezone.utc).isoformat()
        if isinstance(o, Enum):
            return o.value
        raise TypeError(type(o))
    return hashlib.sha256(json.dumps(obj, sort_keys=True, separators=(",", ":"), default=enc).encode()).hexdigest()


def _utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        raise ValueError("naive datetime: all contract times must be timezone-aware")
    return dt.astimezone(timezone.utc)


@dataclass(frozen=True)
class MapSnapshot:
    """One exposure board for one symbol at one instant: strikes × expirations, gamma and (optionally) vanna."""
    source: str
    symbol: str
    provider_ts: datetime
    available_at: datetime
    session_date: str                      # exchange session (YYYY-MM-DD, America/New_York)
    spot: float
    expirations: tuple[str, ...]
    strikes: tuple[float, ...]
    gex: tuple[tuple[float, ...], ...]     # gex[i][j] = strike i, expiration j
    vex: tuple[tuple[float, ...], ...] | None
    convention: SignConvention
    provenance: Provenance
    revision_id: str = "r0"
    raw_hash: str = field(default="")

    def __post_init__(self):
        object.__setattr__(self, "provider_ts", _utc(self.provider_ts))
        object.__setattr__(self, "available_at", _utc(self.available_at))
        if self.available_at < self.provider_ts:
            raise ValueError("available_at earlier than provider_ts")
        if len(self.gex) != len(self.strikes) or any(len(r) != len(self.expirations) for r in self.gex):
            raise ValueError("gex shape does not match strikes × expirations")
        if not self.raw_hash:
            object.__setattr__(self, "raw_hash", canonical_hash(self.payload()))

    def payload(self) -> dict:
        return {"source": self.source, "symbol": self.symbol, "provider_ts": self.provider_ts, "session_date": self.session_date,
                "spot": self.spot, "expirations": self.expirations, "strikes": self.strikes, "gex": self.gex, "vex": self.vex,
                "convention": self.convention, "revision_id": self.revision_id}

    @property
    def snapshot_id(self) -> str:
        return f"{self.source}:{self.symbol}:{self.provider_ts.isoformat()}:{self.revision_id}"


@dataclass(frozen=True)
class PriceBar:
    symbol: str
    vendor: str
    ts_open: datetime
    ts_close: datetime
    o: float
    h: float
    l: float
    c: float
    v: float
    available_at: datetime                 # earliest: the bar's close

    def __post_init__(self):
        for k in ("ts_open", "ts_close", "available_at"):
            object.__setattr__(self, k, _utc(getattr(self, k)))
        if self.available_at < self.ts_close:
            raise ValueError("a bar cannot be available before it closes")
        if not (self.l <= min(self.o, self.c) <= max(self.o, self.c) <= self.h):
            raise ValueError(f"inconsistent OHLC for {self.symbol} {self.ts_open}")
