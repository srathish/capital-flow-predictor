# World model v2 — design (locked 2026-10-05, BEFORE building)

**Status of evidence.** v1 failed its holdout (world/results/holdout.txt). The 2025-01 → 2026-03 holdout has now been SEEN, so v2's design choices are justified **only by v1's 2023–24 development results** and by v1's documented failure modes. v2's holdout numbers will be reported but labelled **"seen period — not validation"**. The clean tests are:
1. **Dev period 2023–24:** v2 must beat v1's dev result *and* every baseline there.
2. **The live forward log:** monthly top-20 from 2026-10 on, scored 6 months later.

## Changes vs v1 (each tied to a v1 dev-period observation)

1. **Exposure from real text, the right sections only.**
   - Download every 10-K and 10-Q (2022 → now) for the universe.
   - Extract **10-K Item 1 (Business) + Item 7 (MD&A)** and **10-Q Part I Item 2 (MD&A)**. Risk Factors are excluded.
   - Exposure(i, c) = concept term frequency per 10k words in those sections, using the filing date as the as-of date and carrying the latest filing forward ≤ 12 months.
   - *Why:* v1 dev picks were polluted by risk-factor boilerplate (banks → "digital assets", VZ → "fiber optic").
2. **Emerging concepts, discovered point-in-time.**
   - At each quarter-end, count 1–3-word phrases in the section text of filings from the last 2 quarters vs the prior 4.
   - A phrase becomes a concept when it appears in ≥ 10 companies' filings in the last 2 quarters **and** its company count is ≥ 3× the prior-4-quarter average (or new).
   - These are added to the fixed 95.
   - *Why:* removes the hand-picked-taxonomy hindsight risk (DESIGN v1 §8).
3. **Scarcity measured in context.** Constraint words count only within 25 words of a concept term. "Capital allocation" no longer reads as scarcity.
4. **Score = equal-weight average of cross-sectional percentile ranks** (no fitted weights):
   - (a) graph impact P(hit), the v1 Monte Carlo on v2 exposure
   - (b) concept heat: exposure-weighted 3-month return of the company's concepts, as a percentile
   - (c) momentum 12-1
   - (d) insider open-market buy ≥ $100k in the last 60 days (1 or 0)

   *Why:* in v1 dev, momentum (+10.9%) and hot themes (+22.0%) beat the model (+7.8%), and v1's "not yet moved" factor fought them.

## Unchanged

Universe, eligibility, point-in-time rules, next-day entry, 6-month target vs the universe median, top-20, baselines (momentum, shock-only, hot theme, random same-sector, Situational Awareness 13F copy), 10,000 draws, seeds.

## Pass

- **Dev:** v2 top-20 > v1 and > every dev baseline, with IC t ≥ 2.
- **Live:** after 6+ monthly cohorts mature, v2 top-20 > the Situational Awareness copy and momentum.

If dev fails, v2 does not go live.
