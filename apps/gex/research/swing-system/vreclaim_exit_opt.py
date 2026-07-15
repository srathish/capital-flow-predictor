#!/usr/bin/env python3
"""V-RECLAIM EXIT OPTIMIZATION — RESEARCH ONLY (Clause 0). No live-code change.

FROZEN ENTRY (do not touch): V-reclaim LONG-only, R=0.25%, CONFIRM=2, counter-trend
suppression (OE.openable), budget<=6/day, LONG-only, flips OFF — exactly the
SWING_V2_VALIDATION primary. The entry set is FROZEN under the baseline stall(S=12)
exit (that is what determines when a position frees up for the next entry). Every exit
variant below is then applied to the *identical* frozen entry list (apples-to-apples).

Reuses ../velocity-capture/pipeline/operator_eye.py for signals + real UW option prints
(ATM@entry, 3% round-trip haircut, all-leg convention — targets book at net_pnl(target)).

Pre-registered EXIT grid (enumerated before outcomes):
  1  baseline      stall S12 + EOD                                    (control)
  2a ladder-stall  1/3@+50 1/3@+100 trail 1/3 gb30, hard=stall12/EOD
  2b ladder-EOD    1/3@+50 1/3@+100 trail 1/3 gb30, hard=EOD          (runner to close)
  3  struct+trail  struct-stop(pivot-0.05%,1m) OR trail(arm50/gb30) OR stall/EOD
  3b struct+stall  struct-stop OR stall/EOD                            (stop isolated)
  4a ladder+struct ladder, hard=min(struct-stop, stall12/EOD)
  4b ladder+strEOD ladder, hard=min(struct-stop, EOD)
  5  trail grid    arm+50 gb{20,30,40}, hard=stall12/EOD
  5e trail-EOD     arm+50 gb{20,30,40}, hard=EOD
  6  stall grid    S{8,12,16,20} + EOD
  7  TP grid       fixed +40/+60/+100 full-exit else stall12/EOD
  7e let-run EOD   pure EOD, no stall/no cap
Rank by expectancy s.t. day-block bootstrap P(mean>0) >= 0.90; winner must beat baseline
in BOTH walk-forward halves; then random-entry+winner-exit control.
"""
import sys, os, json, statistics, random, bisect
from collections import Counter

PIPE = "/Users/saiyeeshrathish/the final plan/apps/gex/research/velocity-capture/pipeline"
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, PIPE)
import operator_eye as OE  # noqa

random.seed(20260715)
R = 0.0025
S_BASE = 12
TICKERS = OE.TICKERS
ORIG16 = set("2026-06-22 2026-06-23 2026-06-24 2026-06-25 2026-06-26 2026-06-29 2026-06-30 "
             "2026-07-01 2026-07-02 2026-07-06 2026-07-07 2026-07-08 2026-07-09 2026-07-10 "
             "2026-07-13 2026-07-14".split())


# ---------------- causal leg-extreme (pivot) tracker: faithful copy of OE ZigZag ----------------
def leg_extreme(spots, Rr):
    """Per-bar current-leg extreme price (== OE.compute_signals ext_p). At a vreclaim-long
    signal (dir=-1) this is the reclaimed swing LOW = the entry pivot (swing-ghost runLow)."""
    n = len(spots); ext = [spots[0]] * n
    dir_ = 0; ext_p = spots[0]; run_max_p = spots[0]; run_min_p = spots[0]
    for i in range(n):
        c = spots[i]
        if dir_ == 0:
            if c > run_max_p: run_max_p = c
            if c < run_min_p: run_min_p = c
            if c >= run_min_p * (1 + Rr): dir_ = 1; ext_p = c
            elif c <= run_max_p * (1 - Rr): dir_ = -1; ext_p = c
        elif dir_ == 1:
            if c > ext_p: ext_p = c
            elif c <= ext_p * (1 - Rr): dir_ = -1; ext_p = c
        else:
            if c < ext_p: ext_p = c
            elif c >= ext_p * (1 + Rr): dir_ = 1; ext_p = c
        ext[i] = ext_p
    return ext


