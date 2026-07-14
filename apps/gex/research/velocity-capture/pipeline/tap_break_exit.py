#!/usr/bin/env python3
"""TAP-BREAK-EXIT (1-min). RESEARCH ONLY (Clause 0). No live-code change.

Operator hypothesis: (A) a level weakens with repeated taps (tap-count = information);
(B) a STRUCTURAL BREAK of the position's defining level is the correct exit/abort — the
thesis dies when the level breaks, not when the option mark wiggles.

PART A  — tap mechanics: TAP = spot enters band (strike +/- 0.05% of spot) and exits the
          SAME side (bounce) vs FAR side (break). Sequence per (level,day): 1st/2nd/3rd/4+.
          Buckets: pika-floor, pika-ceiling, barney, KING. MIRROR = phantom 2*S_arm - K.
PART B  — structural-break exit on the probe-entry cohort (+ live fire cohort). Four exits
          head-to-head: (i) trail-only, (ii) mark-abort, (iii) S-only+trail, (iv) S+trail.
          M in {0.05%,0.10%} x C in {1,2}. false-kill / save vs trail-only counterfactual.
          Plus delivered-node take-profit (the "break up -> exit" profit half).

Reuses extreme_probe (ep) + pnl_v0. Emits tap_break_exit_results.json, tap_events.jsonl,
struct_exit_events.jsonl. n ~ 11 day-blocks -> every verdict is a LEAN.
"""
import json, os, statistics, random, sqlite3
from datetime import datetime, timedelta, timezone
import extreme_probe as ep
import pnl_v0

SP = os.path.dirname(os.path.abspath(__file__))
BASE = "/Users/saiyeeshrathish/the final plan/apps/gex"
BACKFILL = os.path.join(BASE, "research/velocity-capture/backfill")
OUT_RESULTS = os.path.join(SP, "tap_break_exit_results.json")
OUT_TAPJSONL = os.path.join(BASE, "research/velocity-capture/tap_events.jsonl")
OUT_STRUCTJSONL = os.path.join(BASE, "research/velocity-capture/struct_exit_events.jsonl")
DB = os.path.join(BASE, "data/gexester.db")
TICKERS = ["SPXW", "SPY", "QQQ"]
random.seed(20260714)

BAND_FRAC = 0.0005          # +/- 0.05% of spot (matches terrain study)
SEP_MIN = 5                 # tap separation: >=5 min outside OR moved >=2*band (lifecycle 6.3)
NODE_NEAR_FRAC = 0.0015     # node within 0.15% of entry-extreme -> also test node-as-level
# Part B structural-break grid
M_SWEEP = [0.0005, 0.0010]  # 0.05% / 0.10% beyond the level
C_SWEEP = [1, 2]            # consecutive minutes
BEST_M, BEST_C = 0.0010, 1  # best cell chosen post-hoc for the viewer JSONL (stated in report)
ARM = 0.50
GB_TIGHT, GB_LOOSE = 0.15, 0.40

net_of = ep.net_of  # (entry, exit) -> net after 3% round-trip haircut


# ============================ PART A : TAP MECHANICS ============================
def tap_episodes(spots, ets, level, start_i, end_i):
    """Contiguous inside-band runs -> tap episodes with same/far-side resolution and
    lifecycle-style separation (>=5 min outside OR moved >=2*band since last tap)."""
    n = len(spots)
    end_i = min(end_i, n - 1)
    # raw inside runs
    runs = []
    i = start_i
    while i <= end_i:
        h = BAND_FRAC * spots[i]
        if abs(spots[i] - level) <= h:
            j = i
            while j + 1 <= end_i and abs(spots[j + 1] - level) <= BAND_FRAC * spots[j + 1]:
                j += 1
            runs.append((i, j))
            i = j + 1
        else:
            i += 1
    if not runs:
        return []
    # merge flicker: a run is a NEW tap only if since prev tap exit >=SEP_MIN min OR
    # spot moved >=2*band away from level between the two runs; else extend prev run.
    merged = [list(runs[0])]
    for (a, b) in runs[1:]:
        pa, pb = merged[-1]
        gap = a - pb
        moved = max(abs(spots[k] - level) for k in range(pb, a + 1)) if a > pb else 0.0
        h = BAND_FRAC * spots[a]
        if gap >= SEP_MIN or moved >= 2 * h:
            merged.append([a, b])
        else:
            merged[-1][1] = b
    # resolve each episode
    eps = []
    for (a, b) in merged:
        # entry side = side spot came from
        if a > start_i:
            entry_side = "above" if spots[a - 1] > level else "below"
        else:
            entry_side = "above" if spots[a] > level else "below"
        # exit side = side spot leaves to (first frame outside after b)
        if b + 1 <= end_i:
            exit_side = "above" if spots[b + 1] > level else "below"
            if exit_side == entry_side:
                res = "bounce"
            else:
                res = "break"
        else:
            res = "other"   # still inside at window end
        eps.append({"entry_i": a, "exit_i": b, "entry_et": ets[a], "entry_side": entry_side,
                    "resolved": res})
    return eps


