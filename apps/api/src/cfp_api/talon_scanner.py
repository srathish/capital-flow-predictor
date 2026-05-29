"""Talon scanner library — Phase 3-validated flow gates.

Reads GEX timeseries JSON from a local cache dir, computes per-ticker metrics,
ranks, and grades. Output is serializable to JSON for the /v1/talon endpoints.

Gates used (validated against the 48-ticker May 18 universe in Phase 3):
  - delta_buildup (RANK-based, top-decile weighted)        ✓ r=0.485, p=0.0006
  - vanna_band (sweet spot 0.65-1.05, peak at 0.85)        ✓ ρ=-0.510, p=0.0003 (sign was inverted in Phase 2)
  - theme_coherence (mean Spearman corr w/ theme peers)    ✓ largest std coefficient
  - call_dom directional anchor (above/below 50%)          context, not a gate

Excluded (failed Phase 3 validation):
  - call_dom_trend_5d                                      ✗ p=0.49 universe-wide
  - gamma_sign × thesis                                    △ p=0.075, bullish only
"""
from __future__ import annotations

import json
import logging
import os
import threading
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from scipy import stats

from cfp_api import talon_uw_client as uw_client

log = logging.getLogger(__name__)

# Per-scan live client. Reused across scans (auth + http connection pooling).
_LIVE_CLIENT: uw_client.TalonUwClient | None = None

# ---------------------------------------------------------------------------
# Scan-in-progress state
#
# Every Run Scan is a fresh UW fetch; there's no result cache. But concurrent
# clicks must NOT trigger two parallel scans of the same data. The "in-flight"
# pattern: when a scan starts, the lock is taken and progress is published to
# _SCAN_STATE. Concurrent callers block on the lock and receive the same final
# result. A progress endpoint reads _SCAN_STATE without taking the lock.
# ---------------------------------------------------------------------------
_SCAN_LOCK = threading.Lock()
_PROGRESS_LOCK = threading.Lock()
_SCAN_STATE: dict[str, Any] = {
    "status": "idle",                # "idle" | "running" | "complete" | "error"
    "scan_id": None,
    "started_at": None,
    "completed_at": None,
    "phase": None,                   # "prewarm_gex" | "prewarm_dp" | "metrics" | "coherence" | "ranking"
    "phase_progress": 0,             # int — current item
    "phase_total": 0,                # int — total items in this phase
    "current_ticker": None,
    "last_error": None,
}


def get_scan_progress() -> dict[str, Any]:
    """Snapshot of the current scan state. Thread-safe."""
    with _PROGRESS_LOCK:
        return dict(_SCAN_STATE)


def _set_progress(**kwargs) -> None:
    with _PROGRESS_LOCK:
        _SCAN_STATE.update(kwargs)


def _get_live_client() -> uw_client.TalonUwClient | None:
    """Return a shared live client, or None if live fetching is disabled / unauthorized."""
    global _LIVE_CLIENT
    if not uw_client.use_live_fetch():
        return None
    if _LIVE_CLIENT is None:
        try:
            _LIVE_CLIENT = uw_client.TalonUwClient()
        except RuntimeError as e:
            log.warning("Talon live client unavailable (%s); falling back to disk cache.", e)
            return None
    return _LIVE_CLIENT


def reset_live_client() -> None:
    """Force fresh client + clear the in-process TTL cache. Used by force-refresh path."""
    global _LIVE_CLIENT
    if _LIVE_CLIENT is not None:
        _LIVE_CLIENT.close()
        _LIVE_CLIENT = None
    uw_client.clear_cache()

# Cache location is configurable via env so different deploys can point to
# their own GEX store. Defaults to repo-relative `talon_analysis/cache/uw_gex/`
# so local runs work out of the box.
_DEFAULT_CACHE = Path(__file__).resolve().parents[4] / "talon_analysis" / "cache" / "uw_gex"
GEX_CACHE_DIR = Path(os.environ.get("TALON_GEX_CACHE_DIR", str(_DEFAULT_CACHE)))

