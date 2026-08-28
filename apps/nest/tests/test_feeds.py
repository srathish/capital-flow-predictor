"""Market-wide feed fan-out + macro regime — validated against a fake UW client so the
tests stay offline. Field shapes mirror live UW payloads probed 2026-08-28."""

from __future__ import annotations

from datetime import UTC, datetime

from nest.engine import macro
from nest.ingest import feeds


class FakeUW:
    """Returns canned rows per whitelisted endpoint name."""

    def __init__(self, data: dict):
        self.data = data

    def get(self, name, params=None, **path):
        return self.data.get(name, [])


def test_feed_flow_ask_side_call_is_bull():
    rows = [
        # ask-side dominant opening call on ABC -> bull
        {"ticker": "ABC", "type": "call", "has_multileg": False, "issue_type": "Common Stock",
         "volume_oi_ratio": "3.0", "total_ask_side_prem": "2000000", "total_bid_side_prem": "100000"},
        # multileg -> skipped
        {"ticker": "ABC", "type": "call", "has_multileg": True, "issue_type": "Common Stock",
         "volume_oi_ratio": "5.0", "total_ask_side_prem": "9000000", "total_bid_side_prem": "0"},
        # ETF -> skipped
        {"ticker": "SPY", "type": "call", "has_multileg": False, "issue_type": "ETF",
         "volume_oi_ratio": "5.0", "total_ask_side_prem": "9000000", "total_bid_side_prem": "0"},
        # bid-side dominant -> skipped
        {"ticker": "XYZ", "type": "call", "has_multileg": False, "issue_type": "Common Stock",
         "volume_oi_ratio": "5.0", "total_ask_side_prem": "100", "total_bid_side_prem": "9000000"},
    ]
    sigs = feeds.feed_flow(FakeUW({"flow_alerts_market": rows}))
    assert [s.ticker for s in sigs] == ["ABC"]
    assert sigs[0].direction == "bull"


def test_feed_insider_net_buy_is_bull():
    rows = [
        {"ticker": "ACME", "amount": 10000, "price": "50"},   # +$500k buy
        {"ticker": "ACME", "amount": -2000, "price": "50"},   # -$100k sell
        {"ticker": "DOWN", "amount": -50000, "price": "10"},  # pure selling -> no bull signal
    ]
    sigs = feeds.feed_insider(FakeUW({"insider_transactions": rows}))
    tickers = {s.ticker: s for s in sigs}
    assert "ACME" in tickers and tickers["ACME"].direction == "bull"
    assert "DOWN" not in tickers  # net selling isn't surfaced as a bull lean


def test_feed_news_fans_across_tickers():
    rows = [
        {"headline": "big beat", "sentiment": "positive", "is_major": True,
         "tickers": ["AAA", "BBB"]},
        {"headline": "miss", "sentiment": "negative", "is_major": False, "tickers": ["AAA"]},
        {"headline": "macro fed thing", "sentiment": "neutral", "tickers": []},  # no ticker
    ]
    sigs = {s.ticker: s for s in feeds.feed_news(FakeUW({"news_headlines": rows}))}
    assert sigs["BBB"].direction == "bull"          # single positive headline
    assert "AAA" not in sigs                         # +1 then -1 = net 0 -> dropped


def test_macro_hawkish_raises_floor():
    news = [
        {"headline": "Fed's Warsh hawkish: inflation concerning, higher for longer",
         "sentiment": "negative", "tickers": []},
        {"headline": "FOMC signals no cut, tightening bias", "sentiment": "negative", "tickers": []},
    ]
    reg = macro.assess(FakeUW({"news_headlines": news, "economic_calendar": []}),
                       now=datetime(2026, 8, 28, tzinfo=UTC))
    assert reg.tone == "hawkish"
    assert reg.floor_delta > 0
    assert macro.effective_floor(reg) > macro.config.CONVICTION_FLOOR
