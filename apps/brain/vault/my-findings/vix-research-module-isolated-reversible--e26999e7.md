---
title: VIX Research Module — ISOLATED, REVERSIBLE
source_url: repo://apps/gex/research/vix/README.md
source_domain: bellwether-repo
fetched_at: '2026-07-11T18:12:58Z'
trust_tier: 1
category: my-findings
topics:
- own-research
- gex
- 0dte
- vix
- volatility
summary: '**Status: research only. Nothing here is imported by the live trading'
url_sha1: e26999e7b84a22479db1d8e5199f1658264d84f2
simhash: '2827479052879872450'
status: vault
ingested_by: seed
---

# VIX Research Module — ISOLATED, REVERSIBLE

**Status: research only. Nothing here is imported by the live trading path.**

## Isolation contract

- No file under `apps/gex/src/` imports from this directory.
- This module only READS existing artifacts: the Skylit archive
  (`data/skylit-archive/intraday/`), the replay output
  (`scripts/out/replay-fires-*.json`), and the tracker SQLite (read-only).
- All outputs land inside this directory (`out/`).
- **To revert: `rm -rf apps/gex/research/vix` — the trading system is untouched.**
- The only shared-code change made for this study was an additive `--tickers=`
  CLI flag on `scripts/archive-skylit.js` (archival tooling, not trading logic),
  used to pull VIX frames into the same archive format.

## Data

- VIX intraday: Skylit `/api/data` historical frames, 5-min resolution,
  same 64-day window as the index archive (VIX is a native Skylit symbol,
  including its options surface — the study stays 100% in-ecosystem).
- Index spots: existing SPXW/SPY/QQQ archive frames.
- Trade sample: 1,339 replayed fires (points + option-EV proxy) and the
  2026-07-08 live option marks (real premiums) for hold-period IV analysis.

## Objective

Determine whether VIX level / direction / intraday rate-of-change can improve
index-option trade selection — as a *filter*, *position-sizing input*, or
*expected-return adjustment*. Explicitly NOT to ship a rule from this study;
any candidate feature must later pass the same option-EV replay discipline
that rejected the flip-flop cooldown and fuel-skew veto (see
`scripts/out/LOSS_STUDY_2026-07-08.md`).

## Run

```bash
cd apps/gex
uv run --with numpy,pandas,matplotlib,scipy python research/vix/vix_study.py
# outputs: research/vix/out/VIX_RESEARCH_REPORT.md + charts (*.png)
```