def broke_within(spots, level, from_i, entry_side, horizon=30):
    """After a bounce, does price break to the FAR side by >=1 band within `horizon` min?"""
    n = len(spots)
    for k in range(from_i, min(n, from_i + horizon + 1)):
        h = BAND_FRAC * spots[k]
        if entry_side == "above" and spots[k] < level - h:
            return True
        if entry_side == "below" and spots[k] > level + h:
            return True
    return False


def classify_node(nd, spot_at_arm):
    if nd["sign"] == "pika":
        return "pika_floor" if nd["strike"] < spot_at_arm else "pika_ceiling"
    return "barney"


def part_a(series, S):
    # per-bucket accumulators: list of (tapno, resolved) ; plus break-within-30 after tap2/3 ; inter-tap gaps
    buckets = ["pika_floor", "pika_ceiling", "barney", "king"]
    real = {b: {"seq": [], "brk30_after2": [], "brk30_after3": [], "gaps": []} for b in buckets}
    phantom = {b: {"seq": []} for b in buckets}
    tap_log = []

    for (date, t) in series:
        d = S[(date, t)]
        spots, ets, uts = d["spots"], d["ets"], d["uts"]
        n = len(spots)
        nodes = d["nodes"]
        kseries = d["king"]

        # ---- levels: strong nodes ----
        levels = []
        for nd in nodes:
            arm_i = nd["arm_i"]
            s_arm = spots[arm_i]
            b = classify_node(nd, s_arm)
            levels.append({"level": nd["strike"], "bucket": b, "arm_i": arm_i, "s_arm": s_arm,
                           "phantom": 2 * s_arm - nd["strike"]})
        # ---- level: KING (dominant strike over the session) ----
        kstrikes = [k["strike"] for k in kseries if k]
        if kstrikes:
            kmode = statistics.mode(kstrikes)
            first_king_i = next(i for i, k in enumerate(kseries) if k and k["strike"] == kmode)
            s_arm = spots[first_king_i]
            levels.append({"level": kmode, "bucket": "king", "arm_i": first_king_i, "s_arm": s_arm,
                           "phantom": 2 * s_arm - kmode})

        for L in levels:
            b = L["bucket"]
            eps = tap_episodes(spots, ets, L["level"], L["arm_i"], n - 1)
            prev_entry_i = None
            for k, ep_ in enumerate(eps, start=1):
                real[b]["seq"].append((k, ep_["resolved"]))
                if prev_entry_i is not None:
                    real[b]["gaps"].append(ep_["entry_i"] - prev_entry_i)
                prev_entry_i = ep_["entry_i"]
                # break-within-30 after a #2/#3 BOUNCE
                if ep_["resolved"] == "bounce":
                    brk = broke_within(spots, L["level"], ep_["exit_i"] + 1, ep_["entry_side"])
                    if k == 2:
                        real[b]["brk30_after2"].append(1 if brk else 0)
                    if k == 3:
                        real[b]["brk30_after3"].append(1 if brk else 0)
                # viewer JSONL: taps on kings + strong nodes, resolved bounce/break only
                if ep_["resolved"] in ("bounce", "break"):
                    tap_log.append({"day": date, "ticker": t, "minute": uts[ep_["entry_i"]],
                                    "strike": round(L["level"], 2), "kind": "tap",
                                    "tapno": k, "resolved": ep_["resolved"], "bucket": b})
            # phantom (mirror) — same detection at reflected fixed level
            peps = tap_episodes(spots, ets, L["phantom"], L["arm_i"], n - 1)
            for k, ep_ in enumerate(peps, start=1):
                phantom[b]["seq"].append((k, ep_["resolved"]))

    # decay curves: P(bounce | tap#k) for k=1,2,3,4+ , real vs phantom
    def decay(seq):
        out = {}
        for kk in (1, 2, 3, 4):
            key = "4plus" if kk == 4 else str(kk)
            sub = [r for (k, r) in seq if (k >= 4 if kk == 4 else k == kk)]
            nn = len(sub)
            nb = sum(1 for r in sub if r == "bounce")
            nbr = sum(1 for r in sub if r == "break")
            out[key] = {"n": nn, "p_bounce": (nb / nn) if nn else None,
                        "p_break": (nbr / nn) if nn else None}
        return out

    curves = {}
    for b in buckets:
        curves[b] = {
            "real": decay(real[b]["seq"]),
            "phantom": decay(phantom[b]["seq"]),
            "n_real_taps": len(real[b]["seq"]),
            "n_phantom_taps": len(phantom[b]["seq"]),
            "median_gap_min": (statistics.median(real[b]["gaps"]) if real[b]["gaps"] else None),
            "p_break30_after_tap2": (statistics.mean(real[b]["brk30_after2"]) if real[b]["brk30_after2"] else None),
            "n_after2": len(real[b]["brk30_after2"]),
            "p_break30_after_tap3": (statistics.mean(real[b]["brk30_after3"]) if real[b]["brk30_after3"] else None),
            "n_after3": len(real[b]["brk30_after3"]),
        }
    # pooled all-nodes (excl king) real vs phantom
    allseq_r = [x for b in ("pika_floor", "pika_ceiling", "barney") for x in real[b]["seq"]]
    allseq_p = [x for b in ("pika_floor", "pika_ceiling", "barney") for x in phantom[b]["seq"]]
    curves["all_nodes"] = {"real": decay(allseq_r), "phantom": decay(allseq_p),
                           "n_real_taps": len(allseq_r), "n_phantom_taps": len(allseq_p)}

    tap_log.sort(key=lambda r: (r["day"], r["ticker"], r["minute"]))
    with open(OUT_TAPJSONL, "w") as f:
        for r in tap_log:
            f.write(json.dumps({k: r[k] for k in ("day", "ticker", "minute", "strike", "kind", "tapno", "resolved")}) + "\n")
    return curves, len(tap_log)


