-- 0034_explosive_funnel_stages.sql
--
-- Phase B: cascading funnel scoring. Adds per-stage pass/fail flags on
-- explosive_scores so the Board can rank by "passed all 5 stages" rather
-- than a flat 0-100 number that hides which signals actually agreed.
--
-- Stage definitions (evaluated in score_explosive.py):
--   1. Screener seed     — ticker came from a UW screener / earnings calendar
--   2. Flow confirmation — sustained one-sided premium pressure
--   3. Positioning       — OI growth + GEX context (squeeze fuel)
--   4. Catalyst          — catalyst in ≤14d OR exceptional flow without one
--   5. Squeeze           — short interest + FTD spike (bonus, not gate)
--
-- Backwards compatible: existing `score` column stays. Defaults make legacy
-- rows look like "Stage 1 passed only" so they degrade gracefully.

BEGIN;

ALTER TABLE explosive_scores
    ADD COLUMN IF NOT EXISTS stage1_passed   BOOLEAN  NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS stage2_passed   BOOLEAN  NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS stage3_passed   BOOLEAN  NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS stage4_passed   BOOLEAN  NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS stage5_passed   BOOLEAN  NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS stages_passed   INTEGER  NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS stage_reasons   JSONB;

-- Hot path for the Board: "show me names that passed at least N stages,
-- ordered by stages then score." Covers the SELECT we use in /v1/explosive.
CREATE INDEX IF NOT EXISTS idx_explosive_scores_stages
    ON explosive_scores (snapshot_ts DESC, stages_passed DESC, score DESC);

COMMIT;
