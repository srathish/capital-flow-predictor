-- Dev fixture: a handful of agent_signals so the /v1/agents/{T} endpoint
-- and the ensemble grid render without "no signals yet" cards.
INSERT INTO agent_signals (run_ts, ticker, agent, signal, confidence, rationale, payload)
VALUES
    ('2026-05-09 12:00:00+00', 'NVDA', 'technicals',         'bullish', 0.72, 'seed: above 50d, strong momo',          '{}'::jsonb),
    ('2026-05-09 12:00:00+00', 'NVDA', 'fundamentals',       'bullish', 0.65, 'seed: rev growth accelerating',        '{}'::jsonb),
    ('2026-05-09 12:00:00+00', 'NVDA', 'sentiment',          'bullish', 0.60, 'seed: positive news drift',            '{}'::jsonb),
    ('2026-05-09 12:00:00+00', 'NVDA', 'news',               'neutral', 0.50, 'seed: nothing material today',         '{}'::jsonb),
    ('2026-05-09 12:00:00+00', 'NVDA', 'flow',               'bullish', 0.70, 'seed: net call premium > 0',           '{}'::jsonb),
    ('2026-05-09 12:00:00+00', 'NVDA', 'buffett',            'neutral', 0.40, 'seed: rich on classic FCF lens',       '{}'::jsonb),
    ('2026-05-09 12:00:00+00', 'NVDA', 'burry',              'bearish', 0.55, 'seed: parabolic move concerning',      '{}'::jsonb),
    ('2026-05-09 12:00:00+00', 'NVDA', 'druckenmiller',      'bullish', 0.68, 'seed: ride the secular trend',         '{}'::jsonb),
    ('2026-05-09 12:00:00+00', 'NVDA', 'cathie_wood',        'bullish', 0.80, 'seed: long-duration AI bet',           '{}'::jsonb),
    ('2026-05-09 12:00:00+00', 'NVDA', 'portfolio_manager',  'bullish', 0.66, 'seed: synthesis — long with 8% weight','{"target_weight": 0.08}'::jsonb)
ON CONFLICT (run_ts, ticker, agent) DO NOTHING;