# ---------------- frozen entry extraction (baseline stall S12 gates the set) ----------------
class Entry:
    __slots__ = ("day", "tk", "ei", "eet", "eutc", "espot", "K", "occ", "entry_opt",
                 "pivot", "m", "spots", "ets", "utcs", "et2i")


def build_frozen(days):
    entries = []
    daytk = {}   # (day,tk) -> (ets, spots, utcs, et2i)
    for date in days:
        for tk in TICKERS:
            ss = OE.load_spot_series(date, tk)
            if not ss:
                continue
            ets, spots, utcs = ss
            et2i = {}
            for i, e in enumerate(ets):
                et2i[e] = i           # last index wins (minutes unique in practice)
            daytk[(date, tk)] = (ets, spots, utcs, et2i, sorted(set(ets)))
            sig = OE.compute_signals(spots, spots[0], R)
            ext = leg_extreme(spots, R)
            n = len(spots); pos = None; budget = 0
            for i in range(n):
                if pos is not None:
                    if spots[i] > pos["best"]:
                        pos["best"] = spots[i]; pos["best_i"] = i
                    if (i - pos["best_i"]) >= S_BASE and i > pos["ei"]:
                        pos = None
                s = sig[i]
                if s is None:
                    continue
                if pos is None and s["side"] == "LONG" and s["rule"] == "vreclaim" \
                        and OE.openable(s) and budget < 6:
                    K = OE.atm_strike(tk, spots[i]); occ = OE.occ_of(tk, date, K, "C")
                    m = OE.fetch(occ, date)
                    eo = OE.price_at(m, ets[i], "close")
                    e = Entry()
                    e.day = date; e.tk = tk; e.ei = i; e.eet = ets[i]; e.eutc = utcs[i]
                    e.espot = spots[i]; e.K = K; e.occ = occ; e.entry_opt = eo
                    e.pivot = ext[i]; e.m = m; e.spots = spots; e.ets = ets; e.utcs = utcs
                    e.et2i = et2i
                    entries.append(e)
                    pos = {"ei": i, "best": spots[i], "best_i": i}; budget += 1
    return entries, daytk


# ---------------- exit primitives ----------------
def stall_xi(spots, ei, S):
    n = len(spots); best = spots[ei]; best_i = ei
    for j in range(ei + 1, n):
        if spots[j] > best: best = spots[j]; best_i = j
        if (j - best_i) >= S: return j
    return n - 1


def struct_stop_xi(spots, ei, pivot, STOP_PCT=0.0005, STOP_MIN=1):
    thr = pivot * (1 - STOP_PCT); run = 0; n = len(spots)
    for j in range(ei + 1, n):
        if spots[j] < thr: run += 1
        else: run = 0
        if run >= STOP_MIN: return j
    return None


def et_to_xi(e, k, cap_xi):
    """map option-minute k (HH:MM) to a spot index, clamped to <= cap_xi."""
    i = e.et2i.get(k)
    if i is None:
        # nearest spot index with et <= k
        pos = bisect.bisect_right(e.ets, k) - 1
        i = pos if pos >= 0 else e.ei
    return min(i, cap_xi)


def net_close(e, xi):
    xo = OE.price_at(e.m, e.ets[xi], "close")
    return OE.net_pnl(e.entry_opt, xo)


def mfe_mae(e, xi):
    keys = [k for k in e.m.keys() if e.eet <= k <= e.ets[xi]]
    if not keys:
        return 0.0, 0.0
    hi = max(e.m[k]["high"] for k in keys); lo = min(e.m[k]["low"] for k in keys)
    eo = e.entry_opt
    if not eo or eo <= 0:
        return 0.0, 0.0
    return (hi - eo) / eo, (lo - eo) / eo