# Dark pool cache — per-ticker JSON from /api/stock/{t}/volume-by-price (latest session)
_DEFAULT_DP_CACHE = Path(__file__).resolve().parents[4] / "talon_analysis" / "cache" / "uw_dp"
DP_CACHE_DIR = Path(os.environ.get("TALON_DP_CACHE_DIR", str(_DEFAULT_DP_CACHE)))

# Output dir — where scan JSONs are persisted between runs.
_DEFAULT_OUT = Path(__file__).resolve().parents[4] / "talon_analysis" / "output"
OUTPUT_DIR = Path(os.environ.get("TALON_OUTPUT_DIR", str(_DEFAULT_OUT)))
OUTPUT_DIR.mkdir(exist_ok=True, parents=True)

# Universe file — default to repo-relative phase4 universe; override-able.
_DEFAULT_UNIVERSE = Path(__file__).resolve().parents[4] / "talon_analysis" / "phase4_scanner" / "universe.txt"
UNIVERSE_FILE = Path(os.environ.get("TALON_UNIVERSE_FILE", str(_DEFAULT_UNIVERSE)))


# Gate weights from Phase 3 standardized regression coefficients (gates-only model)
GRADE_WEIGHTS = {
    "delta_buildup_rank": 0.30,
    "vanna_band_match": 0.18,
    "theme_coherence": 0.37,
    "call_dom_above_50": 0.15,
}

THEMES: dict[str, list[str]] = {
    "clean_energy":   ["ENPH", "FSLR", "RUN", "PLUG", "SEDG", "BLDP", "FCEL", "TAN"],
    "ev_autos":       ["RIVN", "F", "TSLA", "LCID", "NIO", "GM", "MVST", "HYLN"],
    "crypto_miners":  ["CLSK", "MARA", "RIOT", "IREN", "HUT", "HIVE", "WULF", "CIFR", "BTDR", "CORZ", "BITO"],
    "crypto_tokens":  ["MSTR", "IBIT", "ETHA", "COIN", "BMNR", "SBET", "GLXY"],
    "ai_cloud":       ["MSFT", "META", "AMZN", "GOOGL", "GOOG", "NVDA", "ORCL", "PLTR", "CRM",
                       "SNOW", "NET", "DDOG", "CRWD", "PANW", "NOW", "WDAY", "MDB", "ZS"],
    "semis":          ["SMCI", "MU", "TXN", "AMD", "NVDA", "QCOM", "AMAT", "ASML", "LRCX", "KLAC",
                       "AVGO", "TSM", "MRVL", "ARM", "INTC", "ON", "MPWR", "TER", "CDNS", "SNPS"],
    "ai_compute_infra": ["CRWV", "VRT", "ANET", "NBIS", "BBAI", "APLD", "IREN"],
    "consumer_travel":["DIS", "BKNG", "PINS", "HOOD", "RCL", "CCL", "DASH", "LYFT", "HD",
                       "UAL", "DAL", "EXPE", "WYNN", "MGM", "ABNB", "PENN", "DKNG"],
    "fintech":        ["COIN", "PYPL", "SOFI", "UPST", "AFRM", "HOOD", "SCHW"],
    "ad_tech":        ["TTD", "META", "GOOGL", "PINS", "SNAP", "RBLX"],
    "china_internet": ["KWEB", "BABA", "JD", "BIDU", "PDD", "FUTU", "TIGR", "VNET", "NIO"],
    "metals":         ["SLV", "GLD", "GDX", "RIO", "VALE", "FCX", "STLD"],
    "energy":         ["XLE", "OXY", "COP", "CVX", "XOM", "DVN", "HAL", "PBR", "VLO", "BP", "USO"],
    "healthcare":     ["JNJ", "UNH", "LLY", "MRK", "ISRG", "REGN", "BIIB", "VRTX", "CRSP", "MRNA",
                       "AMGN", "GILD", "ABBV", "TMO", "DXCM", "SYK", "HUM"],
    "retail":         ["AMZN", "EBAY", "ETSY", "CHWY", "DKS", "RH", "ULTA", "ELF", "FIVE", "LULU", "TGT", "WMT", "COST"],
    "satellite_space":["RKLB", "RDW", "ASTS", "PL", "LUNR", "SATL", "SPIR", "IRDM", "VSAT", "AMPG", "AMPX"],
    "quantum":        ["IONQ", "RGTI", "QBTS", "AI"],
    "nuclear_uranium":["CEG", "VST", "SMR", "OKLO", "NNE", "CCJ", "LEU", "UEC", "UUUU", "BWXT", "NRG"],
    "drones_defense": ["RCAT", "KTOS", "RTX", "LMT", "NOC", "HII", "ITA"],
    "nasdaq_hedge":   ["QQQ", "SQQQ", "TQQQ"],
    "semis_hedge":    ["SMH", "SOXL"],
    "software_hedge": ["IGV"],
    "staples_hedge":  ["XLP"],
    "vol_hedge":      ["VIX", "UVXY", "TBT"],
}


