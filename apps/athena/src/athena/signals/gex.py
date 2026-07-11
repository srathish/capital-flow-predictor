"""GEX structure math — pure functions over per-strike exposures.

Input rows are (strike, net_gamma, net_vanna) from UW spot-exposures (already
dealer-signed dollar exposure per 1% move). Deterministic; no LLM, no I/O.
"""

from __future__ import annotations

from dataclasses import dataclass

from athena.perception.models import StrikeExposure


@dataclass
class GexProfile:
    spot: float
    total_gamma: float
    flip_level: float | None  # zero-gamma boundary nearest spot
    call_wall: float | None  # largest positive net-gamma strike
    put_wall: float | None  # largest negative net-gamma strike
    top_gamma_strikes: list[tuple[float, float]]  # (strike, net_gamma) by |gamma|
    mass_below_spot: float  # fraction of |gamma| mass strictly below spot
    total_vanna: float


def build_profile(rows: list[StrikeExposure], spot: float, top_n: int = 5) -> GexProfile:
    rows = sorted((r for r in rows if r.strike > 0), key=lambda r: r.strike)
    total_gamma = sum(r.net_gamma for r in rows)
    total_vanna = sum(r.net_vanna for r in rows)

    pos = [(r.strike, r.net_gamma) for r in rows if r.net_gamma > 0]
    neg = [(r.strike, r.net_gamma) for r in rows if r.net_gamma < 0]
    call_wall = max(pos, key=lambda x: x[1])[0] if pos else None
    put_wall = min(neg, key=lambda x: x[1])[0] if neg else None

    top = sorted(((r.strike, r.net_gamma) for r in rows), key=lambda x: abs(x[1]), reverse=True)
    top_gamma_strikes = top[:top_n]

    mass = sum(abs(r.net_gamma) for r in rows)
    below = sum(abs(r.net_gamma) for r in rows if r.strike < spot)
    mass_below_spot = below / mass if mass else 0.0

    return GexProfile(
        spot=spot,
        total_gamma=total_gamma,
        flip_level=flip_level(rows, spot),
        call_wall=call_wall,
        put_wall=put_wall,
        top_gamma_strikes=top_gamma_strikes,
        mass_below_spot=mass_below_spot,
        total_vanna=total_vanna,
    )


def flip_level(rows: list[StrikeExposure], spot: float) -> float | None:
    """Zero-crossing of cumulative net gamma (low strike -> high), nearest to spot.

    Cumulative profile crossing sign marks the regime boundary; with multiple
    crossings pick the one closest to spot (the actionable boundary).
    """
    rows = sorted((r for r in rows if r.strike > 0), key=lambda r: r.strike)
    if len(rows) < 2:
        return None
    crossings: list[float] = []
    cum = 0.0
    prev_cum = None
    prev_strike = None
    for r in rows:
        cum += r.net_gamma
        if prev_cum is not None and prev_cum != 0 and (cum == 0 or (cum > 0) != (prev_cum > 0)):
            # linear interpolation between the two strikes
            span = cum - prev_cum
            frac = -prev_cum / span if span else 0.0
            crossings.append(prev_strike + frac * (r.strike - prev_strike))
        prev_cum, prev_strike = cum, r.strike
    if not crossings:
        return None
    return min(crossings, key=lambda level: abs(level - spot))


def fallback_gex_from_chain(
    chain: list[dict], spot: float, multiplier: int = 100
) -> list[tuple[float, float]]:
    """Second-source GEX per strike from a raw options chain so Athena is never
    single-sourced: OI * gamma * multiplier * spot^2 * 0.01, calls +, puts -
    (standard dealer-long-call / dealer-short-put assumption).
    Chain rows need: strike, gamma, open_interest, type ('call'|'put').
    """
    per_strike: dict[float, float] = {}
    for c in chain:
        try:
            strike = float(c["strike"])
            gamma = float(c.get("gamma") or 0)
            oi = float(c.get("open_interest") or 0)
        except (KeyError, TypeError, ValueError):
            continue
        sign = 1.0 if str(c.get("type", "")).lower().startswith("c") else -1.0
        per_strike[strike] = per_strike.get(strike, 0.0) + sign * oi * gamma * multiplier * spot**2 * 0.01
    return sorted(per_strike.items())
