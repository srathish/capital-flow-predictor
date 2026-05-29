"""Coil scanner — find still-coiled stocks across the 504-ticker universe.

Pattern target: Sean trades "coiled spring" — multi-month sideways base,
range compression (BB width + ATR percentile in bottom decile), volume dry-up,
price holding above a rising 21 EMA, near (but under) the base's upper resistance.

We score "still coiled" (NOT yet sprung). Already-sprung names are filtered out:
  - if today's close > prior 20d high on > 1.5x avg volume → sprung, exclude
  - if 5d return > 8% → already moving, exclude

Output:
  output/coiled_watchlist.csv  — full ranked list
  output/coiled_top25.csv      — top 25 with theme tags
  output/coiled_summary.md     — narrative summary
"""
from __future__ import annotations

import warnings
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd
import yfinance as yf

warnings.filterwarnings("ignore")

ROOT = Path(__file__).resolve().parents[1]
UNIVERSE_FILE = ROOT / "phase4_scanner" / "universe.txt"
OUT = ROOT / "output"
OUT.mkdir(exist_ok=True)

LOOKBACK_DAYS = 220  # ~10 trading months
SCAN_DATE = datetime(2026, 5, 29)


# ETFs are structurally low-vol → always look "compressed". Single-stock pattern only.
ETFS = {
    "SPY", "QQQ", "IWM", "DIA", "VTI", "VOO", "VTV", "VUG", "VEA", "VWO", "IEMG",
    "EFA", "EEM", "FXI", "MCHI", "VGK", "EWZ",
    "XLF", "XLE", "XLK", "XLV", "XLI", "XLP", "XLY", "XLU", "XLB", "XLRE", "XLC",
    "ARKK", "ARKG", "ARKW", "ARKQ", "ARKF",
    "SMH", "SOXX", "SOXL", "SOXS", "TQQQ", "SQQQ", "TNA", "TZA",
    "HYG", "LQD", "TLT", "IEF", "SHY", "AGG", "BND",
    "GLD", "SLV", "GDX", "GDXJ", "UNG", "USO", "BNO",
    "UUP", "FXE", "FXY",
    "UVXY", "VXX", "VIXY", "UVIX",
    "IBIT", "ETHA", "BITO", "ETHE", "GBTC",
    "URA", "URNM", "ITA", "PPA", "JETS", "KBE", "KRE", "KIE", "XME", "XOP", "XHB",
    "EWG", "EWJ", "EWY", "EWT", "EWH", "EWA", "EWC", "EWU",
    "TAN", "PBW", "ICLN", "FAN", "LIT", "REMX", "COPX", "PALL", "PPLT",
    "MOO", "DBA", "DBC", "CORN", "WEAT", "SOYB",
    "ASHR", "INDA", "EPI",
    "VNQ", "REM", "MORT", "PFF", "PSP",
}


def load_universe(exclude_etfs: bool = True) -> list[str]:
    tickers = [t.strip() for t in UNIVERSE_FILE.read_text().splitlines() if t.strip()]
    if exclude_etfs:
        tickers = [t for t in tickers if t not in ETFS]
    return tickers


def _batch_fetch(tickers: list[str]) -> dict[str, pd.DataFrame]:
    data = yf.download(
        tickers,
        period=f"{LOOKBACK_DAYS}d",
        interval="1d",
        group_by="ticker",
        auto_adjust=True,
        progress=False,
        threads=True,
    )
    out: dict[str, pd.DataFrame] = {}
    for t in tickers:
        try:
            df = data[t].dropna()
            if len(df) >= 120:
                out[t] = df
        except (KeyError, AttributeError):
            continue
    return out


def fetch_ohlc(tickers: list[str]) -> dict[str, pd.DataFrame]:
    """Batched fetch with chunking + retry for missing tickers."""
    print(f"Downloading {LOOKBACK_DAYS}d OHLC for {len(tickers)} tickers (chunked)...")
    out: dict[str, pd.DataFrame] = {}
    chunk_size = 100
    for i in range(0, len(tickers), chunk_size):
        chunk = tickers[i : i + chunk_size]
        out.update(_batch_fetch(chunk))
        print(f"  chunk {i // chunk_size + 1}: cumulative {len(out)}/{i + len(chunk)}")
    # Retry the missing ones individually (some fail in batch)
    missing = [t for t in tickers if t not in out]
    if missing:
        print(f"  retrying {len(missing)} missed tickers individually...")
        for t in missing:
            try:
                df = yf.download(
                    t,
                    period=f"{LOOKBACK_DAYS}d",
                    interval="1d",
                    auto_adjust=True,
                    progress=False,
                ).dropna()
                if len(df) >= 120:
                    out[t] = df
            except Exception:
                continue
    print(f"  → {len(out)} tickers with usable OHLC")
    return out


