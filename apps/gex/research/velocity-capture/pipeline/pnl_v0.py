#!/usr/bin/env python3
"""Option P&L for System-v0 cohorts. RESEARCH ONLY (Clause 0).

Reads system_v0_events.json. For each flip/v0b event: ATM contract (call for BULL,
put for BEAR, nearest strike to spot at signal minute). Fetch UW option-contract
intraday 1-min prints (cached). Apply live trail (arm 0.50 / gb 0.15) close-to-close
to EOD. Report:
  - entry = close of signal minute (polled-mid base case)
  - entry_ext = HIGH of signal minute (operator's "enter at the extreme, not midpoint")
  - gross, 3% round-trip haircut net, and peak/MFE
Cohorts: (a) unconditioned KingFlip-v0 [dom_ok flips], (b) System-v0 [taken],
(c) rejected [mid-range], (d) volume-matched random control [same contracts, random
entry minute]. Plus System-v0b.
"""
import json, os, subprocess, random, statistics
from datetime import datetime, timedelta, timezone

SP = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(SP, "prices_v0")
os.makedirs(CACHE, exist_ok=True)
random.seed(20260714)

def get_key():
    p = "/Users/saiyeeshrathish/the final plan/.env"
    with open(p) as f:
        for line in f:
            if line.startswith("UNUSUAL_WHALES_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("no key")
KEY = get_key()
ARM, GB, HAIRCUT = 0.50, 0.15, 0.015  # 1.5% each side ~ 3% round trip

INC = {"SPXW": 5, "SPY": 1, "QQQ": 1}

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
                    "vol": int(r.get("volume_multi") or 0)}
        except Exception:
            continue
    json.dump(m, open(cp, "w"))
    return m

def minutes_after(m, start_et):
    return [k for k in sorted(m.keys()) if k >= start_et]

def sim_trail(m, entry_et, entry_price):
    """Trail from entry_et using close-to-close. entry_price given (close or high)."""
    ks = minutes_after(m, entry_et)
    if not ks or entry_price <= 0:
        return None
    peak = entry_price; peak_et = entry_et; armed = False
    exit_et = ks[-1]; exit_mark = m[ks[-1]]["close"]; reason = "EOD"
    for k in ks:
        c = m[k]["close"]
        if c > peak:
            peak = c; peak_et = k
        if not armed and peak >= entry_price * (1 + ARM):
            armed = True
        if armed and c <= peak * (1 - GB):
            exit_et = k; exit_mark = c; reason = "TRAIL"; break
    gross = (exit_mark - entry_price) / entry_price
    net = (exit_mark * (1 - HAIRCUT)) / (entry_price * (1 + HAIRCUT)) - 1
    peakpnl = (peak - entry_price) / entry_price
    return {"entry": entry_price, "exit": exit_mark, "exit_et": exit_et, "reason": reason,
            "peak": peak, "peak_et": peak_et, "gross": gross, "net": net, "mfe": peakpnl, "armed": armed}

def price_at(m, entry_et, field):
    ks = minutes_after(m, entry_et)
    if not ks:
        return None
    k0 = entry_et if entry_et in m else ks[0]
    return m[k0][field]

def eval_event(ev):
    ticker = ev["ticker"]; date = ev["date"]; cls = ev["cls"]; et_ = ev["et"]; spot = ev["spot"]
    cp = "C" if cls == "BULLISH" else "P"
    strike = atm_strike(ticker, spot)
    occ = occ_of(ticker, date, strike, cp)
    m = fetch(occ, date)
    if not m:
        return None
    close0 = price_at(m, et_, "close")
    high0 = price_at(m, et_, "high")
    if close0 is None:
        return None
    r_close = sim_trail(m, et_, close0)
    r_ext = sim_trail(m, et_, high0) if high0 else None
    return {"occ": occ, "strike": strike, "cp": cp, "close": r_close, "ext": r_ext, "m": m}

def cohort_stats(results, key="net", field="close"):
    xs = [r[field][key] for r in results if r and r.get(field)]
    if not xs:
        return None
    return {"n": len(xs), "mean": statistics.mean(xs), "median": statistics.median(xs),
            "hit": sum(1 for x in xs if x > 0) / len(xs), "min": min(xs), "max": max(xs)}

