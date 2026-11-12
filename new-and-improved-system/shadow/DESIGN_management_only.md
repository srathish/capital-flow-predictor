# Management-only test: do node-based exits beat fixed exits on random-direction entries? (locked 2026-11-11, before any board pull)

Why: the community's claim, read carefully, is not that the map predicts direction but that it tells you where to take profit and
where you are wrong. Every entry rule we tested is a coin. This test removes the entry entirely (direction by coin) and asks only
whether Skylit node levels, used as exits, add money over fixed exits and over distance-matched random levels.

## Data

- **Boards:** Skylit `/v1/historical` at 10:30 ET (converted to UTC per session with the America/New_York zone, so 14:30Z in
  summer and 15:30Z in winter), `symbols=SPXW,SPY,QQQ`, `metric=gamma`, `maxStrikes=200`, `maxExpirations=5`, `layout=matrix`,
  `includeEmpty=false`, one call per session 2025-05-01 → 2026-10-16 (≈ 370 calls × 5 credits ≈ 1,850 credits, user-approved
  2026-11-11). Cached at `.cache/skylit_boards_1030/<date>.json`. Provenance: today's API history; internally consistent, NOT proven
  to be what was live (see gammalab/reports/REPLAY_VS_API.md). Any pass is labelled accordingly.
- **Prices:** UW 1-minute bars (`.cache/uw/m1`), SPY and QQQ.
- **Options:** SPY/QQQ 0DTE, strike nearest spot at 10:30, UW minute prices (`.cache/uwopt_intraday`, fetched where missing).

## Levels (from the 10:30 board, front expiration column = session date; aggregate 5-expiration as a secondary board)

King = strike with the largest |value|. A **node** is any strike with |value| ≥ 20% of the King (Garma's P20). In the trade
direction, the **target** is the nearest node at least 0.15% away from spot; against the trade, the **stop level** is the nearest
node at least 0.15% away. If either is missing, the trade is skipped and counted.

## Trades

One trade per symbol-day (SPY, QQQ). Direction = coin (`random.Random(2026).choice`), fixed before any result; the mirror
(opposite direction on the same days) is reported as a second sample. Entry at the 10:31 minute price of the ATM 0DTE option
(call for up, put for down) + $0.02; exit − $0.02; $0.65 commission per contract per side. Underlying touches are judged on 1-minute
highs/lows after 10:31; option exits use the option minute close at the touch minute. Everything flattens at 15:55.

Exit rules compared, each applied to the same trades:
- **F1 fixed:** +30% of premium target / −50% stop (pckt's Timmy v4 "+30% on half" simplified to all-out).
- **F2 hold:** no exits until 15:55.
- **N1 node:** underlying touches the target node → exit; touches the stop node → exit; also −50% premium stop.
- **N2 node target only:** target node exit, fixed −50% premium stop.
- **R1 placebo for N1:** same rule with target/stop at the same distances as N1 but taken from another random day's board
  (distances shuffled across days, 200 shuffles) — the distance-matched control this project uses for every level claim.

## Metrics and pass criteria

Per rule: mean $ P&L per trade, profit factor, hit rate (reported, not a criterion), worst trade. Paired differences by trade:
N1 − F1 and N1 − F2, t ≥ 2.0 on build; N1 must also exceed the 97.5th percentile of the R1 placebo distribution of mean P&L.
Holdout (one run): N1 − F1 t ≥ 1.65 and N1 above the R1 95th percentile. Build 2025-05-01 → 2026-03-31; holdout 2026-04-01 →
2026-10-16.

## What a pass or fail means

Pass: node levels carry exit information beyond their distance from spot; worth paper-trading as a management overlay on any
entry. Fail with N1 ≈ R1: nodes are just "some level ~X% away"; the community's management edge, if real, is not in the map.
Fail with N1 < F2: cutting at nodes destroys the convexity that holding keeps — the Nexus finding, confirmed on nodes.

## Amendments

(none)

## Result — build (2025-05-01 → 2026-03-31): **FAIL** (run 2026-11-11; boards pulled 2026-11-11, 368 sessions, 1,840 credits)

`python shadow/management_only.py build` → `results_management_only/build.json`. 432 coin trades (+432 mirror); skipped: 44 no
P20 node within range, 6 no bars, 0 missing options.

| sample | rule | n | mean $ | t | PF | win | worst | exits |
|---|---|---|---|---|---|---|---|---|
| coin | F1 fixed +30/−50 | 432 | −5.88 | −1.72 | 0.83 | 58% | −194 | tp30 252 · stop50 179 |
| coin | F2 hold to 15:55 | 431 | −20.61 | −1.88 | 0.76 | 33% | −323 | — |
| coin | **N1 node tgt + node stop** | 432 | **−8.94** | −2.37 | 0.77 | 42% | −174 | node_tgt 180 · stop50 155 · node_stop 88 |
| coin | N2 node tgt only | 432 | −7.55 | −1.85 | 0.81 | 46% | −194 | stop50 222 · node_tgt 199 |
| mirror | F1 / F2 / N1 / N2 | 432 | −6.78 / −18.19 / −6.03 / −7.37 | | | | | consistent |

Paired: N1 − F1 = −$3.06 (t −0.92); N1 − F2 = +$11.71 (t 1.13). N1 mean −8.94 vs distance-matched placebo: median −5.72,
95th −2.01, 97.5th −1.48 → N1 is **below the placebo median**. Fails all three criteria; holdout not opened.

Reading: on coin-direction 0DTE ATM entries every exit rule loses (theta + spread), as it should. Cutting at nodes beats holding to
the close only in the way any cut does (F1 beats F2 by more). Against random levels at the same distances, node levels are no
better and slightly worse. The community's "the map tells you where to take profit and where you're wrong" does not survive this
test: the information is in the distance, not in the node. Boards are today's API history (see provenance note above), so a
pass would have carried a caveat; a fail does not need one.
