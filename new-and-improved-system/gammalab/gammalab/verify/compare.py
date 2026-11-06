"""Replay archive vs Skylit API, per the pre-registration in reports/DESIGN_replay_vs_api.md.

    python -m gammalab.verify.compare
"""
from __future__ import annotations

import json
import statistics as st
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np

from ..adapters.skylit_replay import DATA, norm_expiry
from ..runlog import ROOT, Run

API = ROOT.parent / ".cache" / "skylit_verify"
SYMS = ("SPXW", "SPY", "QQQ")


def board_api(s):
    exps = [norm_expiry(e) for e in s["expirations"]]
    return {"spot": s["spot"], "exps": exps, "grid": {float(k["strike"]): [float(v or 0) for v in row]
                                                      for k, row in zip(s["strikes"], s["matrix"])}}


def board_replay(t):
    exps = [norm_expiry(e) for e in t["expirations"]]
    return {"spot": t["spotPrice"], "exps": exps,
            "grid": {float(k): [float(v or 0) for v in row] for k, row in zip(t["strikes"], t["gammaValues"])}}


def corr(a, b):
    a, b = np.asarray(a), np.asarray(b)
    if a.std() == 0 or b.std() == 0:
        return float("nan")
    return float(np.corrcoef(a, b)[0, 1])


def king(ks, vals):
    i = int(np.argmax(np.abs(vals)))
    return (ks[i], float(np.sign(vals[i])))


def compare(api, rep, day):
    out = {"spot_rel": abs(api["spot"] - rep["spot"]) / rep["spot"], "front_ok": api["exps"][:1] == [day] == rep["exps"][:1]}
    common_exps = [e for e in api["exps"] if e in rep["exps"]]
    ks = sorted(set(api["grid"]) & set(rep["grid"]))
    out.update(n_strikes_api=len(api["grid"]), n_strikes_rep=len(rep["grid"]), n_common=len(ks), common_exps=len(common_exps))
    if not ks or day not in common_exps:
        return {**out, "verdict": "DIFFER"}
    ja, jr = api["exps"].index(day), rep["exps"].index(day)
    fa = [api["grid"][k][ja] for k in ks]; fr = [rep["grid"][k][jr] for k in ks]
    sa = [sum(api["grid"][k][api["exps"].index(e)] for e in common_exps) for k in ks]
    sr = [sum(rep["grid"][k][rep["exps"].index(e)] for e in common_exps) for k in ks]
    big = [i for i, v in enumerate(sr) if abs(v) >= 0.01 * max(map(abs, sr))]
    out.update(r_front=corr(fa, fr), r_sum=corr(sa, sr), king_front=king(ks, fa) == king(ks, fr), king_sum=king(ks, sa) == king(ks, sr),
               king_front_api=king(ks, fa), king_front_rep=king(ks, fr),
               mrae=float(np.median([abs(sa[i] - sr[i]) / abs(sr[i]) for i in big])) if big else None)
    if out["front_ok"] and out["spot_rel"] <= 2e-4 and out["r_front"] >= 0.999 and out["r_sum"] >= 0.999 and out["king_front"] and out["king_sum"]:
        out["verdict"] = "MATCH"
    elif out["front_ok"] and out["r_front"] >= 0.98 and out["king_front"]:
        out["verdict"] = "CLOSE"
    else:
        out["verdict"] = "DIFFER"
    return out


def frames_by_ts(path):
    return {f["timestamp"][:16]: f for f in json.loads(path.read_text())["frames"]}


