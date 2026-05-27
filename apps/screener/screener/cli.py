"""Screener CLI entrypoint.

Usage:
    python -m screener.cli --config config.yaml [--refresh] [--limit N]
"""
from __future__ import annotations

import argparse
import sys
import time
from datetime import date
from pathlib import Path

import yaml

from .client import UWClient
from .data import fetch_ohlc_batch, fetch_universe
from .flow import fetch_flow, fetch_sector_tides
from .scoring import build_ranking
from .technical import compute_technical


def _load_cfg(path: str) -> dict:
    with open(path) as f:
        return yaml.safe_load(f)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default=str(Path(__file__).resolve().parent.parent / "config.yaml"))
    ap.add_argument("--refresh", action="store_true", help="ignore caches")
    ap.add_argument("--limit", type=int, default=None, help="cap universe size for quick runs")
    ap.add_argument("--top", type=int, default=None, help="override top-N printed")
    args = ap.parse_args()

    cfg = _load_cfg(args.config)
    root = Path(args.config).resolve().parent
    # Make paths relative to the screener dir.
    if not Path(cfg["output"]["duckdb_path"]).is_absolute():
        cfg["output"]["duckdb_path"] = str(root / cfg["output"]["duckdb_path"])
    if not Path(cfg["output"]["csv_dir"]).is_absolute():
        cfg["output"]["csv_dir"] = str(root / cfg["output"]["csv_dir"])

    client = UWClient(
        base_url=cfg["api"]["base_url"],
        rate_limit_rps=cfg["api"]["rate_limit_rps"],
        max_retries=cfg["api"]["max_retries"],
        timeout=cfg["api"]["timeout_seconds"],
    )

    t0 = time.monotonic()
    print(f"[1/5] Pulling universe from UW screener (cap {cfg['universe']['max_size']}) ...", flush=True)
    uni = fetch_universe(client, cfg)
    if args.limit:
        uni = uni.head(args.limit)
    tickers = uni["ticker"].tolist()
    iv_lookup = {
        r["ticker"]: {"iv_rank": r.get("iv_rank"), "iv30d": r.get("iv30d")}
        for _, r in uni.iterrows()
    }
    sector_lookup = {r["ticker"]: r.get("sector") for _, r in uni.iterrows()}
    print(f"  {len(tickers)} tickers after filters", flush=True)

    print(f"[2/5] Fetching OHLC ({cfg['ohlc']['candle_size']}, limit={cfg['ohlc']['limit']}) for {len(tickers)} tickers ...", flush=True)
    ohlc = fetch_ohlc_batch(client, tickers, cfg, refresh=args.refresh)
    print(f"  {len(ohlc)} tickers with usable OHLC", flush=True)

    print("[3/5] Stage 1 technical scan ...", flush=True)
    tech_rows: list[dict] = []
    strict_pass: list[str] = []
    for t, df in ohlc.items():
        tr = compute_technical(df, cfg)
        if tr is None:
            continue
        tech_rows.append(tr.to_dict())
        if tr.passes_stage1:
            strict_pass.append(t)

    # Wider candidate pool: anything with a base + breakout, ranked by tech_score.
    # The strict passers are flagged via the `stage1_pass` column downstream.
    relaxed = sorted(
        [r for r in tech_rows if r["has_base"] and r["has_breakout"]],
        key=lambda r: r["tech_score"],
        reverse=True,
    )
    cap = max(60, cfg["output"]["top_n_print"] * 4)
    survivors = [r["ticker"] for r in relaxed[:cap]]
    print(
        f"  {len(tech_rows)} evaluated; {len(strict_pass)} strict pass, "
        f"running flow on top {len(survivors)} base+breakout candidates",
        flush=True,
    )

    print(f"[4/5] Stage 2 flow overlay on {len(survivors)} survivors ...", flush=True)
    ref_prices = {t: float(ohlc[t]["close"].iloc[-1]) for t in survivors if t in ohlc and not ohlc[t].empty}
    # Pull sector-tide once per unique sector among survivors.
    unique_sectors = sorted({sector_lookup.get(t) for t in survivors if sector_lookup.get(t)})
    print(f"  pulling sector-tide for {len(unique_sectors)} unique sectors ...", flush=True)
    sector_tide = fetch_sector_tides(client, unique_sectors, cfg)
    for sec, (label, mult) in sector_tide.items():
        print(f"    {sec}: {label} (x{mult:.2f})", flush=True)
    flow_rows = fetch_flow(
        client, survivors, ref_prices, iv_lookup, sector_lookup, sector_tide, cfg
    )

    print("[5/5] Scoring + ranking ...", flush=True)
    surv_set = set(survivors)
    tech_subset = [r for r in tech_rows if r["ticker"] in surv_set]
    flow_dicts = {k: v.to_dict() for k, v in flow_rows.items()}
    n_illiquid = sum(1 for v in flow_dicts.values() if not v.get("passes_options_liquidity"))
    df = build_ranking(tech_subset, flow_dicts, cfg)
    print(
        f"  dropped {n_illiquid}/{len(flow_dicts)} for failing options-liquidity gate "
        f"(min ${cfg['stage2_flow']['min_call_premium_today']:,} call premium today)",
        flush=True,
    )

    out_dir = Path(cfg["output"]["csv_dir"])
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"candidates_{date.today().strftime('%Y%m%d')}.csv"
    df.to_csv(out_path, index=False)
    print(f"\nWrote {out_path} ({len(df)} candidates) in {time.monotonic()-t0:.1f}s\n")

    top_n = args.top or cfg["output"]["top_n_print"]
    cols = [
        "ticker", "price", "sector", "base_length", "pct_from_ema21", "atr_squeeze_pct",
        "breakout_date", "vol_ratio", "iv_rank",
        "call_prem_today", "call_vol_today", "net_call_prem_5d",
        "bullish_alerts", "darkpool_above_pct", "sector_tide", "sector_mult",
        "tech_score", "flow_score", "composite",
        "stage1_pass", "flow_confirmed", "flow_confirmed_cheap", "cheap_options", "rationale",
    ]
    cols = [c for c in cols if c in df.columns]
    with_format = df[cols].head(top_n).to_string(index=False)
    print(with_format)

    return 0


if __name__ == "__main__":
    sys.exit(main())
