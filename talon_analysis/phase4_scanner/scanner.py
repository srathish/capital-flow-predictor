"""Phase 4 — Production Scanner over 504-ticker universe.

Built on Phase 3-validated gates only. Excludes failed/marginal gates.

Gates used:
  G1 — delta_buildup_pct (RANK-BASED, top-decile +full weight)
  G3 — vanna_band (0.65–1.05 sweet spot, penalize outside)
  Theme coherence (highest standardized coefficient in Phase 3 master regression)

Excluded:
  G2 — gamma_sign × thesis: marginal p=0.075, bullish-only effect
  G4 — call_dom_trend: failed (p=0.487)

Scan date is "today" (2026-05-28). Predictions for week of June 1-5.

KEY ADAPTATION from real-time use:
  Phase 3 used vanna_stability = vanna(t+3d) / vanna(t=0) — a forward-looking
  measure. For real-time scan we use the BACKWARD ratio: vanna(today) / vanna(3d ago).
  This proxies "is option-driven flow currently converting into price action?"

Output: output/scan_{date}.json + a printed top-N table.
"""
from __future__ import annotations

import json
from datetime import timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import yaml
import yfinance as yf
from scipy import stats

from talon_analysis.phase2_flow.metrics import load_gex

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output"
OUT.mkdir(exist_ok=True)
UNIVERSE_FILE = ROOT / "phase4_scanner" / "universe.txt"

SCAN_DATE = pd.Timestamp("2026-05-28")  # today
LOOKBACK_WINDOW_START = SCAN_DATE - timedelta(days=30)
GRADE_WEIGHTS = {
    # From Phase 3 standardized coefficients (gates-only model)
    "delta_buildup_rank": 0.30,      # G1: strongest validated gate
    "vanna_band_match":   0.18,      # G3: sweet-spot band
    "theme_coherence":    0.37,      # biggest coefficient in Phase 3
    "call_dom_above_50":  0.15,      # directional anchor
}

# Themes — restricted to what's in this scan universe
THEMES = {
    "clean_energy":   ["ENPH", "FSLR", "RUN", "PLUG", "SEDG", "BLDP", "FCEL", "TAN"],
    "ev_autos":       ["RIVN", "F", "TSLA", "LCID", "NIO", "GM", "MVST", "HYLN"],
    "crypto_miners":  ["CLSK", "MARA", "RIOT", "IREN", "HUT", "HIVE", "WULF", "CIFR", "BTDR", "CORZ", "BITO"],
    "crypto_tokens":  ["MSTR", "IBIT", "ETHA", "COIN", "BMNR", "SBET", "GLXY"],
    "ai_cloud":       ["MSFT", "META", "AMZN", "GOOGL", "GOOG", "NVDA", "ORCL", "PLTR", "CRM",
                       "SNOW", "NET", "DDOG", "CRWD", "PANW", "NOW", "WDAY", "MDB", "ZS"],
    "semis":          ["SMCI", "MU", "TXN", "AMD", "NVDA", "QCOM", "AMAT", "ASML", "LRCX", "KLAC",
                       "AVGO", "TSM", "MRVL", "ARM", "INTC", "ON", "MPWR", "TER", "CDNS", "SNPS"],
    "ai_compute_infra":["CRWV", "VRT", "ANET", "NBIS", "BBAI", "APLD", "IREN"],
    "consumer_travel":["DIS", "BKNG", "PINS", "HOOD", "RCL", "CCL", "DASH", "LYFT", "HD",
                       "UAL", "DAL", "EXPE", "WYNN", "MGM", "ABNB", "MAR", "PENN", "DKNG"],
    "fintech":        ["COIN", "PYPL", "SOFI", "UPST", "AFRM", "HOOD", "SCHW"],
    "ad_tech":        ["TTD", "META", "GOOGL", "PINS", "SNAP", "RBLX"],
    "china_internet": ["KWEB", "BABA", "JD", "BIDU", "PDD", "FUTU", "TIGR", "VNET", "NIO"],
    "metals":         ["SLV", "GLD", "GDX", "RIO", "VALE", "FCX", "STLD"],
    "energy":         ["XLE", "OXY", "COP", "CVX", "XOM", "DVN", "HAL", "PBR", "VLO", "BP", "USO"],
    "healthcare":     ["JNJ", "UNH", "LLY", "MRK", "ISRG", "REGN", "BIIB", "VRTX", "CRSP", "MRNA",
                       "AMGN", "GILD", "PFE", "BMY", "ABBV", "TMO", "DXCM", "SYK", "ELV", "HUM"],
    "retail":         ["AMZN", "EBAY", "ETSY", "CHWY", "DKS", "RH", "ULTA", "ELF", "FIVE", "LULU", "TGT", "WMT", "COST"],
    "satellite_space":["RKLB", "RDW", "ASTS", "PL", "LUNR", "SATL", "SPIR", "IRDM", "VSAT", "AMPG", "AMPX"],
    "quantum":        ["IONQ", "RGTI", "QBTS", "AI", "ANET"],
    "nuclear_uranium":["CEG", "VST", "SMR", "OKLO", "NNE", "CCJ", "LEU", "UEC", "UUUU", "BWXT", "NRG"],
    "drones_defense": ["RCAT", "AVAV", "KTOS", "RTX", "LMT", "NOC", "HII", "ITA"],
    "nasdaq_hedge":   ["QQQ", "SQQQ", "TQQQ"],
    "semis_hedge":    ["SMH", "SOXL"],
    "software_hedge": ["IGV"],
    "staples_hedge":  ["XLP"],
    "vol_hedge":      ["VIX", "UVXY", "TBT"],
}


