#!/usr/bin/env python3
"""SWING v2 VALIDATION — RESEARCH ONLY (Clause 0). No live-code change.

TEST 1  V-reclaim LONG-only OOS confirmation (the frozen surviving slice).
TEST 2  v2 node-aware sweep (flip node-gate + pin-hold) on the full operator ruleset.
ADDENDUM  swing-scale (R=0.35%), stall-patience (S=20), day-direction context gate.

Reuses the frozen machinery in ../velocity-capture/pipeline/operator_eye.py:
  compute_signals (causal ZigZag V-reclaim / higher-low / lower-high, R, CONFIRM=2),
  openable (counter-trend suppression), fetch/price_at/net_pnl (real UW 1-min option
  prints, ATM@entry, 3% round-trip haircut), summarize, day_block_bootstrap.
Adds a configurable simulator with: side/rule restriction, flip policy
  {v1-unrestricted, vetoed-in-zone, off}, pin-hold stall extension (PIN_ZONE x
  PIN_STALL_X), and the day-direction context gate. Dominant pika per minute =
  gamma>0 strike with |gamma|/sum|gamma| >= 0.15 (matches swing-ghost.mjs loadDay).
"""
import sys, os, json, glob, gzip, statistics, random
from collections import Counter

PIPE = "/Users/saiyeeshrathish/the final plan/apps/gex/research/velocity-capture/pipeline"
BF   = "/Users/saiyeeshrathish/the final plan/apps/gex/research/velocity-capture/backfill"
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, PIPE)
import operator_eye as OE  # noqa

random.seed(20260714)
TICKERS = ["SPXW", "SPY", "QQQ"]
ORIG16 = set("2026-06-22 2026-06-23 2026-06-24 2026-06-25 2026-06-26 2026-06-29 2026-06-30 "
             "2026-07-01 2026-07-02 2026-07-06 2026-07-07 2026-07-08 2026-07-09 2026-07-10 "
             "2026-07-13 2026-07-14".split())
RELSIG = 0.15  # dominant-pika threshold


# ---------------- loaders ----------------
def load_full(date, ticker):
    """ets, spots, utcs, pikas (per-minute list of dominant-pika strikes). Same frame
    order/filtering as OE.load_spot_series so counts align with random_control."""
    gz = os.path.join(BF, date, f"{ticker}.jsonl.gz")
    raw = os.path.join(BF, date, f"{ticker}.jsonl")
    frames = []
    src = gz if os.path.exists(gz) else (raw if os.path.exists(raw) else None)
    if src is None:
        return None
    op = gzip.open if src.endswith("gz") else open
    with op(src, "rt") as f:
        for line in f:
            line = line.strip()
            if line:
                frames.append(json.loads(line))
    frames.sort(key=lambda d: d["requestedTs"])
    ets = [OE.et(fr["requestedTs"]) for fr in frames]
    spots = [float(fr["spot"]) for fr in frames]
    utcs = [fr["requestedTs"] for fr in frames]
    pikas = []
    for fr in frames:
        st = fr.get("strikes", [])
        tot = sum(abs(x.get("gamma") or 0) for x in st) or 1.0
        pk = [float(x["strike"]) for x in st
              if (x.get("gamma") or 0) > 0 and abs(x.get("gamma") or 0) / tot >= RELSIG]
        pikas.append(pk)
    return ets, spots, utcs, pikas


def complete_days():
    days = []
    for d in sorted(glob.glob(os.path.join(BF, "20*"))):
        date = os.path.basename(d)
        ok = True
        for t in TICKERS:
            s = load_full(date, t)
            if not s or len(s[1]) < 385:
                ok = False; break
        if ok:
            days.append(date)
    return days


# ---------------- configurable simulator ----------------
def near_pika(spot, pikas_i, pin_zone):
    return any(abs(k - spot) / spot <= pin_zone for k in pikas_i)


