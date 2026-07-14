#!/usr/bin/env python3
"""TERRAIN ENTRY SYSTEM — event layer at 1-minute resolution. RESEARCH ONLY (Clause 0).

Pre-registered (see PREREG dict below and TERRAIN_EVENTS_1MIN.md). Detects BOUNCE / BREAK
events at strong dealer-gamma node bands on the 1-min index spot path, plus a distance-matched
PHANTOM (mirror) band for every real node (the control that killed the 5-min "King as level"
study). Outcomes = signed forward underlying drift (15/30/60 min) + ATM option P&L via live
trail. Day-block bootstrap, walk-forward halves, Bonferroni. Also a pre-registered bounce-vs-break
logistic (train/test split) for the payoff question.

Reuses pnl_v0.fetch / sim_trail / cohort_stats / day_block_bootstrap for option P&L.
Emits terrain_events.jsonl (real events) + terrain_results.json (all numbers for the report).
"""
import gzip, json, os, math, statistics, random
from datetime import datetime, timedelta, timezone

SP = os.path.dirname(os.path.abspath(__file__))
BASE = "/Users/saiyeeshrathish/the final plan/apps/gex"
BACKFILL = os.path.join(BASE, "research/velocity-capture/backfill")
OUT_JSONL = os.path.join(BASE, "research/velocity-capture/terrain_events.jsonl")
OUT_RESULTS = os.path.join(SP, "terrain_results.json")
TICKERS = ["SPXW", "SPY", "QQQ"]
random.seed(20260714)

# ---- pre-registration (frozen before outcomes) ----
PREREG = {
    "node_relsig_min": 0.10,           # strong node: |gamma|/sum|gamma| >= this ...
    "node_sustain_min": 5,             # ... sustained >= this many consecutive minutes
    "band_halfwidth_frac": 0.0005,     # band = strike +/- 0.05% of spot
    "K_max_inside": 5,                 # bounce/break must resolve within K minutes inside
    "bounce_pen_frac_max": 0.40,       # bounce penetrates <= 40% of half-width past strike
    "approach_lookback": 5,            # approach velocity = 5-min spot return into band
    "drift_horizons": [15, 30, 60],    # forward underlying drift minutes after resolution
    "primary_horizon": 30,
    "mirror": "reflect strike across spot at node arm minute: K_ph = 2*S_arm - K (fixed level)",
    "mirror_min_dist_frac": 0.0005,    # require |K - S_arm| >= half-width (drop on-price pins)
    "min_frames": 380,                 # require near-complete session per (day,ticker)
    "primary_family": [
        "P1 BOUNCE-pika signed drift@30 real>0 and real>phantom",
        "P2 BREAK-barney signed drift@30 real>0 and real>phantom",
        "P3 BREAK-pika  signed drift@30 real>phantom",
        "P4 BOUNCE-barney signed drift@30 real>phantom (doctrine: expect null)",
        "P5 bounce-vs-break test-set AUC>0.5 (CI excludes 0.5)",
    ],
    "bonferroni_m": 5,
}

def et(ts_iso):
    s = ts_iso.replace("Z", "+00:00")
    dt = datetime.fromisoformat(s).astimezone(timezone.utc) - timedelta(hours=4)
    return dt.strftime("%H:%M")

def load_frames(path_gz, path_plain):
    path = path_gz if os.path.exists(path_gz) else path_plain
    if not os.path.exists(path):
        return None
    frames = []
    op = gzip.open if path.endswith(".gz") else open
    with op(path, "rt") as f:
        for line in f:
            line = line.strip()
            if line:
                frames.append(json.loads(line))
    frames.sort(key=lambda d: d["requestedTs"])
    return frames