# ----------------------------------------------------------------------------
# Data loading + metrics
# ----------------------------------------------------------------------------
def _load_gex_df(ticker: str) -> pd.DataFrame:
    """Load GEX timeseries for a ticker; return enriched DataFrame.

    Lookup order:
      1. Live UW (15-min TTL cached) — production path
      2. Disk JSON fixture — dev fallback when TALON_USE_LIVE_FETCH=0 or live unavailable
    """
    data: dict | None = None
    client = _get_live_client()
    if client is not None:
        try:
            data = client.gex_timeseries(ticker)
        except Exception as e:  # noqa: BLE001 — defensive: live failure → disk
            log.warning("live GEX fetch failed for %s: %s; falling back to disk", ticker, e)
    if data is None:
        path = GEX_CACHE_DIR / f"{ticker.replace('^', '_')}.json"
        if not path.exists():
            return pd.DataFrame()
        try:
            data = json.loads(path.read_text())
        except json.JSONDecodeError:
            return pd.DataFrame()
    if not data or "_error" in data:
        return pd.DataFrame()
    rows = data.get("result") or data.get("data") or []
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows)
    cols = ["call_gamma", "put_gamma", "call_delta", "put_delta",
            "call_charm", "put_charm", "call_vanna", "put_vanna"]
    for c in cols:
        if c in df:
            df[c] = pd.to_numeric(df[c], errors="coerce")
    df["date"] = pd.to_datetime(df["date"])
    df = df.sort_values("date").reset_index(drop=True)
    df["net_gamma"] = df["call_gamma"] + df["put_gamma"]
    df["net_delta"] = df["call_delta"] + df["put_delta"]
    df["net_vanna"] = df["call_vanna"] + df["put_vanna"]
    df["call_dominance_pct"] = (
        df["call_delta"] / (df["call_delta"] + df["put_delta"].abs()) * 100
    )
    return df


def _load_dp_metrics(ticker: str) -> dict | None:
    """Compute single-session dark pool metrics from cached price-group JSON.

    Returns:
      dp_vwap         — volume-weighted avg price across DP prints
      dp_share_pct    — DP volume / (DP + regular) total volume * 100
      dp_skew_pct     — (dp_vwap - reference_close) / reference_close * 100
                        Positive = institutions paid above midline (bullish)
      dp_volume_total — sum of DP volume across all price levels
      dp_session_date — the date the snapshot represents
    Returns None if no usable data on disk.

    Reference close is approximated as the volume-weighted-midpoint of TOTAL
    (DP + regular) prints — i.e. where the bulk of the day's trading cleared.
    DP_skew vs midline > 0 → DP printed disproportionately above midline.
    """
    data: dict | None = None
    client = _get_live_client()
    if client is not None:
        try:
            data = client.dp_volume_by_price(ticker)
        except Exception as e:  # noqa: BLE001
            log.warning("live DP fetch failed for %s: %s; falling back to disk", ticker, e)
    if data is None:
        path = DP_CACHE_DIR / f"{ticker.replace('^', '_')}.json"
        if not path.exists():
            return None
        try:
            data = json.loads(path.read_text())
        except json.JSONDecodeError:
            return None
    if not data or "_error" in data:
        return None
    rows = data.get("stock_price_vol") or []
    if not rows:
        return None
    sess = data.get("date") or (rows[0].get("date") if rows else None)
    total_dp = 0.0
    total_reg = 0.0
    dp_pv = 0.0  # Σ(price × dp_vol)
    total_pv = 0.0  # Σ(price × (dp + reg))
    for r in rows:
        try:
            price = float(r.get("price"))
        except (TypeError, ValueError):
            continue
        dp_v = float(r.get("dark_pool_volume") or 0)
        reg_v = float(r.get("regular_volume") or 0)
        total_dp += dp_v
        total_reg += reg_v
        dp_pv += price * dp_v
        total_pv += price * (dp_v + reg_v)
    if total_dp == 0 or (total_dp + total_reg) == 0:
        return None
    dp_vwap = dp_pv / total_dp
    midline = total_pv / (total_dp + total_reg)  # session midline
    dp_share = total_dp / (total_dp + total_reg) * 100
    dp_skew = (dp_vwap - midline) / midline * 100 if midline else 0.0
    return {
        "dp_vwap": round(dp_vwap, 4),
        "dp_share_pct": round(dp_share, 2),
        "dp_skew_pct": round(dp_skew, 3),
        "dp_volume_total": int(total_dp),
        "dp_session_date": sess,
    }