# ============================ PART B : STRUCTURAL EXIT ============================
def sim_trailonly(m, ets_after, entry_et, entry, gb):
    ks = [k for k in ets_after if k >= entry_et and k in m]
    if not ks or entry <= 0:
        return None
    peak = entry; armed = False
    for k in ks:
        c = m[k]["close"]
        if c > peak:
            peak = c
        if not armed and peak >= entry * (1 + ARM):
            armed = True
        if armed and c <= peak * (1 - gb):
            return {"net": net_of(entry, c), "exit_et": k, "reason": "trail"}
    last = ks[-1]
    return {"net": net_of(entry, m[last]["close"]), "exit_et": last, "reason": "EOD"}


def sim_markabort(m, ets_after, entry_et, entry, A, gb):
    """(ii) known-bad: option mark drop A -> abort; else arm/trail."""
    ks = [k for k in ets_after if k >= entry_et and k in m]
    if not ks or entry <= 0:
        return None
    peak = entry; armed = False
    for k in ks:
        c = m[k]["close"]
        if c <= entry * (1 - A):
            return {"net": net_of(entry, c), "exit_et": k, "reason": "mark_abort"}
        if c > peak:
            peak = c
        if not armed and peak >= entry * (1 + ARM):
            armed = True
        if armed and c <= peak * (1 - gb):
            return {"net": net_of(entry, c), "exit_et": k, "reason": "trail"}
    last = ks[-1]
    return {"net": net_of(entry, m[last]["close"]), "exit_et": last, "reason": "EOD"}


def struct_broken(spots_by_et, k, side, level, M, C, consec_state):
    """Return (broken_bool, new_consec). Break = spot beyond level by M for C consec min.
    call thesis (bounce off low L): break = spot <= L*(1-M).  put: spot >= L*(1+M)."""
    sp = spots_by_et.get(k)
    if sp is None:
        return False, 0
    if side == "call":
        beyond = sp <= level * (1 - M)
    else:
        beyond = sp >= level * (1 + M)
    c = consec_state + 1 if beyond else 0
    return (c >= C), c