def main():
    sample = json.loads((ROOT / "reports" / "replay_vs_api_sample.json").read_text())
    api_files = [API / f"{r['at'].replace(':', '')}.json" for r in sample]
    days = sorted({r["day"] for r in sample})
    rep_files = [DATA / f"gex-replay-{d}.json" for d in days]
    with Run("replay_vs_api", inputs=api_files + rep_files + [ROOT / "reports" / "replay_vs_api_sample.json"]) as run:
        rows, align, backup = [], [], []
        cache = {}
        for r, af in zip(sample, api_files):
            j = json.loads(af.read_text())
            d = r["day"]
            if d not in cache:
                cache[d] = frames_by_ts(DATA / f"gex-replay-{d}.json")
                bp = Path(str(DATA / f"gex-replay-{d}.json") + ".spxw-backup")
                cache[d + "b"] = frames_by_ts(bp) if bp.exists() else {}
            T = datetime.strptime(r["at"], "%Y-%m-%dT%H:%M:%SZ")
            key = lambda dt: dt.strftime("%Y-%m-%dT%H:%M")
            for s in j["data"]["symbols"]:
                a = board_api(s)
                fr = cache[d].get(key(T))
                rec = {"day": d, "et": r["et"], "symbol": s["symbol"], "asOf": s["asOf"], "resolution": j["meta"].get("resolution")}
                if fr is None or not fr["tickers"].get(s["symbol"]):
                    rows.append({**rec, "verdict": "DIFFER", "note": "no replay frame"}); continue
                rows.append({**rec, **compare(a, board_replay(fr["tickers"][s["symbol"]]), d)})
                al = {}
                for m in (-1, 0, 1):
                    f2 = cache[d].get(key(T + timedelta(minutes=m)))
                    if f2 and f2["tickers"].get(s["symbol"]):
                        al[m] = compare(a, board_replay(f2["tickers"][s["symbol"]]), d).get("r_sum")
                align.append({**rec, "r_sum_by_offset": al})
                if s["symbol"] == "SPXW" and cache[d + "b"].get(key(T)):
                    bf = cache[d + "b"][key(T)]
                    bt = bf["tickers"].get("SPXW") if "tickers" in bf else bf   # backup files are single-symbol SPXW frames
                    if bt:
                        backup.append({**rec, "vs_main": rows[-1]["verdict"], **{f"backup_{k}": v for k, v in compare(a, board_replay(bt), d).items()}})
        out = ROOT / "reports" / "replay_vs_api.json"
        out.write_text(json.dumps({"rows": rows, "alignment": align, "backup": backup}, indent=1, default=str))
        run.output(out)
        n = len(rows); cnt = {v: sum(x["verdict"] == v for x in rows) for v in ("MATCH", "CLOSE", "DIFFER")}
        lines = ["# Replay archive vs Skylit API — result", "",
                 "Pre-registration: `reports/DESIGN_replay_vs_api.md` (committed before the pull). Run: `python -m gammalab.verify.compare`; "
                 "ledger line `replay_vs_api` in `runs/LEDGER.jsonl`. Raw API responses: `.cache/skylit_verify/` (30 calls, 150 credits).", "",
                 f"**Verdicts ({n} symbol-instants):** MATCH {cnt['MATCH']}, CLOSE {cnt['CLOSE']}, DIFFER {cnt['DIFFER']} "
                 f"({cnt['MATCH'] / n:.0%} MATCH; decision threshold 90%).", "",
                 "| Symbol | MATCH | CLOSE | DIFFER | median spot_rel | median r_front | median r_sum | King front agree | King sum agree |",
                 "|---|---|---|---|---|---|---|---|---|"]
        for sy in SYMS:
            xs = [x for x in rows if x["symbol"] == sy and "r_sum" in x]
            allx = [x for x in rows if x["symbol"] == sy]
            med = lambda k: f"{st.median([x[k] for x in xs if x.get(k) == x.get(k)]):.6g}" if xs else "—"
            lines.append(f"| {sy} | {sum(x['verdict']=='MATCH' for x in allx)} | {sum(x['verdict']=='CLOSE' for x in allx)} | "
                         f"{sum(x['verdict']=='DIFFER' for x in allx)} | {med('spot_rel')} | {med('r_front')} | {med('r_sum')} | "
                         f"{sum(x['king_front'] for x in xs)}/{len(xs)} | {sum(x['king_sum'] for x in xs)}/{len(xs)} |")
        best = {}
        for a in align:
            if a["r_sum_by_offset"]:
                m = max(a["r_sum_by_offset"], key=lambda k: (a["r_sum_by_offset"][k] if a["r_sum_by_offset"][k] == a["r_sum_by_offset"][k] else -9))
                best[m] = best.get(m, 0) + 1
        lines += ["", f"**Alignment (descriptive):** replay minute offset that best fits the API board (by r_sum): "
                  + ", ".join(f"{k:+d} min: {v}" for k, v in sorted(best.items())), ""]
        if backup:
            lines += [f"**SPXW backup files (descriptive):** {len(backup)} instants on backup days. API vs main file: "
                      + ", ".join(f"{v} {sum(b['vs_main']==v for b in backup)}" for v in ("MATCH", "CLOSE", "DIFFER"))
                      + "; API vs `.spxw-backup`: "
                      + ", ".join(f"{v} {sum(b['backup_verdict']==v for b in backup)}" for v in ("MATCH", "CLOSE", "DIFFER")), ""]
        scraped = {d: json.loads((DATA / f"gex-replay-{d}.json").read_text())["metadata"].get("scrapedAt", "?")[:10] for d in days}
        lines += ["**By replay scrape date (descriptive):**", "", "| Day | scrapedAt | MATCH | CLOSE | DIFFER | median r_front |", "|---|---|---|---|---|---|"]
        for d in days:
            xs = [x for x in rows if x["day"] == d]
            rf = [x["r_front"] for x in xs if isinstance(x.get("r_front"), float)]
            lines.append(f"| {d} | {scraped[d]} | " + " | ".join(str(sum(x["verdict"] == v for x in xs)) for v in ("MATCH", "CLOSE", "DIFFER"))
                         + f" | {st.median(rf):.3f} |")
        lines.append("")
        dif = [x for x in rows if x["verdict"] != "MATCH"]
        if dif:
            lines += ["Non-MATCH cells:", "", "| Day | ET | Symbol | Verdict | spot_rel | r_front | r_sum | King front API / replay | strikes API/replay/common |", "|---|---|---|---|---|---|---|---|---|"]
            for x in dif:
                f = lambda k: f"{x[k]:.4g}" if isinstance(x.get(k), float) else str(x.get(k, "—"))
                lines.append(f"| {x['day']} | {x['et']} | {x['symbol']} | {x['verdict']} | {f('spot_rel')} | {f('r_front')} | {f('r_sum')} | "
                             f"{x.get('king_front_api', '—')} / {x.get('king_front_rep', '—')} | {x.get('n_strikes_api','—')}/{x.get('n_strikes_rep','—')}/{x.get('n_common','—')} |")
        md = ROOT / "reports" / "REPLAY_VS_API.md"
        md.write_text("\n".join(lines) + "\n")
        run.output(md)
    print("\n".join(lines))


if __name__ == "__main__":
    main()