def _theme_for(ticker: str) -> str:
    for name, tickers in THEMES.items():
        if ticker in tickers:
            return name
    return "unthemed"


def _val_near(df: pd.DataFrame, target: pd.Timestamp, col: str, look_back: int = 4) -> float:
    if df.empty:
        return float("nan")
    sub = df[(df["date"] <= target) & (df["date"] >= target - timedelta(days=look_back))]
    if sub.empty:
        return float("nan")
    return float(sub.iloc[-1][col])


def _val_n_days_back(df: pd.DataFrame, target: pd.Timestamp, n_days: int, col: str) -> float:
    return _val_near(df, target - timedelta(days=n_days), col)


def _compute_metrics(ticker: str, scan_date: pd.Timestamp) -> dict | None:
    df = _load_gex_df(ticker)
    if df.empty or len(df) < 5:
        return None
    pre = df[df["date"] < scan_date - timedelta(days=10)]
    recent = df[df["date"] >= scan_date - timedelta(days=10)]
    if pre.empty or recent.empty:
        return None
    cd_scan = _val_near(df, scan_date, "call_dominance_pct")
    delta_pre_mean = pre["net_delta"].mean()
    delta_recent_mean = recent["net_delta"].mean()
    if not pd.isna(delta_pre_mean) and delta_pre_mean != 0:
        delta_buildup_pct = (delta_recent_mean - delta_pre_mean) / abs(delta_pre_mean) * 100
    else:
        delta_buildup_pct = float("nan")
    vanna_now = _val_near(df, scan_date, "net_vanna")
    vanna_back = _val_n_days_back(df, scan_date, 5, "net_vanna")
    if not pd.isna(vanna_back) and vanna_back != 0:
        vanna_ratio = vanna_now / vanna_back
    else:
        vanna_ratio = float("nan")
    gamma_scan = _val_near(df, scan_date, "net_gamma")
    dp = _load_dp_metrics(ticker)
    return {
        "ticker": ticker,
        "call_dom_now": cd_scan,
        "delta_buildup_pct": delta_buildup_pct,
        "vanna_ratio_5d_back": vanna_ratio,
        "gamma_now": gamma_scan,
        "gamma_positive": int(gamma_scan > 0) if not pd.isna(gamma_scan) else 0,
        "n_gex_days": int(len(df)),
        # Dark pool (latest session). Display-only — no grade weight (unvalidated).
        "dp_vwap": dp["dp_vwap"] if dp else None,
        "dp_share_pct": dp["dp_share_pct"] if dp else None,
        "dp_skew_pct": dp["dp_skew_pct"] if dp else None,
        "dp_volume_total": dp["dp_volume_total"] if dp else None,
        "dp_session_date": dp["dp_session_date"] if dp else None,
    }


