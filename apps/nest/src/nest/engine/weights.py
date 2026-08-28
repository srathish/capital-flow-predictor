"""Source weights — the number Layer 1 multiplies each signal's strength by. A source's
live weight is its tracked hit rate, blended with a low prior by sample size:

    weight = (prior * K + hits) / (K + n)          (Beta-style shrinkage, K = PRIOR_STRENGTH)

New sources sit near their prior until they've earned a record; a source that stops
paying decays toward zero automatically. discord:<caller> is weighted per caller, never
as a monolith. This is the mechanism that makes a bad feed cost nothing but a config line.
"""

from __future__ import annotations

from nest import config
from nest.events.log import EventLog

PRIOR_STRENGTH = 8.0  # pseudo-observations; ~8 graded calls to move a source off its prior


def _hit_rates(log: EventLog, horizon: str = "5d") -> dict[str, tuple[int, int]]:
    """(hits, n) per source from per-source Grade events at the given horizon."""
    tally: dict[str, list[int]] = {}
    for g in log.grades():
        if g.horizon != horizon or not g.source:
            continue
        h = tally.setdefault(g.source, [0, 0])
        h[0] += int(g.hit)
        h[1] += 1
    return {s: (v[0], v[1]) for s, v in tally.items()}


def compute_all(log: EventLog, horizon: str = "5d") -> dict[str, float]:
    """Live weight per source seen in grades, shrunk toward its prior."""
    rates = _hit_rates(log, horizon)
    out: dict[str, float] = {}
    for source, (hits, n) in rates.items():
        prior = config.prior_of(source)
        out[source] = (prior * PRIOR_STRENGTH + hits) / (PRIOR_STRENGTH + n)
    return out


def source_weight(source: str, weights: dict[str, float]) -> float:
    """Weight for a source: its tracked value if graded, else its prior."""
    return weights.get(source, config.prior_of(source))
