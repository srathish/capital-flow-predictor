-- Dev fixture: one watchlist run with three NVDA-style picks across two sectors.
INSERT INTO watchlists (run_ts, sector, ticker, rank, final_signal, final_confidence, target_weight, rationale)
VALUES
    ('2026-05-09 12:00:00+00', 'Technology',         'NVDA', 1, 'long',  0.78, 0.08, '{"summary":"seed: strong flow + earnings tailwind"}'::jsonb),
    ('2026-05-09 12:00:00+00', 'Technology',         'MSFT', 2, 'long',  0.62, 0.05, '{"summary":"seed: stable growth"}'::jsonb),
    ('2026-05-09 12:00:00+00', 'Communication Svcs', 'META', 1, 'long',  0.55, 0.04, '{"summary":"seed: ad spend recovery"}'::jsonb),
    ('2026-05-09 12:00:00+00', 'Energy',             'XOM',  1, 'avoid', 0.40, 0.00, '{"summary":"seed: range-bound, no edge"}'::jsonb)
ON CONFLICT (run_ts, sector, ticker) DO NOTHING;
