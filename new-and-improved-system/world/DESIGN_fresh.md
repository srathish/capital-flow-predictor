# Fresh-filing event study — data BEFORE the move (locked 2026-10-05, before any data pull or result)

**Why.** 13F data is stale: a copier misses ~51% of the average new position's excess move, and ~56% for the best managers (world/staleness.mjs). This tests filings stamped **days** after the decision.

**Universe.** The 1,165-company world universe; the eligibility rules are the same as v1–v4.

**Events** (2022-01 → 2026-03, public = SEC filing date):

| | Event | Signal |
|---|---|---|
| **E1** | Initial Schedule 13D on the company (form `SC 13D` or `SCHEDULE 13D`, not amendments): someone crossed 5% with intent | long |
| **E2** | 8-K Item 1.01 (material definitive agreement) **without** Item 2.03 (so not a debt or financing agreement): a signed contract or deal | long |
| **E3** | 8-K / 10-Q text with guidance-raise language: "raises/raised/raising (its) (full-year) guidance/outlook", "increases full-year guidance" | long |
| **E3−** | the same with "lowers/lowered/lowering/reduces/cuts guidance/outlook" | short |

- One event per company per type per 20 sessions.
- **Entry:** the CLOSE of the first session strictly after the filing date. The filing-day move is reported separately as "day-0" (how much is already gone).
- **Outcome:** excess return vs the universe median over 5, 20, 60 and 126 sessions after entry.
- **Control:** the same stocks on 5 random non-event dates each.
- **Halves:** 2022–2023 / 2024–2026-03.
- **PASS** (per event type): 60-session excess > control in BOTH halves, and the event-minus-control t ≥ 2.
