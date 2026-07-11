"""Build the daily feature matrix + labels for the forecast-ensemble study.

One row per (trading session, target ticker in {SPY, QQQ}); features are
day-t aggregates from the backfilled families; label is day t+1 open->close
(binary sign + 3-class with CHOP per DESIGN Amendment A1).

SPX has no OHLC access (422) -> SPX greeks join as *features* on both
targets (index options structure), SPX is not a label ticker. Named in report.

Output: outputs/features.parquet (or .csv fallback), one row per (date, ticker).
Run: /opt/homebrew/bin/python3.12 build_features.py
"""
import gzip, json, math, os, sys
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
OUT = HERE / "outputs"
OUT.mkdir(exist_ok=True)

TARGETS = ["SPY", "QQQ"]


def load_json(p):
    with open(p) as f:
        return json.load(f)


# ---------- OHLC / labels ----------
def ohlc_frame(ticker):
    rows = load_json(DATA / "ohlc" / f"{ticker}.json")["data"]
    df = pd.DataFrame([r for r in rows if r.get("market_time") == "r"])
    for c in ["open", "high", "low", "close"]:
        df[c] = df[c].astype(float)
    df["date"] = pd.to_datetime(df["date"])
    df = df.sort_values("date").set_index("date")
    df["ret_oc"] = np.log(df["close"] / df["open"])
    df["ret_cc"] = np.log(df["close"] / df["close"].shift(1))
    df["gap"] = np.log(df["open"] / df["close"].shift(1))
    df["hl_range"] = (df["high"] - df["low"]) / df["open"]
    rng = (df["high"] - df["low"]).replace(0, np.nan)
    df["close_pos"] = (df["close"] - df["low"]) / rng
    df["ret_3d"] = df["ret_cc"].rolling(3).sum()
    df["ret_5d"] = df["ret_cc"].rolling(5).sum()
    df["vol_z_raw"] = df["volume"].astype(float)
    return df


def vix_frame():
    df = pd.read_csv(DATA / "ohlc" / "VIX.csv")
    df.columns = [c.lower() for c in df.columns]
    df["date"] = pd.to_datetime(df["date"], format="%m/%d/%Y")
    df = df.sort_values("date").set_index("date")
    df = df[df.index >= "2025-01-01"]
    out = pd.DataFrame(index=df.index)
    out["vix_close"] = df["close"]
    out["vix_chg1"] = df["close"].diff()
    out["vix_slope5"] = df["close"].diff(5)
    out["vix_vs_ma20"] = df["close"] / df["close"].rolling(20).mean() - 1
    return out


# ---------- greeks (SPY, QQQ, SPX all join as features) ----------
def greeks_frame(ticker):
    rows = load_json(DATA / "greeks" / f"{ticker}.json")["data"]
    df = pd.DataFrame(rows)
    df["date"] = pd.to_datetime(df["date"])
    df = df.sort_values("date").set_index("date")
    num = df.astype(float)
    p = ticker.lower()
    out = pd.DataFrame(index=df.index)
    out[f"{p}_net_gamma"] = num["call_gamma"] + num["put_gamma"]
    out[f"{p}_net_gamma_d1"] = out[f"{p}_net_gamma"].diff()
    out[f"{p}_net_vanna"] = num["call_vanna"] + num["put_vanna"]
    out[f"{p}_net_vanna_d1"] = out[f"{p}_net_vanna"].diff()
    out[f"{p}_net_charm"] = num["call_charm"] + num["put_charm"]
    out[f"{p}_net_delta"] = num["call_delta"] + num["put_delta"]
    return out


# ---------- market tide (cumulative 5m path -> daily aggregates) ----------
def tide_frame():
    recs = []
    for f in sorted((DATA / "tide").glob("*.json")):
        d = load_json(f)
        rows = d.get("data", [])
        if not rows:
            continue
        cp = np.array([float(r["net_call_premium"]) for r in rows])
        pp = np.array([float(r["net_put_premium"]) for r in rows])
        eod_c, eod_p = cp[-1], pp[-1]
        mid = len(cp) // 2
        pm_slope_c = cp[-1] - cp[mid]
        flips = int(np.sum(np.diff(np.sign(cp - pp)) != 0))
        recs.append(dict(date=f.stem, tide_eod_call=eod_c, tide_eod_put=eod_p,
                         tide_net=eod_c - eod_p, tide_pm_slope=pm_slope_c,
                         tide_flips=flips))
    df = pd.DataFrame(recs)
    df["date"] = pd.to_datetime(df["date"])
    return df.set_index("date").sort_index()