def sim_struct(m, ets_after, spots_by_et, entry_et, entry, side, level, M, C, gb, keep_S_after_arm):
    """(iii) keep_S_after_arm=False : S is the pre-arm stop; after arm switch to giveback trail.
       (iv) keep_S_after_arm=True  : S active the whole life AND giveback trail after arm."""
    ks = [k for k in ets_after if k >= entry_et and k in m]
    if not ks or entry <= 0:
        return None
    peak = entry; armed = False; consec = 0
    for k in ks:
        c = m[k]["close"]
        # structural break check
        active_S = (not armed) or keep_S_after_arm
        brk, consec = struct_broken(spots_by_et, k, side, level, M, C, consec)
        if active_S and brk:
            return {"net": net_of(entry, c), "exit_et": k, "reason": "struct"}
        if c > peak:
            peak = c
        if not armed and peak >= entry * (1 + ARM):
            armed = True
        if armed and c <= peak * (1 - gb):
            return {"net": net_of(entry, c), "exit_et": k, "reason": "trail"}
    last = ks[-1]
    return {"net": net_of(entry, m[last]["close"]), "exit_et": last, "reason": "EOD"}


def sim_delivered_node_tp(m, ets_after, spots_by_et, entry_et, entry, side, next_node, gb):
    """Profit half: TP when spot breaks THROUGH the next favorable node and re-enters band
    from beyond (delivered). Fallback to trail if that never happens."""
    ks = [k for k in ets_after if k >= entry_et and k in m]
    if not ks or entry <= 0 or next_node is None:
        return None
    L = next_node
    peak = entry; armed = False; broke_through = False
    for k in ks:
        c = m[k]["close"]
        sp = spots_by_et.get(k)
        if sp is not None:
            h = BAND_FRAC * sp
            if side == "call":
                if sp > L + h:
                    broke_through = True
                elif broke_through and abs(sp - L) <= h:   # re-entered band from above
                    return {"net": net_of(entry, c), "exit_et": k, "reason": "delivered_tp"}
            else:
                if sp < L - h:
                    broke_through = True
                elif broke_through and abs(sp - L) <= h:
                    return {"net": net_of(entry, c), "exit_et": k, "reason": "delivered_tp"}
        if c > peak:
            peak = c
        if not armed and peak >= entry * (1 + ARM):
            armed = True
        if armed and c <= peak * (1 - gb):
            return {"net": net_of(entry, c), "exit_et": k, "reason": "trail"}
    last = ks[-1]
    return {"net": net_of(entry, m[last]["close"]), "exit_et": last, "reason": "EOD"}


def stat_block(nets, byday):
    if not nets:
        return {"n": 0}
    return {"n": len(nets), "expectancy": statistics.mean(nets),
            "median": statistics.median(nets),
            "hit": sum(1 for x in nets if x > 0) / len(nets),
            "boot": ep.dayblock_boot(byday)}


def build_probe_entries(series, S):
    entries = []
    for (date, t) in series:
        d = S[(date, t)]
        spots, ets, uts = d["spots"], d["ets"], d["uts"]
        spots_by_et = {ets[i]: spots[i] for i in range(len(ets))}
        nodes = d["nodes"]
        for side in ("call", "put"):
            probs = ep.apply_cooldown(ep.detect_probes(spots, ets, side))
            for p in probs:
                ei = p["entry_i"]
                entry_et = ets[ei]
                spot = spots[ei]
                extreme = p["extreme"]
                cp = "C" if side == "call" else "P"
                strike = pnl_v0.atm_strike(t, spot)
                occ = pnl_v0.occ_of(t, date, strike, cp)
                m = pnl_v0.fetch(occ, date)
                entry_price = pnl_v0.price_at(m, entry_et, "close") if m else None
                # node/King within 0.15% of entry extreme -> alt defining level
                alt_level = None
                cand = [nd for nd in nodes if nd["arm_i"] <= ei
                        and abs(nd["strike"] - extreme) / extreme <= NODE_NEAR_FRAC]
                if cand:
                    alt_level = min(cand, key=lambda x: abs(x["strike"] - extreme))["strike"]
                # next favorable node for delivered-TP (above for call, below for put)
                armed_nodes = [nd["strike"] for nd in nodes if nd["arm_i"] <= ei]
                if side == "call":
                    fav = [s for s in armed_nodes if s > spot]
                    next_node = min(fav) if fav else None
                else:
                    fav = [s for s in armed_nodes if s < spot]
                    next_node = max(fav) if fav else None
                entries.append({"date": date, "ticker": t, "side": side, "entry_i": ei,
                                "entry_et": entry_et, "uts": uts[ei], "extreme": extreme,
                                "alt_level": alt_level, "next_node": next_node,
                                "m": m, "entry_price": entry_price,
                                "ets_after": [ets[j] for j in range(ei, len(ets))],
                                "spots_by_et": spots_by_et})
    return entries


