"""Stage 2 — Unusual Whales flow confirmation overlay.

Per-ticker flow data + per-sector tide multiplier → 0-100 flow_score.

Changes vs v0:
- Replaced sparse `/net-prem-ticks` rollup with daily `/options-volume` summary
  (has explicit daily `net_call_premium`, `bullish_premium`, `bearish_premium`).
- `flow_confirmed` no longer requires cheap-options; it's purely directional
  (>=2 of {net call positive, bullish alerts, dark-pool accumulation}).
  Cheap-IV stays as a separate flag and a flow_score component.
- Sector tide multiplier: `/api/market/{sector}/sector-tide` rolled up today,
  applied as 1.10 / 1.00 / 0.85 on flow_score.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

import pandas as pd

from .client import UWClient


@dataclass
class FlowRow:
    ticker: str
    sector: str | None
    iv_rank: float | None
    iv30d: float | None
    cheap_options: bool
    net_call_prem_5d: float
    net_call_prem_positive: bool
    bullish_alerts_5d: int
    has_bullish_alerts: bool
    darkpool_prints_3d: int
    darkpool_above_close_ratio: float
    darkpool_accumulation: bool
    oi_change_call_pct: float | None
    sector_tide_label: str
    sector_tide_mult: float
    flow_confirmed: bool          # >=2 directional signals (independent of IV)
    flow_confirmed_cheap: bool    # flow_confirmed AND cheap_options
    flow_score: float

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _safe_float(v: Any) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _net_call_prem_daily(raw: Any, n_days: int) -> float:
    """Sum daily net_call_premium over the last n_days from /options-volume.

    options-volume rows: {date, net_call_premium, bullish_premium, bearish_premium, ...}
    """
    if not raw or "data" not in raw:
        return 0.0
    rows = raw["data"]
    if not rows:
        return 0.0
    df = pd.DataFrame(rows)
    if "net_call_premium" not in df.columns:
        return 0.0
    df["net_call_premium"] = pd.to_numeric(df["net_call_premium"], errors="coerce").fillna(0)
    if "date" in df.columns:
        df["date"] = pd.to_datetime(df["date"], errors="coerce").dt.date
        df = df.sort_values("date").tail(n_days)
    return float(df["net_call_premium"].sum())


def _bullish_alerts(raw: Any, n_days: int) -> int:
    if not raw or "data" not in raw:
        return 0
    rows = raw["data"]
    cutoff = _now_utc() - timedelta(days=n_days)
    count = 0
    for r in rows:
        if (r.get("type") or "").lower() != "call":
            continue
        ask = _safe_float(r.get("total_ask_side_prem")) or 0.0
        bid = _safe_float(r.get("total_bid_side_prem")) or 0.0
        total = ask + bid
        if total <= 0 or (ask / total) < 0.55:
            continue
        ts = r.get("created_at") or r.get("executed_at") or r.get("alert_time")
        if ts:
            try:
                if pd.to_datetime(ts, utc=True).to_pydatetime() < cutoff:
                    continue
            except Exception:  # noqa: BLE001
                pass
        count += 1
    return count


def _darkpool_stats(raw: Any, n_days: int, ref_price: float) -> tuple[int, float]:
    if not raw or "data" not in raw or not ref_price:
        return 0, 0.0
    rows = raw["data"]
    cutoff = _now_utc() - timedelta(days=n_days)
    n_recent = n_above = 0
    for r in rows:
        ts = r.get("executed_at")
        if ts:
            try:
                if pd.to_datetime(ts, utc=True).to_pydatetime() < cutoff:
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
    if not raw or "data" not in raw:
        return None
    rows = raw["data"]
    call_delta = put_delta = 0.0
    for r in rows:
        sym = r.get("option_symbol") or ""
        otype = ""
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
    return call_delta / total


def fetch_sector_tides(
    client: UWClient,
    sectors: list[str],
    cfg: dict,
) -> dict[str, tuple[str, float]]:
    """Pull today's sector-tide for each unique sector → (label, multiplier)."""
    s_cfg = cfg["stage2_flow"]["sector_tide"]
    if not s_cfg["enabled"]:
        return {}
    out: dict[str, tuple[str, float]] = {}
    today = _now_utc().date().isoformat()
    for sector in sectors:
        if not sector:
            continue
        try:
            raw = client.get(
                f"/api/market/{sector.replace(' ', '%20')}/sector-tide"
            )
        except Exception:  # noqa: BLE001
            raw = None
        if not raw or "data" not in raw:
            out[sector] = ("missing", s_cfg["neutral_mult"])
            continue
        rows = raw["data"]
        if not rows:
            out[sector] = ("missing", s_cfg["neutral_mult"])
            continue
        # Sum today's net_call_premium across intraday ticks.
        df = pd.DataFrame(rows)
        if "net_call_premium" not in df.columns:
            out[sector] = ("missing", s_cfg["neutral_mult"])
            continue
        df["net_call_premium"] = pd.to_numeric(df["net_call_premium"], errors="coerce").fillna(0)
        if "date" in df.columns:
            df = df[df["date"].astype(str) == today]
        total = float(df["net_call_premium"].sum())
        if total > s_cfg["neutral_threshold_dollars"]:
            out[sector] = ("bullish", s_cfg["bullish_mult"])
        elif total < -s_cfg["neutral_threshold_dollars"]:
            out[sector] = ("bearish", s_cfg["bearish_mult"])
        else:
            out[sector] = ("neutral", s_cfg["neutral_mult"])
    return out