def _compute_theme_coherence(rows: list[dict]) -> None:
    """Mutate rows: add theme_coherence (mean Spearman corr with same-theme peers)."""
    cache: dict[str, pd.Series] = {}
    for r in rows:
        df = _load_gex_df(r["ticker"])
        if not df.empty:
            cache[r["ticker"]] = df.set_index("date")["call_dominance_pct"]
    for r in rows:
        theme = r["theme"]
        peers = [t for t in THEMES.get(theme, []) if t != r["ticker"] and t in cache]
        if not peers or r["ticker"] not in cache:
            r["theme_coherence"] = None
            continue
        my_ts = cache[r["ticker"]]
        corrs = []
        for p in peers[:8]:
            peer_ts = cache[p]
            common = my_ts.index.intersection(peer_ts.index)
            if len(common) < 5:
                continue
            corr, _ = stats.spearmanr(my_ts.loc[common], peer_ts.loc[common])
            if not pd.isna(corr):
                corrs.append(float(corr))
        r["theme_coherence"] = round(float(np.mean(corrs)), 4) if corrs else None


def _band_score(x: float | None) -> float:
    if x is None or pd.isna(x):
        return 0.5
    if 0.65 <= x <= 1.05:
        return float(1.0 - 0.5 * abs(x - 0.85) / 0.4)
    if x > 1.05:
        return float(max(0.0, 1.0 - (x - 1.05) / 0.5))
    return float(max(0.0, 1.0 - (0.65 - x) / 0.3))


# ----------------------------------------------------------------------------
# Public API — load universe, run scan
# ----------------------------------------------------------------------------
def load_universe() -> list[str]:
    if not UNIVERSE_FILE.exists():
        return []
    return [t.strip() for t in UNIVERSE_FILE.read_text().splitlines() if t.strip()]


def run_scan(scan_date: str | None = None) -> dict[str, Any]:
    """Run the full scan. Returns serializable result dict.

    scan_date: YYYY-MM-DD. Defaults to today.

    Concurrency: serialized via _SCAN_LOCK. If a scan is in progress when this
    is called, the caller blocks until it completes and then runs a fresh scan
    (the lock is released before this returns).
    """
    with _SCAN_LOCK:
        scan_id = uuid.uuid4().hex[:12]
        started_at = datetime.now(UTC)
        _set_progress(
            status="running",
            scan_id=scan_id,
            started_at=started_at.isoformat(),
            completed_at=None,
            phase="init",
            phase_progress=0,
            phase_total=0,
            current_ticker=None,
            last_error=None,
        )
        try:
            return _run_scan_inner(scan_date, scan_id, started_at)
        except Exception as e:
            log.exception("Talon scan failed")
            _set_progress(status="error", last_error=str(e),
                          completed_at=datetime.now(UTC).isoformat())
            raise