def day_block_bootstrap(results_by_day, field="close", key="net", B=2000):
    """Resample DAYS with replacement; each draw = mean net P&L over resampled days' events."""
    days = list(results_by_day.keys())
    if len(days) < 2:
        return None
    means = []
    for _ in range(B):
        draw = [random.choice(days) for _ in days]
        pooled = []
        for d in draw:
            pooled += [r[field][key] for r in results_by_day[d] if r and r.get(field)]
        if pooled:
            means.append(statistics.mean(pooled))
    if not means:
        return None
    means.sort()
    return {"lo": means[int(0.05 * len(means))], "hi": means[int(0.95 * len(means))],
            "med": means[len(means) // 2], "p_pos": sum(1 for x in means if x > 0) / len(means)}

def main():
    ev = json.load(open(os.path.join(SP, "system_v0_events.json")))
    flips = ev["flips"]; v0b = ev["v0b"]
    dom = [e for e in flips if e["dom_ok"]]            # (a) unconditioned KingFlip-v0
    taken = [e for e in flips if e["bucket"] == "taken"]  # (b) System-v0
    rej = [e for e in flips if e["bucket"].startswith("rej")]  # (c) rejected

    print(f"days={ev['days']}")
    print(f"flips: total={len(flips)} dom_ok={len(dom)} taken={len(taken)} rejected={len(rej)} v0b={len(v0b)}")

    def run_cohort(name, evs, verbose=True):
        print(f"\n===== cohort {name} (n={len(evs)}) =====")
        results = []
        by_day = {}
        pairs = []
        for e in evs:
            r = eval_event(e)
            results.append(r)
            pairs.append((e, r))
            by_day.setdefault(e["date"], []).append(r)
            if verbose:
                if r and r["close"]:
                    c = r["close"]; x = r["ext"]
                    print(f"  {e['date']} {e['ticker']:4s} {e['et']} {e['cls']:7s} pos={e.get('pos','-')} "
                          f"K={r['strike']} {r['cp']} entry={c['entry']:.2f} exit={c['exit']:.2f}@{c['exit_et']} "
                          f"[{c['reason']}] gross={c['gross']*100:+.0f}% net={c['net']*100:+.0f}% mfe={c['mfe']*100:+.0f}% "
                          f"| ext_net={(x['net']*100 if x else float('nan')):+.0f}%")
                else:
                    print(f"  {e['date']} {e['ticker']:4s} {e['et']} {e['cls']:7s} — NO PRICE DATA")
        for field in ("close", "ext"):
            for key in ("gross", "net", "mfe"):
                s = cohort_stats(results, key=key, field=field)
                if s:
                    print(f"  [{field}/{key}] n={s['n']} mean={s['mean']*100:+.1f}% med={s['median']*100:+.1f}% "
                          f"hit={s['hit']*100:.0f}% [{s['min']*100:+.0f}%,{s['max']*100:+.0f}%]")
        bs = day_block_bootstrap(by_day, field="close", key="net")
        if bs:
            print(f"  [day-block bootstrap net] 90%CI mean=[{bs['lo']*100:+.1f}%,{bs['hi']*100:+.1f}%] "
                  f"med={bs['med']*100:+.1f}% P(mean>0)={bs['p_pos']*100:.0f}%")
        return results, by_day, pairs

    def split_stats(pairs, predicate, label):
        rs = [r for (e, r) in pairs if predicate(e) and r and r.get("close")]
        xs = [r["close"]["net"] for r in rs]
        if xs:
            print(f"    {label}: n={len(xs)} mean_net={statistics.mean(xs)*100:+.1f}% "
                  f"med={statistics.median(xs)*100:+.1f}% hit={sum(1 for x in xs if x>0)/len(xs)*100:.0f}%")
        else:
            print(f"    {label}: n=0")

    run_cohort("(a) KingFlip-v0 unconditioned [dom_ok]", dom)
    if taken:
        run_cohort("(b) System-v0 [flips at extremes]", taken)
    else:
        print("\n===== cohort (b) System-v0 [flips at extremes] (n=0) =====")
        print("  *** ZERO events — no confirmed flip occurred at an aligned range extreme. ***")
    run_cohort("(c) rejected [mid-range flips]", rej)

    # (d) volume-matched random control: same contracts as the flip cohort, random entry minutes
    print("\n===== cohort (d) random control (same flip contracts, random entry minute) =====")
    rand_nets = []
    K = 30
    for e in dom + rej:
        r = eval_event(e)
        if not r or not r["m"]:
            continue
        m = r["m"]
        ks = [k for k in sorted(m.keys()) if "09:35" <= k <= "15:30"]
        if len(ks) < 5:
            continue
        for _ in range(K):
            ek = random.choice(ks)
            sim = sim_trail(m, ek, m[ek]["close"])
            if sim:
                rand_nets.append(sim["net"])
    if rand_nets:
        rand_nets.sort()
        print(f"  n={len(rand_nets)} random entries  mean={statistics.mean(rand_nets)*100:+.1f}% "
              f"med={statistics.median(rand_nets)*100:+.1f}% hit={sum(1 for x in rand_nets if x>0)/len(rand_nets)*100:.0f}% "
              f"[p5={rand_nets[int(0.05*len(rand_nets))]*100:+.0f}%, p95={rand_nets[int(0.95*len(rand_nets))]*100:+.0f}%]")

    # System-v0b
    _, _, v0b_pairs = run_cohort("System-v0b [extreme + pika-King support]", v0b, verbose=True)
    print("  --- v0b splits ---")
    split_stats(v0b_pairs, lambda e: e["cls"] == "BULLISH", "BULLISH (buy call at low + pika floor)")
    split_stats(v0b_pairs, lambda e: e["cls"] == "BEARISH", "BEARISH (buy put at high + pika ceiling)")
    for t in ("SPXW", "SPY", "QQQ"):
        split_stats(v0b_pairs, lambda e, t=t: e["ticker"] == t, f"{t}")
    for d in ev["days"]:
        split_stats(v0b_pairs, lambda e, d=d: e["date"] == d, f"day {d}")

if __name__ == "__main__":
    main()
