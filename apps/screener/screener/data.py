"""Universe + OHLC data fetch with DuckDB cache.

- Universe: pulls the UW stock screener for liquid optionable names within
  configurable marketcap and dollar-volume bounds (catches mid-caps like NVTS).
- OHLC: /api/stock/{t}/ohlc/1d. The endpoint returns 3 rows per date
  (pr/r/po market sessions); we filter to regular ("r") and cache to DuckDB
  keyed by (ticker, date).
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
from pathlib import Path
from typing import Any

import duckdb
import pandas as pd

from .client import UWClient


def _ddb(path: str) -> duckdb.DuckDBPyConnection:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(path)
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS ohlc (
            ticker VARCHAR,
            date DATE,
            open DOUBLE,
            high DOUBLE,
            low DOUBLE,
            close DOUBLE,
            volume BIGINT,
            fetched_on DATE,
            PRIMARY KEY (ticker, date)
        )
        """
    )
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS screener_snapshot (
            ticker VARCHAR PRIMARY KEY,
            marketcap DOUBLE,
            close DOUBLE,
            iv_rank DOUBLE,
            iv30d DOUBLE,
            week_52_high DOUBLE,
            week_52_low DOUBLE,
            avg_dollar_vol DOUBLE,
            issue_type VARCHAR,
            sector VARCHAR,
            full_name VARCHAR,
            fetched_on DATE
        )
        """
    )
    return con


def fetch_universe(client: UWClient, cfg: dict) -> pd.DataFrame:
    """Pull a liquid optionable universe from UW screener and snapshot to DuckDB."""
    uc = cfg["universe"]
    if uc["source"] != "uw_screener":
        raise NotImplementedError("static universe not implemented yet")

    # UW screener ignores page=/offset= reliably; only the first 250 rows for any
    # filter window come back. Walk down by marketcap: each call returns the top
    # 250 in [min_mc, current_max_mc); we shrink current_max_mc to the smallest
    # marketcap in the batch and recurse until exhausted or max_size hit.
    rows: list[dict] = []
    page_size = 250
    seen: set[str] = set()
    cur_max = int(uc["max_marketcap"])
    min_mc = int(uc["min_marketcap"])
    while len(rows) < uc["max_size"]:
        params = {
            "limit": page_size,
            "order": "marketcap",
            "order_direction": "desc",
            "min_marketcap": min_mc,
            "max_marketcap": cur_max,
        }
        data = client.get("/api/screener/stocks", params=params)
        if not data or not data.get("data"):
            break
        batch = data["data"]
        # Track smallest marketcap in this batch — will become next call's ceiling.
        batch_mcs = [int(float(r.get("marketcap") or 0)) for r in batch]
        new = [r for r in batch if r.get("ticker") not in seen]
        for r in new:
            seen.add(r.get("ticker"))
        rows.extend(new)
        if not batch_mcs:
            break
        new_max = min(batch_mcs) - 1
        if new_max <= min_mc or new_max >= cur_max:
            break
        cur_max = new_max
        if len(batch) < page_size:
            break

    if not rows:
        raise RuntimeError("UW screener returned no rows — check API key / plan")

    df = pd.DataFrame(rows)
    # Normalize numerics.
    for c in (
        "marketcap",
        "close",
        "iv_rank",
        "iv30d",
        "week_52_high",
        "week_52_low",
        "avg_30_day_call_oi",
    ):
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors="coerce")
    # Approximate avg dollar volume from prev volume * close (UW screener doesn't expose 20d $-vol directly).
    if "prev_close" in df.columns and "volume" in df.columns:
        df["prev_close"] = pd.to_numeric(df["prev_close"], errors="coerce")
        df["volume"] = pd.to_numeric(df["volume"], errors="coerce")
        df["avg_dollar_vol_proxy"] = df["prev_close"] * df["volume"]
    else:
        df["avg_dollar_vol_proxy"] = pd.NA

    # Filter.
    out = df.copy()
    out = out[out["marketcap"].between(uc["min_marketcap"], uc["max_marketcap"], inclusive="both")]
    if "issue_type" in out.columns:
        out = out[~out["issue_type"].isin(uc["exclude_issue_types"])]
    # avg_dollar_vol proxy filter — keep NaN through (we'll re-filter against real OHLC later).
    mask = (out["avg_dollar_vol_proxy"].isna()) | (out["avg_dollar_vol_proxy"] >= uc["min_avg_dollar_vol"])
    out = out[mask]
    out = out.drop_duplicates("ticker").head(uc["max_size"]).reset_index(drop=True)

    # Snapshot to DuckDB.
    con = _ddb(cfg["output"]["duckdb_path"])
    snap = out[[
        "ticker", "marketcap", "close", "iv_rank", "iv30d",
        "week_52_high", "week_52_low", "avg_dollar_vol_proxy", "issue_type", "full_name",
    ]].copy()
    snap = snap.rename(columns={"avg_dollar_vol_proxy": "avg_dollar_vol"})
    snap["sector"] = None
    snap["fetched_on"] = date.today()
    con.execute("DELETE FROM screener_snapshot")
    con.register("snap_df", snap)
    con.execute("INSERT INTO screener_snapshot SELECT ticker, marketcap, close, iv_rank, iv30d, week_52_high, week_52_low, avg_dollar_vol, issue_type, sector, full_name, fetched_on FROM snap_df")
    con.close()

    return out


def _parse_ohlc_response(ticker: str, raw: Any) -> pd.DataFrame:
    if not raw or "data" not in raw:
        return pd.DataFrame()
    rows = [r for r in raw["data"] if r.get("market_time") == "r"]
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows)
    df["ticker"] = ticker
    df["date"] = pd.to_datetime(df["date"]).dt.date
    for c in ("open", "high", "low", "close"):
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df["volume"] = pd.to_numeric(df["volume"], errors="coerce").astype("Int64")
    return df[["ticker", "date", "open", "high", "low", "close", "volume"]].sort_values("date").reset_index(drop=True)


def fetch_ohlc_batch(
    client: UWClient,
    tickers: list[str],
    cfg: dict,
    refresh: bool = False,
) -> dict[str, pd.DataFrame]:
    """Fetch OHLC for tickers in parallel, caching in DuckDB."""
    db_path = cfg["output"]["duckdb_path"]
    con = _ddb(db_path)
    today = date.today()
    limit = cfg["ohlc"]["limit"]
    candle = cfg["ohlc"]["candle_size"]

    cached: dict[str, pd.DataFrame] = {}
    if not refresh:
        existing = con.execute(
            "SELECT ticker, MAX(date) AS last_date, COUNT(*) AS n FROM ohlc GROUP BY ticker"
        ).fetchdf()
        if not existing.empty:
            existing["last_date"] = pd.to_datetime(existing["last_date"]).dt.date
            cutoff = today - pd.Timedelta(days=4).to_pytimedelta()
            fresh = existing[existing["last_date"] >= cutoff]
        else:
            fresh = existing
        for t in fresh["ticker"]:
            if t in tickers:
                df = con.execute(
                    "SELECT * FROM ohlc WHERE ticker = ? ORDER BY date", [t]
                ).fetchdf()
                df["date"] = pd.to_datetime(df["date"]).dt.date
                cached[t] = df

    to_fetch = [t for t in tickers if t not in cached]
    con.close()

    results: dict[str, pd.DataFrame] = dict(cached)
    threads = cfg["api"]["thread_count"]

    def _pull(t: str) -> tuple[str, pd.DataFrame]:
        raw = client.get(f"/api/stock/{t}/ohlc/{candle}", params={"limit": limit})
        return t, _parse_ohlc_response(t, raw)

    if to_fetch:
        with ThreadPoolExecutor(max_workers=threads) as ex:
            futs = {ex.submit(_pull, t): t for t in to_fetch}
            done = 0
            for f in as_completed(futs):
                t, df = f.result()
                if not df.empty:
                    results[t] = df
                done += 1
                if done % 25 == 0 or done == len(to_fetch):
                    print(f"  ohlc {done}/{len(to_fetch)}", flush=True)

        # Persist newly fetched.
        con = _ddb(db_path)
        all_new = [df.assign(fetched_on=today) for t, df in results.items() if t in to_fetch and not df.empty]
        if all_new:
            big = pd.concat(all_new, ignore_index=True)
            con.register("new_ohlc", big)
            con.execute(
                "DELETE FROM ohlc WHERE ticker IN (SELECT DISTINCT ticker FROM new_ohlc)"
            )
            con.execute(
                "INSERT INTO ohlc SELECT ticker, date, open, high, low, close, volume, fetched_on FROM new_ohlc"
            )
        con.close()

    return results
