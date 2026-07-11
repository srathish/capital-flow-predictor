from athena.perception.models import StrikeExposure
from athena.signals import gex


def _row(strike, g, v=0.0):
    return StrikeExposure(strike=strike, call_gamma_oi=max(g, 0), put_gamma_oi=min(g, 0),
                          call_vanna_oi=v, put_vanna_oi=0)


def test_profile_walls_and_totals():
    rows = [_row(90, -5e8), _row(95, -1e8), _row(100, 2e8), _row(105, 8e8), _row(110, 1e8)]
    p = gex.build_profile(rows, spot=101.0)
    assert p.call_wall == 105
    assert p.put_wall == 90
    assert p.total_gamma == 5e8
    assert p.top_gamma_strikes[0][0] in (105, 90)


def test_flip_level_interpolates_between_strikes():
    # cumulative: -6e8 at 95, +2e8 after 100 -> crossing between 95 and 100
    rows = [_row(90, -5e8), _row(95, -1e8), _row(100, 8e8)]
    p = gex.build_profile(rows, spot=98.0)
    assert p.flip_level is not None
    assert 95 < p.flip_level < 100


def test_flip_none_when_single_signed():
    rows = [_row(100, 1e8), _row(105, 2e8)]
    assert gex.build_profile(rows, spot=102).flip_level is None


def test_mass_below_spot():
    rows = [_row(90, -4e8), _row(110, 1e8)]
    p = gex.build_profile(rows, spot=100.0)
    assert p.mass_below_spot == 0.8  # 4e8 of 5e8 total |gamma| is below spot


def test_fallback_gex_signs():
    chain = [
        {"strike": 100, "gamma": 0.02, "open_interest": 1000, "type": "call"},
        {"strike": 100, "gamma": 0.02, "open_interest": 500, "type": "put"},
    ]
    out = dict(gex.fallback_gex_from_chain(chain, spot=100))
    assert out[100] > 0  # call OI dominates -> net positive
