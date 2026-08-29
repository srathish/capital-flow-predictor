"""Lookahead-safe backtest core, in-app (fetches via UWClient, not a standalone script).

Ports the validated signal formulas from research/backtest.py so the daemon can re-measure
them on a schedule. For a fixed liquid universe and a series of as-of dates, reconstruct each
signal from ONLY bars up to that date, then measure forward EXCESS return vs SPY at each
horizon. Edge = mean cross-sectional rank-IC that is positive, |t|>2, and OOS-consistent —
the honest bar from repo memory. Bounded to ~1 OHLC call per name, so a full run is cheap.
"""

from __future__ import annotations

import logging
import math
import statistics

log = logging.getLogger(__name__)

# ~45 liquid names spanning sectors — enough for a stable cross-sectional IC, small enough
# that a full sweep is ~46 API calls. Mirrors research/backtest.py's spirit, trimmed.
UNIVERSE = [
    "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "AVGO", "TSLA", "ORCL", "AMD",
    "MU", "MRVL", "PLTR", "CRWD", "PANW", "NET", "SHOP", "UBER", "COIN", "HOOD",
    "JPM", "BAC", "GS", "V", "MA", "PYPL", "UNH", "LLY", "PFE", "ABBV",
    "WMT", "COST", "HD", "NKE", "MCD", "DIS", "NFLX", "XOM", "CVX", "CAT",
    "BA", "GE", "F", "IREN", "HIMS",
]
HORIZONS = (5, 20)
LOOKBACK_DATES = 12          # as-of dates sampled from recent history
DATE_STRIDE = 15             # ~3 trading weeks between as-of dates


def _bars(uw, ticker: str) -> dict | None:
    try:
        rows = uw.get("ohlc", params={"limit": 900}, ticker=ticker, candle_size="1d")
    except Exception:  # noqa: BLE001 — a missing name must not abort the sweep
        return None
    if not rows:
        return None
    rows = sorted(rows, key=lambda r: r["date"])
    try:
        close = [float(r["close"]) for r in rows]
        high = [float(r["high"]) for r in rows]
        low = [float(r["low"]) for r in rows]
    except (KeyError, TypeError, ValueError):
        return None
    dates = [r["date"] for r in rows]
    return {"dates": dates, "close": close, "high": high, "low": low,
            "idx": {d: i for i, d in enumerate(dates)}}


def _signals(b: dict, i: int) -> dict[str, float]:
    """Lookahead-safe candidate signals at index i (ported from research/backtest.py)."""
    c, hi = b["close"], b["high"]
    if i < 130 or i >= len(c):
        return {}
    sma20 = sum(c[i - 19:i + 1]) / 20
    sma50 = sum(c[i - 49:i + 1]) / 50
    rets = [(c[k] - c[k - 1]) / c[k - 1] for k in range(i - 59, i + 1)]
    vola = statistics.pstdev(rets) or 1e-6
    trend = 0.5 if c[i] > sma20 > sma50 else -0.5 if c[i] < sma20 < sma50 else 0.0
    mom60 = c[i] / c[i - 60] - 1
    return {
        "voladj_mom": mom60 / vola,
        "hi_prox": c[i] / max(hi[i - 251:i + 1] or [c[i]]),
        "chart_combo": trend + max(-0.4, min(0.4, mom60 / 0.25 * 0.4))
                       + (0.3 if c[i] >= 0.97 * max(hi[i - 59:i + 1]) else 0.0),
        "breakout": 1.0 if c[i] >= 0.985 * max(hi[i - 59:i + 1]) else 0.0,
    }


def _fwd_excess(b: dict, spy: dict, i: int, h: int) -> float | None:
    if i + h >= len(b["close"]):
        return None
    r = b["close"][i + h] / b["close"][i] - 1
    d0, dh = b["dates"][i], b["dates"][i + h]
    si, sh = spy["idx"].get(d0), spy["idx"].get(dh)
    if si is None or sh is None:
        return r
    return r - (spy["close"][sh] / spy["close"][si] - 1)


