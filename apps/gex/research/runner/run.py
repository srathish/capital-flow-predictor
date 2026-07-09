#!/usr/bin/env python3
"""Research runner — one command to generate + test hypotheses and produce
reports. Research-only, safe by design (see safety.py).

Usage:
  uv run --with numpy,pandas,pyarrow python research/runner/run.py
  ... --families structural,temporal   # restrict generated studies
  ... --seed 123 --placebo 800         # reproducibility / rigor knobs
  ... --date 2026-07-09                # ledger stamp (default: today)

Outputs (all under research/runner/outputs/, nothing else touched):
  ledger.jsonl        append-only machine ledger (one row per study per run)
  LEDGER.md           human ledger, newest run on top
  REPORT.md           summary: rejected / promising / forward-watchlist
  RECOMMENDATIONS.md  written live-code recommendations — REQUIRE USER APPROVAL

The runner NEVER commits, deploys, restarts, changes live code, flips flags,
or makes trading decisions. It only reads data and writes the files above.
"""
import argparse
import json
import os
from datetime import datetime, timezone

import numpy as np

from safety import SAFETY_BANNER, safe_write, RESEARCH_ROOT
from harness import load_fires, REJECTED, PROMISING, FORWARD_WATCHLIST, NOT_TESTABLE
from hypotheses import generate, PENDING_DOCTRINE_STUDIES

OUT = 'runner/outputs'


