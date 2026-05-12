"""Position sizing math tests."""

from __future__ import annotations

from cfp_models.position_sizing import (
    PositionSizingConfig,
    drawdown_brake,
    kelly_fraction,
    size_position,
)


def test_kelly_classical_formula() -> None:
    # p=0.6, b=1 (even-money) => f* = 0.6 - 0.4/1 = 0.2
    assert abs(kelly_fraction(0.6, 1.0) - 0.2) < 1e-9
    # p=0.5, b=1 => f* = 0
    assert kelly_fraction(0.5, 1.0) == 0.0
    # Negative edge clamps to 0
    assert kelly_fraction(0.4, 1.0) == 0.0


def test_kelly_invalid_inputs() -> None:
    assert kelly_fraction(0.0, 1.0) == 0.0
    assert kelly_fraction(1.0, 1.0) == 0.0
    assert kelly_fraction(0.7, 0.0) == 0.0
    assert kelly_fraction(0.7, -1.0) == 0.0


def test_drawdown_brake_ramps_smoothly() -> None:
    cfg = PositionSizingConfig(drawdown_floor=0.10, max_portfolio_drawdown=0.20)
    assert drawdown_brake(0.05, cfg) == 1.0   # below floor
    assert drawdown_brake(0.25, cfg) == 0.0   # past max
    mid = drawdown_brake(0.15, cfg)
    assert 0.4 < mid < 0.6                    # ramp midpoint


def test_size_position_applies_cap() -> None:
    # Edge so big that uncapped Kelly exceeds 10%.
    out = size_position(win_prob=0.9, win_loss_ratio=2.0)
    assert out["final_size"] <= 0.10 + 1e-9
    assert out["cap_mult"] < 1.0


def test_size_position_zero_when_below_min_edge() -> None:
    out = size_position(win_prob=0.51, win_loss_ratio=1.0)
    assert out["final_size"] == 0.0
    assert "no entry" in out["reason"]


def test_size_position_regime_multiplier_zeros_bear() -> None:
    out = size_position(win_prob=0.7, win_loss_ratio=2.0, regime_multiplier=0.0)
    assert out["final_size"] == 0.0


def test_size_position_drawdown_brake_scales_down() -> None:
    cfg = PositionSizingConfig(max_per_position=1.0)  # disable cap to isolate brake
    nominal = size_position(win_prob=0.7, win_loss_ratio=2.0, current_drawdown=0.0, cfg=cfg)
    braked = size_position(win_prob=0.7, win_loss_ratio=2.0, current_drawdown=0.15, cfg=cfg)
    assert braked["final_size"] < nominal["final_size"]
