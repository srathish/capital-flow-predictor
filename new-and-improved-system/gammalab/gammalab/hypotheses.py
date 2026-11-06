"""Phase 0 — strategy hypothesis registry with exact file:line provenance at the pinned upstream commit.

Each source reference is an (path, anchor) pair; the resolver finds the anchor in the pinned clone and records the
1-based line number. An anchor that is not found (or a file that is encrypted / missing) is reported UNRESOLVED — the
registry never invents a line. Evidence status uses the PRD vocabulary and is never inferred upward:
  Source-reported < Code-inspected < Locally executed < Reproduced < Sealed holdout passed < Paper verified < Live verified
"Local test" pointers refer to this repo's shadow/DESIGN_*.md files; they are pointers to prior local work, NOT results
re-verified under the gammalab data contract (Phase 1 has not executed any strategy).

    python -m gammalab.hypotheses        # writes reports/hypotheses.json + reports/HYPOTHESES.md
"""
from __future__ import annotations

import json
import os

from .census import CLONE_DIR, PINNED_SHA, REPORTS, ensure_clone, GITCRYPT_MAGIC

M = "members/"
GV = M + "dashingbixby/argon-knowledgebase/GarmaAgentVideo_10172026/"
KB = M + "alantiix/skylit-knowledgebase/skylit-bible/docs/"
SF = M + "Anubis/SirFartalot-Backtest-Study.md"
DUKE = M + "Anubis/DUKE_TREND_DAY_TRAP_LOGIC.md"
RAKED = M + "raked/mnq-gamma-node/SKYLIT_STRATEGY_JOURNAL.md"