# ----------------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------------
def _theme_for(ticker: str) -> str:
    for name, tickers in THEMES.items():
        if ticker in tickers:
            return name
    return "unthemed"


def _val_on_or_near(df: pd.DataFrame, target: pd.Timestamp, col: str,
                    look_back: int = 4) -> float:
    if df.empty:
        return float("nan")
    sub = df[(df["date"] <= target) & (df["date"] >= target - timedelta(days=look_back))]
    if sub.empty:
        return float("nan")
    return float(sub.iloc[-1][col])


def _val_n_days_back(df: pd.DataFrame, target: pd.Timestamp, n_days: int, col: str) -> float:
    return _val_on_or_near(df, target - timedelta(days=n_days), col)


def load_universe() -> list[str]:
    return [t.strip() for t in UNIVERSE_FILE.read_text().splitlines() if t.strip()]


# ----------------------------------------------------------------------------
# Compute the 3 surviving gates
# ----------------------------------------------------------------------------
def compute_metrics(ticker: str) -> dict | None:
    df = load_gex(ticker)
    if df.empty or len(df) < 5:
        return None
    pre = df[df["date"] < SCAN_DATE - timedelta(days=10)]
    recent = df[df["date"] >= SCAN_DATE - timedelta(days=10)]
    if pre.empty or recent.empty:
        return None

    cd_scan = _val_on_or_near(df, SCAN_DATE, "call_dominance_pct")
    delta_scan = _val_on_or_near(df, SCAN_DATE, "net_delta")
    delta_pre_mean = pre["net_delta"].mean()
    delta_recent_mean = recent["net_delta"].mean()

    # G1 — delta buildup (recent mean vs pre mean)
    if not pd.isna(delta_pre_mean) and delta_pre_mean != 0:
        delta_buildup_pct = (delta_recent_mean - delta_pre_mean) / abs(delta_pre_mean) * 100
    else:
        delta_buildup_pct = float("nan")

    # G3 (adapted) — backward vanna ratio: vanna(today) / vanna(3d ago)
    vanna_now = _val_on_or_near(df, SCAN_DATE, "net_vanna")
    vanna_back = _val_n_days_back(df, SCAN_DATE, 5, "net_vanna")
    if not pd.isna(vanna_back) and vanna_back != 0:
        vanna_ratio = vanna_now / vanna_back
    else:
        vanna_ratio = float("nan")

    # Auxiliary
    gamma_scan = _val_on_or_near(df, SCAN_DATE, "net_gamma")

    return {
        "ticker": ticker,
        "call_dom_now": cd_scan,
        "delta_now": delta_scan,
        "delta_buildup_pct": delta_buildup_pct,
        "vanna_ratio_5d_back": vanna_ratio,
        "gamma_now": gamma_scan,
        "gamma_positive": int(gamma_scan > 0) if not pd.isna(gamma_scan) else 0,
        "n_gex_days": len(df),
    }


# ----------------------------------------------------------------------------
# Theme coherence — second pass after metrics built
# ----------------------------------------------------------------------------
def compute_theme_coherence(df: pd.DataFrame) -> pd.DataFrame:
    """For each ticker, min Spearman corr of call_dominance_pct with same-theme peers."""
    print(f"  computing theme coherence for {len(df)} tickers...")
    # Pre-cache timeseries
    cache: dict[str, pd.Series] = {}
    for t in df["ticker"].unique():
        gex = load_gex(t)
        if not gex.empty:
            cache[t] = gex.set_index("date")["call_dominance_pct"]

    coherences = []
    for _, r in df.iterrows():
        theme = r["theme"]
        peers = [t for t in THEMES.get(theme, []) if t != r["ticker"] and t in cache]
        if not peers or r["ticker"] not in cache:
            coherences.append(float("nan"))
            continue
        my_ts = cache[r["ticker"]]
        corrs = []
        for p in peers[:8]:  # limit to first 8 peers for speed
            peer_ts = cache[p]
            common = my_ts.index.intersection(peer_ts.index)
            if len(common) < 5:
                continue
            corr, _ = stats.spearmanr(my_ts.loc[common], peer_ts.loc[common])
            if not pd.isna(corr):
                corrs.append(corr)
        coherences.append(np.mean(corrs) if corrs else float("nan"))
    df["theme_coherence"] = coherences
    return df


