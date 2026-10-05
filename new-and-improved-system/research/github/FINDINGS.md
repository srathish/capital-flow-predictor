# GitHub scan for the world model (2026-10-05)

**Method.** 46 queries through the GitHub search API, read-only: supply-chain and knowledge graphs, SEC/EDGAR NLP, transcripts, themes, alternative data, event-driven trading, AI hedge funds, backtesting, factor investing, agent-based simulation, input-output tables.
- **Results:** 649 + ~200 repos.
- **Filtered to:** ≥100 stars and active since mid-2024, or ≥1,000 stars. That left 54.
- **Then:** READMEs read for the 7 most relevant.

Raw lists: `repos_unique.json`, `repos2.jsonl`, `readmes.txt`.

**Headline.** There is essentially **no serious open-source causal supply-chain or theme-prediction model**. The "knowledge graph" repos are small, stale Chinese demos (2020–2024). The popular projects are backtesting engines and LLM "AI hedge fund" demos, none with a validated edge. The world model is novel territory, not a solved problem we're re-inventing.

## Useful to us

| Repo | ★ | What to use it for |
|---|---|---|
| [lefterisloukas/edgar-crawler](https://github.com/lefterisloukas/edgar-crawler) | 550 | Downloads 10-K / 10-Q / 8-K and splits them into **items**: Item 1 Business, 1A Risk Factors, 7 MD&A. A paper was presented at WWW 2025. Fixes our biggest exposure-noise risk (DESIGN §8: "mentions ≠ dependence") by counting a concept only when it appears in **Business / MD&A, not Risk Factors**. Also the base for v2 emerging-keyword discovery. Its companion EDGAR-CORPUS (HuggingFace) has 10-K sections 1993–2020 for long history. |
| [zanistaai/AI-in-Finance](https://github.com/zanistaai/AI-in-Finance) | 30 | The idea, not the code: score companies by embedding similarity to a concept profile. An alternative exposure measure to keyword counts. The repo itself uses today's Yahoo descriptions, which isn't point-in-time. Ours would embed dated filings. |
| [microsoft/qlib](https://github.com/microsoft/qlib) + RD-Agent | 49k | A research-grade quant platform with automated factor mining. Heavy (Python), China-market defaults, and automated factor search overfits easily. Only worth it if we move to ML factor models. |

## Not useful / caution

| Repo | ★ | Why not |
|---|---|---|
| virattt/ai-hedge-fund | 64k | LLM agents role-playing famous investors. "Educational only", places no trades, no validated performance. Popularity ≠ edge. |
| xbtlin/ai-berkshire | 17k | Claude Code value-investing prompts. Claims +69% (2024) and +66% (2025) **live** returns, self-reported, unverified, and it funnels to a WeChat channel. Treat as marketing until audited. |
| AutoHedge, ai-market-maker, ai-hedge-fund-crypto, TradingAgents variants | — | Multi-agent LLM trading demos with no out-of-sample evidence. |
| backtesting.py, nautilus_trader, rqalpha, backtrader forks, pybroker… | — | Good engines, but we already have our own point-in-time harness. An engine doesn't create an edge. |
| alphanome-ai/sec-parser | 294 | No longer maintained (says so on its README). |
| stocksight, bulbea (checked earlier) | — | Dead APIs. LSTM-on-price is the classic "lagged copy" illusion. |

## Actions for the world model

1. **v2 exposure:** use edgar-crawler-style item splitting. Count concept mentions in **Item 1 + Item 7 only**, and treat Item 1A as a risk mention (separate channel). Add this as a pre-registered v2, not mid-holdout.
2. **v2 discovery:** emerging-keyword detection on Item 1/7 text. Terms whose share jumps vs their own history become concepts automatically, removing the hand-picked taxonomy (DESIGN §8 hindsight risk).
3. **Benchmark list:** add any audited, dated public track record (like the Situational Awareness 13F) as a baseline. Self-reported returns don't qualify.
