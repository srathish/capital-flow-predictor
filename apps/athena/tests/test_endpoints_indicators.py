import pytest
from athena.perception import endpoints
from athena.perception.models import Bar
from athena.signals import indicators


def test_whitelist_resolves():
    assert endpoints.path("flow_alerts", ticker="SPY") == "/api/stock/SPY/flow-alerts"
    assert endpoints.path("market_tide") == "/api/market/market-tide"


def test_whitelist_rejects_unknown():
    with pytest.raises(KeyError):
        endpoints.path("options_flow")  # the classic hallucinated endpoint


def _bars(n=30, base=100.0):
    out = []
    for i in range(n):
        px = base + i * 0.1
        out.append(Bar(open=px, high=px + 0.5, low=px - 0.5, close=px + 0.2, volume=1000))
    return out


def test_vwap_within_range():
    bars = _bars()
    v = indicators.vwap(bars)
    assert bars[0].low < v < bars[-1].high


def test_ema_orders_in_uptrend():
    closes = [b.close for b in _bars(60)]
    assert indicators.ema(closes, 9) > indicators.ema(closes, 21)


def test_atr_positive_and_sane():
    a = indicators.atr(_bars())
    assert 0.5 < a < 2.0


def test_opening_range_and_rvol():
    bars = _bars(30)
    hi, lo = indicators.opening_range(bars)
    assert hi > lo
    bars[-1].volume = 5000
    assert indicators.rvol(bars) == pytest.approx(5.0)