def _run_scan_inner(
    scan_date: str | None, scan_id: str, started_at: datetime
) -> dict[str, Any]:
    if scan_date is None:
        scan_date_ts = pd.Timestamp(datetime.now(UTC).date())
    else:
        scan_date_ts = pd.Timestamp(scan_date)

    universe = load_universe()
    client = _get_live_client()

    # Phase 1: prewarm GEX
    if client is not None:
        log.info("Talon: pre-warming GEX for %d tickers", len(universe))
        _set_progress(phase="prewarm_gex", phase_progress=0,
                      phase_total=len(universe))
        client.gex_batch(universe)
        _set_progress(phase_progress=len(universe))

    # Phase 2: prewarm DP
    if client is not None:
        _set_progress(phase="prewarm_dp", phase_progress=0,
                      phase_total=len(universe))
        client.dp_batch(universe)
        _set_progress(phase_progress=len(universe))

    # Phase 3: serial metric computation (reads from cache, fast)
    _set_progress(phase="metrics", phase_progress=0,
                  phase_total=len(universe), current_ticker=None)
    rows: list[dict] = []
    skipped: list[str] = []
    for i, t in enumerate(universe):
        _set_progress(phase_progress=i, current_ticker=t)
        m = _compute_metrics(t, scan_date_ts)
        if m is None:
            skipped.append(t)
            continue
        m["theme"] = _theme_for(t)
        rows.append(m)
    _set_progress(phase_progress=len(universe), current_ticker=None)

    # Phase 4: theme coherence
    _set_progress(phase="coherence", phase_progress=0, phase_total=len(rows))
    _compute_theme_coherence(rows)
    _set_progress(phase_progress=len(rows))

    # Rank delta_buildup → percentile
    buildup_vals = [r["delta_buildup_pct"] for r in rows if not pd.isna(r["delta_buildup_pct"])]
    if buildup_vals:
        sorted_v = np.sort(buildup_vals)

        def _rank(x):
            if pd.isna(x):
                return 0.5
            return float(np.searchsorted(sorted_v, x) / max(1, len(sorted_v)))
    else:
        _rank = lambda _: 0.5  # noqa: E731

    for r in rows:
        bup_rank = _rank(r["delta_buildup_pct"])
        vanna_match = _band_score(r["vanna_ratio_5d_back"])
        coh = r["theme_coherence"]
        coh_norm = ((coh + 1) / 2) if coh is not None else 0.5
        cd = r["call_dom_now"]
        cd_score = (cd / 100) if (cd is not None and not pd.isna(cd)) else 0.5
        w = GRADE_WEIGHTS
        score = (
            w["delta_buildup_rank"] * bup_rank
            + w["vanna_band_match"] * vanna_match
            + w["theme_coherence"] * coh_norm
            + w["call_dom_above_50"] * cd_score
        )
        score = score / sum(w.values())
        r["grade"] = round(float(score * 100), 1)
        r["direction"] = (
            "bull" if (cd is not None and cd >= 55)
            else "bear" if (cd is not None and cd <= 45)
            else "neutral"
        )
        r["g_delta_score"] = round(bup_rank * 100, 1)
        r["g_vanna_score"] = round(vanna_match * 100, 1)
        r["g_theme_score"] = round(coh_norm * 100, 1)
        r["g_call_dom_score"] = round(cd_score * 100, 1)
        # Round floats for JSON cleanliness
        for k in ("call_dom_now", "delta_buildup_pct", "vanna_ratio_5d_back", "gamma_now"):
            if r.get(k) is not None and not pd.isna(r[k]):
                r[k] = round(float(r[k]), 4)
            else:
                r[k] = None

    rows.sort(key=lambda r: r["grade"], reverse=True)
    actionable = [r for r in rows if r["grade"] >= 70]
    watchlist = [r for r in rows if 55 <= r["grade"] < 70]
    skip = [r for r in rows if r["grade"] < 55]

    completed_at = datetime.now(UTC)
    elapsed_seconds = round((completed_at - started_at).total_seconds(), 1)
    result = {
        "scan_id": scan_id,
        "scan_date": scan_date_ts.strftime("%Y-%m-%d"),
        "generated_at": completed_at.isoformat(),
        "started_at": started_at.isoformat(),
        "elapsed_seconds": elapsed_seconds,
        "universe_total": len(universe),
        "with_gex_data": len(rows),
        "skipped_no_data": len(skipped),
        "actionable_count": len(actionable),
        "watchlist_count": len(watchlist),
        "skip_count": len(skip),
        "actionable": actionable,
        "watchlist": watchlist[:75],
        "skipped_tickers": skipped[:50],
        "gate_weights_used": GRADE_WEIGHTS,
        "notes": (
            "Phase 3-validated gates only. Excludes call_dom_trend (p=0.49) and "
            "gamma_sign (marginal). Vanna gate uses 5d-backward ratio "
            "(vanna_today / vanna_5d_ago) as real-time proxy for the Phase 2 "
            "t+3d-forward stability measure. Sweet spot 0.65-1.05, peak ~0.85."
        ),
    }
    _set_progress(
        status="complete",
        completed_at=completed_at.isoformat(),
        phase="done",
        current_ticker=None,
    )
    return result


def write_scan_to_disk(scan: dict[str, Any]) -> Path:
    fname = f"scan_{scan['scan_date']}.json"
    out_path = OUTPUT_DIR / fname
    out_path.write_text(json.dumps(scan, indent=2))
    return out_path


def load_latest_scan() -> dict[str, Any] | None:
    """Return the most recent scan_*.json on disk."""
    scans = sorted(OUTPUT_DIR.glob("scan_*.json"))
    if not scans:
        return None
    try:
        return json.loads(scans[-1].read_text())
    except json.JSONDecodeError:
        return None