def find_nodes(frames):
    """First sustained-5min relSig>=0.10 window per strike -> node instance."""
    n = len(frames)
    strikes = set()
    gser = {}
    tot = [0.0] * n
    for i, fr in enumerate(frames):
        s = 0.0
        for st in fr["strikes"]:
            s += abs(st["gamma"])
        tot[i] = s
        for st in fr["strikes"]:
            strikes.add(st["strike"])
    for k in strikes:
        gser[k] = [0.0] * n
    for i, fr in enumerate(frames):
        for st in fr["strikes"]:
            gser[st["strike"]][i] = st["gamma"]
    nodes = []
    thr = PREREG["node_relsig_min"]; sus = PREREG["node_sustain_min"]
    for k in strikes:
        gl = gser[k]
        rs = [(abs(gl[i]) / tot[i]) if tot[i] > 0 else 0.0 for i in range(n)]
        run = 0
        armed = False
        for i in range(n):
            if rs[i] >= thr:
                run += 1
                if run >= sus and not armed:
                    arm_i = i
                    win = list(range(arm_i - sus + 1, arm_i + 1))
                    strength = statistics.mean(rs[j] for j in win)
                    mg = statistics.mean(gl[j] for j in win)
                    sign = "pika" if mg > 0 else "barney"
                    nodes.append({"strike": k, "arm_i": arm_i, "arm_et": et(frames[arm_i]["requestedTs"]),
                                  "S_arm": frames[arm_i]["spot"], "strength": strength, "sign": sign})
                    armed = True
            else:
                run = 0
    return nodes

def detect_events(spots, K, start_i, end_i):
    wfrac = PREREG["band_halfwidth_frac"]; Kmax = PREREG["K_max_inside"]
    lb = PREREG["approach_lookback"]
    n = len(spots)
    end = min(end_i, n - 1)
    def inside(i):
        return abs(spots[i] - K) <= wfrac * spots[i]
    events = []
    j = start_i + 1
    while j <= end:
        if inside(j) and not inside(j - 1):
            entry_i = j
            approach_dir = "up" if spots[j - 1] < K else "down"
            entry_side = "below" if approach_dir == "up" else "above"
            e = None
            k = j + 1
            while k <= end:
                if not inside(k):
                    e = k; break
                k += 1
            if e is None:
                break
            dwell = e - entry_i
            exit_side = "below" if spots[e] < K else "above"
            if approach_dir == "up":
                pen = max(spots[t] - K for t in range(entry_i, e))
            else:
                pen = max(K - spots[t] for t in range(entry_i, e))
            w_entry = wfrac * spots[entry_i]
            pen_frac = pen / w_entry if w_entry > 0 else 0.0
            same = (exit_side == entry_side)
            if dwell <= Kmax and same and pen_frac <= PREREG["bounce_pen_frac_max"]:
                kind = "bounce"; implied = "down" if approach_dir == "up" else "up"
            elif dwell <= Kmax and not same:
                kind = "break"; implied = "up" if approach_dir == "up" else "down"
            else:
                kind = "other"; implied = None
            av = (spots[entry_i] - spots[entry_i - lb]) / spots[entry_i - lb] if entry_i - lb >= 0 else None
            events.append({"entry_i": entry_i, "exit_i": e, "dwell": dwell, "kind": kind,
                           "approach_dir": approach_dir, "implied": implied, "pen_frac": pen_frac,
                           "approach_vel": av})
            j = e + 1
        else:
            j += 1
    return events

def signed_drift(spots, anchor_i, implied, h):
    n = len(spots)
    if implied is None or anchor_i + h >= n:
        return None
    r = (spots[anchor_i + h] - spots[anchor_i]) / spots[anchor_i]
    return r if implied == "up" else -r