def simulate(cfg, ets, spots, utcs, pikas, ticker, date):
    """cfg keys:
       R, S, sides(tuple), rules(tuple of allowed entry rules), flip('v1'|'vetoed'|'off'),
       node_aware(bool -> pin-hold stall extension), pin_zone, pin_stall_x, gate(bool).
    Returns (trades, diag) with diag counting gate binds."""
    R = cfg["R"]; S = cfg["S"]; sides = cfg["sides"]; rules = cfg["rules"]
    flip = cfg["flip"]; node = cfg["node_aware"]; pz = cfg.get("pin_zone", 0.0030)
    px = cfg.get("pin_stall_x", 2); gate = cfg.get("gate", False)
    sig = OE.compute_signals(spots, spots[0], R)
    n = len(spots); open_px = spots[0]
    # causal running mean (VWAP proxy)
    run_sum = 0.0; run_mean = [0.0] * n
    for i in range(n):
        run_sum += spots[i]; run_mean[i] = run_sum / (i + 1)
    trades = []; budget = {"LONG": 0, "SHORT": 0}; pos = None
    diag = {"flip_veto_binds": 0, "flips_taken": 0, "pinhold_binds": 0,
            "pinhold_trades": 0, "gate_blocked_entries": 0, "gate_blocked_flips": 0}

    def passes_gate(side, i):
        if not gate:
            return True
        if side == "LONG":
            return spots[i] > max(open_px, run_mean[i])
        return spots[i] < min(open_px, run_mean[i])

    def open_pos(i, side, rule):
        espot = spots[i]; cp = "C" if side == "LONG" else "P"
        K = OE.atm_strike(ticker, espot); occ = OE.occ_of(ticker, date, K, cp)
        m = OE.fetch(occ, date); entry_opt = OE.price_at(m, ets[i], "close")
        return {"side": side, "ei": i, "eet": ets[i], "espot": espot, "best": espot,
                "best_i": i, "rule": rule, "occ": occ, "K": K, "cp": cp, "m": m,
                "entry_opt": entry_opt, "pin_extended": False}

    def close_pos(p, xi, reason):
        m = p["m"]; eo = p["entry_opt"]
        if eo is None or eo <= 0:
            net = None; xo = None
        else:
            xo = OE.price_at(m, ets[xi], "close"); net = OE.net_pnl(eo, xo)
        trades.append({"date": date, "ticker": ticker, "side": p["side"], "rule": p["rule"],
                       "ei": p["ei"], "eet": p["eet"], "e_utc": utcs[p["ei"]], "espot": p["espot"],
                       "xi": xi, "xet": ets[xi], "x_utc": utcs[xi], "reason": reason,
                       "K": p["K"], "cp": p["cp"], "occ": p["occ"], "entry_opt": eo,
                       "exit_opt": xo, "net": net, "hold": xi - p["ei"],
                       "pin_extended": p["pin_extended"]})
        if p["pin_extended"]:
            diag["pinhold_trades"] += 1

    for i in range(n):
        if pos is not None:
            fav = spots[i] if pos["side"] == "LONG" else -spots[i]
            bf = pos["best"] if pos["side"] == "LONG" else -pos["best"]
            if fav > bf:
                pos["best"] = spots[i]; pos["best_i"] = i
            held = node and near_pika(spots[i], pikas[i], pz)
            thr = round(S * px) if held else S
            if (i - pos["best_i"]) >= S and held and (i - pos["best_i"]) < thr:
                if not pos["pin_extended"]:
                    diag["pinhold_binds"] += 1
                pos["pin_extended"] = True
            if (i - pos["best_i"]) >= thr and i > pos["ei"]:
                close_pos(pos, i, "stall"); pos = None

        s = sig[i]
        if s is None:
            continue
        side = s["side"]
        if pos is not None and side != pos["side"]:
            # opposite signal while in position -> flip candidate
            if flip == "off":
                continue
            if gate and not passes_gate(side, i):
                diag["gate_blocked_flips"] += 1; continue
            if flip == "vetoed" and node and near_pika(spots[i], pikas[i], pz):
                diag["flip_veto_binds"] += 1; continue
            close_pos(pos, i, "flip"); pos = None
            if side in sides and budget[side] < 6:
                pos = open_pos(i, side, "flip"); budget[side] += 1; diag["flips_taken"] += 1
        elif pos is None:
            if side not in sides:
                continue
            if s["rule"] not in rules:
                continue
            if not passes_gate(side, i):
                diag["gate_blocked_entries"] += 1; continue
            if OE.openable(s) and budget[side] < 6:
                pos = open_pos(i, side, s["rule"]); budget[side] += 1

    if pos is not None:
        close_pos(pos, n - 1, "eod")
    return trades, diag


