# gammalab — Phase 0 + Phase 1 (GammaLab Trader PRD, Appendix B)

Research substrate only: no strategies, no performance claims.

## Phase 0 — source census
| Command | Output |
|---|---|
| `python -m gammalab.census` | `reports/manifest.{json,csv}`: every file at the pinned upstream HEAD with blob SHA, size, readable/encrypted, member, license, pinned link |
| `python -m gammalab.census_history` | `reports/history_manifest.json`: every path on all remote branches and history, with encrypted versions and HEAD presence |
| `python -m gammalab.hypotheses` | `reports/hypotheses.{json}`, `reports/HYPOTHESES.md`: trading hypotheses with file:line refs resolved in the pinned clone |

Pinned upstream: `chriskrajewski/Skylit.API.Community.Collab@d4356833`, cloned to `../.cache/upstream/` (not committed).

## Phase 1 — point-in-time data contract (`gammalab/contract/`)
- `events.py`: `MapSnapshot`, `PriceBar`; tz-aware UTC only; `available_at >= provider_ts`; content hash; sign convention and provenance tags.
- `store.py`: append-only `SnapshotStore` (as-of `available_at <= T`, TTL fails closed, immutable ids, one sign convention per store), `BarStore`.
- `expiry.py`: `front` (true 0DTE only, else `NoZeroDTE`) and `first_n` aggregation; signed King.
- `pairing.py`: a map pairs only with the last bar closed by its `available_at`; gap > 120 s rejected.
- `calendar.py`: NYSE holidays and early closes 2023–2026; refuses other years.
- Adapters: `adapters/skylit_replay.py` (archived replay, 60 s lag, in-session frames only), `adapters/uw_m1.py` (UW 1-minute bars, available at close).

Tests: `../../.venv/bin/python -m pytest -q tests` (unit tests are synthetic; adapter tests skip if the vendor files are absent).

## Run ledger
`gammalab/runlog.py` wraps every producing run and appends to `runs/LEDGER.jsonl`: code SHA, whether `gammalab/` or `tests/` was dirty,
exact command, params, sha256 of inputs and outputs. A result counts as reproducible only from a ledger line with `status: ok`
and `dirty: false`.

## Reports
- `reports/DATA_AUDIT.md`: `python -m gammalab.audit_replay` — replay archive vs UW bars.
- `reports/DISCREPANCY.md`: PRD v1.0 and the supplied analysis vs the pinned repo and local data.