# ---------- build event set ----------
def build_all():
    days = sorted(d for d in os.listdir(BACKFILL) if d.startswith("2026-"))
    real_events = []
    phantom_events = []
    series_info = []
    for day in days:
        for t in TICKERS:
            frames = load_frames(os.path.join(BACKFILL, day, f"{t}.jsonl.gz"),
                                 os.path.join(BACKFILL, day, f"{t}.jsonl"))
            if not frames or len(frames) < PREREG["min_frames"]:
                continue
            spots = [fr["spot"] for fr in frames]
            ets = [et(fr["requestedTs"]) for fr in frames]
            n = len(spots)
            runmean = []
            acc = 0.0
            for i, s in enumerate(spots):
                acc += s
                runmean.append(acc / (i + 1))
            nodes = find_nodes(frames)
            series_info.append({"day": day, "ticker": t, "frames": n, "n_nodes": len(nodes)})
            for nd in nodes:
                K = nd["strike"]; arm = nd["arm_i"]
                # real band events
                for ev in detect_events(spots, K, arm, n - 1):
                    rec = _mk(day, t, ev, nd, spots, ets, runmean, phantom=False, K=K)
                    real_events.append(rec)
                # phantom band (mirror): reflect across arm spot
                w_arm = PREREG["band_halfwidth_frac"] * nd["S_arm"]
                if abs(K - nd["S_arm"]) < w_arm:  # on-price pin: no valid mirror
                    continue
                K_ph = 2 * nd["S_arm"] - K
                if K_ph <= 0:
                    continue
                for ev in detect_events(spots, K_ph, arm, n - 1):
                    rec = _mk(day, t, ev, nd, spots, ets, runmean, phantom=True, K=K_ph)
                    phantom_events.append(rec)
    return days, series_info, real_events, phantom_events

def _mk(day, t, ev, nd, spots, ets, runmean, phantom, K):
    entry_i = ev["entry_i"]; anchor = ev["exit_i"]
    drifts = {str(h): signed_drift(spots, anchor, ev["implied"], h) for h in PREREG["drift_horizons"]}
    vwap_pos = (spots[entry_i] - runmean[entry_i]) / runmean[entry_i]
    return {
        "day": day, "ticker": t, "phantom": phantom,
        "strike": round(K, 2), "node_strike": nd["strike"], "sign": nd["sign"],
        "strength": round(nd["strength"], 4), "kind": ev["kind"],
        "approach_dir": ev["approach_dir"], "implied": ev["implied"],
        "approach_vel": ev["approach_vel"], "approach_speed": abs(ev["approach_vel"]) if ev["approach_vel"] is not None else None,
        "pen_frac": round(ev["pen_frac"], 3), "dwell": ev["dwell"],
        "entry_et": ets[entry_i], "exit_et": ets[anchor], "entry_i": entry_i, "exit_i": anchor,
        "spot_entry": round(spots[entry_i], 2), "spot_exit": round(spots[anchor], 2),
        "vwap_pos": round(vwap_pos, 6),
        "drift15": drifts["15"], "drift30": drifts["30"], "drift60": drifts["60"],
    }

# ---------- stats helpers ----------
def summ(xs):
    xs = [x for x in xs if x is not None]
    if not xs:
        return None
    return {"n": len(xs), "mean": statistics.mean(xs), "median": statistics.median(xs),
            "pos": sum(1 for x in xs if x > 0) / len(xs)}

