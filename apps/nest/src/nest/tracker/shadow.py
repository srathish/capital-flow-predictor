"""Shadow-grading — the live-proof loop. Once a day it snapshots the finder's top book
(ticker, conviction, direction, reference price) and then, as those snapshots mature, grades
them at 1d/5d/20d against realized price MARKET-RELATIVE (excess vs SPY) — because a 60% hit
rate in a tape where everything rose is not skill (repo memory). Bear picks are graded as
shorts (profit when they fall relative to the market). The rollup is the Nest's live track
record: does high conviction actually beat the market? That's the only honest answer to
"does this give alpha," and it accrues on its own over ~a month.

Stored in NEST_HOME/shadow.json — separate from the event log; cheap, self-contained.
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, date, datetime

from nest import config

log = logging.getLogger(__name__)

_HORIZONS = {"1d": 1, "5d": 7, "20d": 28}   # trading-day horizon -> ~calendar days
_TOP_N = 30
_BUCKETS = [(70, 101, "70+"), (55, 70, "55-70"), (0, 55, "<55")]


def _path():
    return config.DATA_DIR / "shadow.json"


def _load() -> dict:
    p = _path()
    if p.exists():
        try:
            return json.loads(p.read_text())
        except (ValueError, OSError):
            pass
    return {"snaps": []}


def _save(d: dict) -> None:
    try:
        config.DATA_DIR.mkdir(parents=True, exist_ok=True)
        _path().write_text(json.dumps(d))
    except OSError:
        pass


def _close(uw, ticker: str) -> float | None:
    try:
        st = uw.get("stock_state", ticker=ticker) or {}
        v = st.get("close") or st.get("last")
        return float(v) if v else None
    except Exception:  # noqa: BLE001
        return None


def record_snapshot(log_db, uw, now: datetime | None = None) -> bool:
    """Once per day: snapshot the top-N book with reference prices. Returns True if written."""
    now = now or datetime.now(UTC)
    today = now.date().isoformat()
    d = _load()
    if any(s["date"] == today for s in d["snaps"]):
        return False
    spy_ref = _close(uw, "SPY")
    if not spy_ref:
        return False
    picks = {}
    for s in log_db.latest_scores(_TOP_N):
        c = _close(uw, s.ticker)
        if c:
            picks[s.ticker] = {"conv": round(s.conviction, 1), "dir": s.direction, "ref": c}
    if not picks:
        return False
    d["snaps"].append({"date": today, "ts": now.isoformat(timespec="seconds"),
                       "spy_ref": spy_ref, "picks": picks, "graded": {}})
    d["snaps"] = d["snaps"][-120:]   # keep ~4 months
    _save(d)
    log.info("shadow snapshot: %d picks recorded for %s", len(picks), today)
    return True


def grade_due(uw, now: datetime | None = None) -> int:
    """Grade every snapshot whose horizon has matured (market-relative excess). Idempotent."""
    now = now or datetime.now(UTC)
    d = _load()
    graded = 0
    spy_now = _close(uw, "SPY")
    if not spy_now:
        return 0
    for snap in d["snaps"]:
        snap_day = date.fromisoformat(snap["date"])
        age = (now.date() - snap_day).days
        for hz, cal in _HORIZONS.items():
            if age < cal or hz in snap["graded"]:
                continue
            spy_ret = spy_now / snap["spy_ref"] - 1
            rows = []
            for tk, info in snap["picks"].items():
                nc = _close(uw, tk)
                if not nc:
                    continue
                ret = nc / info["ref"] - 1
                excess = ret - spy_ret
                if info["dir"] == "bear":          # short: profit when it falls vs market
                    excess = -excess
                rows.append({"tk": tk, "conv": info["conv"], "dir": info["dir"],
                             "excess": round(excess * 100, 2), "hit": excess > 0})
            if rows:
                snap["graded"][hz] = rows
                graded += 1
    _save(d)
    if graded:
        log.info("shadow grade: %d horizon-groups graded", graded)
    return graded


def track_record() -> dict:
    """Live track record: per horizon, per conviction bucket — n, hit rate, mean excess%."""
    d = _load()
    out: dict[str, dict] = {}
    for hz in _HORIZONS:
        buckets = {label: {"n": 0, "hits": 0, "sum": 0.0} for _, _, label in _BUCKETS}
        for snap in d["snaps"]:
            for row in snap["graded"].get(hz, []):
                for lo, hi, label in _BUCKETS:
                    if lo <= row["conv"] < hi:
                        b = buckets[label]
                        b["n"] += 1
                        b["hits"] += int(row["hit"])
                        b["sum"] += row["excess"]
                        break
        out[hz] = {label: {"n": b["n"],
                           "hit_rate": round(b["hits"] / b["n"], 3) if b["n"] else None,
                           "mean_excess": round(b["sum"] / b["n"], 2) if b["n"] else None}
                   for label, b in buckets.items()}
    return out


def leg_record(min_conv: float = 55.0) -> dict:
    """Long-SHORT book proof: per horizon, split the graded actionable book (conv ≥ min_conv)
    into its long leg and short leg. Each row's `excess` is already sign-adjusted to "profit"
    (short rows were negated at grade time), so a working leg has positive mean_excess. The
    `spread` is long+short mean — the market-neutral book's edge, and the backtest's biggest
    alpha lever. This is the honest test of whether the short side actually pays."""
    d = _load()
    out: dict[str, dict] = {}
    for hz in _HORIZONS:
        legs = {"long": {"n": 0, "hits": 0, "sum": 0.0},
                "short": {"n": 0, "hits": 0, "sum": 0.0}}
        for snap in d["snaps"]:
            for row in snap["graded"].get(hz, []):
                if row["conv"] < min_conv:
                    continue
                leg = legs["short" if row["dir"] == "bear" else "long"]
                leg["n"] += 1
                leg["hits"] += int(row["hit"])
                leg["sum"] += row["excess"]

        def roll(b: dict) -> dict:
            return {"n": b["n"],
                    "hit_rate": round(b["hits"] / b["n"], 3) if b["n"] else None,
                    "mean_excess": round(b["sum"] / b["n"], 2) if b["n"] else None}

        lo_r, sh_r = roll(legs["long"]), roll(legs["short"])
        spread = (round(lo_r["mean_excess"] + sh_r["mean_excess"], 2)
                  if lo_r["mean_excess"] is not None and sh_r["mean_excess"] is not None
                  else None)
        out[hz] = {"long": lo_r, "short": sh_r, "spread": spread}
    return out


def summary() -> dict:
    """Headline numbers for the UI: the 20d 70+ bucket (the finder's flagship claim), plus the
    long/short leg split (does the market-neutral book earn its spread?)."""
    tr = track_record()
    lr = leg_record()
    flagship = tr.get("20d", {}).get("70+", {})
    total = sum(v["n"] for hz in tr.values() for v in hz.values())
    return {"graded_total": total, "flagship": flagship, "by_horizon": tr, "by_leg": lr}
