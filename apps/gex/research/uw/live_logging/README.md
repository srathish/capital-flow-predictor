# Live Observation Logging — forward-validation instrumentation ONLY

**No policy is deployed. Nothing here affects trading.**

- FULL_COMBINED is REJECTED despite +7.8% return — it failed holdout
  stability (odd +17% / even −11.6%, 2/9 checks).
- flags_eq_0 (zero red flags) is `research_more` only: +2.8%, PF 1.10,
  positive in all four holdout splits, but n=162 and it fails the
  median-return and outlier-dependency checks. It needs forward days.
- The purpose of this module is to collect UNBIASED out-of-sample live
  fire observations so those forward days accumulate automatically.

## How it works

`src/tracker/fire-loop.js` contains ONE optional hook, active only when
`ENABLE_UW_OBSERVATION_LOGGING=true`. It dynamically imports
`observation-logger.js` (zero cost when off), fire-and-forget. Every code
path in the logger is exception-wrapped; failures go to
`live_fire_observation_errors_<day>.log` and can never touch the fire
loop. With the flag unset/false, live behavior is byte-identical to today.

Each live fire (including gate-blocked ones — execution status is in
`notes_json`) produces one row with the same features and red-flag
definitions as the policy simulator (thresholds mirrored in
`thresholds.json`; `research/uw/studies/policy_config.py` is canonical).
Missing live data (flow/VIX/quote/surface) → null fields, a
`missing_data` marker, and affected red flags recorded as `"unknown"` —
never guessed. The row is written after the 1-minute confirmation check
resolves (~70s after fire).

`policy_flags_eq_0_pass` / `policy_flags_le_1_pass` /
`policy_full_combined_pass` are computed for LOGGING ONLY.

## Outputs
`research/uw/outputs/live_observations/`
- `live_fire_observations_YYYY-MM-DD.csv` (daily)
- `live_fire_observations_all.csv` (append-only master)
- `live_fire_observation_errors_YYYY-MM-DD.log`

## Commands
```bash
# enable for a session (observation only):
ENABLE_UW_OBSERVATION_LOGGING=true pnpm plays 2>&1 | tee -a data/plays-$(date +%F).log

# summarize a day (counts/distributions only — no P&L by design):
cd apps/gex && uv run --with pandas python -m research.uw.live_logging.summarize_live_observations --date 2026-07-09

# merge daily logs into the forward-validation dataset:
cd apps/gex && uv run --with pandas,pyarrow python -m research.uw.live_logging.merge_forward_logs

# dry run with a mocked fire (writes a real row after ~65s confirmation wait):
node research/uw/live_logging/observation-logger.js --dry-run
```

Revert: remove the single flag-gated block in fire-loop.js and
`rm -rf research/uw/live_logging` — or simply leave the flag unset.