def run_cfg(cfg, days):
    all_tr = []; counts = {}; diag = Counter()
    for date in days:
        for t in TICKERS:
            ff = load_full(date, t)
            if not ff:
                continue
            ets, spots, utcs, pikas = ff
            tr, dg = simulate(cfg, ets, spots, utcs, pikas, t, date)
            all_tr += tr
            for k, v in dg.items():
                diag[k] += v
            for x in tr:
                counts[(date, t, x["side"])] = counts.get((date, t, x["side"]), 0) + 1
    return all_tr, counts, dict(diag)


# ---------------- stats helpers ----------------
def halves(days):
    h = len(days) // 2
    return days[:h], days[h:]


def wf_summary(trades, days):
    d1, d2 = halves(days)
    s1 = OE.summarize([t for t in trades if t["date"] in set(d1)])
    s2 = OE.summarize([t for t in trades if t["date"] in set(d2)])
    return s1, s2


def sub(trades, days):
    return [t for t in trades if t["date"] in set(days)]


def random_matched(days, cfg, counts, reps=20):
    """volume-matched random-timing with cfg's exit rule (stall S, no pin-hold on random)."""
    S = cfg["S"]; nets = []
    for date in days:
        for t in TICKERS:
            ff = load_full(date, t)
            if not ff:
                continue
            ets, spots, utcs, pikas = ff
            valid = [i for i, e in enumerate(ets) if "09:35" <= e <= "15:30"]
            for side in ("LONG", "SHORT"):
                cnt = counts.get((date, t, side), 0)
                if not cnt:
                    continue
                cp = "C" if side == "LONG" else "P"
                for _ in range(reps):
                    for _ in range(cnt):
                        i = random.choice(valid)
                        K = OE.atm_strike(t, spots[i]); occ = OE.occ_of(t, date, K, cp)
                        m = OE.fetch(occ, date); eo = OE.price_at(m, ets[i], "close")
                        if not eo:
                            continue
                        best = spots[i]; bi = i; xi = len(spots) - 1
                        for j in range(i + 1, len(spots)):
                            fav = spots[j] if side == "LONG" else -spots[j]
                            b = best if side == "LONG" else -best
                            if fav > b:
                                best = spots[j]; bi = j
                            if (j - bi) >= S:
                                xi = j; break
                        net = OE.net_pnl(eo, OE.price_at(m, ets[xi], "close"))
                        if net is not None:
                            nets.append(net)
    return nets


def fmt(s):
    if not s:
        return "n=0"
    return (f"n={s['n']} mean={s['mean']*100:+.1f}% med={s['median']*100:+.1f}% "
            f"hit={s['hit']*100:.0f}% total={s['total']*100:+.0f}%")


def boot_line(trades):
    b = OE.day_block_bootstrap(trades)
    if not b:
        return "boot=n/a"
    return f"90%CI=[{b['lo']*100:+.1f}%,{b['hi']*100:+.1f}%] P(mean>0)={b['p_pos']*100:.1f}%"


