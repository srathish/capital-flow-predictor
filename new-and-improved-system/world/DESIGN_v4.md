# v4 — find the next Leopold (locked 2026-10-05, BEFORE building or any result)

**Idea.** v3 averaged 100+ skilled managers, and the edge washed out (+16.4% vs SA LP +46.8%). v4 copies **concentrated, high-conviction managers individually**.

**Disclosure.** v4's idea came from seeing that a concentrated thesis fund won the 2025–26 holdout. The holdout is therefore **semi-seen**. Every parameter below is fixed now and nothing is fit to returns, but the clean tests are the **dev period** and the **live log**.

## Rules (point-in-time, as of month-end t)

1. **Concentrated manager.** In its latest 13F filed ≤ t:
   - 5–40 long equity positions (shares, puts excluded), counting ALL holdings, not just our universe
   - total long value ≥ $50M
2. **Conviction.** A position's weight = its value ÷ the filing's total long value.
3. **Events.** New positions, or positions increased ≥ 25% in shares vs the manager's previous 13F, each carrying its conviction weight.
4. **Skill.** The conviction-weighted mean of the events' 6-month excess return vs the universe median.
   - Only events whose 6-month window ended before t, within the trailing 3 years.
   - ≥ 10 scored events required.
   - Shrunk by n ÷ (n + 10).
5. **Selected managers.** The 10 concentrated managers with the highest positive skill.
6. **Signal.** Each selected manager's events filed in the last 90 days, ranked by that manager's conviction weight. Take its top 3. Score each stock = Σ(skill × conviction) across selected managers. **Top 20** by score, equal weight, held 6 months.

Entry, eligibility, target and baselines are the same as v3:
- crowd
- momentum 12-1
- copy Situational Awareness LP
- random same-sector
- plus the v3 consensus

## Protocol

- **Dev:** 2023-07 → 2024-12.
- **Holdout (semi-seen):** 2025-01 → 2026-03, run once.
- **PASS:** dev top-20 > momentum and > v3, and holdout top-20 > SA copy and > momentum. Otherwise v4 does not go live.
