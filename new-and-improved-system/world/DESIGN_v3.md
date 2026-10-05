# World model v3 — the smart-money graph (locked 2026-10-05, BEFORE downloading or looking at any 13F results)

**Idea.** Copying one fund (Situational Awareness LP) beat everything in the v1 holdout, but that fund was found with hindsight. v3 generalizes it without hindsight:
1. Score **every** 13F manager on its past picks, using only data public at the time.
2. Find the managers with a real record.
3. Copy the consensus of their **new** positions.

13F filings are public and dated, so this can be backtested point-in-time. There is no LLM in the loop, so there is no look-ahead.

## Graph

**Nodes:**
- every 13F filer (manager)
- every security held
- every Form 3/4/5 reporting insider
- every issuer

**Edges:**
- manager → security holding (value, shares, put/call), per quarter
- insider → issuer transaction

**Source:** SEC Form 13F Data Sets and Insider Transactions (Form 345) Data Sets, 2021 → 2026. Free.

Node and edge counts are reported as measured. The goal is the full graph, not a target number.

## Point-in-time rules

- A holding is known on its **13F filing date**. Amendments count from their own date.
- **Prices:** only securities in the priced world universe (1,091 companies) are scored or traded. Other holdings still count as graph edges.
- **CUSIP → ticker:** SEC issuer name matched to the SEC ticker list. Unmatched CUSIPs are dropped and the count is reported.
- **Entry:** the next session's close after the filing date (tradable).

## Manager skill (as of date t)

1. A manager's **new or increased positions**: share count up ≥ 25% vs its previous 13F, or newly held. Calls count as long. Puts are excluded.
2. Each such position is scored by its 6-month forward return minus the universe median, measured from entry.
3. Only positions whose 6-month window **ended before t** count.
4. **Skill** = mean excess × n / (n + 20). This shrinks managers with few positions toward 0. A manager needs ≥ 20 scored positions in the trailing 3 years.
5. **Skilled set at t** = the top 2% of eligible managers by skill.

## Signal

At each month-end t:
- Each stock's score = the number of skilled managers that disclosed a new or increased position in it in filings dated within the last 90 days, weighted by each manager's skill.
- **Top 20** by score, equal weight. Hold 6 months.
- Target: 6-month return minus the universe median (same as v1/v2).

## Baselines

| Baseline | What it is |
|---|---|
| **Crowd** | The same signal using ALL managers, equal-weighted. Tests whether skill matters or just popularity |
| Momentum 12-1 | |
| Situational Awareness copy | |
| Random same-sector | |

## Protocol

- **Skill warm-up:** 2021–2022 filings.
- **Development:** month-ends 2023-07 → 2024-12.
- **Holdout:** month-ends 2025-01 → 2026-03, run **once**.
  - *Disclosure:* I've seen which themes won in 2025, but v3 has no knobs fit to outcomes. Every parameter above is fixed now.
- **PASS** (all four must hold on the holdout):
  1. Top-20 > Situational Awareness copy.
  2. Top-20 > Crowd.
  3. Top-20 > Momentum.
  4. IC > 0 with t ≥ 2, and per-symbol win > loss.
- **Kill switch** applies.

## Live

If it passes:
- Each new 13F filing season updates the skilled set and the picks, logged with dates.
- The **thesis engine** (monthly AI reasoning over the same data) runs alongside it, judged on its own live log only.
