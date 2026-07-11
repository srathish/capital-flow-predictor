---
title: Research Runner — safe-by-design autonomous study engine
source_url: repo://apps/gex/research/runner/README.md
source_domain: bellwether-repo
fetched_at: '2026-07-11T19:10:43Z'
trust_tier: 1
category: my-findings
topics:
- own-research
- gex
- 0dte
- hypothesis
- backtest
summary: One command generates + tests GEX/VEX hypotheses, classifies them against a fixed evidence bar, and writes reports. **Research-only. It cannot touch the live trading system** — safety is enforced in code (`safety.py`), not by
url_sha1: d07f64b00394dc51cbc238a89d67df0a4f1bff22
simhash: '10676538808081225002'
status: vault
ingested_by: seed
---

# Research Runner — safe-by-design autonomous study engine

One command generates + tests GEX/VEX hypotheses, classifies them against a
fixed evidence bar, and writes reports. **Research-only. It cannot touch the
live trading system** — safety is enforced in code (`safety.py`), not by
convention.

## Run it

```bash
cd apps/gex/research/runner
uv run --with numpy,pandas,pyarrow python run.py                 # full sweep
uv run --with numpy,pandas,pyarrow python run.py --families structural,temporal
uv run --with numpy,pandas,pyarrow python run.py --seed 123 --placebo 800
```

## What it guarantees (safe by design)

- Writes **only** under `research/`. `safety.assert_under_research` raises on
  any path touching `src/`, `scripts/`, `package.json`, config, or env —
  verified: attempts to write there are BLOCKED.
- **No** git, deploy, restart, network, feature-flag, sizing, exit, entry, or
  trading-decision code exists anywhere in the runner. It reads data
  read-only and writes the outputs below. Nothing else.
- **No auto-commit.** You commit its outputs if/when you want.
- Any live-code idea is written to `RECOMMENDATIONS.md` as a proposal that
  **requires your explicit approval** — the runner never implements anything.

## Outputs (`outputs/`)

| file | what |
|---|---|
| `ledger.jsonl` | append-only machine record, one row per study per run |
| `LEDGER.md` | human ledger, newest run on top |
| `REPORT.md` | summary: promising / forward-watchlist / rejected + family breakdown |
| `RECOMMENDATIONS.md` | proposals only; require explicit approval |

## The evidence bar (in `harness.py`, applied to every study)

- real option dollars (`pnl_atfire` on final-system fires)
- tercile gap ≥ 10pp
- all 4 stability cuts (odd days, even days, first half, second half)
- pooled placebo ≥ 95th **and** split-half placebo ≥ 80th (multiple-testing guard)
- **ticker-neutrality**: holds on ≥2 of SPY/QQQ/SPXW (else concentrated →
  forward_watchlist, not promising — this is the check that correctly keeps
  the SPXW-only `dn_vex_mass` off the promising list)
- incremental over gate+nflags (signal survives inside `nflags==0`)
- n ≥ 30 in the key cell
- forced verdict: `promising` / `forward_watchlist` / `rejected` / `not_testable`

## Add a hypothesis

- Feature-based: add the column name + family to `FEATURE_FAMILIES` in
  `hypotheses.py`. It flows through the same bar automatically.
- Archive-derived (e.g. node-growth): register in `PENDING_DOCTRINE_STUDIES`
  until its feature is extracted into the fires dataset.

## Relationship to the rest of research/

The runner mechanizes the `CHARTER.md` discipline for feature-conditioning
studies. Bespoke studies (topology physics, cohort backtests, event studies)
still live as standalone scripts under `research/sessions/` and
`research/gexvex-structure/`; the runner is the repeatable sweep over the
structured feature set. Findings context: `../gexvex-structure/
FOUNDATIONAL_FINDINGS.md` and `KNOWLEDGE_BASE.md`.