def compute_features(df: pd.DataFrame) -> dict | None:
    """Compute coil features for one ticker."""
    if len(df) < 120:
        return None

    c = df["Close"]
    h = df["High"]
    l = df["Low"]
    v = df["Volume"]

    # Bollinger Band width (20d, 2σ) and its percentile rank over trailing 126d (6mo)
    ma20 = c.rolling(20).mean()
    sd20 = c.rolling(20).std()
    bb_width = (4 * sd20) / ma20  # normalized band width
    bb_pct = bb_width.rolling(126).rank(pct=True)
    bb_pct_now = bb_pct.iloc[-1]

    # ATR (14d) and percentile rank over trailing 126d
    tr = pd.concat(
        [h - l, (h - c.shift()).abs(), (l - c.shift()).abs()], axis=1
    ).max(axis=1)
    atr14 = tr.rolling(14).mean()
    atr_pct = (atr14 / c).rolling(126).rank(pct=True)
    atr_pct_now = atr_pct.iloc[-1]

    # Volume dry-up: 20d avg / 60d avg
    vol_dryup = v.rolling(20).mean() / v.rolling(60).mean()
    vol_dryup_now = vol_dryup.iloc[-1]

    # EMA stack: price vs 21 EMA, slope
    ema21 = c.ewm(span=21, adjust=False).mean()
    ema21_slope = (ema21.iloc[-1] / ema21.iloc[-10] - 1) * 100  # % over 10d
    above_ema21 = c.iloc[-1] > ema21.iloc[-1]

    # 52w (here 126d) range position
    hi126 = h.rolling(126).max().iloc[-1]
    lo126 = l.rolling(126).min().iloc[-1]
    range_pos = (c.iloc[-1] - lo126) / (hi126 - lo126) if hi126 > lo126 else 0.5

    # Distance from 126d high (negative = below)
    pct_from_high = (c.iloc[-1] / hi126 - 1) * 100

    # Already sprung filters
    prior_20d_high = h.iloc[-21:-1].max()
    avg_vol_20 = v.iloc[-21:-1].mean()
    breakout_today = (
        c.iloc[-1] > prior_20d_high
        and v.iloc[-1] > 1.5 * avg_vol_20
    )
    ret_5d = (c.iloc[-1] / c.iloc[-6] - 1) * 100

    # Base length: how many days has price held within X% of current consolidation
    # use last 60d range / current price
    base_range_60d = (h.iloc[-60:].max() - l.iloc[-60:].min()) / c.iloc[-1] * 100

    # Wedge tightening: slope of 20d high (descending = tightening)
    highs_20 = h.rolling(20).max()
    if len(highs_20.dropna()) >= 40:
        x = np.arange(40)
        y = highs_20.iloc[-40:].values
        slope = np.polyfit(x, y, 1)[0] / c.iloc[-1] * 100  # % per day
    else:
        slope = 0.0

    # Trigger levels — "spring fires when close > X"
    # Near trigger: prior 20d high (intraday/swing)
    # Swing trigger: 60d high (multi-month breakout)
    # Big trigger: 126d high (6mo base breakout, biggest moves)
    trigger_20d = float(h.iloc[-21:-1].max())
    trigger_60d = float(h.iloc[-61:-1].max())
    trigger_126d = float(hi126)
    # Stop-out: 20d low (below = base broken)
    stop_20d = float(l.iloc[-21:-1].min())
    # Distance to trigger as % of current
    dist_to_20d_trigger = (trigger_20d / c.iloc[-1] - 1) * 100
    dist_to_60d_trigger = (trigger_60d / c.iloc[-1] - 1) * 100
    dist_to_126d_trigger = (trigger_126d / c.iloc[-1] - 1) * 100

    return {
        "close": float(c.iloc[-1]),
        "bb_pct": float(bb_pct_now) if pd.notna(bb_pct_now) else np.nan,
        "atr_pct": float(atr_pct_now) if pd.notna(atr_pct_now) else np.nan,
        "vol_dryup": float(vol_dryup_now) if pd.notna(vol_dryup_now) else np.nan,
        "ema21_slope": float(ema21_slope),
        "above_ema21": bool(above_ema21),
        "range_pos": float(range_pos),
        "pct_from_high": float(pct_from_high),
        "breakout_today": bool(breakout_today),
        "ret_5d": float(ret_5d),
        "base_range_60d": float(base_range_60d),
        "wedge_slope": float(slope),
        "trigger_20d": trigger_20d,
        "trigger_60d": trigger_60d,
        "trigger_126d": trigger_126d,
        "stop_20d": stop_20d,
        "dist_to_20d_trigger": float(dist_to_20d_trigger),
        "dist_to_60d_trigger": float(dist_to_60d_trigger),
        "dist_to_126d_trigger": float(dist_to_126d_trigger),
    }