def ladder_net(e, hard_xi, targets=(0.5, 1.0), arm=0.5, gb=0.30):
    """1/3 @ +t1, 1/3 @ +t2, trail final 1/3 (arm/gb). Unsold settle at hard exit.
    All legs booked via net_pnl (all-leg 3% haircut). Returns (net, xi_report)."""
    eo = e.entry_opt
    if not eo or eo <= 0:
        return None, hard_xi
    hard_et = e.ets[hard_xi]
    keys = [k for k in sorted(e.m.keys()) if e.eet <= k <= hard_et]
    if not keys:
        return None, hard_xi
    t1 = eo * (1 + targets[0]); t2 = eo * (1 + targets[1])
    got1 = got2 = False; r1 = r2 = None
    peak = eo; armed = False; trail_ret = None; trail_k = None
    for k in keys:
        c = e.m[k]["close"]; hi = e.m[k]["high"]
        if not got1 and hi >= t1:
            r1 = OE.net_pnl(eo, t1); got1 = True
        if not got2 and hi >= t2:
            r2 = OE.net_pnl(eo, t2); got2 = True
        if c > peak: peak = c
        if not armed and peak >= eo * (1 + arm): armed = True
        if armed and trail_ret is None and c <= peak * (1 - gb):
            trail_ret = OE.net_pnl(eo, c); trail_k = k
    last_c = e.m[keys[-1]]["close"]
    if r1 is None: r1 = OE.net_pnl(eo, last_c)
    if r2 is None: r2 = OE.net_pnl(eo, last_c)
    if trail_ret is None: trail_ret = OE.net_pnl(eo, last_c); trail_k = keys[-1]
    vals = [x for x in (r1, r2, trail_ret) if x is not None]
    if not vals:
        return None, hard_xi
    xi_report = et_to_xi(e, trail_k, hard_xi)
    return statistics.mean(vals), xi_report


def trail_net(e, hard_xi, arm=0.5, gb=0.30):
    """full-position trail on option close; else settle at hard exit close."""
    eo = e.entry_opt
    if not eo or eo <= 0:
        return None, hard_xi, "hard"
    hard_et = e.ets[hard_xi]
    keys = [k for k in sorted(e.m.keys()) if e.eet <= k <= hard_et]
    peak = eo; armed = False
    for k in keys:
        c = e.m[k]["close"]
        if c > peak: peak = c
        if not armed and peak >= eo * (1 + arm): armed = True
        if armed and c <= peak * (1 - gb):
            xi = et_to_xi(e, k, hard_xi)
            return OE.net_pnl(eo, c), xi, "trail"
    return net_close(e, hard_xi), hard_xi, "hard"


def tp_net(e, hard_xi, tp):
    """full-exit fixed take-profit at option high>=entry*(1+tp); else settle at hard exit."""
    eo = e.entry_opt
    if not eo or eo <= 0:
        return None, hard_xi, "hard"
    hard_et = e.ets[hard_xi]
    keys = [k for k in sorted(e.m.keys()) if e.eet <= k <= hard_et]
    tgt = eo * (1 + tp)
    for k in keys:
        if e.m[k]["high"] >= tgt:
            xi = et_to_xi(e, k, hard_xi)
            return OE.net_pnl(eo, tgt), xi, "tp"
    return net_close(e, hard_xi), hard_xi, "hard"


# ---------------- the exit variants (each: entry -> dict with net, xi, reason) ----------------
def score_variant(e, name):
    n = len(e.spots)
    stall12 = stall_xi(e.spots, e.ei, 12)
    if name == "baseline":
        xi = stall12; return dict(net=net_close(e, xi), xi=xi, reason="stall/eod")
    if name == "ladder-stall":
        net, xi = ladder_net(e, stall12); return dict(net=net, xi=xi, reason="ladder")
    if name == "ladder-EOD":
        net, xi = ladder_net(e, n - 1); return dict(net=net, xi=xi, reason="ladder")
    if name == "struct+trail":
        ss = struct_stop_xi(e.spots, e.ei, e.pivot)
        hard = stall12 if ss is None else min(ss, stall12)
        # trail may fire before hard; struct-stop caps the hard exit
        net, xi, why = trail_net(e, hard, arm=0.5, gb=0.30)
        return dict(net=net, xi=xi, reason=why if why == "trail" else ("struct" if ss is not None and hard == ss else "stall/eod"))
    if name == "struct+stall":
        ss = struct_stop_xi(e.spots, e.ei, e.pivot)
        xi = stall12 if ss is None else min(ss, stall12)
        return dict(net=net_close(e, xi), xi=xi, reason=("struct" if ss is not None and xi == ss else "stall/eod"))
    if name == "ladder+struct":
        ss = struct_stop_xi(e.spots, e.ei, e.pivot)
        hard = stall12 if ss is None else min(ss, stall12)
        net, xi = ladder_net(e, hard); return dict(net=net, xi=xi, reason="ladder+struct")
    if name == "ladder+strEOD":
        ss = struct_stop_xi(e.spots, e.ei, e.pivot)
        hard = (n - 1) if ss is None else min(ss, n - 1)
        net, xi = ladder_net(e, hard); return dict(net=net, xi=xi, reason="ladder+struct")
    if name.startswith("trail-gb"):
        gb = int(name.split("gb")[1].split("-")[0]) / 100.0
        hard = (n - 1) if name.endswith("-EOD") else stall12
        net, xi, why = trail_net(e, hard, arm=0.5, gb=gb)
        return dict(net=net, xi=xi, reason=why)
    if name.startswith("stall-S"):
        S = int(name.split("S")[1]); xi = stall_xi(e.spots, e.ei, S)
        return dict(net=net_close(e, xi), xi=xi, reason="stall/eod")
    if name.startswith("TP+"):
        tp = int(name.split("+")[1]) / 100.0
        net, xi, why = tp_net(e, stall12, tp)
        return dict(net=net, xi=xi, reason=why)
    if name == "let-run-EOD":
        xi = n - 1; return dict(net=net_close(e, xi), xi=xi, reason="eod")
    raise ValueError(name)


