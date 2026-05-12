"""Position sizing — constrained Kelly with a max-drawdown safety cap.

The Portfolio Manager agent currently emits raw allocation percentages from the
ensemble. This module converts a (win_prob, win_loss_ratio) view into a position
size that's bounded by:

  1. Kelly fraction × ``kelly_haircut`` (default 0.5 — half-Kelly to dampen variance)
  2. Per-position cap (``max_per_position``) — never bet more than e.g. 10% on one name
  3. Regime risk multiplier — 1.0 / 0.5 / 0.0 from cfp_features.regime
  4. Portfolio-level max-drawdown brake — scales every position down once realized DD
     exceeds the threshold

Inputs are deliberately simple so personas can populate them without LLM hallucinating
sharpe-style numbers. The function is pure: no DB, no globals.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class PositionSizingConfig:
    kelly_haircut: float = 0.5      # 0.5 == half-Kelly
    max_per_position: float = 0.10  # 10% cap per name
    max_portfolio_drawdown: float = 0.20  # 20% — scale down beyond this
    drawdown_floor: float = 0.10    # below this DD, no scaling
    min_edge_for_entry: float = 0.02  # 2% — skip positions with no real edge


def kelly_fraction(win_prob: float, win_loss_ratio: float) -> float:
    """Classic Kelly: f* = p - (1-p)/b where b = win/loss ratio.

    Returns 0 (no bet) when the edge is negative."""
    if not (0.0 < win_prob < 1.0):
        return 0.0
    if win_loss_ratio <= 0:
        return 0.0
    f = win_prob - (1.0 - win_prob) / win_loss_ratio
    return max(0.0, f)


def drawdown_brake(current_drawdown: float, cfg: PositionSizingConfig) -> float:
    """Returns a multiplier in [0,1]. Smooth ramp from `drawdown_floor` to
    `max_portfolio_drawdown` — at DD == max, the multiplier is 0."""
    dd = abs(current_drawdown)
    if dd <= cfg.drawdown_floor:
        return 1.0
    if dd >= cfg.max_portfolio_drawdown:
        return 0.0
    span = cfg.max_portfolio_drawdown - cfg.drawdown_floor
    return float(np.clip(1.0 - (dd - cfg.drawdown_floor) / span, 0.0, 1.0))


def size_position(
    *,
    win_prob: float,
    win_loss_ratio: float,
    regime_multiplier: float = 1.0,
    current_drawdown: float = 0.0,
    cfg: PositionSizingConfig | None = None,
) -> dict[str, float]:
    """Return a sizing breakdown so the FE can show why a position is X%.

    Output keys:
      kelly_raw    — uncapped Kelly fraction
      kelly_sized  — after haircut
      regime_mult  — passed-through
      dd_mult      — drawdown brake multiplier
      cap_mult     — 1 if Kelly within cap, else cap/Kelly_sized
      final_size   — fraction of portfolio (0..max_per_position)
      reason       — human-readable string explaining the chain
    """
    cfg = cfg or PositionSizingConfig()
    kelly = kelly_fraction(win_prob, win_loss_ratio)
    sized = kelly * cfg.kelly_haircut
    if sized < cfg.min_edge_for_entry:
        return {
            "kelly_raw": kelly, "kelly_sized": sized,
            "regime_mult": regime_multiplier, "dd_mult": 1.0,
            "cap_mult": 0.0, "final_size": 0.0,
            "reason": f"no entry: sized={sized:.3f} below min_edge={cfg.min_edge_for_entry}",
        }
    dd_mult = drawdown_brake(current_drawdown, cfg)
    after_regime = sized * regime_multiplier * dd_mult
    if after_regime <= cfg.max_per_position:
        cap_mult = 1.0
        final = after_regime
    else:
        cap_mult = cfg.max_per_position / after_regime
        final = cfg.max_per_position
    reason = (
        f"kelly={kelly:.3f}*haircut={cfg.kelly_haircut} "
        f"*regime={regime_multiplier} *dd_brake={dd_mult:.2f} "
        f"*cap_mult={cap_mult:.2f} = {final:.3f}"
    )
    return {
        "kelly_raw": float(kelly),
        "kelly_sized": float(sized),
        "regime_mult": float(regime_multiplier),
        "dd_mult": float(dd_mult),
        "cap_mult": float(cap_mult),
        "final_size": float(final),
        "reason": reason,
    }
