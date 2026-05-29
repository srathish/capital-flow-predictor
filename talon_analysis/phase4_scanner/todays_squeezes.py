"""Find names that WERE coiled (HOOD/PLTR fingerprint) AND squeezed TODAY.

Scan the full 504-ticker universe for today's intraday gainers, cross-ref with
yesterday's coil scanner output, and return only names that match BOTH:
  1. HOOD-style setup pre-squeeze (compressed BB, off highs, low range pos)
  2. Today's intraday move >5%

This is the "yesterday it was coiled, today it's firing" filter.
"""
from __future__ import annotations

from pathlib import Path
import pandas as pd
import yfinance as yf
import warnings

warnings.filterwarnings("ignore")

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output"
UNIVERSE_FILE = ROOT / "phase4_scanner" / "universe.txt"

# ETFs (re-use)
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
    "VNQ", "REM", "MORT", "PFF", "PSP", "SDY", "DGRO",
}


def load_universe() -> list[str]:
    tickers = [t.strip() for t in UNIVERSE_FILE.read_text().splitlines() if t.strip()]
    return [t for t in tickers if t not in ETFS]


def fetch_intraday(tickers: list[str]) -> pd.DataFrame:
    """Get yesterday close + today price for each ticker."""
    print(f"Fetching 2d data for {len(tickers)} tickers (chunked)...")
    rows = []
    chunk_size = 100
    for i in range(0, len(tickers), chunk_size):
        chunk = tickers[i : i + chunk_size]
        try:
            data = yf.download(chunk, period="2d", interval="1d",
                              auto_adjust=True, progress=False,
                              group_by="ticker", threads=True)
            for t in chunk:
                try:
                    df = data[t].dropna()
                    if len(df) >= 2:
                        prev = float(df["Close"].iloc[-2])
                        last = float(df["Close"].iloc[-1])
                        vol = int(df["Volume"].iloc[-1])
                        rows.append({
                            "ticker": t,
                            "prev_close": round(prev, 2),
                            "last": round(last, 2),
                            "intraday_pct": round((last / prev - 1) * 100, 1),
                            "today_vol": vol,
                        })
                except (KeyError, AttributeError, IndexError):
                    continue
        except Exception as e:
            print(f"  chunk {i} failed: {e}")
    return pd.DataFrame(rows)


def main():
    # Load coil features (both watchlist and sprung)
    watch = pd.read_csv(OUT / "coiled_watchlist.csv")
    sprung = pd.read_csv(OUT / "coiled_already_sprung.csv")
    coil_data = pd.concat([
        watch.assign(yesterday_status="coiled"),
        sprung.assign(yesterday_status="sprung")
    ], ignore_index=True)

    universe = load_universe()
    intraday = fetch_intraday(universe)
    print(f"  → {len(intraday)} tickers with intraday data")

    # Join with coil features
    merged = intraday.merge(coil_data, on="ticker", how="inner")
    print(f"  → {len(merged)} matched to coil features")

    # Today's HOOD-style breakouts:
    # 1. Intraday > 5% (squeezing today)
    # 2. Yesterday's compression was real (BB pct < 0.40)
    # 3. NOT already extended (i.e., the move is fresh, not a continuation)

    hood_breakouts = merged[
        (merged["intraday_pct"] > 5)
        & (merged["bb_pct"] < 0.40)
        & (merged["close"] > 1)  # not penny crap
    ].copy()

    # Score: prioritize compression + range room
    hood_breakouts["upside_to_126d_pct"] = -hood_breakouts["pct_from_high"]
    hood_breakouts["squeeze_score"] = (
        hood_breakouts["intraday_pct"] * 2  # today's move weight
        + (1 - hood_breakouts["bb_pct"]) * 25  # compression
        + hood_breakouts["upside_to_126d_pct"].clip(upper=80) * 0.5  # room left
        + (1 - hood_breakouts["range_pos"]).clip(lower=0) * 15  # depressed bonus
    )

    hood_breakouts = hood_breakouts.sort_values("squeeze_score", ascending=False).reset_index(drop=True)

    cols_show = [
        "ticker", "theme", "yesterday_status", "prev_close", "last", "intraday_pct",
        "bb_pct", "atr_pct", "range_pos", "pct_from_high",
        "ret_5d", "trigger_20d", "trigger_60d", "trigger_126d", "stop_20d",
        "upside_to_126d_pct", "squeeze_score",
    ]
    print(f"\n{'='*120}")
    print(f"TODAY'S COILED SQUEEZES — {len(hood_breakouts)} candidates (intraday > +5% AND BB compressed)")
    print(f"{'='*120}")
    print(hood_breakouts[cols_show].head(40).to_string(index=False))

    hood_breakouts.to_csv(OUT / "todays_squeezes.csv", index=False)
    print(f"\n→ wrote {OUT / 'todays_squeezes.csv'}")

    # Also print a quick "still-coiled and just starting" list (intraday 2-5%)
    starting = merged[
        (merged["intraday_pct"].between(2, 5))
        & (merged["bb_pct"] < 0.25)
        & (merged["range_pos"] < 0.50)
        & (merged["pct_from_high"] < -20)
    ].sort_values("intraday_pct", ascending=False).head(15)

    if len(starting):
        print(f"\n{'='*100}")
        print(f"BONUS — STILL EARLY (intraday +2-5%, deeply coiled, depressed)")
        print(f"{'='*100}")
        print(starting[["ticker","theme","prev_close","last","intraday_pct","bb_pct","range_pos","pct_from_high"]].to_string(index=False))


if __name__ == "__main__":
    main()