def terciles(vals):
    v = sorted(x for x in vals if x is not None)
    if len(v) < 3:
        return None
    a = v[len(v) // 3]; b = v[2 * len(v) // 3]
    return a, b

def day_block_boot_mean(events, key, B=3000):
    byday = {}
    for e in events:
        if e.get(key) is not None:
            byday.setdefault(e["day"], []).append(e[key])
    days = list(byday.keys())
    if len(days) < 2:
        return None
    means = []
    for _ in range(B):
        pooled = []
        for _ in days:
            pooled += byday[random.choice(days)]
        if pooled:
            means.append(statistics.mean(pooled))
    means.sort()
    return {"lo": means[int(0.05 * len(means))], "hi": means[int(0.95 * len(means))],
            "med": means[len(means) // 2], "p_pos": sum(1 for x in means if x > 0) / len(means), "B": B}

def day_block_boot_diff(real, phantom, key, B=3000):
    """Bootstrap real_mean - phantom_mean over resampled days; two-sided p for diff==0."""
    rr = {}; pp = {}
    for e in real:
        if e.get(key) is not None:
            rr.setdefault(e["day"], []).append(e[key])
    for e in phantom:
        if e.get(key) is not None:
            pp.setdefault(e["day"], []).append(e[key])
    days = sorted(set(rr) | set(pp))
    if len(days) < 2:
        return None
    diffs = []
    for _ in range(B):
        rpool = []; ppool = []
        for _ in days:
            d = random.choice(days)
            rpool += rr.get(d, []); ppool += pp.get(d, [])
        if rpool and ppool:
            diffs.append(statistics.mean(rpool) - statistics.mean(ppool))
    if not diffs:
        return None
    diffs.sort()
    n = len(diffs)
    p_gt0 = sum(1 for x in diffs if x > 0) / n
    p_two = 2 * min(p_gt0, 1 - p_gt0)
    return {"lo": diffs[int(0.05 * n)], "hi": diffs[int(0.95 * n)], "med": diffs[n // 2],
            "p_pos": p_gt0, "p_two": p_two, "B": B}

# ---------- logistic (pure python) ----------
def fit_logistic(X, y, iters=4000, lr=0.2):
    m = len(X[0])
    means = [statistics.mean(col) for col in zip(*X)]
    stds = [statistics.pstdev(col) or 1.0 for col in zip(*X)]
    Xs = [[(row[j] - means[j]) / stds[j] for j in range(m)] for row in X]
    w = [0.0] * m; b = 0.0
    nrec = len(Xs)
    for _ in range(iters):
        gw = [0.0] * m; gb = 0.0
        for xi, yi in zip(Xs, y):
            z = b + sum(w[j] * xi[j] for j in range(m))
            p = 1 / (1 + math.exp(-max(-30, min(30, z))))
            err = p - yi
            for j in range(m):
                gw[j] += err * xi[j]
            gb += err
        for j in range(m):
            w[j] -= lr * gw[j] / nrec
        b -= lr * gb / nrec
    return {"w": w, "b": b, "means": means, "stds": stds}

def predict_logistic(model, X):
    w = model["w"]; b = model["b"]; means = model["means"]; stds = model["stds"]
    out = []
    for row in X:
        xi = [(row[j] - means[j]) / stds[j] for j in range(len(row))]
        z = b + sum(w[j] * xi[j] for j in range(len(row)))
        out.append(1 / (1 + math.exp(-max(-30, min(30, z)))))
    return out

def auc(labels, scores):
    pos = [s for s, l in zip(scores, labels) if l == 1]
    neg = [s for s, l in zip(scores, labels) if l == 0]
    if not pos or not neg:
        return None
    c = 0.0
    for p in pos:
        for ng in neg:
            c += 1.0 if p > ng else (0.5 if p == ng else 0.0)
    return c / (len(pos) * len(neg))

def main():
    days, series_info, real, phantom = build_all()
    used_days = sorted(set(e["day"] for e in real) | set(s["day"] for s in series_info))

    # emit JSONL (real events only, viewer fields + extras)
    with open(OUT_JSONL, "w") as f:
        for e in real:
            f.write(json.dumps({"day": e["day"], "ticker": e["ticker"], "minute": e["exit_et"],
                                "entry_minute": e["entry_et"], "strike": e["node_strike"],
                                "sign": e["sign"], "kind": e["kind"], "strength": e["strength"],
                                "approach_vel": e["approach_vel"], "implied": e["implied"],
                                "drift30": e["drift30"]}) + "\n")

    res = {"prereg": PREREG, "used_days": used_days, "series_info": series_info}

    # counts per day/ticker, real vs phantom
    def counts(evs):
        c = {}
        for e in evs:
            key = (e["day"], e["ticker"])
            c.setdefault(key, {"bounce": 0, "break": 0, "other": 0})
            c[key][e["kind"]] += 1
        return c
    res["counts_real"] = {f"{k[0]}|{k[1]}": v for k, v in counts(real).items()}
    res["counts_phantom"] = {f"{k[0]}|{k[1]}": v for k, v in counts(phantom).items()}

    def kindsign_counts(evs):
        out = {}
        for e in evs:
            key = f"{e['kind']}-{e['sign']}"
            out[key] = out.get(key, 0) + 1
        return out
    res["kindsign_real"] = kindsign_counts(real)
    res["kindsign_phantom"] = kindsign_counts(phantom)

    # ---- primary outcome: signed drift by kind x sign, real vs phantom ----
    def subset(evs, kind, sign):
        return [e for e in evs if e["kind"] == kind and e["sign"] == sign]
    cells = {}
    for kind in ("bounce", "break"):
        for sign in ("pika", "barney"):
            rr = subset(real, kind, sign)
            pp = subset(phantom, kind, sign)
            cell = {"n_real": len(rr), "n_phantom": len(pp)}
            for h in PREREG["drift_horizons"]:
                key = f"drift{h}"
                cell[f"real_{key}"] = summ([e[key] for e in rr])
                cell[f"phantom_{key}"] = summ([e[key] for e in pp])
            # bootstrap on primary horizon
            cell["boot_real_drift30"] = day_block_boot_mean(rr, "drift30")
            cell["boot_diff_drift30"] = day_block_boot_diff(rr, pp, "drift30")
            cells[f"{kind}-{sign}"] = cell
    res["cells"] = cells

    # ---- secondary splits (exploratory): ticker, strength tercile, approach-speed tercile ----
    clean_real = [e for e in real if e["kind"] in ("bounce", "break")]
    sec = {}
    for t in TICKERS:
        sec[f"ticker_{t}"] = summ([e["drift30"] for e in clean_real if e["ticker"] == t])
    st = terciles([e["strength"] for e in clean_real])
    if st:
        a, b = st
        sec["strength_lo"] = summ([e["drift30"] for e in clean_real if e["strength"] <= a])
        sec["strength_mid"] = summ([e["drift30"] for e in clean_real if a < e["strength"] <= b])
        sec["strength_hi"] = summ([e["drift30"] for e in clean_real if e["strength"] > b])
    sp = terciles([e["approach_speed"] for e in clean_real if e["approach_speed"] is not None])
    if sp:
        a, b = sp
        res["approach_speed_terciles"] = [a, b]
        sec["appvel_slow"] = summ([e["drift30"] for e in clean_real if e["approach_speed"] is not None and e["approach_speed"] <= a])
        sec["appvel_mid"] = summ([e["drift30"] for e in clean_real if e["approach_speed"] is not None and a < e["approach_speed"] <= b])
        sec["appvel_fast"] = summ([e["drift30"] for e in clean_real if e["approach_speed"] is not None and e["approach_speed"] > b])
    res["secondary"] = sec

    # break-rate by approach-speed tercile (the mechanism hypothesis: fast approach -> break)
    if sp:
        a, b = sp
        def brk_rate(lo, hi):
            grp = [e for e in clean_real if e["approach_speed"] is not None and lo < e["approach_speed"] <= hi]
            if not grp:
                return None
            return {"n": len(grp), "break_rate": sum(1 for e in grp if e["kind"] == "break") / len(grp)}
        res["breakrate_by_appspeed"] = {
            "slow": brk_rate(-1, a), "mid": brk_rate(a, b), "fast": brk_rate(b, 1e9)}

    # ---- walk-forward halves ----
    half = used_days[:len(used_days) // 2]
    half2 = used_days[len(used_days) // 2:]
    res["walkforward_days"] = {"train": half, "test": half2}
    res["wf_drift30"] = {
        "train": summ([e["drift30"] for e in clean_real if e["day"] in half]),
        "test": summ([e["drift30"] for e in clean_real if e["day"] in half2])}

    # ---- payoff question: bounce(0) vs break(1) logistic ----
    feat_events = [e for e in clean_real if e["approach_speed"] is not None]
    def feats(e):
        return [e["approach_speed"], e["strength"], 1.0 if e["sign"] == "pika" else 0.0, e["vwap_pos"]]
    tr = [e for e in feat_events if e["day"] in half]
    te = [e for e in feat_events if e["day"] in half2]
    logit = {"n_train": len(tr), "n_test": len(te)}
    if len(tr) >= 20 and len(te) >= 10 and len(set(1 if e["kind"] == "break" else 0 for e in tr)) == 2:
        Xtr = [feats(e) for e in tr]; ytr = [1 if e["kind"] == "break" else 0 for e in tr]
        Xte = [feats(e) for e in te]; yte = [1 if e["kind"] == "break" else 0 for e in te]
        model = fit_logistic(Xtr, ytr)
        ptr = predict_logistic(model, Xtr); pte = predict_logistic(model, Xte)
        logit["base_rate_train"] = sum(ytr) / len(ytr)
        logit["base_rate_test"] = sum(yte) / len(yte)
        logit["auc_train"] = auc(ytr, ptr)
        logit["auc_test"] = auc(yte, pte)
        logit["weights"] = {"approach_speed": model["w"][0], "strength": model["w"][1],
                            "sign_pika": model["w"][2], "vwap_pos": model["w"][3], "bias": model["b"]}
        # accuracy at 0.5 threshold vs majority-class baseline
        acc = sum(1 for p, yv in zip(pte, yte) if (p >= 0.5) == (yv == 1)) / len(yte)
        maj = max(logit["base_rate_test"], 1 - logit["base_rate_test"])
        logit["acc_test"] = acc; logit["majority_baseline"] = maj
        # bootstrap test AUC over days
        byday = {}
        for e, pv in zip(te, pte):
            byday.setdefault(e["day"], []).append((1 if e["kind"] == "break" else 0, pv))
        tdays = list(byday.keys())
        aucs = []
        if len(tdays) >= 2:
            for _ in range(2000):
                pool = []
                for _ in tdays:
                    pool += byday[random.choice(tdays)]
                a_ = auc([x[0] for x in pool], [x[1] for x in pool])
                if a_ is not None:
                    aucs.append(a_)
            if aucs:
                aucs.sort()
                logit["auc_test_ci"] = [aucs[int(0.05 * len(aucs))], aucs[int(0.95 * len(aucs))]]
    res["logistic"] = logit

    # ---- option P&L for real bounce/break events (entry at resolution minute) + random control ----
    try:
        import pnl_v0
        pnl = eval_option_pnl(real, pnl_v0)
        res["option_pnl"] = pnl
    except Exception as ex:
        res["option_pnl"] = {"error": repr(ex)}

    json.dump(res, open(OUT_RESULTS, "w"), indent=1, default=str)
    print_digest(res)
    return res

def eval_option_pnl(real, pnl_v0):
    """ATM option P&L via live trail for clean real events. Cached fetch. Random-entry control."""
    clean = [e for e in real if e["kind"] in ("bounce", "break") and e["implied"] is not None]
    out = {}
    for kind in ("bounce", "break"):
        for field in ("net",):
            evs = [e for e in clean if e["kind"] == kind]
            nets = []; byday = {}; contracts = []
            for e in evs:
                cp = "C" if e["implied"] == "up" else "P"
                strike = pnl_v0.atm_strike(e["ticker"], e["spot_exit"])
                occ = pnl_v0.occ_of(e["ticker"], e["day"], strike, cp)
                m = pnl_v0.fetch(occ, e["day"])
                if not m:
                    continue
                entry_et = e["exit_et"]
                c0 = pnl_v0.price_at(m, entry_et, "close")
                if not c0 or c0 <= 0:
                    continue
                sim = pnl_v0.sim_trail(m, entry_et, c0)
                if not sim:
                    continue
                nets.append(sim["net"]); byday.setdefault(e["day"], []).append(sim["net"])
                contracts.append((occ, e["day"], m))
            s = None
            if nets:
                s = {"n": len(nets), "mean": statistics.mean(nets), "median": statistics.median(nets),
                     "hit": sum(1 for x in nets if x > 0) / len(nets)}
                # day-block bootstrap
                days = list(byday.keys())
                if len(days) >= 2:
                    boot = []
                    for _ in range(3000):
                        pool = []
                        for _ in days:
                            pool += byday[random.choice(days)]
                        if pool:
                            boot.append(statistics.mean(pool))
                    boot.sort()
                    s["boot_ci"] = [boot[int(0.05 * len(boot))], boot[int(0.95 * len(boot))]]
                    s["boot_p_pos"] = sum(1 for x in boot if x > 0) / len(boot)
            # random-entry control on same contracts
            rand = []
            for occ, day, m in contracts:
                ks = [k for k in sorted(m.keys()) if "09:35" <= k <= "15:30"]
                if len(ks) < 5:
                    continue
                for _ in range(20):
                    ek = random.choice(ks)
                    sim = pnl_v0.sim_trail(m, ek, m[ek]["close"])
                    if sim:
                        rand.append(sim["net"])
            rc = None
            if rand:
                rc = {"n": len(rand), "mean": statistics.mean(rand), "median": statistics.median(rand),
                      "hit": sum(1 for x in rand if x > 0) / len(rand)}
            out[kind] = {"real": s, "random_control": rc}
    return out

def print_digest(res):
    p = lambda x: "None" if x is None else x
    print("=" * 70)
    print("TERRAIN EVENTS 1-MIN — DIGEST")
    print("used_days:", res["used_days"])
    print("series (day|ticker: frames, n_nodes):")
    for s in res["series_info"]:
        print(f"  {s['day']} {s['ticker']:4s} frames={s['frames']} nodes={s['n_nodes']}")
    tot_r = sum(sum(v.values()) for v in res["counts_real"].values())
    tot_p = sum(sum(v.values()) for v in res["counts_phantom"].values())
    print(f"\nREAL events total={tot_r}  kindsign={res['kindsign_real']}")
    print(f"PHANTOM events total={tot_p}  kindsign={res['kindsign_phantom']}")
    print("\n--- PRIMARY: signed drift@30 real vs phantom (kind-sign) ---")
    for k, c in res["cells"].items():
        r = c.get("real_drift30"); ph = c.get("phantom_drift30")
        d = c.get("boot_diff_drift30")
        rs = f"{r['mean']*1e4:+.1f}bp n={r['n']} pos={r['pos']*100:.0f}%" if r else "n=0"
        ps = f"{ph['mean']*1e4:+.1f}bp n={ph['n']}" if ph else "n=0"
        ds = f"diff med={d['med']*1e4:+.1f}bp p2={d['p_two']:.3f}" if d else "diff n/a"
        print(f"  {k:14s} REAL {rs:34s} PHANTOM {ps:20s} {ds}")
    print("\n--- break-rate by approach-speed tercile (fast->break?) ---")
    for k, v in (res.get("breakrate_by_appspeed") or {}).items():
        if v:
            print(f"  {k:5s} n={v['n']} break_rate={v['break_rate']*100:.0f}%")
    print("\n--- PAYOFF: bounce-vs-break logistic ---")
    lg = res["logistic"]
    print(f"  n_train={lg.get('n_train')} n_test={lg.get('n_test')}")
    if "auc_test" in lg:
        print(f"  base_rate(break) train={lg['base_rate_train']:.2f} test={lg['base_rate_test']:.2f}")
        print(f"  AUC train={p(lg['auc_train'])} test={p(lg['auc_test'])} test_CI={lg.get('auc_test_ci')}")
        print(f"  acc_test={lg['acc_test']:.2f} vs majority={lg['majority_baseline']:.2f}")
        print(f"  weights={lg['weights']}")
    print("\n--- OPTION P&L (real, entry at resolution minute) ---")
    op = res.get("option_pnl", {})
    if "error" in op:
        print("  ERROR:", op["error"])
    else:
        for kind, d in op.items():
            r = d.get("real"); rc = d.get("random_control")
            rs = f"n={r['n']} mean={r['mean']*100:+.0f}% med={r['median']*100:+.0f}% hit={r['hit']*100:.0f}%" if r else "n=0"
            if r and "boot_ci" in r:
                rs += f" CI[{r['boot_ci'][0]*100:+.0f}%,{r['boot_ci'][1]*100:+.0f}%] p+={r['boot_p_pos']*100:.0f}%"
            cs = f"n={rc['n']} mean={rc['mean']*100:+.0f}% hit={rc['hit']*100:.0f}%" if rc else "n=0"
            print(f"  {kind:7s} REAL {rs}")
            print(f"          RAND {cs}")
    print("=" * 70)

if __name__ == "__main__":
    main()