# ---------- per-ticker net premium ticks (per-minute deltas -> daily) ----------
def netprem_frame(ticker):
    recs = []
    for f in sorted((DATA / "netprem").glob(f"{ticker}_*.json")):
        rows = load_json(f)
        if not rows:
            continue
        ncp = np.array([float(r["net_call_premium"]) for r in rows])
        npp = np.array([float(r["net_put_premium"]) for r in rows])
        cask = sum(r["call_volume_ask_side"] for r in rows)
        cbid = sum(r["call_volume_bid_side"] for r in rows)
        pask = sum(r["put_volume_ask_side"] for r in rows)
        pbid = sum(r["put_volume_bid_side"] for r in rows)
        last_hr = max(1, len(rows) - 60)
        recs.append(dict(date=f.stem.split("_")[1],
                         np_call=ncp.sum(), np_put=npp.sum(),
                         np_net=ncp.sum() - npp.sum(),
                         np_call_askshare=cask / max(1, cask + cbid),
                         np_put_askshare=pask / max(1, pask + pbid),
                         np_late_call=ncp[last_hr:].sum()))
    df = pd.DataFrame(recs)
    df["date"] = pd.to_datetime(df["date"])
    return df.set_index("date").sort_index()


# ---------- short volume ----------
def shortvol_frame(ticker):
    rows = load_json(DATA / "shortvol" / f"{ticker}.json")["si"]
    df = pd.DataFrame(rows)
    df["date"] = pd.to_datetime(df["market_date"])
    df = df.sort_values("date").set_index("date")
    out = pd.DataFrame(index=df.index)
    out["shortvol_ratio"] = df["short_volume_ratio"].astype(float)
    out["shortvol_ratio_5dm"] = out["shortvol_ratio"].rolling(5).mean()
    out["shortvol_ratio_5dd"] = out["shortvol_ratio"].diff(5)
    return out


# ---------- dark pool (last-500 prints cap; late-day sample) ----------
def darkpool_frame():
    recs = []
    for f in sorted((DATA / "darkpool").glob("SPY_*.json")):
        rows = load_json(f)
        if not rows:
            continue
        prem = np.array([float(r["premium"]) for r in rows])
        px = np.array([float(r["price"]) for r in rows])
        sz = np.array([float(r["size"]) for r in rows])
        vwap = (px * sz).sum() / max(1.0, sz.sum())
        recs.append(dict(date=f.stem.split("_")[1], dp_prem_sum=prem.sum(),
                         dp_big_share=(prem > 1e6).mean(), dp_vwap=vwap))
    df = pd.DataFrame(recs)
    df["date"] = pd.to_datetime(df["date"])
    return df.set_index("date").sort_index()


# ---------- insider (aggregate across sectors by date) ----------
def insider_frame():
    rows = []
    d = DATA / "insider"
    if d.exists():
        for f in d.glob("*.json"):
            rows.extend(load_json(f))
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows)
    df["date"] = pd.to_datetime(df["date"])
    df["premium"] = df["premium"].astype(float)
    g = df.groupby("date").agg(ins_net_prem=("premium", "sum"),
                               ins_txn=("transactions", "sum"))
    buys = df[df["buy_sell"] == "buy"].groupby("date")["sector"].nunique()
    g["ins_buy_breadth"] = buys.reindex(g.index).fillna(0)
    return g.sort_index()


# ---------- congress (by disclosure/report date; weak on purpose) ----------
def congress_frame():
    p = DATA / "congress" / "trades.json"
    if not p.exists():
        return pd.DataFrame()
    rows = load_json(p)
    df = pd.DataFrame(rows)
    datecol = next((c for c in ["filed_at_date", "disclosure_date", "report_date"] if c in df.columns), None)
    if datecol is None:
        return pd.DataFrame()
    df["date"] = pd.to_datetime(df[datecol], errors="coerce")
    df = df.dropna(subset=["date"])
    df["is_buy"] = df.get("txn_type", df.get("transaction_type", "")).astype(str).str.lower().str.contains("purchase|buy")
    g = df.groupby("date").agg(cg_n=("is_buy", "size"), cg_buyshare=("is_buy", "mean"))
    return g.sort_index()


def trailing_z(s, win=60, min_periods=30):
    m = s.rolling(win, min_periods=min_periods).mean()
    sd = s.rolling(win, min_periods=min_periods).std()
    return (s - m) / sd.replace(0, np.nan)


FAMILIES = {}  # feature -> family name, filled as we add


def add_family(df, cols, fam):
    for c in cols:
        FAMILIES[c] = fam


