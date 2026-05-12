# Persona Roster

Versioned reference for every investor-persona agent in the ensemble. Update
this doc in the same commit that changes a persona's prompt — it's how we
keep "what does Buffett look at?" answerable a year from now.

## Current roster (v1, 2026-05)

| Persona       | Stance     | Edge (one line)                                          | File                               |
|---------------|------------|----------------------------------------------------------|------------------------------------|
| ackman        | Activist   | Concentrated, public-pressure long-term holdings         | `packages/agents/.../ackman.py`    |
| buffett       | Value      | Owner-earnings + moat + sane price                       | `.../buffett.py`                   |
| burry         | Contrarian | Hidden-leverage shorts; "I see what you don't"           | `.../burry.py`                     |
| cathie_wood   | Innovation | Long-duration thematic growth; tolerate vol              | `.../cathie_wood.py`               |
| damodaran     | Valuation  | DCF + narrative; rejects momentum                        | `.../damodaran.py`                 |
| druckenmiller | Macro      | Top-down currency/rates → equity tilt                    | `.../druckenmiller.py`             |
| greenblatt    | Quality    | High ROIC + cheap; magic-formula lens                    | `.../greenblatt.py`                |
| klarman       | Special    | Discount-to-tangible + distressed equity                 | `.../klarman.py`                   |
| lynch         | Growth     | PEG ≤ 1, scuttlebutt, "what you know"                    | `.../lynch.py`                     |
| minervini     | Momentum   | Stage-2 uptrends + tight stops (CAN SLIM-adjacent)       | `.../minervini.py`                 |
| simons        | Quant      | Anomaly-driven short-horizon (placeholder for ensemble)  | `.../simons.py`                    |
| soros         | Reflexive  | Feedback-loop narratives; trend then reversal            | `.../soros.py`                     |
| taleb         | Convex     | Long optionality + tail risk; "don't blow up"            | `.../taleb.py`                     |

Plus the synthesis layer: `bull_researcher`, `bear_researcher`,
`bull_rebuttal`, `bear_rebuttal`, `trader`, `risk_manager`,
`portfolio_manager`.

## Changelog

### 2026-05-11 (v1.0)
- 13 personas + 5 analysts + 2 rebuttals + 2 researchers + 3 synthesis (25 total)
- All personas read the same `EvidenceBundle`; no extra LLM context fetches per persona
- Conviction rule validator gates persona signal → ensemble vote

## Adding a persona

1. Create `packages/agents/src/cfp_agents/personas/<name>.py` subclassing the base.
2. Register the persona in `packages/agents/src/cfp_agents/graph.py`.
3. Update `EXPECTED_TOTAL` in `apps/api/src/cfp_api/routes/agents.py`.
4. Add a row above + a changelog entry.
5. Backfill with `cfp-jobs agents-run <ticker>` for a few names to seed the eval table.
