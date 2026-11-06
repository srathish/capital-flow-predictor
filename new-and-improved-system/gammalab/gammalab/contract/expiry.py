"""Expiration selection and aggregation (PRD FR-04, S21).

`front`  : the first listed expiration only, and ONLY if it is the session date (true 0DTE); otherwise NoZeroDTE.
`first_n`: the first n listed expirations, summed per strike (Skylit's API default nets the nearest 5).
Aggregation never mixes sign conventions (enforced upstream by the store).
"""
from __future__ import annotations

from .events import MapSnapshot


class NoZeroDTE(LookupError): ...


def select(s: MapSnapshot, mode: str = "front", n: int = 5, metric: str = "gex") -> dict[float, float]:
    grid = s.gex if metric == "gex" else s.vex
    if grid is None:
        raise ValueError(f"{metric} not present in snapshot {s.snapshot_id}")
    if mode == "front":
        if not s.expirations or s.expirations[0] != s.session_date:
            raise NoZeroDTE(f"{s.snapshot_id}: first expiration {s.expirations[:1]} is not the session date {s.session_date}")
        cols = [0]
    elif mode == "first_n":
        cols = list(range(min(n, len(s.expirations))))
    else:
        raise ValueError(mode)
    return {k: float(sum(row[j] or 0.0 for j in cols)) for k, row in zip(s.strikes, grid)}


def king(values: dict[float, float], spot: float, window: float = 0.02) -> tuple[float, float] | None:
    """Largest |value| strike within ±window of spot; None if nothing is in the window."""
    near = [(k, v) for k, v in values.items() if abs(k / spot - 1) <= window]
    return max(near, key=lambda kv: abs(kv[1])) if near else None