def build():
    vix = vix_frame()
    tide = tide_frame()
    dp = darkpool_frame()
    ins = insider_frame()
    cg = congress_frame()
    spx_grk = greeks_frame("SPX")

    frames = []
    for t in TARGETS:
        px = ohlc_frame(t)
        grk = greeks_frame(t)
        npf = netprem_frame(t)
        sv = shortvol_frame(t)

        f = pd.DataFrame(index=px.index)
        # momentum family (already scale-free except volume)
        f["mom_ret_oc"] = px["ret_oc"]
        f["mom_ret_3d"] = px["ret_3d"]
        f["mom_ret_5d"] = px["ret_5d"]
        f["mom_gap"] = px["gap"]
        f["mom_close_pos"] = px["close_pos"]
        f["mom_range_z"] = trailing_z(px["hl_range"])
        f["mom_vol_z"] = trailing_z(px["vol_z_raw"])
        add_family(f, [c for c in f.columns], "momentum")

        # greeks (own ticker + SPX structure)
        for src, tag in [(grk, "own"), (spx_grk, "spx")]:
            for c in src.columns:
                name = f"grk_{tag}_{'_'.join(c.split('_')[1:])}"
                f[name] = trailing_z(src[c].reindex(f.index))
                FAMILIES[name] = "greeks"

        # tide (market-wide)
        for c in tide.columns:
            f[f"td_{c}"] = trailing_z(tide[c].reindex(f.index))
            FAMILIES[f"td_{c}"] = "tide"

        # per-ticker options flow
        for c in npf.columns:
            f[f"fl_{c}"] = trailing_z(npf[c].reindex(f.index))
            FAMILIES[f"fl_{c}"] = "flow"

        # short volume
        for c in sv.columns:
            f[f"sv_{c}"] = trailing_z(sv[c].reindex(f.index))
            FAMILIES[f"sv_{c}"] = "shortvol"

        # VIX
        for c in vix.columns:
            f[f"vx_{c}"] = trailing_z(vix[c].reindex(f.index))
            FAMILIES[f"vx_{c}"] = "vix"

        # dark pool (SPY prints, joins both targets as market feature)
        for c in ["dp_prem_sum", "dp_big_share"]:
            if c in dp.columns:
                f[f"dpx_{c}"] = trailing_z(dp[c].reindex(f.index))
                FAMILIES[f"dpx_{c}"] = "darkpool"

        # insider / congress (slow families, ffill 1 day max)
        for src, tag, fam in [(ins, "ins", "insider"), (cg, "cg", "congress")]:
            for c in (src.columns if len(src) else []):
                f[f"{tag}_{c}"] = trailing_z(src[c].reindex(f.index).ffill(limit=2).fillna(0))
                FAMILIES[f"{tag}_{c}"] = fam

        # calendar
        f["cal_dow_mon"] = (f.index.dayofweek == 0).astype(float)
        f["cal_dow_fri"] = (f.index.dayofweek == 4).astype(float)
        f["cal_month_end"] = (f.index.day >= 25).astype(float)
        add_family(f, ["cal_dow_mon", "cal_dow_fri", "cal_month_end"], "calendar")

        # labels: next session open->close
        nxt = px["ret_oc"].shift(-1)
        f["y_ret"] = nxt
        f["y_up"] = (nxt > 0).astype(int)
        thresh = px["ret_oc"].abs().rolling(60, min_periods=30).quantile(0.30)
        f["y_chop"] = (nxt.abs() <= thresh).astype(int)
        f["y3"] = np.where(f["y_chop"] == 1, 0, np.where(nxt > 0, 1, -1))
        f["ticker"] = t
        frames.append(f)

    allf = pd.concat(frames).reset_index().rename(columns={"index": "date"})
    # keep rows with label and enough trailing history
    allf = allf.dropna(subset=["y_ret", "mom_ret_5d"])
    feat_cols = [c for c in allf.columns if c not in ("date", "ticker", "y_ret", "y_up", "y_chop", "y3")]
    # require ≥80% feature coverage per row
    cov = allf[feat_cols].notna().mean(axis=1)
    allf = allf[cov >= 0.8].copy()
    allf[feat_cols] = allf[feat_cols].fillna(0.0).clip(-5, 5)

    allf.to_csv(OUT / "features.csv", index=False)
    with open(OUT / "families.json", "w") as fh:
        json.dump(FAMILIES, fh, indent=1)
    print(f"rows={len(allf)} features={len(feat_cols)} "
          f"dates {allf['date'].min().date()}..{allf['date'].max().date()}")
    print("per family:", pd.Series(FAMILIES).value_counts().to_dict())
    print("class balance y_up:", allf["y_up"].mean().round(3),
          "| chop share:", allf["y_chop"].mean().round(3))


if __name__ == "__main__":
    build()
