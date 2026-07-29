#!/usr/bin/env python3
"""PART 1 — Score the operator's 8 annotated trades with REAL option prints.
RESEARCH ONLY (Clause 0). n=8, descriptive, no claims.

For each trade: ATM contract at entry (nearest strike to spot at that minute;
call for LONG, put for SHORT; same-day expiry), pull UW option-contract intraday
1-min prints (cached in prices_v0/), score entry->exit close-to-close with a 3%
round-trip haircut (1.5% each side, matching pnl_v0.py). Also report avg-to-avg,
the underlying spot move over the window (what the terrain viewer shows = the
"rough estimate"), MFE inside the window, and the EOD/peak.
"""
import json, os, subprocess, csv, statistics
from datetime import datetime, timedelta, timezone

SP = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(SP, "prices_v0")
BACKFILL = "/Users/saiyeeshrathish/the final plan/apps/gex/research/velocity-capture/backfill"
HAIRCUT = 0.015
INC = {"SPXW": 5, "SPY": 1, "QQQ": 1}

def get_key():
    with open("/Users/saiyeeshrathish/the final plan/.env") as f:
        for line in f:
            if line.startswith("UNUSUAL_WHALES_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("no key")
KEY = get_key()

def et(ts_iso):
    s = ts_iso.replace("Z", "+00:00")
    dt = datetime.fromisoformat(s).astimezone(timezone.utc) - timedelta(hours=4)
    return dt.strftime("%H:%M")

def atm_strike(ticker, spot):
    inc = INC[ticker]
    return int(round(spot / inc) * inc)

def occ_of(ticker, date, strike, cp):
    yymmdd = date[2:].replace("-", "")
    return f"{ticker}{yymmdd}{cp}{int(strike*1000):08d}"

def fetch(occ, date):
    cp = os.path.join(CACHE, f"{occ}_{date}.json")
    if os.path.exists(cp):
        return json.load(open(cp))
    url = f"https://api.unusualwhales.com/api/option-contract/{occ}/intraday?date={date}"
    out = subprocess.run(["curl", "-s", url, "-H", f"Authorization: Bearer {KEY}",
                          "-H", "User-Agent: bellwether-research/1.0"],
                         capture_output=True, text=True).stdout
    try:
        rows = json.loads(out).get("data", [])
    except Exception:
        rows = []
    m = {}
    for r in rows:
        e = et(r["start_time"])
        try:
            m[e] = {"close": float(r["close"]), "high": float(r["high"]),
                    "low": float(r["low"]), "avg": float(r["avg_price"]),
                    "vol": int(r.get("volume_multi") or r.get("volume") or 0)}
        except Exception:
            continue
    json.dump(m, open(cp, "w"))
    return m

# spot series per (date,ticker) from price_structure.csv
def load_spot(date, ticker):
    p = os.path.join(BACKFILL, date, "price_structure.csv")
    out = {}
    with open(p) as f:
        for row in csv.DictReader(f):
            if row["ticker"] == ticker:
                out[row["et"]] = float(row["spot"])
    return out

def price_at(m, e, field):
    """price at exactly ET e, else nearest earlier minute with data."""
    if e in m:
        return m[e][field]
    ks = [k for k in sorted(m.keys()) if k <= e]
    return m[ks[-1]][field] if ks else None

def net_pnl(entry, exit_):
    if entry is None or exit_ is None or entry <= 0:
        return None
    return (exit_ * (1 - HAIRCUT)) / (entry * (1 + HAIRCUT)) - 1

def window_mfe(m, entry_et, exit_et, entry_price):
    """max favorable (for a long call: highest option HIGH) between entry and exit."""
    ks = [k for k in sorted(m.keys()) if entry_et <= k <= exit_et]
    if not ks or not entry_price:
        return None
    hi = max(m[k]["high"] for k in ks)
    return (hi - entry_price) / entry_price

# ---- the 8 operator trades ----
TRADES = [
    # id, date, ticker, side(LONG/SHORT), entry_et, exit_et, note
    ("T1", "2026-07-14", "SPXW", "LONG",  "10:51", "11:09", "V-reclaim off 10:51 dip"),
    ("T2", "2026-07-14", "SPXW", "LONG",  "11:19", "11:31", "higher-low continuation"),
    ("T3", "2026-07-14", "SPXW", "SHORT", "11:32", "12:05", "flip long->short at HOD reject"),
    ("T4", "2026-07-14", "SPXW", "LONG",  "12:24", "13:27", "V-reclaim off noon bottom (exit approx +-10min)"),
    ("T5", "2026-07-10", "SPXW", "LONG",  "10:35", "11:27", "V-reclaim off 10:34 flush low"),
    ("T6", "2026-07-10", "SPXW", "LONG",  "11:43", "15:04", "higher-low pullback -> trend runner"),
    ("T7", "2026-07-10", "SPY",  "LONG",  "10:34", "11:27", "V-reclaim off 10:34 flush low"),
    ("T8", "2026-07-10", "SPY",  "LONG",  "11:44", "14:43", "higher-low pullback -> trend runner"),
]

def score(entry_et, exit_et, date, ticker, side):
    spots = load_spot(date, ticker)
    espot = spots.get(entry_et); xspot = spots.get(exit_et)
    cp = "C" if side == "LONG" else "P"
    strike = atm_strike(ticker, espot)
    occ = occ_of(ticker, date, strike, cp)
    m = fetch(occ, date)
    e_close = price_at(m, entry_et, "close"); x_close = price_at(m, exit_et, "close")
    e_avg = price_at(m, entry_et, "avg");     x_avg = price_at(m, exit_et, "avg")
    net_c = net_pnl(e_close, x_close)
    net_a = net_pnl(e_avg, x_avg)
    # underlying move in the trade's favor
    if espot and xspot:
        und = (xspot - espot) / espot * (1 if side == "LONG" else -1)
    else:
        und = None
    mfe = window_mfe(m, entry_et, exit_et, e_close)
    return dict(occ=occ, strike=strike, cp=cp, espot=espot, xspot=xspot,
                e_close=e_close, x_close=x_close, e_avg=e_avg, x_avg=x_avg,
                net_c=net_c, net_a=net_a, und=und, mfe=mfe, m=m)

def main():
    print("PART 1 — OPERATOR'S 8 ANNOTATED TRADES (real prints, 3% haircut)\n")
    hdr = f"{'id':3s} {'date':10s} {'tkr':4s} {'side':5s} {'win':13s} {'K':>6s} {'cp':2s} " \
          f"{'espot':>8s} {'entry$':>7s} {'exit$':>7s} {'undMove':>8s} {'netCLOSE':>9s} {'netAVG':>8s} {'MFE':>7s}"
    print(hdr); print("-" * len(hdr))
    rows = []
    port_net = []
    for tid, date, ticker, side, e_et, x_et, note in TRADES:
        r = score(e_et, x_et, date, ticker, side)
        rows.append((tid, date, ticker, side, e_et, x_et, note, r))
        port_net.append(r["net_c"])
        print(f"{tid:3s} {date:10s} {ticker:4s} {side:5s} {e_et}->{x_et:5s} {r['strike']:>6d} {r['cp']:2s} "
              f"{r['espot']:>8.2f} {r['e_close']:>7.2f} {r['x_close']:>7.2f} "
              f"{(r['und']*100 if r['und'] is not None else 0):>+7.2f}% "
              f"{(r['net_c']*100 if r['net_c'] is not None else 0):>+8.1f}% "
              f"{(r['net_a']*100 if r['net_a'] is not None else 0):>+7.1f}% "
              f"{(r['mfe']*100 if r['mfe'] is not None else 0):>+6.0f}%")
    print()
    valid = [x for x in port_net if x is not None]
    print(f"PORTFOLIO (equal-weight, close-to-close net): mean={statistics.mean(valid)*100:+.1f}%  "
          f"median={statistics.median(valid)*100:+.1f}%  total(sum of %)={sum(valid)*100:+.1f}%  "
          f"win={sum(1 for x in valid if x>0)}/{len(valid)}")

    # --- T4 exit sensitivity (+-10 min) ---
    print("\nT4 exit sensitivity (2026-07-14 SPXW, entry 12:24):")
    tid, date, ticker, side, e_et, x_et, note, r = rows[3]
    for xe in ["13:17", "13:27", "13:37"]:
        xc = price_at(r["m"], xe, "close")
        n = net_pnl(r["e_close"], xc)
        xspot = load_spot(date, ticker).get(xe)
        print(f"   exit {xe}: exit$={xc:.2f}  net={n*100:+.1f}%  (spot {xspot})")

    # --- print the actual entry/exit prints for auditability ---
    print("\nAUDIT — raw 1-min option prints at entry & exit minute:")
    for tid, date, ticker, side, e_et, x_et, note, r in rows:
        me = r["m"].get(e_et, {}); mx = r["m"].get(x_et, {})
        print(f"  {tid} {r['occ']}  entry {e_et}: {me}   exit {x_et}: {mx}")

    json.dump([{**{k: v for k, v in r[7].items() if k != 'm'},
                "id": r[0], "date": r[1], "ticker": r[2], "side": r[3],
                "entry_et": r[4], "exit_et": r[5], "note": r[6]} for r in rows],
              open(os.path.join(SP, "operator_trades_results.json"), "w"), indent=1)
    print("\n[wrote operator_trades_results.json]")

if __name__ == "__main__":
    main()