def score_coil(f: dict) -> tuple[float, dict]:
    """Score 0-100 how 'coiled and ready' a ticker is. Returns (grade, sub-scores)."""
    sub = {}

    # G1: Range compression (BB width percentile + ATR percentile) — want LOW
    bb = f["bb_pct"]
    atr = f["atr_pct"]
    if pd.isna(bb) or pd.isna(atr):
        return 0.0, sub
    compression = (1 - bb) * 0.5 + (1 - atr) * 0.5  # 0-1, higher = more compressed
    sub["compression"] = compression * 100

    # G2: Volume dry-up — want < 0.85
    dryup = f["vol_dryup"]
    if pd.isna(dryup):
        return 0.0, sub
    dryup_score = max(0.0, min(1.0, (1.0 - dryup) / 0.3))  # full credit at ≤0.7
    sub["dryup"] = dryup_score * 100

    # G3: Base depth — want price in upper half of 6mo range, within 20% of high
    rp = f["range_pos"]
    pfh = f["pct_from_high"]
    if rp >= 0.6 and pfh > -25:
        base_score = 1.0
    elif rp >= 0.45 and pfh > -35:
        base_score = 0.6
    else:
        base_score = 0.2
    sub["base"] = base_score * 100

    # G4: EMA stack — price above 21 EMA AND 21 EMA flat-to-rising
    ema_slope = f["ema21_slope"]
    if f["above_ema21"] and ema_slope > 0:
        ema_score = 1.0
    elif f["above_ema21"]:
        ema_score = 0.7
    elif ema_slope > -1:
        ema_score = 0.4
    else:
        ema_score = 0.1
    sub["ema"] = ema_score * 100

    # G5: Wedge tightening — 20d high slope negative or flat
    ws = f["wedge_slope"]
    if ws < -0.05:
        wedge_score = 1.0
    elif ws < 0.05:
        wedge_score = 0.7
    else:
        wedge_score = 0.3
    sub["wedge"] = wedge_score * 100

    # Weighted grade
    grade = (
        sub["compression"] * 0.30
        + sub["dryup"] * 0.20
        + sub["base"] * 0.20
        + sub["ema"] * 0.20
        + sub["wedge"] * 0.10
    )

    return grade, sub


# Theme tags lifted from Phase 4 writeup (keep light — coverage is partial)
THEMES = {
    "quantum": {"RGTI", "QBTS", "IONQ", "QUBT"},
    "clean_energy": {"ENPH", "FSLR", "BLDP", "SEDG", "FCEL", "RUN", "NOVA", "ARRY", "SPWR", "CSIQ", "JKS", "PLUG"},
    "crypto_miners": {"CLSK", "HIVE", "CIFR", "IREN", "BTDR", "WULF", "HUT", "CORZ", "RIOT", "MARA", "BITF"},
    "drones_defense": {"KTOS", "LMT", "RTX", "NOC", "GD", "LHX", "HII", "AVAV"},
    "satellite_space": {"RDW", "ASTS", "RKLB", "AMPG", "LUNR", "SATL", "SPIR", "IRDM", "SIDU", "VOYG"},
    "ev_autos": {"F", "HYLN", "TSLA", "RIVN", "LCID", "GM", "NIO", "XPEV", "LI"},
    "nuclear": {"VST", "OKLO", "NNE", "SMR", "CCJ", "URA", "URNM", "BWXT", "CEG"},
    "semis": {"SMCI", "AMD", "CDNS", "LRCX", "ARM", "AMAT", "MU", "NVDA", "AVGO", "MRVL", "TSM", "INTC", "ASML", "QCOM"},
    "ai_megacap": {"MSFT", "GOOGL", "GOOG", "META", "AMZN", "AAPL"},
    "crypto_tokens": {"MSTR", "IBIT", "ETHA", "COIN", "HOOD"},
    "retail": {"FIVE", "ROST", "TJX", "BURL", "WMT", "TGT", "COST", "DG", "DLTR"},
    "healthcare_pharma": {"ABBV", "JNJ", "MRK", "PFE", "LLY", "NVO", "BMY", "AMGN", "GILD"},
    "data_centers": {"DLR", "EQIX", "VRT", "ETN"},
    "banks": {"JPM", "BAC", "WFC", "GS", "MS", "C"},
    "oil_gas": {"XOM", "CVX", "COP", "OXY", "EOG", "PSX", "VLO"},
    "saas": {"CRM", "NOW", "WDAY", "SNOW", "DDOG", "MDB", "OKTA", "GTLB", "ZS", "NET"},
    "cyber": {"PANW", "CRWD", "FTNT", "S", "RBRK"},
}


