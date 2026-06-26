#!/usr/bin/env python3
"""Render a per-day SPY brief + outcome table for every day in brief_backtest.json."""
import json
from pathlib import Path

d = json.loads(Path("sniper/validation/brief_backtest.json").read_text())
days = d["days"]
summary = d["summary"]

out = ["# Sniper morning brief — per-day SPY backtest", "",
       "Each row shows the **brief that would have been generated at 09:35 ET** based on Skylit Trinity, then the **actual day outcome**, then the **grade**.", "",
       "Brief format key:",
       "- **REVERT_UP** = spot was below King → buy calls toward King (mean reversion play)",
       "- **REVERT_DOWN** = spot was above King → buy puts toward King",
       "- **PIN** = spot was at King → sell premium",
       "- **Breakout ↑** = if spot closes above ceiling + buffer, target vacuum high (calls)",
       "- **Breakout ↓** = if spot closes below floor − buffer, target vacuum low (puts)", "",
       "**P&L is in SPY points** (1 pt SPY ≈ $1, scales to options via delta).", "",
       "| Date | Spot | King | Floor | Ceil | Primary play | Hit? | Br↑ trig/hit | Br↑ pnl | Br↓ trig/hit | Br↓ pnl |",
       "|---|---:|---:|---:|---:|---|:---:|:---:|---:|:---:|---:|",
]

# Sort by date
days_sorted = sorted(days, key=lambda x: x.get("date", ""))
for day in days_sorted:
    date = day.get("date", "?")
    spy = day.get("per_ticker", {}).get("SPY")
    if not spy: continue
    spot = spy["spot_0935"]
    s = spy["structure"]
    b = spy["brief"]
    g = spy["grade"]

    primary = b["primary"]
    primary_hit = "✅" if g["primary_hit"] else "❌" if g["primary_hit"] is False else "·"

    # Breakout above
    if g["breakout_above_triggered"]:
        ba_trig = "Y"
        ba_hit_full = "Y" if g["breakout_above_hit"] else "n"
        ba_pnl = f"{g['breakout_above_pnl_pts']:+.2f}"
    else:
        ba_trig = "n"
        ba_hit_full = "-"
        ba_pnl = "-"

    # Breakout below
    if g["breakout_below_triggered"]:
        bb_trig = "Y"
        bb_hit_full = "Y" if g["breakout_below_hit"] else "n"
        bb_pnl = f"{g['breakout_below_pnl_pts']:+.2f}"
    else:
        bb_trig = "n"
        bb_hit_full = "-"
        bb_pnl = "-"

    primary_label = primary
    if primary in ("REVERT_UP", "REVERT_DOWN"):
        primary_label = f"{primary} → {b['primary_target']:.2f}"

    fl = "-" if s['floor'] is None else f"{s['floor']:.0f}"
    cl = "-" if s['ceiling'] is None else f"{s['ceiling']:.0f}"
    out.append(f"| {date} | {spot:.2f} | {s['king']:.0f} | {fl} | {cl} | {primary_label} | {primary_hit} | {ba_trig}/{ba_hit_full} | {ba_pnl} | {bb_trig}/{bb_hit_full} | {bb_pnl} |")

# Summary
sp = summary["SPY"]
out.append("")
out.append("## SPY summary across all 71 days")
out.append("")
out.append("### Primary plays (mean reversion to King)")
out.append("")
out.append("| Play | n | Hit % | Avg P&L pts | Total P&L pts |")
out.append("|---|---:|---:|---:|---:|")
for ptype in ["REVERT_UP", "REVERT_DOWN", "PIN"]:
    if ptype in sp["primary_by_type"]:
        p = sp["primary_by_type"][ptype]
        out.append(f"| {ptype} | {p['n']} | {p['hit_rate_pct']:.1f}% | {p['avg_pnl_pts']:+.2f} | **{p['total_pnl_pts']:+.1f}** |")

out.append("")
out.append("### Breakout plays (directional vacuum trades)")
out.append("")
out.append("| Play | Triggered | Full target hit | Hit % | Avg P&L | Total P&L |")
out.append("|---|---:|---:|---:|---:|---:|")
out.append(f"| Breakout above ceiling | {sp['breakout_above']['triggered']} | {sp['breakout_above']['hit_full_target']} | {sp['breakout_above']['hit_rate_pct']:.1f}% | {sp['breakout_above']['avg_pnl_pts']:+.2f} | **{sp['breakout_above']['total_pnl_pts']:+.1f}** |")
out.append(f"| Breakout below floor | {sp['breakout_below']['triggered']} | {sp['breakout_below']['hit_full_target']} | {sp['breakout_below']['hit_rate_pct']:.1f}% | {sp['breakout_below']['avg_pnl_pts']:+.2f} | **{sp['breakout_below']['total_pnl_pts']:+.1f}** |")

# QQQ summary
qq = summary["QQQ"]
out.append("")
out.append("## QQQ summary across all 71 days")
out.append("")
out.append("### Primary plays")
out.append("")
out.append("| Play | n | Hit % | Avg P&L pts | Total P&L pts |")
out.append("|---|---:|---:|---:|---:|")
for ptype in ["REVERT_UP", "REVERT_DOWN", "PIN"]:
    if ptype in qq["primary_by_type"]:
        p = qq["primary_by_type"][ptype]
        out.append(f"| {ptype} | {p['n']} | {p['hit_rate_pct']:.1f}% | {p['avg_pnl_pts']:+.2f} | **{p['total_pnl_pts']:+.1f}** |")
out.append("")
out.append("### Breakout plays")
out.append("")
out.append("| Play | Triggered | Full target hit | Hit % | Avg P&L | Total P&L |")
out.append("|---|---:|---:|---:|---:|---:|")
out.append(f"| Breakout above ceiling | {qq['breakout_above']['triggered']} | {qq['breakout_above']['hit_full_target']} | {qq['breakout_above']['hit_rate_pct']:.1f}% | {qq['breakout_above']['avg_pnl_pts']:+.2f} | **{qq['breakout_above']['total_pnl_pts']:+.1f}** |")
out.append(f"| Breakout below floor | {qq['breakout_below']['triggered']} | {qq['breakout_below']['hit_full_target']} | {qq['breakout_below']['hit_rate_pct']:.1f}% | {qq['breakout_below']['avg_pnl_pts']:+.2f} | **{qq['breakout_below']['total_pnl_pts']:+.1f}** |")

out.append("")
out.append("## Conclusion")
out.append("")
out.append("- **Mean reversion primary (REVERT_UP / REVERT_DOWN)** loses money on SPY (−31 / −29 pts) and barely breaks even on QQQ. The user's intuitive \"below King = calls, above King = puts\" rule does NOT have edge on SPY.")
out.append("- **PIN trades fail miserably as a directional bet** (−40+ pts on both tickers). They should be premium-selling structures, not directional contracts.")
out.append("- **Breakout plays ARE profitable**: SPY breakout above ceiling +37.7 pts total; below floor +26.7 pts. QQQ even better: +70.5 / +47.3 pts.")
out.append("- **The brief format the framework should use**: do NOT trade naively to the King. Wait for confirmation of a structural break through the ceiling (long) or floor (short) into a liquidity vacuum.")

Path("sniper/validation/BRIEF_PER_DAY.md").write_text("\n".join(out))
print(f"Wrote sniper/validation/BRIEF_PER_DAY.md ({len(out)} lines)")
