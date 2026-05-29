"""Find still-coiled HOOD/PLTR fingerprint stocks that have NOT yet fired.

The goal: predict next week's squeezes, not chase today's.

Filter: yesterday they would have looked exactly like PLTR yesterday (BB pct < 0.20,
range_pos < 0.55, pct_from_high < -20) AND today they're flat-to-mild (intraday < +4%)
AND 5d return not already pumped (< 8%). These are the ones still loaded.
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
                            "today_intraday_pct": round((last / prev - 1) * 100, 1),
                            "live_price": round(last, 2),
                            "today_vol": vol,
                        })
                except (KeyError, AttributeError, IndexError):
                    continue
        except Exception:
            pass
    return pd.DataFrame(rows)


def main():
    # Load yesterday's coil features (both buckets — sprung names that haven't moved
    # further today are still valid pre-squeeze candidates)
    watch = pd.read_csv(OUT / "coiled_watchlist.csv")
    sprung = pd.read_csv(OUT / "coiled_already_sprung.csv")
    coil_data = pd.concat([
        watch.assign(yesterday_status="coiled"),
        sprung.assign(yesterday_status="sprung")
    ], ignore_index=True)

    universe = load_universe()
    print(f"Scanning {len(universe)} tickers...")
    intraday = fetch_intraday(universe)
    print(f"  → {len(intraday)} with intraday data")

    merged = intraday.merge(coil_data, on="ticker", how="inner")

    # PRE-SQUEEZE filter — must match PLTR/HOOD pre-squeeze profile and NOT yet fire
    pre_squeeze = merged[
        (merged["bb_pct"] < 0.20)                    # tight compression
        & (merged["atr_pct"] < 0.40)                 # low realized vol
        & (merged["range_pos"] < 0.55)               # depressed (room to run)
        & (merged["pct_from_high"] < -20)            # at least 20% off 6mo high
        & (merged["today_intraday_pct"] < 4)         # NOT firing today
        & (merged["today_intraday_pct"] > -3)        # not crashing either
        & (merged["ret_5d"] < 8)                     # not extended
        & (merged["close"] > 2)                       # not penny stock
        & (merged["ema21_slope_pct_10d"] > -5)       # not collapsing
    ].copy()

    pre_squeeze["upside_to_126d_pct"] = -pre_squeeze["pct_from_high"]

    # Score: tighter compression + bigger room + recently-coiled (not fully sprung)
    pre_squeeze["pre_squeeze_score"] = (
        (1 - pre_squeeze["bb_pct"]) * 35              # compression weight high
        + (1 - pre_squeeze["atr_pct"]) * 15
        + (pre_squeeze["upside_to_126d_pct"]).clip(upper=80) * 0.5
        + (1 - pre_squeeze["range_pos"]).clip(lower=0) * 20
    )

    pre_squeeze = pre_squeeze.sort_values("pre_squeeze_score", ascending=False).reset_index(drop=True)

    cols = [
        "ticker", "theme", "yesterday_status", "live_price", "today_intraday_pct",
        "bb_pct", "atr_pct", "vol_dryup", "range_pos", "pct_from_high",
        "ret_5d", "ema21_slope_pct_10d",
        "trigger_20d", "trigger_60d", "trigger_126d", "stop_20d",
        "upside_to_126d_pct", "pre_squeeze_score",
    ]
    print(f"\n{'='*125}")
    print(f"PRE-SQUEEZE CANDIDATES — coiled like HOOD/PLTR YESTERDAY but flat today (will fire next week+)")
    print(f"{'='*125}")
    print(pre_squeeze[cols].head(30).to_string(index=False))

    pre_squeeze.to_csv(OUT / "pre_squeeze.csv", index=False)
    print(f"\n→ wrote {OUT / 'pre_squeeze.csv'} ({len(pre_squeeze)} rows)")


if __name__ == "__main__":
    main()