# ----------------------------------------------------------------------------
# Grade formula — uses Phase 3 weights
# ----------------------------------------------------------------------------
def compute_grades(df: pd.DataFrame) -> pd.DataFrame:
    """Convert raw metrics into 0-100 Grade + direction."""
    n = len(df)

    # Delta buildup → percentile rank
    df["delta_buildup_rank"] = df["delta_buildup_pct"].rank(pct=True)

    # Vanna band match: linear bell with peak at 0.85, falloff to 0.5 and 1.2
    def _band_score(x):
        if pd.isna(x):
            return 0.5  # neutral
        if 0.65 <= x <= 1.05:
            # Peak at 0.85; flat top
            return 1.0 - 0.5 * abs(x - 0.85) / 0.4
        if x > 1.05:
            return max(0.0, 1.0 - (x - 1.05) / 0.5)
        return max(0.0, 1.0 - (0.65 - x) / 0.3)
    df["vanna_band_match"] = df["vanna_ratio_5d_back"].apply(_band_score)

    # Theme coherence normalized to [0, 1]
    df["theme_coherence_norm"] = ((df["theme_coherence"] + 1) / 2).clip(0, 1)
    df["theme_coherence_norm"] = df["theme_coherence_norm"].fillna(0.5)

    # Call dominance: above 50% is bullish; below is bearish
    df["call_dom_score"] = (df["call_dom_now"] / 100).clip(0, 1)

    # Direction
    df["direction"] = df["call_dom_now"].apply(
        lambda x: "bull" if x >= 55 else ("bear" if x <= 45 else "neutral")
    )

    # Compute grade as weighted sum of normalized [0, 1] components → scaled to 0-100
    w = GRADE_WEIGHTS
    score = (
        w["delta_buildup_rank"] * df["delta_buildup_rank"].fillna(0.5) +
        w["vanna_band_match"]   * df["vanna_band_match"] +
        w["theme_coherence"]    * df["theme_coherence_norm"] +
        w["call_dom_above_50"]  * df["call_dom_score"]
    )
    score = score / sum(w.values())  # normalize
    df["grade"] = (score * 100).round(1)

    # Sub-scores for flagging
    df["g_delta_score"] = (df["delta_buildup_rank"].fillna(0.5) * 100).round(1)
    df["g_vanna_score"] = (df["vanna_band_match"] * 100).round(1)
    df["g_theme_score"] = (df["theme_coherence_norm"] * 100).round(1)

    return df


# ----------------------------------------------------------------------------
# Price fetch
# ----------------------------------------------------------------------------
def fetch_prices(tickers: list[str]) -> dict[str, float]:
    """Bulk fetch latest close prices from yfinance."""
    out = {}
    # yfinance batch
    print(f"  fetching prices for {len(tickers)} tickers...")
    batch_size = 50
    for i in range(0, len(tickers), batch_size):
        batch = tickers[i:i+batch_size]
        try:
            data = yf.download(batch, period="5d", progress=False, auto_adjust=False)["Close"]
            if isinstance(data, pd.Series):
                # single-ticker case
                out[batch[0]] = float(data.dropna().iloc[-1])
            else:
                for t in batch:
                    if t in data.columns:
                        s = data[t].dropna()
                        if not s.empty:
                            out[t] = float(s.iloc[-1])
        except Exception:
            for t in batch:
                try:
                    hist = yf.Ticker(t).history(period="5d", auto_adjust=False)
                    if not hist.empty:
                        out[t] = float(hist["Close"].iloc[-1])
                except Exception:
                    pass
    return out


# ----------------------------------------------------------------------------
# Target inference (using IV proxy from call_dominance)
# ----------------------------------------------------------------------------
def infer_targets(price: float, direction: str, vol_proxy_pct: float) -> dict:
    """Roughly project a 5-day target using IV proxy."""
    if pd.isna(price) or price <= 0:
        return {"st_target": None, "vex_targets": []}
    # Use a baseline 25% annualized vol scaled by call_dom strength
    annual_iv = 0.20 + (vol_proxy_pct - 50) / 250  # rough 25-32%
    annual_iv = max(0.15, min(0.6, annual_iv))
    five_day_move = annual_iv * np.sqrt(5 / 252)
    if direction == "bull":
        return {
            "st_target": round(price * (1 + five_day_move), 2),
            "vex_targets": [
                round(price * (1 + five_day_move * 1.5), 2),
                round(price * (1 + five_day_move * 2.0), 2),
                round(price * (1 + five_day_move * 3.0), 2),
            ],
        }
    if direction == "bear":
        return {
            "st_target": round(price * (1 - five_day_move), 2),
            "vex_targets": [
                round(price * (1 - five_day_move * 1.5), 2),
                round(price * (1 - five_day_move * 2.0), 2),
                round(price * (1 - five_day_move * 3.0), 2),
            ],
        }
    return {"st_target": round(price, 2), "vex_targets": []}


