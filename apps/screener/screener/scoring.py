"""Combine technical + flow into a composite 0-100 score."""
from __future__ import annotations

import pandas as pd


def build_ranking(tech_rows: list[dict], flow_rows: dict[str, dict], cfg: dict) -> pd.DataFrame:
    rows = []
    for t in tech_rows:
        f = flow_rows.get(t["ticker"])
        flow_score = f["flow_score"] if f else 0.0
        composite = (
            cfg["scoring"]["technical_weight"] * t["tech_score"]
            + cfg["scoring"]["flow_weight"] * flow_score
        )
        rationale = _rationale(t, f)
        rows.append(
            {
                "ticker": t["ticker"],
                "price": round(t["price"], 2),
                "base_length": t["base_length"],
                "pct_from_ema21": round(t["pct_from_ema21"] * 100, 2),
                "atr_squeeze_pct": round(t["atr_squeeze_ratio"] * 100, 1) if t["atr_squeeze_ratio"] == t["atr_squeeze_ratio"] else None,
                "breakout_date": t["breakout_date"],
                "vol_ratio": round(t["vol_ratio_breakout"], 2) if t["vol_ratio_breakout"] == t["vol_ratio_breakout"] else None,
                "sector": f.get("sector") if f else None,
                "iv_rank": round(f["iv_rank"], 1) if f and f["iv_rank"] is not None else None,
                "net_call_prem_5d": int(f["net_call_prem_5d"]) if f else 0,
                "bullish_alerts": f["bullish_alerts_5d"] if f else 0,
                "darkpool_above_pct": round(f["darkpool_above_close_ratio"] * 100, 0) if f else None,
                "sector_tide": f.get("sector_tide_label") if f else None,
                "sector_mult": round(f["sector_tide_mult"], 2) if f else 1.0,
                "flow_score": round(flow_score, 1),
                "tech_score": round(t["tech_score"], 1),
                "composite": round(composite, 1),
                "stage1_pass": t.get("passes_stage1", False),
                "flow_confirmed": (f["flow_confirmed"] if f else False),
                "flow_confirmed_cheap": (f.get("flow_confirmed_cheap", False) if f else False),
                "cheap_options": (f["cheap_options"] if f else False),
                "rationale": rationale,
            }
        )
    df = pd.DataFrame(rows).sort_values("composite", ascending=False).reset_index(drop=True)
    return df


def _rationale(t: dict, f: dict | None) -> str:
    bits = []
    bits.append(f"{t['base_length']}d base, range {t['base_range_pct']*100:.0f}%")
    if t["breakout_date"]:
        bits.append(f"breakout {t['breakout_date']} on {t['vol_ratio_breakout']:.1f}x vol")
    bits.append(f"ATR {t['atr_squeeze_ratio']*100:.0f}% of 50d")
    if f:
        if f["cheap_options"] and f["iv_rank"] is not None:
            bits.append(f"IV rank {f['iv_rank']:.0f} (cheap)")
        elif f["iv_rank"] is not None:
            bits.append(f"IV rank {f['iv_rank']:.0f}")
        if f["net_call_prem_positive"]:
            bits.append(f"net call $+{f['net_call_prem_5d']/1e6:.1f}M")
        if f["has_bullish_alerts"]:
            bits.append(f"{f['bullish_alerts_5d']} bull alerts")
        if f["darkpool_accumulation"]:
            bits.append(f"DP {f['darkpool_above_close_ratio']*100:.0f}% above close")
        if f.get("sector_tide_label") and f["sector_tide_label"] not in ("n/a", "missing", "neutral"):
            bits.append(f"sector {f['sector_tide_label']}")
    return "; ".join(bits)