# ================================ MAIN ================================
def main():
    days = complete_days()
    oos = [d for d in days if d not in ORIG16]
    ins = [d for d in days if d in ORIG16]
    print(f"[days] complete={len(days)}  in-sample(orig16)={len(ins)}  OOS-new={len(oos)}: {oos}")
    print(f"[days] all: {days}\n")

    ALLR = (0.0015, 0.0025, 0.0035)
    ALLS = (12, 20)
    results = {"days": days, "oos": oos, "ins": ins}

    # ---- enumerate final grid for Bonferroni ----
    # T1: vreclaim long-only  R{3} x S{2} x gate{2}          = 12
    # T2: node sweep full-ruleset PZ{3} x PSX{2} x flip{3}   = 18
    # C : addendum full-ruleset R{3} x S{2} x gate{2}        = 12
    NCELLS = 12 + 18 + 12
    BONF = 0.05 / NCELLS
    NEED = 1 - BONF
    print(f"[grid] enumerated cells = {NCELLS}  Bonferroni alpha={BONF:.5f} -> need P(mean>0) >= {NEED:.5f}\n")
    results["ncells"] = NCELLS; results["bonf_need"] = NEED

    # ===== ENGINE VALIDATION: pure-v1 must reproduce operator_eye primary =====
    v1cfg = dict(R=0.0025, S=12, sides=("LONG", "SHORT"),
                 rules=("vreclaim", "higherlow", "lowerhigh"),
                 flip="v1", node_aware=False, gate=False)
    v1_tr, v1_counts, _ = run_cfg(v1cfg, ins)
    v1s = OE.summarize(v1_tr)
    print("=" * 92)
    print("ENGINE VALIDATION  pure-v1 (R0.25/S12/flip-unrestricted/no-node) on orig16")
    print(f"  {fmt(v1s)}   (operator_eye primary reported: n=389 mean=-2.9% hit=31%)")
    print(f"  exit reasons: {dict(Counter(t['reason'] for t in v1_tr))}")
    results["v1_validation"] = {"summary": v1s,
                                "reasons": dict(Counter(t['reason'] for t in v1_tr))}
    print()

    # =========================== TEST 1 ===========================
    print("=" * 92)
    print("TEST 1  V-RECLAIM LONG-ONLY  (no flips, no shorts, no higher-low; stall exit)")
    print("=" * 92)
    t1 = []
    for R in ALLR:
        for S in ALLS:
            for gate in (False, True):
                cfg = dict(R=R, S=S, sides=("LONG",), rules=("vreclaim",),
                           flip="off", node_aware=False, gate=gate)
                tr, counts, _ = run_cfg(cfg, days)
                s = OE.summarize(tr); b = OE.day_block_bootstrap(tr)
                s_oos = OE.summarize(sub(tr, oos))
                s1, s2 = wf_summary(tr, days)
                cell = {"R": R, "S": S, "gate": gate, "full": s, "boot": b,
                        "oos": s_oos, "h1": s1, "h2": s2, "counts": counts,
                        "primary": (R == 0.0025 and S == 12 and not gate)}
                t1.append(cell)
    results["test1"] = [{k: v for k, v in c.items() if k != "counts"} for c in t1]
    hdr = f"{'R%':>5} {'S':>3} {'gate':>5} {'nTr':>4} {'mean':>7} {'hit':>4} {'P>0':>6} {'H1mean':>7} {'H2mean':>7} {'OOSn':>5} {'OOSmean':>8}"
    print(hdr); print("-" * len(hdr))
    for c in t1:
        s = c["full"]; b = c["boot"]
        h1 = f"{c['h1']['mean']*100:+.1f}" if c['h1'] else "--"
        h2 = f"{c['h2']['mean']*100:+.1f}" if c['h2'] else "--"
        on = c['oos']['n'] if c['oos'] else 0
        om = f"{c['oos']['mean']*100:+.1f}%" if c['oos'] else "--"
        star = " <PRIMARY" if c["primary"] else ""
        print(f"{c['R']*100:>5.2f} {c['S']:>3} {str(c['gate']):>5} {s['n']:>4} "
              f"{s['mean']*100:>+6.1f}% {s['hit']*100:>3.0f}% {b['p_pos']*100:>5.1f}% "
              f"{h1:>7} {h2:>7} {on:>5} {om:>8}{star}")

    # primary frozen cell + random control + pass-bar
    prim = next(c for c in t1 if c["primary"])
    cfgP = dict(R=0.0025, S=12, sides=("LONG",), rules=("vreclaim",),
                flip="off", node_aware=False, gate=False)
    trP, countsP, _ = run_cfg(cfgP, days)
    print("\n--- TEST 1 PRIMARY (R0.25/S12/ungated) frozen slice ---")
    print(f"  full: {fmt(prim['full'])}  {boot_line(trP)}")
    print(f"  H1({halves(days)[0][0]}..{halves(days)[0][-1]}): {fmt(prim['h1'])}")
    print(f"  H2({halves(days)[1][0]}..{halves(days)[1][-1]}): {fmt(prim['h2'])}")
    print(f"  OOS-only {oos}: {fmt(prim['oos'])}")
    rnd = random_matched(days, cfgP, countsP, reps=20)
    if rnd:
        rnd_s = {"n": len(rnd), "mean": statistics.mean(rnd),
                 "median": statistics.median(rnd), "hit": sum(1 for x in rnd if x > 0)/len(rnd),
                 "total": sum(rnd)}
        print(f"  RANDOM(matched): {fmt(rnd_s)}")
        # random split by halves
        d1, d2 = halves(days)
        r1 = random_matched(d1, cfgP, {k: v for k, v in countsP.items() if k[0] in set(d1)}, reps=20)
        r2 = random_matched(d2, cfgP, {k: v for k, v in countsP.items() if k[0] in set(d2)}, reps=20)
        rm1 = statistics.mean(r1) if r1 else None
        rm2 = statistics.mean(r2) if r2 else None
        print(f"  RANDOM H1 mean={rm1*100:+.1f}% | H2 mean={rm2*100:+.1f}%")
        # PASS BAR: system beats random on BOTH halves AND positive expectancy after haircut
        beats_h1 = prim['h1'] and rm1 is not None and prim['h1']['mean'] > rm1
        beats_h2 = prim['h2'] and rm2 is not None and prim['h2']['mean'] > rm2
        pos_exp = prim['full']['mean'] > 0
        results["test1_passbar"] = {"beats_h1": beats_h1, "beats_h2": beats_h2,
                                    "pos_exp": pos_exp, "rand_full": rnd_s,
                                    "rand_h1": rm1, "rand_h2": rm2,
                                    "sys_h1": prim['h1']['mean'] if prim['h1'] else None,
                                    "sys_h2": prim['h2']['mean'] if prim['h2'] else None}
        print(f"  PASS BAR: beats_random_H1={beats_h1} beats_random_H2={beats_h2} "
              f"pos_expectancy={pos_exp} -> {'PASS' if (beats_h1 and beats_h2 and pos_exp) else 'FAIL'}")
    results["test1_primary_trades"] = trP
    print()

    # =========================== TEST 2 ===========================
    print("=" * 92)
    print("TEST 2  v2 NODE-AWARE SWEEP  (full operator ruleset: V-reclaim+higher-low longs, flip shorts)")
    print("=" * 92)
    PZ = (0.0015, 0.0030, 0.0045); PSX = (2, 3); FLIP = ("vetoed", "off", "v1")
    t2 = []
    for pz in PZ:
        for px in PSX:
            for fl in FLIP:
                cfg = dict(R=0.0025, S=12, sides=("LONG", "SHORT"),
                           rules=("vreclaim", "higherlow", "lowerhigh"),
                           flip=fl, node_aware=True, pin_zone=pz, pin_stall_x=px, gate=False)
                tr, counts, diag = run_cfg(cfg, days)
                s = OE.summarize(tr); b = OE.day_block_bootstrap(tr)
                flip_tr = [t for t in tr if t["rule"] == "flip"]
                fs = OE.summarize(flip_tr)
                pin_tr = [t for t in tr if t.get("pin_extended")]
                ps = OE.summarize(pin_tr)
                t2.append({"pz": pz, "px": px, "flip": fl, "full": s, "boot": b,
                           "flip_coh": fs, "pin_coh": ps, "diag": diag, "trades": tr,
                           "counts": counts})
    results["test2"] = [{k: v for k, v in c.items() if k not in ("trades", "counts")} for c in t2]
    hdr = (f"{'PZ%':>5} {'PSX':>3} {'flip':>7} {'nTr':>4} {'mean':>7} {'hit':>4} {'P>0':>6} "
           f"{'flipN':>5} {'flipMean':>8} {'vetoBind':>8} {'pinBind':>7} {'pinN':>4} {'pinMean':>8}")
    print(hdr); print("-" * len(hdr))
    for c in t2:
        s = c["full"]; b = c["boot"]; d = c["diag"]
        fn = c["flip_coh"]["n"] if c["flip_coh"] else 0
        fm = f"{c['flip_coh']['mean']*100:+.1f}%" if c["flip_coh"] else "--"
        pn = c["pin_coh"]["n"] if c["pin_coh"] else 0
        pm = f"{c['pin_coh']['mean']*100:+.1f}%" if c["pin_coh"] else "--"
        print(f"{c['pz']*100:>5.2f} {c['px']:>3} {c['flip']:>7} {s['n']:>4} "
              f"{s['mean']*100:>+6.1f}% {s['hit']*100:>3.0f}% {b['p_pos']*100:>5.1f}% "
              f"{fn:>5} {fm:>8} {d['flip_veto_binds']:>8} {d['pinhold_binds']:>7} {pn:>4} {pm:>8}")

    # ---- (b) pin-hold isolation: same full ruleset, flip=v1, node on vs off ----
    print("\n--- (b) PIN-HOLD isolation (flip=v1 fixed; node OFF vs ON at PZ0.30/PSX2 and PSX3) ---")
    pin_iso = {}
    for lbl, node, px in (("v1 no-pinhold", False, 2), ("v1 +pinhold PSX2", True, 2), ("v1 +pinhold PSX3", True, 3)):
        cfg = dict(R=0.0025, S=12, sides=("LONG", "SHORT"),
                   rules=("vreclaim", "higherlow", "lowerhigh"),
                   flip="v1", node_aware=node, pin_zone=0.0030, pin_stall_x=px, gate=False)
        tr, _, diag = run_cfg(cfg, days)
        s = OE.summarize(tr)
        pin_tr = [t for t in tr if t.get("pin_extended")]
        ps = OE.summarize(pin_tr)
        pin_iso[lbl] = {"full": s, "pin": ps, "diag": diag}
        print(f"  {lbl:20s}: {fmt(s)} | pinhold-extended trades: {fmt(ps)} (binds={diag['pinhold_binds']})")
    results["pin_iso"] = pin_iso

    # best v2 cell by bootstrap P(mean>0)
    bestv2 = max(t2, key=lambda c: (c["boot"]["p_pos"], c["full"]["mean"]))
    print(f"\n  BEST v2 cell: PZ{bestv2['pz']*100:.2f}/PSX{bestv2['px']}/flip={bestv2['flip']} "
          f"-> {fmt(bestv2['full'])} {boot_line(bestv2['trades'])}")
    results["bestv2"] = {"pz": bestv2["pz"], "px": bestv2["px"], "flip": bestv2["flip"],
                         "full": bestv2["full"], "boot": bestv2["boot"], "diag": bestv2["diag"]}

    # =========================== ADDENDUM (Group C) ===========================
    print("\n" + "=" * 92)
    print("ADDENDUM  full-ruleset R/S/day-context-gate sweep (node fixed PZ0.30/PSX2/flip=vetoed)")
    print("=" * 92)
    cC = []
    for R in ALLR:
        for S in ALLS:
            for gate in (False, True):
                cfg = dict(R=R, S=S, sides=("LONG", "SHORT"),
                           rules=("vreclaim", "higherlow", "lowerhigh"),
                           flip="vetoed", node_aware=True, pin_zone=0.0030,
                           pin_stall_x=2, gate=gate)
                tr, counts, diag = run_cfg(cfg, days)
                s = OE.summarize(tr); b = OE.day_block_bootstrap(tr)
                long_s = OE.summarize([t for t in tr if t["side"] == "LONG"])
                short_s = OE.summarize([t for t in tr if t["side"] == "SHORT"])
                cC.append({"R": R, "S": S, "gate": gate, "full": s, "boot": b,
                           "long": long_s, "short": short_s, "diag": diag, "trades": tr})
    results["addendum"] = [{k: v for k, v in c.items() if k != "trades"} for c in cC]
    hdr = (f"{'R%':>5} {'S':>3} {'gate':>5} {'nTr':>4} {'mean':>7} {'hit':>4} {'P>0':>6} "
           f"{'longN':>5} {'longM':>7} {'shortN':>6} {'shortM':>7} {'gateBlk':>7}")
    print(hdr); print("-" * len(hdr))
    for c in cC:
        s = c["full"]; b = c["boot"]
        ln = c["long"]["n"] if c["long"] else 0
        lm = f"{c['long']['mean']*100:+.1f}" if c["long"] else "--"
        sn = c["short"]["n"] if c["short"] else 0
        sm = f"{c['short']['mean']*100:+.1f}" if c["short"] else "--"
        gb = c["diag"]["gate_blocked_entries"] + c["diag"]["gate_blocked_flips"]
        print(f"{c['R']*100:>5.2f} {c['S']:>3} {str(c['gate']):>5} {s['n']:>4} "
              f"{s['mean']*100:>+6.1f}% {s['hit']*100:>3.0f}% {b['p_pos']*100:>5.1f}% "
              f"{ln:>5} {lm:>7} {sn:>6} {sm:>7} {gb:>7}")

    # ---- case studies under best gated cell ----
    gated = [c for c in cC if c["gate"]]
    best_gated = max(gated, key=lambda c: (c["boot"]["p_pos"], c["full"]["mean"]))
    ungated_match = next(c for c in cC if not c["gate"] and c["R"] == best_gated["R"] and c["S"] == best_gated["S"])
    print(f"\n--- CASE STUDIES  best gated cell R{best_gated['R']*100:.2f}/S{best_gated['S']}/gated "
          f"vs matched ungated ---")
    results["case_studies"] = {}
    for day in ("2026-07-13", "2026-07-14", "2026-07-10"):
        if day not in days:
            continue
        g = [t for t in best_gated["trades"] if t["date"] == day]
        u = [t for t in ungated_match["trades"] if t["date"] == day]
        gs = OE.summarize(g); us = OE.summarize(u)
        gside = Counter(t["side"] for t in g); uside = Counter(t["side"] for t in u)
        print(f"  {day}:")
        print(f"     ungated: {fmt(us)}  sides={dict(uside)}")
        print(f"     gated  : {fmt(gs)}  sides={dict(gside)}")
        results["case_studies"][day] = {
            "ungated": {"summary": us, "sides": dict(uside)},
            "gated": {"summary": gs, "sides": dict(gside)}}

    # =========================== HEAD-TO-HEAD ===========================
    print("\n" + "=" * 92)
    print("HEAD-TO-HEAD (full sample, all complete days)")
    print("=" * 92)
    contenders = {
        "vreclaim-LONG-only (T1 primary)": trP,
        f"best-v2 PZ{bestv2['pz']*100:.2f}/PSX{bestv2['px']}/{bestv2['flip']}": bestv2["trades"],
        f"best-gated R{best_gated['R']*100:.2f}/S{best_gated['S']}": best_gated["trades"],
        "v1 baseline (operator_eye primary)": v1_tr if days == ins else run_cfg(v1cfg, days)[0],
    }
    h2h = {}
    for name, tr in contenders.items():
        s = OE.summarize(tr); b = OE.day_block_bootstrap(tr)
        h2h[name] = {"summary": s, "boot": b}
        print(f"  {name:44s}: {fmt(s)}  {boot_line(tr)}")
    # random baseline (matched to T1 primary)
    if rnd:
        print(f"  {'random (vol-matched, T1 timing)':44s}: {fmt(rnd_s)}")
    results["head_to_head"] = h2h

    # =========================== EMIT BEST SURVIVING CONFIG ===========================
    # decision: if T1 primary clears pass bar and beats v2 -> ghost vreclaim-long-only;
    # else if a v2 cell survives Bonferroni -> that; else emit T1 primary as the least-bad
    survivors = []
    if prim["boot"]["p_pos"] >= NEED and prim["full"]["mean"] > 0:
        survivors.append(("vreclaim-long-only-primary", trP))
    for c in t2:
        if c["boot"]["p_pos"] >= NEED and c["full"]["mean"] > 0:
            survivors.append((f"v2-PZ{c['pz']}-PSX{c['px']}-{c['flip']}", c["trades"]))
    print(f"\n[survivors clearing Bonferroni P>0>={NEED:.4f} AND positive expectancy]: "
          f"{[s[0] for s in survivors] if survivors else 'NONE'}")
    results["survivors"] = [s[0] for s in survivors]

    emit_name, emit_tr = ("vreclaim-long-only-primary", trP)
    if survivors:
        emit_name, emit_tr = survivors[0]
    out = os.path.join(HERE, "swing_v2_events.jsonl")
    nemit = 0
    with open(out, "w") as f:
        for t in emit_tr:
            if t["net"] is None:
                continue
            f.write(json.dumps({
                "day": t["date"], "ticker": t["ticker"], "minute": t["e_utc"],
                "strike": t["K"], "spot_at_entry": round(t["espot"], 2), "kind": "swing",
                "implied": t["occ"], "side": t["side"], "exit_minute": t["x_utc"],
                "outcome": "win" if t["net"] > 0 else "loss",
                "pnl_pct": round(t["net"] * 100, 1),
                "rule": t["rule"] if t["rule"] in ("vreclaim", "higherlow", "lowerhigh") else "flip"
            }) + "\n"); nemit += 1
    print(f"[emit] {nemit} events for '{emit_name}' -> {out}")
    results["emitted"] = {"config": emit_name, "n": nemit}

    # strip trades from results before dump
    results.pop("test1_primary_trades", None)
    json.dump(results, open(os.path.join(HERE, "swing_v2_results.json"), "w"),
              indent=1, default=lambda o: None)
    print(f"[dump] {os.path.join(HERE, 'swing_v2_results.json')}")


if __name__ == "__main__":
    main()
