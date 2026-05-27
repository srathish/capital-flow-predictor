"""Stage 2 — Unusual Whales flow confirmation overlay.

Pulls per-ticker flow data and computes a 0-100 flow sub-score.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta
from typing import Any

import pandas as pd

from .client import UWClient


@dataclass
class FlowRow:
    ticker: str
    iv_rank: float | None
    iv30d: float | None
    cheap_options: bool          # iv_rank <= cfg.iv_rank_max
    net_call_prem_5d: float      # net call premium over the recent days
    net_call_prem_positive: bool
    bullish_alerts_5d: int
    has_bullish_alerts: bool
    darkpool_prints_3d: int
    darkpool_above_close_ratio: float
    darkpool_accumulation: bool
    oi_change_call_pct: float | None  # net OI change call-side (premium-weighted) recent
    flow_confirmed: bool         # composite: at least 2 of the 3 main flow signals
    flow_score: float            # 0-100

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _safe_float(v: Any) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _net_prem_recent(raw: Any, n_days: int) -> float:
    """net-prem-ticks returns intraday rows. Sum the most recent ~n_days worth of net call premium."""
    if not raw or "data" not in raw:
        return 0.0
    rows = raw["data"]
    if not rows:
        return 0.0
    df = pd.DataFrame(rows)
    # tick rows typically include net_call_premium, net_put_premium, tape_time.
    if "net_call_premium" not in df.columns:
        return 0.0
    df["net_call_premium"] = pd.to_numeric(df["net_call_premium"], errors="coerce").fillna(0)
    if "tape_time" in df.columns:
        df["tape_time"] = pd.to_datetime(df["tape_time"], errors="coerce", utc=True)
        cutoff = datetime.utcnow().replace(tzinfo=df["tape_time"].iloc[0].tzinfo) - timedelta(days=n_days)
        df = df[df["tape_time"] >= cutoff]
    return float(df["net_call_premium"].sum())


def _bullish_alerts(raw: Any, n_days: int) -> int:
    if not raw or "data" not in raw:
        return 0
    rows = raw["data"]
    cutoff = datetime.utcnow() - timedelta(days=n_days)
    count = 0
    for r in rows:
        # Bullish = CALL alert where ask-side premium dominates bid-side.
        if (r.get("type") or "").lower() != "call":
            continue
        ask = _safe_float(r.get("total_ask_side_prem")) or 0.0
        bid = _safe_float(r.get("total_bid_side_prem")) or 0.0
        total = ask + bid
        if total <= 0:
            continue
        if (ask / total) < 0.55:
            continue
        ts = r.get("created_at") or r.get("executed_at") or r.get("alert_time")
        if ts:
            try:
                if pd.to_datetime(ts, utc=True).to_pydatetime().replace(tzinfo=None) < cutoff:
                    continue
            except Exception:  # noqa: BLE001
                pass
        count += 1
    return count


def _darkpool_stats(raw: Any, n_days: int, ref_price: float) -> tuple[int, float]:
    if not raw or "data" not in raw or not ref_price:
        return 0, 0.0
    rows = raw["data"]
    cutoff = datetime.utcnow() - timedelta(days=n_days)
    n_recent = 0
    n_above = 0
    for r in rows:
        ts = r.get("executed_at")
        if ts:
            try:
                if pd.to_datetime(ts, utc=True).to_pydatetime().replace(tzinfo=None) < cutoff:
                    continue
            except Exception:  # noqa: BLE001
                pass
        price = _safe_float(r.get("price"))
        if price is None:
            continue
        n_recent += 1
        if price >= ref_price:
            n_above += 1
    ratio = (n_above / n_recent) if n_recent > 0 else 0.0
    return n_recent, ratio


def _oi_change_call_pct(raw: Any) -> float | None:
    """Premium-weighted call vs put OI change over the recent rows."""
    if not raw or "data" not in raw:
        return None
    rows = raw["data"]
    call_delta = 0.0
    put_delta = 0.0
    for r in rows:
        # Option symbol like "APP260529C00435000": position 1+ticker_len has YYMMDD then C/P.
        sym = r.get("option_symbol") or ""
        otype = ""
        # Scan for the C/P after the 6-digit date in the symbol.
        for i in range(len(sym) - 1, 0, -1):
            ch = sym[i]
            if ch in ("C", "P") and sym[i + 1 : i + 2].isdigit():
                otype = "call" if ch == "C" else "put"
                break
        if not otype:
            otype = (r.get("option_type") or r.get("type") or "").lower()
        d = _safe_float(r.get("oi_diff_plain"))
        if d is None:
            prev_oi = _safe_float(r.get("last_oi") or r.get("prev_oi")) or 0.0
            cur_oi = _safe_float(r.get("curr_oi") or r.get("oi")) or 0.0
            d = cur_oi - prev_oi
        if otype == "call":
            call_delta += d
        elif otype == "put":
            put_delta += d
    total = abs(call_delta) + abs(put_delta)
    if total == 0:
        return None
    return call_delta / total  # in [-1, 1]; positive = calls growing faster


def fetch_flow(
    client: UWClient,
    tickers: list[str],
    ref_prices: dict[str, float],
    iv_lookup: dict[str, dict[str, float]],
    cfg: dict,
) -> dict[str, FlowRow]:
    """Pull flow endpoints in parallel per ticker."""
    s = cfg["stage2_flow"]
    threads = cfg["api"]["thread_count"]

    def _pull(t: str) -> FlowRow:
        # 5-endpoint stack per survivor.
        net_prem = client.get(f"/api/stock/{t}/net-prem-ticks")
        flow_alerts = client.get(f"/api/stock/{t}/flow-alerts", params={"limit": 200})
        darkpool = client.get(f"/api/darkpool/{t}", params={"limit": 200})
        oi_change = client.get(f"/api/stock/{t}/oi-change", params={"limit": 50})
        iv_rank = iv_lookup.get(t, {}).get("iv_rank")
        iv30d = iv_lookup.get(t, {}).get("iv30d")

        net_call_prem_5d = _net_prem_recent(net_prem, s["net_prem_days"])
        alerts_n = _bullish_alerts(flow_alerts, s["alerts_lookback_days"])
        dp_n, dp_ratio = _darkpool_stats(darkpool, s["darkpool_lookback_days"], ref_prices.get(t, 0.0))
        oi_pct = _oi_change_call_pct(oi_change)

        cheap = iv_rank is not None and iv_rank <= s["iv_rank_max"]
        net_pos = net_call_prem_5d > s["net_prem_min_dollars"]
        alerts_ok = alerts_n >= s["alerts_bullish_min"]
        dp_accum = dp_ratio >= s["darkpool_min_above_close_ratio"] and dp_n >= 3

        # Flow score (0-100): IV cheap 25, net prem positive 25, alerts 20, darkpool 15, OI tilt call 15.
        score = 0.0
        if cheap:
            score += 20.0
            if s.get("iv_rank_weight_bonus") and iv_rank is not None and iv_rank < 25:
                score += 5.0
        if net_pos:
            score += 25.0
        if alerts_ok:
            score += 15.0
            if alerts_n >= 5:
                score += 5.0
        if dp_accum:
            score += 15.0
        if oi_pct is not None:
            score += max(0.0, oi_pct) * 15.0  # up to +15 if all OI growth is call-side

        confirmed_count = sum([net_pos, alerts_ok, dp_accum])
        flow_confirmed = confirmed_count >= 2 and cheap  # require cheap-options AND >=2 directional signals

        return FlowRow(
            ticker=t,
            iv_rank=iv_rank,
            iv30d=iv30d,
            cheap_options=bool(cheap),
            net_call_prem_5d=float(net_call_prem_5d),
            net_call_prem_positive=bool(net_pos),
            bullish_alerts_5d=int(alerts_n),
            has_bullish_alerts=bool(alerts_ok),
            darkpool_prints_3d=int(dp_n),
            darkpool_above_close_ratio=float(dp_ratio),
            darkpool_accumulation=bool(dp_accum),
            oi_change_call_pct=oi_pct,
            flow_confirmed=bool(flow_confirmed),
            flow_score=float(min(100.0, score)),
        )

    results: dict[str, FlowRow] = {}
    with ThreadPoolExecutor(max_workers=threads) as ex:
        futs = {ex.submit(_pull, t): t for t in tickers}
        done = 0
        for f in as_completed(futs):
            row = f.result()
            results[row.ticker] = row
            done += 1
            if done % 5 == 0 or done == len(tickers):
                print(f"  flow {done}/{len(tickers)}", flush=True)
    return results