VARIANTS = ["baseline",
            "ladder-stall", "ladder-EOD",
            "struct+trail", "struct+stall",
            "ladder+struct", "ladder+strEOD",
            "trail-gb20", "trail-gb30", "trail-gb40",
            "trail-gb20-EOD", "trail-gb30-EOD", "trail-gb40-EOD",
            "stall-S8", "stall-S12", "stall-S16", "stall-S20",
            "TP+40", "TP+60", "TP+100",
            # exploratory take-profit curve (NOT pre-registered; characterization only)
            "TP+80", "TP+120", "TP+150", "TP+200",
            "let-run-EOD"]
PREREG = set(VARIANTS) - {"TP+80", "TP+120", "TP+150", "TP+200"}   # exploratory excluded from selection


# ---------------- stats ----------------
def summ(nets):
    xs = [x for x in nets if x is not None]
    if not xs:
        return None
    wins = [x for x in xs if x > 0]; losses = [x for x in xs if x <= 0]
    return {"n": len(xs), "mean": statistics.mean(xs), "median": statistics.median(xs),
            "hit": len(wins) / len(xs), "total": sum(xs),
            "avgwin": statistics.mean(wins) if wins else 0.0,
            "avgloss": statistics.mean(losses) if losses else 0.0,
            "min": min(xs), "max": max(xs)}


def day_boot(rows, B=3000):
    """rows: list of (day, net). day-block bootstrap P(mean>0), 90% CI."""
    by = {}
    for d, x in rows:
        if x is not None:
            by.setdefault(d, []).append(x)
    days = list(by.keys())
    if len(days) < 2:
        return None
    means = []
    for _ in range(B):
        draw = [random.choice(days) for _ in days]
        pooled = []
        for d in draw:
            pooled += by[d]
        if pooled:
            means.append(statistics.mean(pooled))
    means.sort()
    return {"lo": means[int(0.05 * len(means))], "hi": means[int(0.95 * len(means))],
            "p_pos": sum(1 for x in means if x > 0) / len(means)}