# id, name, rule as stated (paraphrase kept close to source), sources [(path, anchor)], source claim, status, local tests, conflicts
H = [
    ("S01", "Gamma-node sweep + 3-minute reclaim",
     "Price sweeps a node (>=50% of King), then a 3-minute candle closes back across it within 15 minutes; stop beyond the sweep +1 pt.",
     [(RAKED, "Entry B (sweep + 3-min reclaim) is the edge"), (RAKED, "RECLAIM_WINDOW_MIN")],
     "92 trades, 47% win, +1.34R (MNQ, Jul 13 - Sep 30 2026); filters R1-R4 chosen with September in view.",
     "Source-reported", ["research: Timmy hunt test 2026-10-09 (SPY/QQQ nodes)"], []),
    ("S02", "Direct node tap / limit at the node",
     "Limit order at the node, one position at a time.",
     [(RAKED, "Entry A:** limit at the node")],
     "438 trades, 13% win, -0.24R (source's own negative result).",
     "Source-reported", [], []),
    ("S03", "Positive-gamma floor bounce (fade at fresh node)",
     "On the Current expiry, fade a fresh or once-tapped node at chart structure; enter on the tap for + nodes.",
     [(M + "dashingbixby/argon-knowledgebase/setup_catalog_fade_gatekeeper_and_vex_swing.md", "Precise version:")],
     "No measured results in source.", "Source-reported", ["research: node reaction test 2026-10-09"], []),
    ("S04", "Negative-gamma node: wait for overshoot then fade",
     "On - (purple) nodes, wait for overshoot, stall and rejection before fading.",
     [(M + "dashingbixby/argon-knowledgebase/setup_catalog_fade_gatekeeper_and_vex_swing.md", "If $\\text{GEX}(K_{\\text{extreme}}) < 0$")],
     "No measured results in source.", "Source-reported", [], []),
    ("S05", "Gatekeeper fade",
     "A node between price and the King of at least 1/4-1/3 of the King's size; fade the first tap.",
     [(KB + "2026-02-04_Skylit_x_Owls_Heatseeker_105_Trump_Dump.md", "The \"Gatekeeper\" Scalp"),
      (GV + "garma_agent_video_comparative_analysis_10172026.md", "20% to 30%")],
     "No measured results; size thresholds disagree (1/4-1/3 vs 20-30%).", "Source-reported", [],
     ["Gatekeeper size: 25-33% (Owls 105) vs 20-30% (Garma playbook p.6)"]),
    ("S06", "Rug / reverse rug",
     "Reverse rug: negative node above a positive floor with price on the floor -> long on the direct tap; never short it.",
     [(GV + "garma_agent_video_reverse_rug_10172026.md", "# Reverse Rug Setup (Bullish)"),
      (GV + "garma_agent_video_comparative_analysis_10172026.md", "Rule 9 — Never short a reverse rug")],
     "No measured results in source.", "Source-reported", [], []),
    ("S07", "Rolling ceilings / floors",
     "A ceiling losing value and moving to a lower strike is bearish confirmation (mirror for floors).",
     [(KB + "HEATSEEKER_AGENT_REFERENCE.md", "| **Rolling of ceilings** |")],
     "Doctrine; no measured results.", "Source-reported", ["shadow/DESIGN_garma.md (H1 direction)"], []),
    ("S08", "King moves with price (magnet vs follower)",
     "Measured: the King follows spot; same strike next day only 33-60%.",
     [(SF, "| J7 | The King moves with price |")],
     "70-84% of King moves follow spot (source study).", "Source-reported", ["research: king-as-destination tests"], []),
    ("S09", "IB sweep reversal (IBSniper)",
     "After 10:00 ET, PDH/PDL or IB sweep, IB golden zone (50-61.8%), 2-of-3 Kings, entry on re-entry into the node zone.",
     [(GV + "garma_agent_video_transcript_10172026.md", "Liquidity Sweep of PDH"),
      (GV + "garma_agent_video_transcript_10172026.md", "Golden Zone + 2/3 Node Confluence")],
     "One narrated trade (~+900%, 2026-10-16); agent backtest 97% win at 1:3 on 1-minute bars, ~80% live (no ledger).",
     "Source-reported", ["shadow/DESIGN_garma.md (H2, H3)"], []),
    ("S10", "IB break / hold (IBSniper Break Long)",
     "1-minute close over the IB high after the golden zone held a node; target 0.5x IB extension, stop under the node.",
     [(GV + "garma_agent_video_transcript_10172026.md", "IBSniper Break Long")],
     "One screenshot alert (~3.5R planned); no results.", "Source-reported", [], []),
    ("S11", "Two-of-three index confluence",
     "At least two of SPX, SPY, QQQ must tell the same story before conviction.",
     [(GV + "garma_agent_video_comparative_analysis_10172026.md", "Rule 3 — Get 2 of 3")],
     "Recollected 'Holy Trinity' ~95% deflection (no measurement).", "Source-reported", ["shadow/DESIGN_garma.md (H1)"],
     ["SirFartalot reports 3/3 confluence no better than ordinary setups"]),
    ("S12", "Duke five-pillar trend lock",
     "Every 3 min 10:00-14:45: VWAP, gamma fuel, stair-step, opening range, dark pool; >=3 pillars blocks counter-trend fades.",
     [(DUKE, "**Pillar 1: Dual VWAP & Intraday Extension**"), (DUKE, "**Pillar 2: Net Gamma Fuel")],
     "40 hand-picked trap moments; no holdout or control; code (duke_strategy.js) not in repo.", "Source-reported", [],
     ["S13: SirFartalot A17 trend-follow in -gamma 42% vs fade 49%"]),
    ("S13", "Negative-gamma regime router (trend vs fade)",
     "Fade in +gamma books, follow the trend in -gamma books.",
     [(SF, "| A17 | Regime router (trend-follow in −γ) |")],
     "Direction 42% (follow) vs 49% (fade) vs 54% (always long); marked failed by source.", "Source-reported", [], ["S12"]),
    ("S13b", "Index-gamma sleeve tilt (sizing)",
     "Size shorts full and longs half when index net gamma is negative.",
     [(SF, "| A19 | Index-gamma sleeve tilt |")],
     "Right sleeve 18 of 23 weeks (78%), forward test owed.", "Source-reported", [], []),
    ("S14", "VEX stair-step",
     "Dominant vanna node per major expiry (2-120 DTE); UP if Spearman >= +0.6 and last step >= 3% above the first.",
     [(M + "Anubis/Vex_Stairup-down/vex_stair_openai.py", "RULE = {\"window\": 0.50"),
      (M + "Anubis/Vex_Stairup-down/vex_stair_grok.py", "UP   = Spearman rank correlation")],
     "Source's own test: 49.3% direction at 5 sessions, 48.0% at 10 (display only).", "Code-inspected", [], []),
    ("S16", "Gamma / IV range forecasting",
     "Volatility (range) is forecastable; direction is not.",
     [(SF, "**Volatility is forecastable; direction is not.**")],
     "Source study finding.", "Source-reported", ["shadow/DESIGN_gamma_range.md (local: validated range forecast, live scorecard)"], []),
    ("S17", "ESB_q 15-minute swing-leg retest (ES)",
     "Swing legs >= ATR14 and 5 pts with 5 bars each side; re-touch of the leg origin with EMA50 filter; stop at leg end.",
     [(M + "mtmtempo/README.md", "")],
     "37 trades, 59.5% win, PF 2.23 (Aug 31 - Oct 9, old policy); rules are in a PDF/DOCX (line refs not applicable).",
     "Source-reported", ["shadow/DESIGN_community_batch.md (ESB_q ~0)"], []),
    ("S18", "Tape sweep confirmation (futures)",
     "Stitch same-aggressor prints within join_ms; close on side flip, gap or quiet_ms; publish above size threshold.",
     [(M + "v01/bigtrades-indicator/README.md", "**Sweep aggregation**")],
     "No edge claim (tool). License AGPL-3.0: do not copy code.", "Code-inspected", [], []),
    ("S19", "Session-level liquidity sweep (PDH/PDL, Asia, London, ONH/ONL)",
     "Sweep of session levels as the setup; 'the sweep isn't the trade' — wait for failure to continue.",
     [(GV + "garma_agent_video_transcript_10172026.md", "So, for example, like Session Levels"),
      (GV + "garma_agent_video_comparative_analysis_10172026.md", "Rule 2 — The sweep isn't the trade")],
     "No measured results.", "Source-reported", ["research: Timmy hunt test (classic levels -0.095R)"], []),
    ("S20", "Node velocity / freshness",
     "A node growing ~50% while price is flat becomes the magnet; 10-minute growth of ~20% preceded a crash.",
     [(KB + "2026-02-04_Skylit_x_Owls_Heatseeker_101.md", "### Node \"Rate of Change\" (Velocity)"),
      (KB + "2026-02-04_SPX_3000_Percent_Crash_Case_Study.md", "Rate of Increase (Velocity)")],
     "Anecdotes (Tier C AI-generated session notes per the KB's own reference).", "Source-reported", [],
     ["Growth during a break = fake (Owls 101 L-ref) vs = real (pattern-cards/RUG.json, SKILL.md)"]),
    ("S20c", "CONFLICT: node growth during a break",
     "Two sources disagree whether a node growing during a break signals a fakeout or a real break.",
     [(KB + "2026-02-04_Skylit_x_Owls_Heatseeker_101.md", "the breakout is fake"),
      (M + "alantiix/skylit-knowledgebase/pattern-cards/RUG.json", "Node growth during break = real breakdown"),
      (M + "alantiix/skylit-academy-playbook-skill/SKILL.md", "If purple grows on the b")],
     "Unresolved in sources.", "Source-reported", [], ["self-contradictory doctrine"]),
    ("S21", "Expiry scope: Current (front) expiry for 0DTE vs aggregate",
     "0DTE uses the Current expiry only (top 3-5 nodes); swings use Current + next N.",
     [(M + "dashingbixby/argon-knowledgebase/gex_vs_vex_and_expirations.md", "GEX vs. VEX Mechanics & Expiration Scoping")],
     "Doctrine; no measured results.", "Source-reported", ["shadow/DESIGN_garma.md (front vs 5-expiration boards)"], []),
    ("S23", "Late-session 0DTE entry cutoff (13:00)",
     "No new 0DTE entries after 13:00.",
     [(SF, "| E6 | Late-session 0DTE cutoff |")],
     "Modeled option P&L -14.9 -> +8.1 (model only).", "Source-reported", [], []),
    ("S25", "Trend day: far King with small counter-side skew",
     "Price fixates on a King far from spot with small counter-directional skew; do not mean-revert on trending days.",
     [(KB.replace("docs/", "patterns/") + "pattern-trend.md", "Price fixates on a king node far away from spot")],
     "Doctrine; no measured results.", "Source-reported", [], []),
    ("X01", "Fixed premium exits vs holding (Nexus auto-trader)",
     "Source's desk notes that every fixed premium exit rule lost money compared with holding.",
     [(M + "Anubis/NEXUS-LLM-HOOKUP.md", "every fixed premium exit rule lost money")],
     "Source-reported study note; no ledger.", "Source-reported", ["shadow/DESIGN_flux_runners.md, shadow/DESIGN_orb_lowgamma.md"], []),
    ("X02", "fse engine status (no published results)",
     "Engine built and tested against mocked services only; strategies TS4/Matrix/Range/sfmax encrypted in history.",
     [(M + "alantiix/fse/README.md", "No backtest result on real Skylit history is published here")],
     "No results (stated by source). License CC0 1.0 (reusable).", "Code-inspected", [], []),
]


