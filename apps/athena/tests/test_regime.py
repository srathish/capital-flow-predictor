from athena.signals.regime import RegimeInputs, classify


def _inputs(**kw):
    base = dict(spot=100.0, total_gamma=1e9, flip_level=95.0, nearest_wall=105.0,
                range_used=0.5, rvol=1.0, or_break=0, flow_direction=0.0)
    base.update(kw)
    return RegimeInputs(**base)


def test_defensive_on_negative_gamma_heavy_tape():
    regime, why = classify(_inputs(total_gamma=-2e9, rvol=2.0))
    assert regime == "defensive"
    assert why


def test_breakout_on_or_break_with_volume():
    regime, _ = classify(_inputs(or_break=1, rvol=1.5))
    assert regime == "breakout"


def test_pinned_on_wall_with_positive_gamma():
    regime, _ = classify(_inputs(nearest_wall=100.1, range_used=0.4))
    assert regime == "pinned"


def test_squeeze_near_flip():
    regime, _ = classify(_inputs(flip_level=100.2, nearest_wall=110.0))
    assert regime == "squeeze"


def test_trend_on_negative_gamma_calm_tape():
    regime, _ = classify(_inputs(total_gamma=-1e9, rvol=1.0, nearest_wall=110.0, flip_level=90.0))
    assert regime == "trend"