def eval_probe_cohort(entries, days):
    """Run all exits; return per-exit stats + false-kill/save + walk-forward + delivered TP."""
    priced = [e for e in entries if e["m"] and e["entry_price"] and e["entry_price"] > 0]
    half = days[:(len(days) + 1) // 2]
    wf1, wf2 = set(half), set(days) - set(half)

    def run_exit(fn):
        nets = []; byday = {}; per = {}
        wfa = {"h1": [], "h2": []}
        for e in priced:
            r = fn(e)
            if not r:
                continue
            nets.append(r["net"]); byday.setdefault(e["date"], []).append(r["net"])
            per[id(e)] = r
            (wfa["h1"] if e["date"] in wf1 else wfa["h2"]).append(r["net"])
        blk = stat_block(nets, byday)
        blk["wf1_expect"] = statistics.mean(wfa["h1"]) if wfa["h1"] else None
        blk["wf2_expect"] = statistics.mean(wfa["h2"]) if wfa["h2"] else None
        blk["haircut3_expect"] = (statistics.mean(nets) - 0.03) if nets else None  # extra 3% stress
        return blk, per

    exits = {}
    # (i) trail-only (current best) tight + loose
    exits["i_trail_15"], trail_per = run_exit(
        lambda e: sim_trailonly(e["m"], e["ets_after"], e["entry_et"], e["entry_price"], GB_TIGHT))
    exits["i_trail_40"], _ = run_exit(
        lambda e: sim_trailonly(e["m"], e["ets_after"], e["entry_et"], e["entry_price"], GB_LOOSE))
    # (ii) mark-abort (known bad) A=.15 gb=.40
    exits["ii_markabort_15_40"], _ = run_exit(
        lambda e: sim_markabort(e["m"], e["ets_after"], e["entry_et"], e["entry_price"], 0.15, GB_LOOSE))

    # (iii)+(iv) structural grid over M,C, using entry-extreme level and node-alt level
    for M in M_SWEEP:
        for C in C_SWEEP:
            tag = f"M{int(M*10000)}_C{C}"
            exits[f"iii_S_ext_{tag}"], per_iii = run_exit(
                lambda e, M=M, C=C: sim_struct(e["m"], e["ets_after"], e["spots_by_et"], e["entry_et"],
                                               e["entry_price"], e["side"], e["extreme"], M, C, GB_TIGHT, False))
            exits[f"iv_S_ext_{tag}"], _ = run_exit(
                lambda e, M=M, C=C: sim_struct(e["m"], e["ets_after"], e["spots_by_et"], e["entry_et"],
                                               e["entry_price"], e["side"], e["extreme"], M, C, GB_TIGHT, True))
            # false-kill / save vs trail-only (i_trail_15) for the S-only variant
            trig = 0; save = 0; falsekill = 0; ntot = 0; delta = []
            for e in priced:
                ntot += 1
                rs = sim_struct(e["m"], e["ets_after"], e["spots_by_et"], e["entry_et"],
                                e["entry_price"], e["side"], e["extreme"], M, C, GB_TIGHT, False)
                rt = trail_per.get(id(e))
                if not rs or not rt:
                    continue
                if rs["reason"] == "struct":
                    trig += 1
                    delta.append(rs["net"] - rt["net"])
                    if rs["net"] > rt["net"]:
                        save += 1
                    if rt["net"] > 0 and rs["net"] < rt["net"]:
                        falsekill += 1
            exits[f"iii_S_ext_{tag}"]["trigger_rate"] = trig / ntot if ntot else None
            exits[f"iii_S_ext_{tag}"]["n_trigger"] = trig
            exits[f"iii_S_ext_{tag}"]["save_rate"] = save / trig if trig else None
            exits[f"iii_S_ext_{tag}"]["falsekill_rate"] = falsekill / trig if trig else None
            exits[f"iii_S_ext_{tag}"]["mean_delta_vs_trail_on_trigger"] = statistics.mean(delta) if delta else None

    # node-as-level variant (only entries with alt_level), best M/C
    node_entries = [e for e in priced if e["alt_level"] is not None]
    nn = []; nbyday = {}
    for e in node_entries:
        r = sim_struct(e["m"], e["ets_after"], e["spots_by_et"], e["entry_et"], e["entry_price"],
                       e["side"], e["alt_level"], BEST_M, BEST_C, GB_TIGHT, False)
        if r:
            nn.append(r["net"]); nbyday.setdefault(e["date"], []).append(r["net"])
    exits["iii_S_node_best"] = stat_block(nn, nbyday)
    exits["iii_S_node_best"]["n_entries_with_node"] = len(node_entries)

    # delivered-node take-profit vs trail-only, on entries that HAVE a next node
    dn_entries = [e for e in priced if e["next_node"] is not None]
    dtp = []; dbyday = {}; trl = []
    for e in dn_entries:
        rd = sim_delivered_node_tp(e["m"], e["ets_after"], e["spots_by_et"], e["entry_et"],
                                   e["entry_price"], e["side"], e["next_node"], GB_TIGHT)
        rt = trail_per.get(id(e))
        if rd:
            dtp.append(rd["net"]); dbyday.setdefault(e["date"], []).append(rd["net"])
        if rt:
            trl.append(rt["net"])
    exits["delivered_node_tp"] = stat_block(dtp, dbyday)
    exits["delivered_node_tp"]["trail_only_same_entries_expect"] = statistics.mean(trl) if trl else None
    exits["delivered_node_tp"]["n_entries_with_node"] = len(dn_entries)

    # ---- call/put splits for the key exits (prior study: edge was call-side) ----
    def split_exit(fn):
        out = {}
        for sd in ("call", "put"):
            nets = []; byday = {}
            for e in priced:
                if e["side"] != sd:
                    continue
                r = fn(e)
                if r:
                    nets.append(r["net"]); byday.setdefault(e["date"], []).append(r["net"])
            out[sd] = stat_block(nets, byday)
        return out
    splits = {
        "i_trail_15": split_exit(lambda e: sim_trailonly(e["m"], e["ets_after"], e["entry_et"], e["entry_price"], GB_TIGHT)),
        "ii_markabort_15_40": split_exit(lambda e: sim_markabort(e["m"], e["ets_after"], e["entry_et"], e["entry_price"], 0.15, GB_LOOSE)),
        "iii_S_ext_M5_C1": split_exit(lambda e: sim_struct(e["m"], e["ets_after"], e["spots_by_et"], e["entry_et"],
                                                           e["entry_price"], e["side"], e["extreme"], 0.0005, 1, GB_TIGHT, False)),
        "delivered_node_tp": split_exit(lambda e: sim_delivered_node_tp(e["m"], e["ets_after"], e["spots_by_et"], e["entry_et"],
                                                                        e["entry_price"], e["side"], e["next_node"], GB_TIGHT) if e["next_node"] else None),
    }

    # viewer JSONL: probe cohort scored under BEST S cell (iii)
    struct_log = []
    for e in priced:
        r = sim_struct(e["m"], e["ets_after"], e["spots_by_et"], e["entry_et"], e["entry_price"],
                       e["side"], e["extreme"], BEST_M, BEST_C, GB_TIGHT, False)
        if not r:
            continue
        outcome = "struct_exit" if r["reason"] == "struct" else ("win" if r["reason"] == "trail" else "eod")
        struct_log.append({"day": e["date"], "ticker": e["ticker"], "minute": e["uts"],
                           "strike": round(e["extreme"], 2), "kind": "probe",
                           "implied": "up" if e["side"] == "call" else "down",
                           "exit_minute": ep.et_to_utc(r["exit_et"]),
                           "outcome": outcome, "pnl_pct": round(r["net"] * 100, 1)})
    struct_log.sort(key=lambda r: (r["day"], r["ticker"], r["minute"], r["implied"]))
    with open(OUT_STRUCTJSONL, "w") as f:
        for r in struct_log:
            f.write(json.dumps(r) + "\n")

    return {"n_priced": len(priced), "exits": exits, "splits": splits, "n_struct_logged": len(struct_log)}


# ---- live fire cohort (second population) ----
def eval_fire_cohort(series, S, days):
    con = sqlite3.connect(DB); con.row_factory = sqlite3.Row
    rows = con.execute(
        "SELECT trading_day, ticker, fire_ts_ms, option_type, strike, spot_at_fire "
        "FROM tracked_plays WHERE trading_day >= '2026-07-01'").fetchall()
    con.close()
    Smap = {(d, t): S[(d, t)] for (d, t) in series}
    exits = {"i_trail_15": {"nets": [], "byday": {}},
             "ii_markabort": {"nets": [], "byday": {}},
             "iii_S_best": {"nets": [], "byday": {}}}
    n_eval = 0
    trig = 0; save = 0; falsekill = 0
    for r in rows:
        date, t = r["trading_day"], r["ticker"]
        if (date, t) not in Smap:
            continue
        d = Smap[(date, t)]
        spots, ets = d["spots"], d["ets"]
        spots_by_et = {ets[i]: spots[i] for i in range(len(ets))}
        e = datetime.fromtimestamp(r["fire_ts_ms"] / 1000, tz=timezone.utc) - timedelta(hours=4)
        fire_et = e.strftime("%H:%M")
        if fire_et not in ets:
            continue
        ei = ets.index(fire_et)
        side = "call" if r["option_type"] == "call" else "put"
        cp = "C" if side == "call" else "P"
        strike = r["strike"] if r["strike"] else pnl_v0.atm_strike(t, r["spot_at_fire"])
        occ = pnl_v0.occ_of(t, date, int(strike), cp)
        m = pnl_v0.fetch(occ, date)
        entry = pnl_v0.price_at(m, fire_et, "close") if m else None
        if not m or not entry or entry <= 0:
            continue
        ets_after = [ets[j] for j in range(ei, len(ets))]
        spot = spots[ei]
        # defining level for a fire = nearest strong node on the STOP side (floor for call, ceiling for put); fallback spot
        nodes = d["nodes"]
        armed = [nd["strike"] for nd in nodes if nd["arm_i"] <= ei]
        if side == "call":
            below = [s for s in armed if s < spot]
            level = max(below) if below else spot
        else:
            above = [s for s in armed if s > spot]
            level = min(above) if above else spot
        n_eval += 1
        rt = sim_trailonly(m, ets_after, fire_et, entry, GB_TIGHT)
        rm = sim_markabort(m, ets_after, fire_et, entry, 0.15, GB_LOOSE)
        rs = sim_struct(m, ets_after, spots_by_et, fire_et, entry, side, level, BEST_M, BEST_C, GB_TIGHT, False)
        for tag, rr in (("i_trail_15", rt), ("ii_markabort", rm), ("iii_S_best", rs)):
            if rr:
                exits[tag]["nets"].append(rr["net"]); exits[tag]["byday"].setdefault(date, []).append(rr["net"])
        if rs and rt and rs["reason"] == "struct":
            trig += 1
            if rs["net"] > rt["net"]:
                save += 1
            if rt["net"] > 0 and rs["net"] < rt["net"]:
                falsekill += 1
    out = {"n_eval": n_eval, "n_trigger": trig,
           "save_rate": save / trig if trig else None,
           "falsekill_rate": falsekill / trig if trig else None}
    for tag in exits:
        out[tag] = stat_block(exits[tag]["nets"], exits[tag]["byday"])
    return out


# ================================ MAIN ================================
def main():
    series = ep.complete_series()
    days = sorted(set(d for d, _ in series))
    S = {}
    for (date, t) in series:
        fr = ep.load(os.path.join(BACKFILL, date, f"{t}.jsonl.gz"))
        spots = [x["spot"] for x in fr]
        ets = [ep.et(x["requestedTs"]) for x in fr]
        uts = [ep.utc_hhmm(x["requestedTs"]) for x in fr]
        S[(date, t)] = {"fr": fr, "spots": spots, "ets": ets, "uts": uts,
                        "nodes": ep.find_nodes(fr), "king": ep.king_series(fr)}

    curves, n_tap = part_a(series, S)
    probe_entries = build_probe_entries(series, S)
    partB = eval_probe_cohort(probe_entries, days)
    fires = eval_fire_cohort(series, S, days)

    res = {"days": days, "n_series": len(series), "n_tap_events": n_tap,
           "partA_curves": curves, "partB": partB, "fire_cohort": fires,
           "cfg": {"BAND_FRAC": BAND_FRAC, "SEP_MIN": SEP_MIN, "M_SWEEP": M_SWEEP,
                   "C_SWEEP": C_SWEEP, "BEST_M": BEST_M, "BEST_C": BEST_C,
                   "GB_TIGHT": GB_TIGHT, "GB_LOOSE": GB_LOOSE, "NODE_NEAR_FRAC": NODE_NEAR_FRAC}}
    json.dump(res, open(OUT_RESULTS, "w"), indent=1, default=str)
    digest(res)
    return res


def pct(x, p=0):
    return "  n/a" if x is None else f"{x*100:+.{p}f}%"


def digest(res):
    print("=" * 80)
    print("TAP-BREAK-EXIT 1-MIN  days=%d series=%d  taps=%d" % (len(res["days"]), res["n_series"], res["n_tap_events"]))
    print("days:", res["days"])
    print("\n--- PART A: P(bounce | tap#)  REAL vs PHANTOM ---")
    print("bucket        nReal  1st          2nd          3rd          4+           medGap  brk30@2  brk30@3")
    for b in ("pika_floor", "pika_ceiling", "barney", "king", "all_nodes"):
        c = res["partA_curves"][b]
        r = c["real"]
        def cell(k):
            d = r[k]
            return f"{(d['p_bounce']*100 if d['p_bounce'] is not None else 0):3.0f}%(n{d['n']})"
        mg = c.get("median_gap_min"); b2 = c.get("p_break30_after_tap2"); b3 = c.get("p_break30_after_tap3")
        print(f"{b:13s} {c['n_real_taps']:5d}  {cell('1'):11s}  {cell('2'):11s}  {cell('3'):11s}  {cell('4plus'):11s}  "
              f"{('%.0f'%mg) if mg is not None else 'n/a':>5s}  "
              f"{(('%.0f%%(n%d)'%(b2*100,c['n_after2'])) if b2 is not None else 'n/a'):>8s}  "
              f"{(('%.0f%%(n%d)'%(b3*100,c['n_after3'])) if b3 is not None else 'n/a'):>8s}")
        p = c["phantom"]
        def pcell(k):
            d = p[k]
            return f"{(d['p_bounce']*100 if d['p_bounce'] is not None else 0):3.0f}%(n{d['n']})"
        print(f"{'  PHANTOM':13s} {c['n_phantom_taps']:5d}  {pcell('1'):11s}  {pcell('2'):11s}  {pcell('3'):11s}  {pcell('4plus'):11s}")
    print("\n--- PART B: probe cohort  n_priced=%d ---" % res["partB"]["n_priced"])
    print("exit                    n    expect   median   hit   boot90CI            wf1     wf2   -3%stress")
    ex = res["partB"]["exits"]
    for k in sorted(ex.keys()):
        c = ex[k]
        if "expectancy" not in c:
            continue
        bt = c.get("boot") or {}
        print(f"{k:22s} {c['n']:4d}  {pct(c['expectancy']):7s} {pct(c.get('median')):7s} "
              f"{(c['hit']*100 if c.get('hit') else 0):3.0f}%  "
              f"[{pct(bt.get('lo')):>6s},{pct(bt.get('hi')):>6s}] p+{(bt.get('p_pos',0)*100):3.0f}%  "
              f"{pct(c.get('wf1_expect')):6s} {pct(c.get('wf2_expect')):6s} {pct(c.get('haircut3_expect')):6s}")
    print("\n--- Part B: S-exit trigger/false-kill/save (vs trail-only .15) ---")
    for k in sorted(ex.keys()):
        if not k.startswith("iii_S_ext"):
            continue
        c = ex[k]
        print(f"  {k:22s} trig={c.get('n_trigger')}/{res['partB']['n_priced']} "
              f"({pct2(c.get('trigger_rate'))}) save={pct2(c.get('save_rate'))} "
              f"falsekill={pct2(c.get('falsekill_rate'))} meanDelta={pct(c.get('mean_delta_vs_trail_on_trigger'))}")
    dt = ex["delivered_node_tp"]
    print(f"\n  delivered_node_tp: n={dt.get('n')} expect={pct(dt.get('expectancy'))} "
          f"vs trail-only same entries={pct(dt.get('trail_only_same_entries_expect'))}")
    nb = ex["iii_S_node_best"]
    print(f"  S-node-as-level (best M/C): n={nb.get('n')} expect={pct(nb.get('expectancy'))}")
    print("\n--- Part B: CALL/PUT splits ---")
    for k, sp in res["partB"]["splits"].items():
        for sd in ("call", "put"):
            c = sp[sd]
            bt = c.get("boot") or {}
            print(f"  {k:20s} {sd:4s} n={c.get('n')} expect={pct(c.get('expectancy'))} "
                  f"median={pct(c.get('median'))} hit={(c.get('hit',0)*100 if c.get('hit') else 0):.0f}% "
                  f"boot=[{pct(bt.get('lo'))},{pct(bt.get('hi'))}] p+{(bt.get('p_pos',0)*100):.0f}%")
    print("\n--- FIRE cohort (2nd population; heavily 07-08) ---")
    fc = res["fire_cohort"]
    print(f"  n_eval={fc['n_eval']} trig={fc['n_trigger']} save={pct2(fc.get('save_rate'))} falsekill={pct2(fc.get('falsekill_rate'))}")
    for tag in ("i_trail_15", "ii_markabort", "iii_S_best"):
        c = fc[tag]
        print(f"  {tag:14s} n={c.get('n')} expect={pct(c.get('expectancy'))} median={pct(c.get('median'))}")
    print("=" * 80)


def pct2(x):
    return "n/a" if x is None else f"{x*100:.0f}%"


if __name__ == "__main__":
    main()