def resolve(path: str, anchor: str) -> dict:
    full = os.path.join(CLONE_DIR, path)
    if not os.path.exists(full):
        return {"path": path, "status": "MISSING", "line": None}
    with open(full, "rb") as fh:
        raw = fh.read()
    if raw.startswith(GITCRYPT_MAGIC):
        return {"path": path, "status": "ENCRYPTED", "line": None}
    url = f"https://github.com/chriskrajewski/Skylit.API.Community.Collab/blob/{PINNED_SHA}/{path}"
    if not anchor:
        return {"path": path, "status": "FILE_ONLY", "line": None, "url": url}
    for i, line in enumerate(raw.decode("utf-8", "replace").splitlines(), 1):
        if anchor in line:
            return {"path": path, "status": "OK", "line": i, "url": f"{url}#L{i}", "anchor": anchor}
    return {"path": path, "status": "UNRESOLVED", "line": None, "anchor": anchor}


def license_for(path: str, manifest: dict) -> str:
    for f in manifest["files"]:
        if f["path"] == path:
            return f["license_head"] or "no license file"
    return "unknown"


def main() -> int:
    ensure_clone()
    manifest = json.load(open(os.path.join(REPORTS, "manifest.json")))
    out = []
    for hid, name, rule, srcs, claim, status, local, conflicts in H:
        refs = [resolve(p, a) for p, a in srcs]
        out.append({"id": hid, "name": name, "rule_as_stated": rule, "sources": refs,
                    "license": sorted({license_for(r["path"], manifest) for r in refs}),
                    "source_claim": claim, "evidence_status": status, "local_test_pointers": local,
                    "conflicts": conflicts, "pinned_sha": PINNED_SHA})
    bad = [(h["id"], r["path"], r["status"]) for h in out for r in h["sources"] if r["status"] not in ("OK", "FILE_ONLY")]
    json.dump({"pinned_sha": PINNED_SHA, "hypotheses": out, "unresolved": bad}, open(os.path.join(REPORTS, "hypotheses.json"), "w"), indent=1)
    md = [f"# Strategy hypothesis registry (pinned {PINNED_SHA[:8]})", "",
          "Evidence status is the source's, not ours. Local test pointers are prior local work, not re-verified under the gammalab contract.", "",
          "| ID | Hypothesis | Source (file:line) | Source claim | Status | Conflicts |", "|---|---|---|---|---|---|"]
    for h in out:
        src = "<br>".join(f"[{r['path'].split('/')[-1]}:{r['line'] or r['status']}]({r.get('url', '')})" for r in h["sources"])
        md.append(f"| {h['id']} | {h['name']} | {src} | {h['source_claim']} | {h['evidence_status']} | {'; '.join(h['conflicts']) or '—'} |")
    md += ["", f"Unresolved references: {bad or 'none'}"]
    open(os.path.join(REPORTS, "HYPOTHESES.md"), "w").write("\n".join(md) + "\n")
    print(f"{len(out)} hypotheses, {sum(len(h['sources']) for h in out)} source refs, unresolved: {bad or 'none'}")
    return 0 if not bad else 1


if __name__ == "__main__":
    raise SystemExit(main())