def main():
    days = OE.complete_days()
    oos = [d for d in days if d not in ORIG16]
    ins = [d for d in days if d in ORIG16]
    half = len(days) // 2
    H1days, H2days = set(days[:half]), set(days[half:])
    print(f"[days] complete={len(days)}  ins(orig16)={len(ins)}  OOS(earlier)={len(oos)}")
    print(f"[days] WF split: H1={days[0]}..{days[half-1]} ({half}d)  H2={days[half]}..{days[-1]} ({len(days)-half}d)")

    entries, daytk = build_frozen(days)
    print(f"[frozen] {len(entries)} vreclaim-long entries")
    # faithfulness guardrail: restrict to the 18 validation days -> must be n=92
    vdays = ORIG16 | {"2026-06-17", "2026-06-18"}
    nv = sum(1 for e in entries if e.day in vdays)
    print(f"[guardrail] entries on the 18 validation days = {nv}  (expect 92)")

    # score every variant on the identical frozen entries
    scored = {v: [] for v in VARIANTS}   # v -> list of (entry, res)
    for e in entries:
        for v in VARIANTS:
            scored[v].append((e, score_variant(e, v)))

    # baseline per-entry nets (same entry order across all variants) for PAIRED deltas
    base_nets = [r["net"] for _, r in scored["baseline"]]
    base_days = [e.day for e, _ in scored["baseline"]]

    def paired_boot(delta_rows, B=3000):
        by = {}
        for d, x in delta_rows:
            if x is not None:
                by.setdefault(d, []).append(x)
        dys = list(by.keys())
        if len(dys) < 2:
            return None
        means = []
        for _ in range(B):
            draw = [random.choice(dys) for _ in dys]
            pooled = []
            for d in draw:
                pooled += by[d]
            if pooled:
                means.append(statistics.mean(pooled))
        means.sort()
        return {"p_pos": sum(1 for x in means if x > 0) / len(means),
                "lo": means[int(0.05 * len(means))], "hi": means[int(0.95 * len(means))]}

    def loo_worst_delta(recs):
        """leave-one-day-out worst mean per-trade delta vs baseline."""
        deltas = []
        for (e, r), bn in zip(recs, base_nets):
            if r["net"] is not None and bn is not None:
                deltas.append((e.day, r["net"] - bn))
        by = {}
        for d, x in deltas:
            by.setdefault(d, []).append(x)
        dys = list(by.keys())
        worst = None
        for drop in dys:
            pooled = [x for d in dys if d != drop for x in by[d]]
            if pooled:
                mm = statistics.mean(pooled)
                worst = mm if worst is None else min(worst, mm)
        return worst

    # build table rows
    rows = []
    for v in VARIANTS:
        recs = scored[v]
        nets = [r["net"] for _, r in recs]
        s = summ(nets)
        if s is None:
            continue
        dr = [(e.day, r["net"]) for e, r in recs]
        b = day_boot(dr)
        h1 = summ([r["net"] for e, r in recs if e.day in H1days])
        h2 = summ([r["net"] for e, r in recs if e.day in H2days])
        so = summ([r["net"] for e, r in recs if e.day in set(oos)])
        si = summ([r["net"] for e, r in recs if e.day in set(ins)])
        # MFE/MAE avg
        mfes = []; maes = []
        for e, r in recs:
            f, a = mfe_mae(e, r["xi"])
            mfes.append(f); maes.append(a)
        # paired delta vs baseline (same entries)
        drows = [(e.day, r["net"] - bn) for (e, r), bn in zip(recs, base_nets)
                 if r["net"] is not None and bn is not None]
        dmean = statistics.mean([x for _, x in drows]) if drows else 0.0
        pb = paired_boot(drows) if v != "baseline" else None
        loo = loo_worst_delta(recs) if v != "baseline" else None
        rows.append({"v": v, "s": s, "boot": b, "h1": h1, "h2": h2, "oos": so, "ins": si,
                     "mfe": statistics.mean(mfes), "mae": statistics.mean(maes),
                     "reasons": dict(Counter(r["reason"] for _, r in recs)),
                     "dmean": dmean, "pb": pb, "loo": loo,
                     "prereg": v in PREREG})
    # rank by expectancy with P(mean>0)>=0.9 constraint
    def ppos(r): return r["boot"]["p_pos"] if r["boot"] else 0.0
    eligible = [r for r in rows if ppos(r) >= 0.90 and r["s"]["mean"] > 0]
    eligible.sort(key=lambda r: r["s"]["mean"], reverse=True)
    allsorted = sorted(rows, key=lambda r: r["s"]["mean"], reverse=True)

    baseline = next(r for r in rows if r["v"] == "baseline")
    bmean = baseline["s"]["mean"]; bh1 = baseline["h1"]["mean"]; bh2 = baseline["h2"]["mean"]

    print("\n" + "=" * 132)
    print("EXIT GRID  (all on the SAME 162 frozen V-reclaim-long entries; 3% all-leg haircut, real UW 1-min prints)")
    print("=" * 132)
    hdr = (f"{'variant':16} {'n':>4} {'exp/tr':>7} {'hit':>4} {'avgW':>6} {'avgL':>7} {'total':>7} "
           f"{'MFE':>6} {'MAE':>7} {'P>0':>5} {'H1':>7} {'H2':>7} {'OOS':>7} {'INS':>7}")
    print(hdr); print("-" * len(hdr))
    for r in allsorted:
        s = r["s"]; b = r["boot"]
        elig = "*" if (ppos(r) >= 0.90 and s["mean"] > 0) else " "
        beats = "^" if (r["h1"] and r["h2"] and r["h1"]["mean"] > bh1 and r["h2"]["mean"] > bh2 and r["v"] != "baseline") else " "
        print(f"{elig}{beats}{r['v']:14} {s['n']:>4} {s['mean']*100:>+6.1f}% {s['hit']*100:>3.0f}% "
              f"{s['avgwin']*100:>+5.0f}% {s['avgloss']*100:>+6.0f}% {s['total']*100:>+6.0f}% "
              f"{r['mfe']*100:>+5.0f}% {r['mae']*100:>+6.0f}% {ppos(r)*100:>4.0f}% "
              f"{r['h1']['mean']*100:>+6.1f}% {r['h2']['mean']*100:>+6.1f}% "
              f"{r['oos']['mean']*100:>+6.1f}% {r['ins']['mean']*100:>+6.1f}%")
    print("  * = P(mean>0)>=0.90 & positive expectancy (eligible)   ^ = beats baseline in BOTH WF halves")
    print(f"\n[baseline] exp/tr {bmean*100:+.1f}%  H1 {bh1*100:+.1f}%  H2 {bh2*100:+.1f}%  "
          f"OOS {baseline['oos']['mean']*100:+.1f}%  P>0 {ppos(baseline)*100:.0f}%")

    # ---- entry-level MFE reach frequency (option path, entry->EOD) ----
    reach = {50: 0, 100: 0, 150: 0, 200: 0}; nrf = 0
    for e in entries:
        if not e.entry_opt or e.entry_opt <= 0:
            continue
        keys = [k for k in e.m.keys() if k >= e.eet]
        if not keys:
            continue
        mx = max(e.m[k]["high"] for k in keys)
        mf = (mx - e.entry_opt) / e.entry_opt; nrf += 1
        for thr in reach:
            if mf >= thr / 100.0:
                reach[thr] += 1
    print(f"[MFE reach, entry->EOD, n={nrf}]  >=+50%: {reach[50]/nrf*100:.0f}%   "
          f">=+100%: {reach[100]/nrf*100:.0f}%   >=+150%: {reach[150]/nrf*100:.0f}%   "
          f">=+200%: {reach[200]/nrf*100:.0f}%")

    # ---- PAIRED delta table (variant - baseline, same entries) ----
    print("\n" + "=" * 100)
    print("PAIRED improvement vs baseline (same frozen entries): does the EXIT itself add value?")
    print("=" * 100)
    ph = f"{'variant':16} {'Δexp/tr':>8} {'P(Δ>0)':>7} {'Δ90%CI':>16} {'LOO-worst-Δ':>12} {'prereg':>6}"
    print(ph); print("-" * len(ph))
    for r in sorted([r for r in rows if r["v"] != "baseline"], key=lambda r: r["dmean"], reverse=True):
        pb = r["pb"]
        ci = f"[{pb['lo']*100:+.1f},{pb['hi']*100:+.1f}]" if pb else "-"
        pp = f"{pb['p_pos']*100:.0f}%" if pb else "-"
        loo = f"{r['loo']*100:+.1f}%" if r["loo"] is not None else "-"
        print(f"{r['v']:16} {r['dmean']*100:>+7.1f}% {pp:>7} {ci:>16} {loo:>12} {str(r['prereg']):>6}")

    # ---- winner selection (PRE-REGISTERED variants only) ----
    prereg_rows = [r for r in rows if r["prereg"] and r["v"] != "baseline"]
    # primary gate: absolute P(mean>0)>=0.9 AND positive expectancy AND beats baseline both halves
    def beats_both(r):
        return r["h1"] and r["h2"] and r["h1"]["mean"] > bh1 and r["h2"]["mean"] > bh2
    strict = [r for r in prereg_rows if ppos(r) >= 0.90 and r["s"]["mean"] > 0 and beats_both(r)]
    strict.sort(key=lambda r: r["s"]["mean"], reverse=True)
    # paired-robust gate: paired P(delta>0)>=0.9 AND beats baseline both halves AND positive expectancy
    paired = [r for r in prereg_rows if r["pb"] and r["pb"]["p_pos"] >= 0.90 and beats_both(r) and r["s"]["mean"] > 0]
    paired.sort(key=lambda r: r["s"]["mean"], reverse=True)
    winner = strict[0] if strict else (paired[0] if paired else None)
    winner_gate = "STRICT(abs P>0>=0.9)" if strict else ("PAIRED(P(Δ>0)>=0.9)" if paired else "NONE")
    print(f"\n[winner gate] strict-eligible={[r['v'] for r in strict]}  "
          f"paired-eligible={[r['v'] for r in paired]}  -> gate={winner_gate}")
    # best-expectancy prereg exit regardless of gate (for the honest 'best exit' headline)
    best_exit = max(prereg_rows, key=lambda r: r["s"]["mean"])
    print("\n" + "=" * 132)
    # config to ghost: gated winner if any, else the best-expectancy prereg exit that beats baseline both halves
    chosen = winner if winner else (best_exit if beats_both(best_exit) else None)

    def report(r, label):
        s = r["s"]
        print(f"{label}: {r['v']}   exp/tr {s['mean']*100:+.1f}%  (baseline {bmean*100:+.1f}%  -> "
              f"{(s['mean']-bmean)*100:+.1f} pts)")
        print(f"  hit {s['hit']*100:.0f}%  avgWin {s['avgwin']*100:+.0f}%  avgLoss {s['avgloss']*100:+.0f}%  "
              f"total {s['total']*100:+.0f}%  n={s['n']}")
        print(f"  ABS P(mean>0)={ppos(r)*100:.1f}%  90%CI=[{r['boot']['lo']*100:+.1f},{r['boot']['hi']*100:+.1f}]  "
              f"|  PAIRED Δ{r['dmean']*100:+.1f}pts P(Δ>0)={r['pb']['p_pos']*100:.0f}% LOO-worst-Δ {r['loo']*100:+.1f}pts")
        print(f"  WF  H1 {r['h1']['mean']*100:+.1f}% (base {bh1*100:+.1f})  "
              f"H2 {r['h2']['mean']*100:+.1f}% (base {bh2*100:+.1f})  "
              f"-> beats baseline both halves: {beats_both(r)}")
        print(f"  OOS(earlier 18d) {r['oos']['mean']*100:+.1f}% n={r['oos']['n']}  "
              f"(base {baseline['oos']['mean']*100:+.1f}%)   INS(orig16) {r['ins']['mean']*100:+.1f}% "
              f"(base {baseline['ins']['mean']*100:+.1f}%)")

    if winner:
        print(f"[gate cleared: {winner_gate}]")
        report(winner, "WINNER")
    else:
        print("[NO prereg variant clears the absolute P(mean>0)>=0.90 gate; reporting best-expectancy exit]")
    if chosen and chosen is not winner:
        report(best_exit, "BEST-EXIT (does NOT clear abs 0.90 gate)")

    if chosen:
        print("\n--- CONTROL: volume-matched random-entry + chosen-exit ---")
        rnet = random_matched(days, daytk, entries, chosen["v"], reps=12)
        if rnet:
            rs = summ(rnet)
            print(f"  random n={rs['n']}  exp/tr {rs['mean']*100:+.1f}%  hit {rs['hit']*100:.0f}%  "
                  f"(system {chosen['s']['mean']*100:+.1f}%  -> edge {(chosen['s']['mean']-rs['mean'])*100:+.1f} pts)")
            rn1 = random_matched(days[:half], daytk, [e for e in entries if e.day in H1days], chosen["v"], reps=12)
            rn2 = random_matched(days[half:], daytk, [e for e in entries if e.day in H2days], chosen["v"], reps=12)
            rm1 = statistics.mean(rn1) if rn1 else None; rm2 = statistics.mean(rn2) if rn2 else None
            print(f"  random H1 {rm1*100:+.1f}%  H2 {rm2*100:+.1f}%  (system H1 {chosen['h1']['mean']*100:+.1f} / H2 {chosen['h2']['mean']*100:+.1f})")
        emit_events(scored[chosen["v"]], chosen["v"])
    else:
        print("WINNER/CHOSEN: NONE — no prereg exit beats baseline in both halves; keep the frozen baseline.")
    winner = chosen  # for the dump

    # dump results json
    dump = {"days": days, "oos": oos, "ins": ins, "n_entries": len(entries),
            "baseline_mean": bmean, "winner": winner["v"] if winner else None,
            "grid": []}
    for r in allsorted:
        dump["grid"].append({
            "variant": r["v"], "n": r["s"]["n"], "exp": r["s"]["mean"], "hit": r["s"]["hit"],
            "avgwin": r["s"]["avgwin"], "avgloss": r["s"]["avgloss"], "total": r["s"]["total"],
            "mfe": r["mfe"], "mae": r["mae"], "p_pos": ppos(r),
            "h1": r["h1"]["mean"] if r["h1"] else None, "h2": r["h2"]["mean"] if r["h2"] else None,
            "oos": r["oos"]["mean"] if r["oos"] else None, "ins": r["ins"]["mean"] if r["ins"] else None,
            "reasons": r["reasons"]})
    json.dump(dump, open(os.path.join(HERE, "vreclaim_exit_opt_results.json"), "w"), indent=1)
    print(f"\n[dump] {os.path.join(HERE, 'vreclaim_exit_opt_results.json')}")


