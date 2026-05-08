"""Tests for the analyst layer.

These exercise the deterministic analyst logic and the LangGraph parallel
fan-out, with no DB and no LLM dependencies.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from cfp_agents.analysts import (
    FundamentalsAnalyst,
    NewsAnalyst,
    SentimentAnalyst,
    TechnicalsAnalyst,
)
from cfp_agents.graph import build_analyst_graph

# ---------- TechnicalsAnalyst ----------

def _uptrend_prices(n: int = 250) -> pd.DataFrame:
    rng = np.random.default_rng(0)
    rets = rng.normal(0.004, 0.010, n)  # strong positive drift, modest vol
    close = 100 * np.exp(np.cumsum(rets))
    idx = pd.date_range("2024-01-02", periods=n, freq="B")
    return pd.DataFrame(
        {
            "ts": idx,
            "open": close,
            "high": close * 1.005,
            "low": close * 0.995,
            "close": close,
            "volume": rng.integers(1_000_000, 5_000_000, n),
        }
    )


def _downtrend_prices(n: int = 250) -> pd.DataFrame:
    rng = np.random.default_rng(1)
    rets = rng.normal(-0.0015, 0.012, n)  # negative drift
    close = 100 * np.exp(np.cumsum(rets))
    idx = pd.date_range("2024-01-02", periods=n, freq="B")
    return pd.DataFrame(
        {
            "ts": idx,
            "open": close,
            "high": close * 1.005,
            "low": close * 0.995,
            "close": close,
            "volume": rng.integers(1_000_000, 5_000_000, n),
        }
    )


def test_technicals_uptrend_is_bullish() -> None:
    state = {"ticker": "FOO", "prices": _uptrend_prices()}
    sig = TechnicalsAnalyst().analyze(state)
    assert sig.signal == "bullish"
    assert sig.confidence > 0.0
    assert sig.payload["score"] > 0


def test_technicals_downtrend_is_bearish() -> None:
    state = {"ticker": "BAR", "prices": _downtrend_prices()}
    sig = TechnicalsAnalyst().analyze(state)
    assert sig.signal == "bearish"
    assert sig.payload["score"] < 0


def test_technicals_no_data() -> None:
    sig = TechnicalsAnalyst().analyze({"ticker": "X", "prices": pd.DataFrame()})
    assert sig.signal == "neutral"
    assert sig.confidence == 0.0


# ---------- FundamentalsAnalyst ----------

def _fundamentals_long(metrics: dict[str, list[tuple[str, float]]]) -> pd.DataFrame:
    """Build a fundamentals long-format DF from {metric: [(period, value), ...]}."""
    rows = []
    for metric, points in metrics.items():
        for period, value in points:
            rows.append(
                {
                    "fiscal_period": pd.Timestamp(period).date(),
                    "period_type": "A",
                    "metric": metric,
                    "value": float(value),
                }
            )
    return pd.DataFrame(rows)


def test_fundamentals_growth_company_is_bullish() -> None:
    f = _fundamentals_long(
        {
            "revenue": [
                ("2021-12-31", 100), ("2022-12-31", 130), ("2023-12-31", 170), ("2024-12-31", 220),
            ],
            "roe": [("2024-12-31", 0.32)],
            "free_cash_flow": [("2023-12-31", 30), ("2024-12-31", 45)],
            "debt_to_equity": [("2024-12-31", 0.5)],
            "pe_ratio": [("2024-12-31", 28)],
        }
    )
    sig = FundamentalsAnalyst().analyze({"ticker": "GROW", "fundamentals": f})
    assert sig.signal == "bullish", sig.rationale
    assert sig.payload["rev_cagr_3y"] > 0.25


def test_fundamentals_distressed_company_is_bearish() -> None:
    f = _fundamentals_long(
        {
            "revenue": [("2021-12-31", 200), ("2022-12-31", 170), ("2023-12-31", 140), ("2024-12-31", 110)],
            "roe": [("2024-12-31", -0.12)],
            "free_cash_flow": [("2023-12-31", 5), ("2024-12-31", -20)],
            "debt_to_equity": [("2024-12-31", 5.0)],
            "pe_ratio": [("2024-12-31", -15)],  # losing money
        }
    )
    sig = FundamentalsAnalyst().analyze({"ticker": "BAD", "fundamentals": f})
    assert sig.signal == "bearish", sig.rationale


def test_fundamentals_no_data_neutral() -> None:
    sig = FundamentalsAnalyst().analyze({"ticker": "X", "fundamentals": pd.DataFrame()})
    assert sig.signal == "neutral"
    assert sig.confidence == 0.0


# ---------- Stub analysts ----------

def test_sentiment_stub_returns_neutral() -> None:
    sig = SentimentAnalyst().analyze({"ticker": "FOO"})
    assert sig.signal == "neutral"
    assert sig.confidence == 0.0
    assert sig.payload.get("stub") is True


def test_news_stub_returns_neutral() -> None:
    sig = NewsAnalyst().analyze({"ticker": "FOO"})
    assert sig.signal == "neutral"
    assert sig.confidence == 0.0


# ---------- Graph wiring ----------

def test_graph_runs_all_four_analysts_in_parallel() -> None:
    graph = build_analyst_graph()
    state = {
        "ticker": "FOO",
        "sector": "XLK",
        "prices": _uptrend_prices(),
        "fundamentals": _fundamentals_long(
            {
                "revenue": [("2022-12-31", 100), ("2023-12-31", 110), ("2024-12-31", 120)],
                "roe": [("2024-12-31", 0.18)],
            }
        ),
        "analyst_signals": [],
    }
    result = graph.invoke(state)
    signals = result["analyst_signals"]
    agents = {s.agent for s in signals}
    assert agents == {"technicals", "fundamentals", "sentiment", "news"}
    # The two real analysts should have non-zero confidence; stubs should be 0
    by_agent = {s.agent: s for s in signals}
    assert by_agent["technicals"].confidence > 0
    assert by_agent["sentiment"].confidence == 0.0
    assert by_agent["news"].confidence == 0.0