# ----------------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------------
def main():
    print("=== Phase 4 Scanner ===")
    universe = load_universe()
    print(f"Universe: {len(universe)} tickers")

    rows = []
    skipped = []
    for t in universe:
        m = compute_metrics(t)
        if m is None:
            skipped.append(t)
            continue
        m["theme"] = _theme_for(t)
        rows.append(m)
    df = pd.DataFrame(rows)
    print(f"Tickers with GEX data: {len(df)} / {len(universe)} (skipped: {len(skipped)})")

    df = compute_theme_coherence(df)
    df = compute_grades(df)

    # Fetch prices for graded tickers
    graded = df[df["grade"].notna() & (df["call_dom_now"].notna())].copy()
    prices = fetch_prices(graded["ticker"].tolist())
    graded["price"] = graded["ticker"].map(prices)
    graded = graded[graded["price"].notna()].copy()

    # Targets
    targets = graded.apply(
        lambda r: infer_targets(r["price"], r["direction"], r["call_dom_now"]),
        axis=1, result_type="expand"
    )
    graded["st_target"] = targets["st_target"]
    graded["vex_targets"] = targets["vex_targets"]

    # Soft invalidation
    graded["soft_inval"] = graded.apply(
        lambda r: round(r["price"] * 0.97, 2) if r["direction"] == "bull"
                  else round(r["price"] * 1.03, 2) if r["direction"] == "bear"
                  else None, axis=1,
    )

    graded = graded.sort_values("grade", ascending=False).reset_index(drop=True)

    # Buckets
    actionable = graded[graded["grade"] >= 70].copy()
    watch = graded[(graded["grade"] >= 55) & (graded["grade"] < 70)].copy()
    skip = graded[graded["grade"] < 55].copy()

    # Print top setups
    print()
    print(f"Actionable (Grade ≥ 70): {len(actionable)}")
    print(f"Watchlist  (55 ≤ G <70): {len(watch)}")
    print(f"Skip       (Grade < 55): {len(skip)}")
    print()
    print("=" * 130)
    print(" TOP 25 SETUPS — Predictions for week of 2026-06-01 to 2026-06-05")
    print("=" * 130)
    cols = ["ticker", "grade", "direction", "theme", "price", "st_target",
            "soft_inval", "call_dom_now", "delta_buildup_pct", "vanna_ratio_5d_back",
            "theme_coherence", "g_delta_score", "g_vanna_score", "g_theme_score"]
    show = graded[cols].head(25).copy()
    for c in ["delta_buildup_pct"]:
        show[c] = show[c].round(0)
    for c in ["vanna_ratio_5d_back", "theme_coherence", "call_dom_now"]:
        show[c] = show[c].round(2)
    print(show.to_string(index=False))

    # Save JSON
    scan = {
        "scan_date": SCAN_DATE.strftime("%Y-%m-%d"),
        "prediction_window": "2026-06-01 to 2026-06-05",
        "universe_total": len(universe),
        "with_gex_data": int(len(df)),
        "graded": int(len(graded)),
        "actionable_count": int(len(actionable)),
        "watchlist_count": int(len(watch)),
        "actionable_setups": actionable.to_dict("records"),
        "watchlist_setups": watch.head(50).to_dict("records"),
        "gate_weights_used": GRADE_WEIGHTS,
        "notes": "Built on Phase 3-validated gates only. Excludes call_dom_trend (p=0.49) "
                 "and gamma_sign (marginal). Vanna gate uses 5d-backward ratio as real-time proxy "
                 "for the original t+3d-forward stability measure.",
    }

    out_path = OUT / f"scan_{SCAN_DATE.strftime('%Y-%m-%d')}.json"

    # Convert any non-JSON-serializable values
    def _clean(o):
        if isinstance(o, (np.integer, np.int64)):
            return int(o)
        if isinstance(o, (np.floating, np.float64)):
            return None if np.isnan(o) else float(o)
        if isinstance(o, dict):
            return {k: _clean(v) for k, v in o.items()}
        if isinstance(o, list):
            return [_clean(v) for v in o]
        return o

    out_path.write_text(json.dumps(_clean(scan), indent=2))
    print()
    print(f"Wrote {out_path}")
    csv_path = OUT / f"scan_{SCAN_DATE.strftime('%Y-%m-%d')}.csv"
    graded.to_csv(csv_path, index=False)
    print(f"Wrote {csv_path}")


if __name__ == "__main__":
    main()