def random_matched(days, daytk, entries, variant, reps=12):
    """per (day,tk) draw the same #entries at random minutes in [09:35,15:30], same ATM-call
    logic, apply the winner's exit. Uses fresh Entry objects."""
    nets = []
    cnt = Counter((e.day, e.tk) for e in entries)
    for (date, tk), c in cnt.items():
        if (date, tk) not in daytk:
            continue
        ets, spots, utcs, et2i, _ = daytk[(date, tk)]
        valid = [i for i, e in enumerate(ets) if "09:35" <= e <= "15:30"]
        if not valid:
            continue
        for _ in range(reps):
            for _ in range(c):
                i = random.choice(valid)
                K = OE.atm_strike(tk, spots[i]); occ = OE.occ_of(tk, date, K, "C")
                m = OE.fetch(occ, date)
                eo = OE.price_at(m, ets[i], "close")
                if not eo or eo <= 0:
                    continue
                e = Entry()
                e.day = date; e.tk = tk; e.ei = i; e.eet = ets[i]; e.eutc = utcs[i]
                e.espot = spots[i]; e.K = K; e.occ = occ; e.entry_opt = eo
                # pivot for struct: use a causal recent swing low proxy = min spot in prior 20 bars
                e.pivot = min(spots[max(0, i - 20):i + 1])
                e.m = m; e.spots = spots; e.ets = ets; e.utcs = utcs; e.et2i = et2i
                res = score_variant(e, variant)
                if res["net"] is not None:
                    nets.append(res["net"])
    return nets


def emit_events(recs, variant):
    out = os.path.join(HERE, "vreclaim_best_events.jsonl")
    n = 0
    with open(out, "w") as f:
        for e, r in recs:
            if r["net"] is None:
                continue
            xi = r["xi"]
            f.write(json.dumps({
                "day": e.day, "ticker": e.tk, "minute": e.eutc[11:16],   # UTC HH:MM (viewer subtracts 13:30 UTC)
                "strike": e.K, "spot_at_entry": round(e.espot, 2),
                "kind": "vr", "implied": "up", "occ": e.occ, "side": "LONG",
                "exit_minute": e.utcs[xi][11:16],                        # UTC HH:MM
                "outcome": "win" if r["net"] > 0 else "loss",
                "pnl_pct": round(r["net"] * 100, 1),
                "exit_reason": r["reason"]
            }) + "\n"); n += 1
    print(f"[emit] {n} events ({variant}) -> {out}")


if __name__ == "__main__":
    main()
