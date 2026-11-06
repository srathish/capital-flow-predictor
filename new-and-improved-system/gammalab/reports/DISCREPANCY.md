# Discrepancy report: PRD v1.0 and "Skylit Community Repo Analysis" vs the pinned repository

Pinned upstream: `chriskrajewski/Skylit.API.Community.Collab` @ `d435683365450f2108e7fdf4b63f8d3437d730cc` (main, 2026-10-25, 271 commits).
Generated artifacts this report rests on: `reports/manifest.json` (HEAD tree), `reports/history_manifest.json` (all 26 remote
branches + history), `reports/hypotheses.json` (line-resolved registry), `reports/DATA_AUDIT.md` (replay archive), each with a
line in `runs/LEDGER.jsonl`.

Status words used here: **Code-inspected** = read in the pinned clone; **Locally executed** = produced by a ledgered run in
this package. Nothing here is a performance claim. Prior project test results are cited as *prior local work*; they were
not produced under this contract and are not re-verified here.

## 1. Scope and access

| # | Supplied statement | Pinned repo / local fact | Status |
|---|---|---|---|
| 1.1 | PRD: "Repository clone/execution was unavailable" | Cloned and pinned; HEAD tree 1,206 files (note 169, code 918, data 4, other 115) | Locally executed (census) |
| 1.2 | Analysis: "9 member folders, 271 commits, ~200 MB" | 9 member folders, 271 commits on main, 201 MB working tree | Locally executed |
| 1.3 | Analysis: "123 note files readable" | 137 `.md` files at HEAD; 169 files classed as notes (md/txt/pdf/docx). The 123 figure has no reproducible definition | Code-inspected |
| 1.4 | Analysis: "2 notes … are git-crypt encrypted" | Confirmed: exactly 2 encrypted files at HEAD, both `members/alantiix/skylit-academy-playbook-skill/skill-fine-tune-wip/` (`TASK.md`, `current_working_SKILL_100226.md`) | Locally executed |
| 1.5 | Analysis: "alantiix's old research tree … encrypted"; ".kiro and .agents folders" encrypted | Not at HEAD at all. `.gitattributes` still declares `.kiro/**` and `.agents/**` as git-crypt, but no files there are tracked at HEAD. The material is in **history/branches**: 3,041 paths ever, 1,936 not at HEAD, 1,883 with encrypted versions — almost all `members/alantiix/skylit-futures-strategy-engine/` (removed in `c46647d`) | Locally executed (history census) |
| 1.6 | Analysis: TS4 / Matrix / Range / sfmax strategies "git-crypt encrypted"; Matrix "−$13,300 kill line" | None of these names appear in any file at HEAD. TS4 appears in readable history files (`.agents/ts4-plugin/*`, `.agents/ts4-be-trail/*`); branches `kiro/fse-matrix-pull`, `kiro/fse-sfmax-plugin` exist. The −$13,300 figure was not found by a pickaxe search of history; its source is untraced | Unresolved — treat as unsourced until traced |
| 1.7 | — (not in either document) | 189 readable files exist only in history/branches, including `members/pckt/pckt-bench/` (an evaluation harness with baselines, scoring and a signal slice), `members/rakedfps/mnq-gamma-node/` (raked's earlier folder with its own `LICENSE` and `parameters.json`) and the TS4 reports. They are **not** enumerated in the hypothesis registry, which is pinned to HEAD | Open item |

## 2. Licenses (PRD §2: "individual member projects … carry their own licenses")

Most member material has **no license at all**, which means default copyright (no reuse right), not permissive reuse.

| Area | License found | Consequence |
|---|---|---|
| hub root (`LICENSE`) | CC0 1.0 — scope is hub materials, not member projects | Hub docs reusable |
| `alantiix/fse` (1,041 files) | CC0 1.0 | Code/ideas reusable (the contract's pairing idea cites it) |
| `pckt/eod-chart` | MIT | Reusable with notice |
| `akbryan2024/grok-nq-skylit-context` | CC BY 4.0 | Reusable with attribution |
| `v01/bigtrades-indicator` | GNU AGPL-3.0 | Do not copy code into this project |
| `dashingbixby/argon-knowledgebase` | "Copyright (c) 2026 dashingbixby. All rights reserved." | Read as reference only; no copying |
| Anubis, raked, mtmtempo, geometricalpanda, alantiix knowledge base, alantiix playbook skill | none | Default copyright; ideas analysable, text/code not copied |

The PRD's catalog does not record licenses per strategy; `reports/hypotheses.json` now does (FR-01).

## 3. Attribution errors in the PRD strategy catalog

The PRD attributes several conclusions to "repo notes" or "supplied notes" that are actually **this project's own prior local tests**
(they reached the PRD through the supplied analysis). The repo itself contains no such results.

| PRD ID | PRD text | Actual source |
|---|---|---|
| S09 | "repo notes say mapped gate failed holdout" | Prior local work: `shadow/DESIGN_garma.md` (commit `96d98ba3`, 2026-11-05). The repo's only S09 evidence is Garma's narrated trade and his unledgered 97% / ~80% claims (`garma_agent_video_transcript_10172026.md:83,85`) |
| S11 | "claimed predictive edge failed in supplied notes" | Two sources mixed: the repo's SirFartalot study says "Three indices aligned" paid less (`SirFartalot-Backtest-Study.md:394`, `:397`); the "failed" direction test is prior local work (`DESIGN_garma.md` H1) |
| S16 | "Supplied audit reports 1.2x/0.8x range" | Prior local work (`shadow/DESIGN_gamma_range.md`, `95198a48`, 2026-10-09). The repo's S16 source is SirFartalot (`:42`), which says a stock's own implied volatility ranks the next day's range ("volatility is forecastable; direction is not"), not these ratios |
| S22 | "Supplied audit reports no robust net edge" | Prior local work (`shadow/DESIGN_flux_runners.md` `478801fc`, `shadow/DESIGN_orb_lowgamma.md` `74f0eb8e`). Closest repo source: NEXUS-LLM-HOOKUP.md:284 (fixed premium exits lost vs holding) — registered as X01 |

## 4. PRD statements contradicted or unconfirmed by the pinned clone

| # | PRD statement | Finding | Status |
|---|---|---|---|
| 4.1 | §14: DESIGN_garma/flux/flux_runners/orb_lowgamma/iv_walls "referenced … but not supplied" | All five exist in this repository under `shadow/` with committed results (garma `96d98ba3`, flux `3b9227c7`, flux_runners `478801fc`, orb_lowgamma `74f0eb8e`, iv_walls `97901098`). They are prior local work, not re-run under this contract | Code-inspected |
| 4.2 | §2: Vex_Stairup-down "Python loader raises NotImplementedError" | Confirmed: `vex_stair_grok.py:56` and `vex_stair_openai.py:56` | Code-inspected |
| 4.3 | S14: "~49% reported directional accuracy" | Confirmed at `vex_stair_grok.py:34` and `:134` (49.3% / 48.0% at 5 / 10 sessions, labelled display-only by the source) | Code-inspected |
| 4.4 | §2: geometricalpanda "historical downloader described as broken" | Not described as broken anywhere in the repo (its README is a stub). By inspection `download_replay_data.py:49` subscripts a dataclass (`input_start_boundary['hour']`), which would raise `TypeError`, and `:73` stops windows at 15:00 ET. Running it was not permitted in this session, so this stays inspected, not executed | Code-inspected |
| 4.5 | S01: "Sweep a node >= 50% of King" | Confirmed: `SKYLIT_STRATEGY_JOURNAL.md:41` (`STRONG` 0.50) | Code-inspected |
| 4.6 | S17: rules as stated | The rules are in a PDF/DOCX; `mtmtempo/README.md` has no rule lines, so line references are not applicable (registry status FILE_ONLY) | Code-inspected |
| 4.7 | S15, S24 | Not sourced in the repo (S15 is a new hypothesis, S24 a control). The registry keeps only sourced ideas and adds S13b, S20c (conflict), S25, X01, X02 that the PRD lacks | — |
| 4.8 | Analysis: "fse about 600 Python files" | 611 `.py` files under `members/alantiix/fse` | Locally executed |
| 4.9 | Analysis: argon knowledge base "22 files" | 27 tracked files (includes LICENSE, README and the Garma video folder) | Locally executed |

## 5. Data-provenance findings (replay archive used by prior local tests)

From `reports/DATA_AUDIT.md` (ledgered run of `python -m gammalab.audit_replay`):

1. **09:30 ET frame is stale.** Its spot is the prior close (SPY median |diff| vs the first regular bar open 2.10, max 11.38; QQQ 2.90 / 11.86). Prior local tests that read the 09:30 frame inherited a stale spot; Garma rules wait until 10:00 so the effect on those is likely small, but this is unverified. The adapter now drops the frame.
2. **Frame timestamp = state at the end of the prior minute.** Replay spot matches the UW bar that *closed* at the frame time (median |diff| 0.055 SPY / 0.065 QQQ) better than the bar that *opens* there (0.150 / 0.170). Availability lag in real time is unknown; the adapter adds a conservative 60 s.
3. **Replay archive vs today's API — pre-registered check FAILED** (`reports/DESIGN_replay_vs_api.md`, result `reports/REPLAY_VS_API.md`, ledger `replay_vs_api` @ `68748c48`, 150 credits). 10 of 90 symbol-instants MATCH (11%; bar 90%), 30 CLOSE, 50 DIFFER. Spot always agrees (median relative diff < 0.01%), so the gap is in the exposure values. It splits by **scrape vintage**: the one sampled day scraped on 2026-03-23 matches perfectly (9/9, r = 1.000); the 9 days scraped on 2026-03-13 give 1 MATCH in 81 cells (median front-column r 0.49–0.99 by day; front King strike or sign disagrees in 17 of 81). 60 of 72 archive files (2025-12-15 to 2026-03-12) are the 2026-03-13 vintage. So Skylit's history changed between those dates, or the two scrapes came from different sources. Either way, neither version is shown to be what a trader saw live. The SPXW `.spxw-backup` files match the API no better than the main files. One later-vintage day is too few to call that vintage verified.
4. **Archive, not live capture.** `metadata.scrapedAt` is 2026-03-13 for December files: pulled after the fact through Skylit's historical parameter. Whether Skylit stores snapshots or recomputes history is unanswered (also listed as unknown in the analysis). Labelled `ARCHIVED_SNAPSHOT`, never `LIVE_CAPTURE`.
5. **Format defects.** 7 symbol-frames write expirations as `YYYYMMDD` (normalized); 4 last-minute frames (15:59 ET) already list the next day first, so `front` selection refuses them; `gex-replay-2026-03-23.json` is empty; the files labelled 2026-03-14 and 2026-03-21 are Saturdays and are excluded. 19 days also have a `.json.spxw-backup` sibling, meaning the SPXW data in those files was replaced after the first pull; which version prior local tests read is not recorded.
6. **Sign convention.** Skylit replay values and UW greek-exposure values use different sign models; the contract tags each snapshot (`SKYLIT_NET` vs `UW_OI_CALLS_POS`) and a store refuses to mix them. The 2026-08-29 project comparison (signed correlation 0.15 vs |magnitude| 0.58) is prior local work.

## 6. What this means before strategy development

- Prior local tests that read the 2026-03-13 vintage (at least `shadow/DESIGN_garma.md`, Dec 2025 – Mar 2026 replay) ran on boards that today's API does not reproduce. Their FAIL verdicts are not overturned by this, but they cannot be cited as reproducible.
- Tests that pulled boards straight from the API (`/v1/historical`) read today's version, which is internally consistent but unproven point-in-time.
- The P0 panel can be built on the contract for the replay window (2025-12-15 to 2026-05-05, non-contiguous: 12/20/19/18/2/1 files Dec–May; 69 usable sessions), but every result on it stays at **Locally executed** with an `ARCHIVED_SNAPSHOT` provenance tag until a live-capture period exists.
- The registry must be extended to the 189 readable history-only files (notably pckt-bench and the TS4 reports) before claiming an exhaustive hypothesis list.
- Item 1.6 (Matrix −$13,300) should be traced or removed from the analysis doc.
