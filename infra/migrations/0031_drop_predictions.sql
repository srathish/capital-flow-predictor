-- Drop the XGB sector-rotation predictions table.
--
-- Audited 2026-05-21: the predictions table held exactly one run snapshot
-- dated 2026-05-08 across its entire history — the weekly train-baseline
-- cron had either never fired successfully or had been silently failing.
-- Zero forward-return scorecard data existed, so the model had no
-- demonstrated value.
--
-- Everything that read this table has been rewired (Tier B) or deleted
-- (Tier C):
--   - sector heatmap → ranks by realized N-day return from prices_daily
--   - sector holdings → no longer returns model_rank / model_score
--   - /v1/sectors/scorecard, /v1/sectors/forward-call → DELETED
--   - /v1/rankings, rankings.py route → DELETED
--   - network /correlation, /lead-lag → bucket by realized return
--   - assistant tools get_rankings, get_sectors_heatmap → return-based
--   - watchlist orchestrator (build_watchlist) → picks sectors by return
--   - train.py + train-baseline CLI + Sunday cron → DELETED

DROP TABLE IF EXISTS predictions CASCADE;