def _jsonable(o):
    """Coerce numpy scalars/arrays to native types for JSON."""
    if isinstance(o, dict):
        return {k: _jsonable(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_jsonable(v) for v in o]
    if isinstance(o, np.integer):
        return int(o)
    if isinstance(o, np.floating):
        return None if np.isnan(o) else float(o)
    if isinstance(o, np.bool_):
        return bool(o)
    if isinstance(o, float) and np.isnan(o):
        return None
    return o


def forward_ingest():
    """Read-only summary of live forward-validation state (R1)."""
    obs_dir = os.path.join(RESEARCH_ROOT, 'uw/outputs/live_observations')
    info = {'live_obs_today': None, 'live_obs_total': None}
    today = os.path.join(obs_dir, 'live_fire_observations_all.csv')
    if os.path.exists(today):
        with open(today) as f:
            n = sum(1 for _ in f) - 1
        info['live_obs_total'] = max(0, n)
    return info


def run(args):
    print(SAFETY_BANNER)
    rng = np.random.default_rng(args.seed)
    stamp = args.date or datetime.now(timezone.utc).strftime('%Y-%m-%d')
    families = args.families.split(',') if args.families else None

    fs = load_fires()
    print(f"\nloaded {len(fs)} final-system fires (read-only)")
    fwd = forward_ingest()
    print(f"forward-validation: {fwd['live_obs_total']} live observations logged\n")

    results = generate(fs, rng, only_families=families)
    # sort: promising first, then watchlist, then rejected, then not_testable
    order = {PROMISING: 0, FORWARD_WATCHLIST: 1, REJECTED: 2, NOT_TESTABLE: 3}
    results.sort(key=lambda r: (order.get(r.get('verdict'), 9), -abs(r.get('gap', 0) or 0)))

    buckets = {PROMISING: [], FORWARD_WATCHLIST: [], REJECTED: [], NOT_TESTABLE: []}
    for r in results:
        buckets.get(r.get('verdict'), buckets[NOT_TESTABLE]).append(r)

    # ---- append machine ledger (never rewrites history) ----
    for r in results:
        row = dict(run_date=stamp, seed=args.seed, **r)
        safe_write(f'{OUT}/ledger.jsonl', json.dumps(_jsonable(row)) + '\n', append=True)

    _render_report(stamp, fs, fwd, buckets, args)
    _render_ledger_md(stamp, results)
    _render_recommendations(stamp, buckets[PROMISING])

    print(f"RESULTS  promising={len(buckets[PROMISING])}  "
          f"forward_watchlist={len(buckets[FORWARD_WATCHLIST])}  "
          f"rejected={len(buckets[REJECTED])}  not_testable={len(buckets[NOT_TESTABLE])}")
    for r in buckets[PROMISING]:
        print(f"  ★ PROMISING: {r['feature']} ({r['family']}) gap {r['gap']:+}pp "
              f"placebo {r['placebo_pooled']:.0f}/{r['placebo_odd']:.0f}/{r['placebo_even']:.0f}")
    for r in buckets[FORWARD_WATCHLIST]:
        print(f"  ◦ watch: {r['feature']} ({r['family']}) gap {r['gap']:+}pp placebo {r['placebo_pooled']:.0f}")
    print(f"\nwrote: {OUT}/REPORT.md · LEDGER.md · ledger.jsonl"
          + (f" · RECOMMENDATIONS.md ({len(buckets[PROMISING])})" if buckets[PROMISING] else ""))
    print("No live code touched. Recommendations (if any) await your approval.")


def _fmt(r):
    if r.get('verdict') == NOT_TESTABLE:
        return f"| `{r['feature']}` | {r.get('family','?')} | not_testable | {r.get('reason','')} |"
    return (f"| `{r['feature']}` | {r['family']} | n={r['n']} (key {r['n_key']}) | "
            f"{r['gap']:+}pp | {r['cuts_ok']}/4 | {r.get('tickers_consistent','?')}/3 | "
            f"{r['placebo_pooled']:.0f} ({r['placebo_odd']:.0f}/{r['placebo_even']:.0f}) | "
            f"{r['incremental'] if r['incremental'] is not None else '—'} |")


def _render_report(stamp, fs, fwd, buckets, args):
    L = [f"# Research Runner — Summary Report", "",
         f"**Run:** {stamp} · seed {args.seed} · {len(fs)} final-system fires · "
         f"{fwd['live_obs_total']} live observations logged",
         "",
         "Auto-generated by `research/runner/run.py`. Research-only; no live "
         "code, flags, or trading behavior was touched. Bars: gap ≥10pp, all "
         "4 stability cuts, pooled placebo ≥95th + split-half ≥80th, "
         "incremental over gate+nflags, n≥30.", ""]
    L += [f"## ★ Promising ({len(buckets[PROMISING])})",
          "_Meets the full bar. Candidate for a written recommendation — still "
          "requires forward validation + your approval before any live change._", ""]
    if buckets[PROMISING]:
        L += ["| feature | family | n | gap | cuts | tickers | placebo (pool/odd/even) | incr |",
              "|---|---|---|---|---|---|---|---|"] + [_fmt(r) for r in buckets[PROMISING]]
    else:
        L += ["_None this run._"]
    L += ["", f"## ◦ Forward-watchlist ({len(buckets[FORWARD_WATCHLIST])})",
          "_Directional promise; fails full bar (small n, one cut, or placebo "
          "80–95). Re-tested as forward data accumulates._", ""]
    if buckets[FORWARD_WATCHLIST]:
        L += ["| feature | family | n | gap | cuts | tickers | placebo (pool/odd/even) | incr |",
              "|---|---|---|---|---|---|---|---|"] + [_fmt(r) for r in buckets[FORWARD_WATCHLIST]]
    else:
        L += ["_None this run._"]
    L += ["", f"## ✗ Rejected ({len(buckets[REJECTED])})",
          "_Noise (placebo <80th) or failed stability/incremental. Final "
          "absent new data._", ""]
    if buckets[REJECTED]:
        L += ["| feature | family | gap | placebo |", "|---|---|---|---|"]
        L += [f"| `{r['feature']}` | {r['family']} | {r.get('gap','?')}pp | {r.get('placebo_pooled','?'):.0f} |"
              for r in buckets[REJECTED]]
    # family breakdown — is the surviving signal structural, as theory predicts?
    L += ["", "## Family breakdown (does structure beat scalar, per F2?)", ""]
    fam_stats = {}
    for r in [x for b in buckets.values() for x in b]:
        f = r.get('family', '?')
        fam_stats.setdefault(f, {'promising': 0, 'watch': 0, 'rejected': 0, 'n': 0})
        fam_stats[f]['n'] += 1
        v = r.get('verdict')
        if v == PROMISING: fam_stats[f]['promising'] += 1
        elif v == FORWARD_WATCHLIST: fam_stats[f]['watch'] += 1
        elif v == REJECTED: fam_stats[f]['rejected'] += 1
    L += ["| family | studies | promising | watchlist | rejected |", "|---|---|---|---|---|"]
    for f, s in sorted(fam_stats.items()):
        L += [f"| {f} | {s['n']} | {s['promising']} | {s['watch']} | {s['rejected']} |"]
    L += ["", "## Pending doctrine studies (need feature extraction)", ""]
    for d in PENDING_DOCTRINE_STUDIES:
        L += [f"- **{d['title']}** — {d['status']}: {d['note']}"]
    L += ["", "---", "_Recommendations, if any, are in RECOMMENDATIONS.md and "
          "require explicit user approval. The runner never commits, deploys, "
          "restarts, or edits live code._"]
    safe_write(f'{OUT}/REPORT.md', "\n".join(L) + "\n")


def _render_ledger_md(stamp, results):
    header = (f"\n## Run {stamp}\n\n"
              "| feature | family | verdict | gap | cuts | placebo (pool/odd/even) | incr |\n"
              "|---|---|---|---|---|---|---|---|\n")
    rows = []
    for r in results:
        if r.get('verdict') == NOT_TESTABLE:
            rows.append(f"| `{r['feature']}` | {r.get('family','?')} | not_testable | — | — | — | — |")
        else:
            rows.append(f"| `{r['feature']}` | {r['family']} | **{r['verdict']}** | "
                        f"{r['gap']:+}pp | {r['cuts_ok']}/4 | "
                        f"{r['placebo_pooled']:.0f}/{r['placebo_odd']:.0f}/{r['placebo_even']:.0f} | "
                        f"{r['incremental'] if r['incremental'] is not None else '—'} |")
    # prepend newest run to the top of a human ledger
    path = os.path.join(RESEARCH_ROOT, f'{OUT}/LEDGER.md')
    prior = ''
    if os.path.exists(path):
        with open(path) as f:
            prior = f.read()
        prior = prior.split('\n', 2)[2] if prior.startswith('# ') else prior
    body = "# Research Ledger (newest first)\n" + header + "\n".join(rows) + "\n" + prior
    safe_write(f'{OUT}/LEDGER.md', body)


def _render_recommendations(stamp, promising):
    L = ["# Live-Code Recommendations — REQUIRE EXPLICIT USER APPROVAL", "",
         f"_Generated {stamp}. NOTHING here is implemented. Each item is a "
         "proposal only; the runner cannot and will not change live code, "
         "flags, sizing, exits, or entries. Approve individually before any "
         "implementation._", ""]
    if not promising:
        L += ["**No recommendations this run.** No study cleared the full bar "
              "(and even a cleared study must also pass forward validation "
              "before it becomes a recommendation)."]
    else:
        L += ["The following studies cleared the in-sample bar. They are NOT "
              "ready to ship — each still needs forward out-of-sample "
              "confirmation. Listed so you can decide what to watch:", ""]
        for r in promising:
            L += [f"## Candidate: `{r['feature']}` ({r['family']})",
                  f"- in-sample tercile gap {r['gap']:+}pp, all {r['cuts_ok']}/4 "
                  f"stability cuts, placebo {r['placebo_pooled']:.0f}th "
                  f"(odd {r['placebo_odd']:.0f} / even {r['placebo_even']:.0f}), "
                  f"incremental over gate+nflags {r['incremental']:+}pp, n={r['n']}.",
                  f"- **Proposed (NOT implemented):** treat as an entry-quality "
                  f"filter/tier. Requires: (1) forward-data confirmation, (2) "
                  f"your explicit approval, (3) the same one-gate discipline as "
                  f"the bull tape gate.", ""]
    safe_write(f'{OUT}/RECOMMENDATIONS.md', "\n".join(L) + "\n")


if __name__ == '__main__':
    p = argparse.ArgumentParser(description='Research-only autonomous study runner')
    p.add_argument('--seed', type=int, default=20260709)
    p.add_argument('--placebo', type=int, default=500)
    p.add_argument('--families', type=str, default=None,
                   help='comma list: structural,temporal,tape,scalar')
    p.add_argument('--date', type=str, default=None)
    run(p.parse_args())
