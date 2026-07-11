"""Regime classifier — explicit, testable rules. Five modes:
trend | squeeze | breakout | pinned | defensive.

Grounded in the user's validated doctrine (T1): positive-gamma pins, negative-
gamma trends/accelerates, flip proximity is the boundary condition, and a pin
near a big node kills 0DTE longs while "barney fuel" (building far node) holds.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class RegimeInputs:
    spot: float
    total_gamma: float
    flip_level: float | None
    nearest_wall: float | None  # strike of the dominant gamma node
    range_used: float | None  # session realized range / ATR
    rvol: float | None
    or_break: int  # -1 broke low, 0 inside, +1 broke high (opening range)
    flow_direction: float  # -1..+1


def classify(x: RegimeInputs) -> tuple[str, list[str]]:
    """Return (regime, evidence). Rules fire in priority order."""
    evidence: list[str] = []
    flip_dist = abs(x.spot - x.flip_level) / x.spot if x.flip_level else None
    wall_dist = abs(x.spot - x.nearest_wall) / x.spot if x.nearest_wall else None

    # defensive: negative gamma + heavy tape
    if x.total_gamma < 0 and (x.rvol or 0) > 1.5:
        evidence.append(f"negative total gamma ({x.total_gamma:.2e}) with rvol {x.rvol:.2f}")
        return "defensive", evidence

    # breakout: opening-range break with volume, away from the wall
    if x.or_break != 0 and (x.rvol or 0) > 1.2 and (wall_dist is None or wall_dist > 0.003):
        evidence.append(f"opening range break ({'high' if x.or_break > 0 else 'low'}), rvol {x.rvol:.2f}")
        return "breakout", evidence

    # pinned: positive gamma, sitting on a wall, range exhausted
    if x.total_gamma > 0 and wall_dist is not None and wall_dist < 0.0025 and (x.range_used or 0) < 1.0:
        evidence.append(f"positive gamma, {wall_dist * 100:.2f}% from wall {x.nearest_wall}")
        return "pinned", evidence

    # squeeze: near the flip boundary — regime can go either way, energy stored
    if flip_dist is not None and flip_dist < 0.003:
        evidence.append(f"spot within {flip_dist * 100:.2f}% of gamma flip {x.flip_level}")
        return "squeeze", evidence

    # trend: negative gamma or persistent one-way flow
    if x.total_gamma < 0 or abs(x.flow_direction) > 0.4:
        evidence.append(
            f"total gamma {x.total_gamma:.2e}, flow direction {x.flow_direction:+.2f}"
        )
        return "trend", evidence

    evidence.append("positive gamma, no boundary condition active")
    return "pinned", evidence
