-- Full-stack rollback. Drops every table created by migrations 0001-0014 in
-- reverse-FK order. Safe to run on a partially-applied DB (IF EXISTS).
-- Intentionally one file so a single psql call cleans the slate; per-migration
-- rollback scripts live alongside if needed.

BEGIN;

-- 0014 whale_conviction
DROP TABLE IF EXISTS whale_conviction CASCADE;

-- 0013 reddit_outcomes
DROP TABLE IF EXISTS reddit_outcomes CASCADE;

-- 0012 etf_breadth_snapshots
DROP TABLE IF EXISTS etf_breadth_snapshots CASCADE;

-- 0011 reddit_predictions
DROP TABLE IF EXISTS reddit_predictions CASCADE;

-- 0010 reddit_posts
DROP TABLE IF EXISTS reddit_posts CASCADE;

-- 0009 reddit_mentions
DROP TABLE IF EXISTS reddit_mentions CASCADE;

-- 0008 uw_etf_holdings (the v2 holdings)
DROP TABLE IF EXISTS uw_etf_holdings CASCADE;

-- 0007 agent_eval
DROP TABLE IF EXISTS agent_eval CASCADE;

-- 0006 run_evidence
DROP TABLE IF EXISTS run_evidence CASCADE;

-- 0005 unusual_whales v2 (insider/earnings/etc.)
DROP TABLE IF EXISTS uw_insider_transactions CASCADE;
DROP TABLE IF EXISTS uw_earnings CASCADE;
DROP TABLE IF EXISTS uw_short_interest CASCADE;
DROP TABLE IF EXISTS uw_institutional_holders CASCADE;
DROP TABLE IF EXISTS uw_ofi CASCADE;
DROP TABLE IF EXISTS uw_dark_pool CASCADE;
DROP TABLE IF EXISTS uw_max_pain CASCADE;
DROP TABLE IF EXISTS uw_iv_term CASCADE;

-- 0004 unusual_whales v1 (flow alerts)
DROP TABLE IF EXISTS uw_flow_alerts CASCADE;
DROP TABLE IF EXISTS uw_gex CASCADE;
DROP TABLE IF EXISTS uw_volatility CASCADE;
DROP TABLE IF EXISTS uw_ticker_options_volume CASCADE;

-- 0003 stock universe + agents + watchlists
DROP TABLE IF EXISTS watchlists CASCADE;
DROP TABLE IF EXISTS agent_signals CASCADE;
DROP TABLE IF EXISTS stock_universe CASCADE;

-- 0002 lead_lag_matrix
DROP TABLE IF EXISTS lead_lag_matrix CASCADE;

-- 0001 init
DROP TABLE IF EXISTS predictions CASCADE;
DROP TABLE IF EXISTS features_daily CASCADE;
DROP TABLE IF EXISTS gex_daily CASCADE;
DROP TABLE IF EXISTS etf_flows_weekly CASCADE;
DROP TABLE IF EXISTS macro_daily CASCADE;
DROP TABLE IF EXISTS prices_daily CASCADE;
DROP TABLE IF EXISTS etf_holdings CASCADE;
DROP TABLE IF EXISTS fundamentals CASCADE;
DROP TABLE IF EXISTS news_items CASCADE;

COMMIT;
