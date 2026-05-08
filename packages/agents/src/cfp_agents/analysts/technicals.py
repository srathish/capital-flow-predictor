"""Technicals analyst: rule-based signal from prices alone.

Inputs: a daily OHLCV DataFrame for one ticker.
Output: AgentSignal with bull/bear/neutral and a 0..1 confidence.

Heuristics (simple, transparent — Phase 4b is rule-based, no LLM):
  + Trend: close above MA50 and MA50 above MA200 -> uptrend (bullish)
  + Momentum: 20d return > 5% -> mild bullish
  + Mean reversion: RSI(14) < 30 -> oversold (bullish), > 70 -> overbought (bearish)
  + Volume: 20d volume z-score > 1.5 -> conviction multiplier
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd

from cfp_agents.base import BaseAnalyst, clamp, score_to_signal
from cfp_agents.state import AgentSignal, AnalysisState


def _rsi(close: pd.Series, period: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0.0)
    loss = -delta.clip(upper=0.0)
    avg_gain = gain.rolling(period, min_periods=period).mean()
    avg_loss = loss.rolling(period, min_periods=period).mean()
    rs = avg_gain / avg_loss
    rsi = 100 - (100 / (1 + rs))
    return rsi.replace([np.inf, -np.inf], np.nan)


class TechnicalsAnalyst(BaseAnalyst):
    name = "technicals"

    def analyze(self, state: AnalysisState) -> AgentSignal:
        ticker = state.get("ticker", "?")
        prices = state.get("prices")
        if prices is None or prices.empty or "close" not in prices.columns:
            return AgentSignal(
                agent=self.name,
                signal="neutral",
                confidence=0.0,
                rationale=f"{ticker}: no price data",
            )

        df = prices.sort_values("ts").reset_index(drop=True)
        close = df["close"].astype(float)

        if len(close) < 50:
            return AgentSignal(
                agent=self.name,
                signal="neutral",
                confidence=0.1,
                rationale=f"{ticker}: only {len(close)} bars, insufficient history",
            )

        # --- features ---
        last = float(close.iloc[-1])
        ma50 = float(close.rolling(50, min_periods=50).mean().iloc[-1])
        ma200 = (
            float(close.rolling(200, min_periods=200).mean().iloc[-1])
            if len(close) >= 200
            else math.nan
        )
        ret_20 = float(close.iloc[-1] / close.iloc[-21] - 1.0) if len(close) >= 21 else 0.0
        rsi = _rsi(close, 14).iloc[-1]
        rsi = float(rsi) if pd.notna(rsi) else 50.0

        # --- score components, each in roughly -1..+1 ---
        trend = 0.0
        if not math.isnan(ma200):
            if last > ma50 > ma200:
                trend = 0.8
            elif last < ma50 < ma200:
                trend = -0.8
            elif last > ma50:
                trend = 0.3
            elif last < ma50:
                trend = -0.3

        momentum = clamp(ret_20 * 5.0, -1.0, 1.0)  # ±20% -> ±1.0

        mean_rev = 0.0
        if rsi < 30:
            mean_rev = 0.6
        elif rsi > 70:
            mean_rev = -0.4
        elif rsi < 40:
            mean_rev = 0.2
        elif rsi > 60:
            mean_rev = -0.1

        # Volume conviction (20d z) — multiplier on confidence, not direction
        vol_z = 0.0
        if "volume" in df.columns and len(df) >= 20:
            v = df["volume"].astype(float)
            v_mean = v.rolling(20, min_periods=20).mean().iloc[-1]
            v_std = v.rolling(20, min_periods=20).std().iloc[-1]
            if v_std and v_std > 0 and pd.notna(v_mean):
                vol_z = float((v.iloc[-1] - v_mean) / v_std)

        # --- aggregate ---
        score = 0.5 * trend + 0.3 * momentum + 0.2 * mean_rev
        score = clamp(score, -1.0, 1.0)

        # Confidence rises with absolute score and volume conviction
        confidence = clamp(abs(score) * (1.0 + 0.2 * clamp(vol_z, 0, 3) / 3))

        return AgentSignal(
            agent=self.name,
            signal=score_to_signal(score, neutral_band=0.15),
            confidence=confidence,
            rationale=(
                f"{ticker}: trend={trend:+.2f} momentum={momentum:+.2f} "
                f"rsi={rsi:.0f} vol_z={vol_z:+.1f} -> score={score:+.2f}"
            ),
            payload={
                "score": score,
                "trend": trend,
                "momentum_20d": ret_20,
                "rsi_14": rsi,
                "ma50_dist": (last / ma50 - 1.0) if ma50 else None,
                "ma200_dist": (last / ma200 - 1.0) if ma200 and not math.isnan(ma200) else None,
                "volume_z": vol_z,
            },
        )