def tag_theme(ticker: str) -> str:
    for theme, members in THEMES.items():
        if ticker in members:
            return theme
    return "unthemed"


def main() -> None:
    universe = load_universe()
    print(f"Universe: {len(universe)} tickers")

    ohlc = fetch_ohlc(universe)

    rows = []
    for t, df in ohlc.items():
        f = compute_features(df)
        if not f:
            continue
        grade, sub = score_coil(f)
        rows.append(
            {
                "ticker": t,
                "theme": tag_theme(t),
                "close": f["close"],
                "grade": round(grade, 1),
                "compression": round(sub.get("compression", 0), 1),
                "dryup_score": round(sub.get("dryup", 0), 1),
                "base_score": round(sub.get("base", 0), 1),
                "ema_score": round(sub.get("ema", 0), 1),
                "wedge_score": round(sub.get("wedge", 0), 1),
                "bb_pct": round(f["bb_pct"], 3),
                "atr_pct": round(f["atr_pct"], 3),
                "vol_dryup": round(f["vol_dryup"], 2),
                "ema21_slope_pct_10d": round(f["ema21_slope"], 2),
                "range_pos": round(f["range_pos"], 2),
                "pct_from_high": round(f["pct_from_high"], 1),
                "ret_5d": round(f["ret_5d"], 1),
                "base_range_60d_pct": round(f["base_range_60d"], 1),
                "wedge_slope_pct_per_day": round(f["wedge_slope"], 3),
                "trigger_20d": round(f["trigger_20d"], 2),
                "trigger_60d": round(f["trigger_60d"], 2),
                "trigger_126d": round(f["trigger_126d"], 2),
                "stop_20d": round(f["stop_20d"], 2),
                "dist_to_20d_trigger_pct": round(f["dist_to_20d_trigger"], 1),
                "dist_to_60d_trigger_pct": round(f["dist_to_60d_trigger"], 1),
                "dist_to_126d_trigger_pct": round(f["dist_to_126d_trigger"], 1),
                "breakout_today": f["breakout_today"],
            }
        )

    df = pd.DataFrame(rows)
    print(f"\nScored {len(df)} tickers")

    # Exclude already-sprung: today's breakout OR 5d return > 8%
    sprung = df[(df["breakout_today"]) | (df["ret_5d"] > 8)].copy()
    coiled = df[~((df["breakout_today"]) | (df["ret_5d"] > 8))].copy()
    print(f"  excluded {len(sprung)} already-sprung names")
    print(f"  {len(coiled)} still-coiled candidates")

    coiled = coiled.sort_values("grade", ascending=False).reset_index(drop=True)
    sprung = sprung.sort_values("grade", ascending=False).reset_index(drop=True)

    # Write full ranked watchlist
    out_full = OUT / "coiled_watchlist.csv"
    coiled.to_csv(out_full, index=False)
    print(f"  → wrote {out_full}")

    # Top 25
    top25 = coiled.head(25)
    out_top25 = OUT / "coiled_top25.csv"
    top25.to_csv(out_top25, index=False)

    # Sprung list (already moving — chase or skip). Full list, not just top 25.
    out_sprung = OUT / "coiled_already_sprung.csv"
    sprung.to_csv(out_sprung, index=False)

    # Print top 25 to stdout
    print("\n" + "=" * 90)
    print("TOP 25 STILL-COILED CANDIDATES (Grade desc)")
    print("=" * 90)
    cols_show = ["ticker", "theme", "close", "grade", "trigger_20d", "trigger_60d",
                 "dist_to_20d_trigger_pct", "stop_20d", "compression", "vol_dryup"]
    print(top25[cols_show].to_string(index=False))

    # Theme rollup
    theme_roll = (
        coiled.groupby("theme")
        .agg(n=("ticker", "count"), mean_grade=("grade", "mean"), max_grade=("grade", "max"))
        .sort_values("mean_grade", ascending=False)
        .round(1)
    )
    print("\n" + "=" * 60)
    print("THEME ROLLUP (still-coiled only)")
    print("=" * 60)
    print(theme_roll.head(20).to_string())

    out_theme = OUT / "coiled_themes.csv"
    theme_roll.to_csv(out_theme)

    print(f"\nDone. Outputs:")
    print(f"  {out_full}")
    print(f"  {out_top25}")
    print(f"  {out_sprung}")
    print(f"  {out_theme}")


if __name__ == "__main__":
    main()