def fetch_flow(
    client: UWClient,
    tickers: list[str],
    ref_prices: dict[str, float],
    iv_lookup: dict[str, dict[str, Any]],
    sector_lookup: dict[str, str | None],
    sector_tide: dict[str, tuple[str, float]],
    cfg: dict,
) -> dict[str, FlowRow]:
    s = cfg["stage2_flow"]
    threads = cfg["api"]["thread_count"]

    def _pull(t: str) -> FlowRow:
        opt_vol = client.get(f"/api/stock/{t}/options-volume")
        flow_alerts = client.get(f"/api/stock/{t}/flow-alerts", params={"limit": 200})
        darkpool = client.get(f"/api/darkpool/{t}", params={"limit": 200})
        oi_change = client.get(f"/api/stock/{t}/oi-change", params={"limit": 50})
        iv_rank = iv_lookup.get(t, {}).get("iv_rank")
        iv30d = iv_lookup.get(t, {}).get("iv30d")
        sector = sector_lookup.get(t)

        net_call_5d = _net_call_prem_daily(opt_vol, s["net_prem_days"])
        alerts_n = _bullish_alerts(flow_alerts, s["alerts_lookback_days"])
        dp_n, dp_ratio = _darkpool_stats(darkpool, s["darkpool_lookback_days"], ref_prices.get(t, 0.0))
        oi_pct = _oi_change_call_pct(oi_change)

        cheap = iv_rank is not None and iv_rank <= s["iv_rank_max"]
        net_pos = net_call_5d > s["net_prem_min_dollars"]
        alerts_ok = alerts_n >= s["alerts_bullish_min"]
        dp_accum = dp_ratio >= s["darkpool_min_above_close_ratio"] and dp_n >= 3

        # Base flow score (0-100, before sector multiplier).
        score = 0.0
        if cheap:
            score += 15.0
            if s.get("iv_rank_weight_bonus") and iv_rank is not None and iv_rank < 25:
                score += 5.0
        if net_pos:
            score += 25.0
            # Bonus for size — net call > $5M is a real conviction signal.
            if net_call_5d > 5_000_000:
                score += 10.0
        if alerts_ok:
            score += 15.0
            if alerts_n >= 5:
                score += 5.0
        if dp_accum:
            score += 15.0
        if oi_pct is not None:
            score += max(0.0, oi_pct) * 10.0

        # Sector tide multiplier.
        sector_label, sector_mult = sector_tide.get(sector or "", ("n/a", 1.0))
        score *= sector_mult
        score = min(100.0, score)

        confirmed_count = sum([net_pos, alerts_ok, dp_accum])
        flow_confirmed = confirmed_count >= 2
        flow_confirmed_cheap = flow_confirmed and cheap

        return FlowRow(
            ticker=t,
            sector=sector,
            iv_rank=iv_rank,
            iv30d=iv30d,
            cheap_options=bool(cheap),
            net_call_prem_5d=float(net_call_5d),
            net_call_prem_positive=bool(net_pos),
            bullish_alerts_5d=int(alerts_n),
            has_bullish_alerts=bool(alerts_ok),
            darkpool_prints_3d=int(dp_n),
            darkpool_above_close_ratio=float(dp_ratio),
            darkpool_accumulation=bool(dp_accum),
            oi_change_call_pct=oi_pct,
            sector_tide_label=sector_label,
            sector_tide_mult=float(sector_mult),
            flow_confirmed=bool(flow_confirmed),
            flow_confirmed_cheap=bool(flow_confirmed_cheap),
            flow_score=float(score),
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
