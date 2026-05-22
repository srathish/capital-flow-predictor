-- Remove contaminating 'seed' rows from prices_daily.
--
-- Background (2026-05-21): 21 rows with source='seed' for NVDA, SPY, XLK
-- across 2026-05-01..2026-05-09 had snuck into production. The closes were
-- wrong-scale (e.g. XLK 'seed' ~$225 vs the real yfinance close ~$170),
-- almost certainly from a CI smoke-test fixture that leaked in via
-- infra/seeds/0001_prices.sql or similar.
--
-- The prices_daily PK is (ts, symbol, source) so both rows coexisted for
-- the same date, and ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY ts)
-- in sectors / cohorts / network reads picked them up in mixed order,
-- producing nonsense N-day returns like "+40% in 5 days" on XLK.
--
-- Fix: delete every 'seed' row. The yfinance source covers all 50 symbols
-- back to 2021 and is the canonical price feed.

DELETE FROM prices_daily WHERE source = 'seed';