def _spearman(xs: list[float], ys: list[float]) -> float:
    n = len(xs)
    if n < 5:
        return float("nan")

    def rank(v: list[float]) -> list[float]:
        order = sorted(range(len(v)), key=lambda k: v[k])
        r = [0.0] * len(v)
        for pos, k in enumerate(order):
            r[k] = pos
        return r

    rx, ry = rank(xs), rank(ys)
    mx, my = sum(rx) / n, sum(ry) / n
    num = sum((a - mx) * (bb - my) for a, bb in zip(rx, ry))
    den = math.sqrt(sum((a - mx) ** 2 for a in rx) * sum((bb - my) ** 2 for bb in ry))
    return num / den if den else float("nan")


def _asof_indices(spy: dict) -> list[int]:
    """The most recent LOOKBACK_DATES trading indices, strided, that still leave room for the
    longest forward horizon."""
    n = len(spy["dates"])
    last = n - max(HORIZONS) - 1
    idx = [last - k * DATE_STRIDE for k in range(LOOKBACK_DATES)]
    return sorted(i for i in idx if i > 130)


def run_sweep(uw, universe: list[str] | None = None) -> dict:
    """Full sweep. Returns {signal: {horizon: {mean_ic, t_stat, oos_pos, n_dates, ls_spread}}}
    plus meta. Market-relative throughout. Pure measurement — proposes nothing."""
    universe = universe or UNIVERSE
    spy = _bars(uw, "SPY")
    if not spy:
        return {"error": "no SPY bars", "signals": {}}
    bars = {t: _bars(uw, t) for t in universe}
    bars = {t: b for t, b in bars.items() if b}
    asof = _asof_indices(spy)
    # map each name's own index for a shared calendar date (names share trading days)
    sig_names = ["voladj_mom", "hi_prox", "chart_combo", "breakout"]
    out: dict[str, dict] = {s: {h: {"ics": [], "spreads": []} for h in HORIZONS}
                            for s in sig_names}
    for si in asof:
        date = spy["dates"][si]
        for h in HORIZONS:
            for sig in sig_names:
                xs, ys = [], []
                for b in bars.values():
                    i = b["idx"].get(date)
                    if i is None:
                        continue
                    sv = _signals(b, i)
                    if sig not in sv:
                        continue
                    fe = _fwd_excess(b, spy, i, h)
                    if fe is None:
                        continue
                    xs.append(sv[sig])
                    ys.append(fe)
                if len(xs) >= 8:
                    ic = _spearman(xs, ys)
                    if not math.isnan(ic):
                        out[sig][h]["ics"].append(ic)
                        # long-short: top-third minus bottom-third mean forward excess
                        order = sorted(range(len(xs)), key=lambda k: xs[k])
                        third = max(1, len(xs) // 3)
                        bot = statistics.mean(ys[k] for k in order[:third])
                        top = statistics.mean(ys[k] for k in order[-third:])
                        out[sig][h]["spreads"].append(top - bot)
    # roll up
    rolled: dict[str, dict] = {}
    for sig in sig_names:
        rolled[sig] = {}
        for h in HORIZONS:
            ics = out[sig][h]["ics"]
            spreads = out[sig][h]["spreads"]
            if not ics:
                rolled[sig][str(h)] = {"mean_ic": None, "t_stat": None, "oos_pos": 0,
                                       "n_dates": 0, "ls_spread": None}
                continue
            mic = statistics.mean(ics)
            sd = statistics.pstdev(ics) or 1e-9
            t = mic / (sd / math.sqrt(len(ics)))
            rolled[sig][str(h)] = {
                "mean_ic": round(mic, 4), "t_stat": round(t, 2),
                "oos_pos": sum(1 for x in ics if x > 0), "n_dates": len(ics),
                "ls_spread": round(statistics.mean(spreads) * 100, 2) if spreads else None,
            }
    return {"signals": rolled, "n_names": len(bars), "n_dates": len(asof),
            "universe": len(universe)}
