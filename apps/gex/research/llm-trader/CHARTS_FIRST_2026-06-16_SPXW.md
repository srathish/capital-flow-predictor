# Charts-First 0DTE — SPXW 2026-06-16 (session cf0616)

Blind out-of-sample. Read only CF_METHOD.md + harness output. Paper/RESEARCH.
Day arc: SPX opened ~7554, faded to 7550, then spent the entire session locked in an
extreme positive-gamma pin (7530 floor / 7550 pin) that intensified to +286M net gamma by
mid-afternoon before finally resolving DOWN in the last 45 min (new low 7513.74, pin
collapsed into a 7525 barney). Trend read all day: below VWAP, range/downtrend, levels hold.

Result: **2 trades — 1 win, 1 small managed loss. Net +27.94% on the two ATM 0DTE calls.**

---

## Trade 1 — LONG (exhaustion-V off the 7530 floor)  ✅ WIN

- **Entry:** 10:33 ET (14:33 UTC) · spot 7536.55 · ATM strike 7535 · `SPXW260616C07535000`
- **Exit:** 10:41 ET (14:41 UTC) · spot 7548.85
- **Chart thesis:** Price flushed from the 7564 highs down to the day-low 7533.75, then printed a
  low-then-close-higher hammer (10:30 candle) and turned up. Oversold bounce, price below VWAP 7555
  = room to mean-revert. I waited for the reversal tick (7533.75 → 7536.55) before committing rather
  than catch the falling knife.
- **GEX confirm:** 7530 pika floor (+10.5M) held its first test; regime still POSITIVE-gamma (+71M)
  which *favors* the mean-reversion up; king pin 7560 sat ~24 pts overhead as the magnet with no wall
  in between. Floor holding + positive gamma + pin target = long confirmed.
- **Management:** Capped the winner into the opposing node — as price reached the 7550 king pin
  (which had migrated down and firmed to +22M, net gamma +109M) with VWAP 7554 as confluence
  resistance, I exited rather than chase the last points into a strong pin. Price immediately
  stalled at 7548, confirming the exit.
- **Real P&L:** entry close $14.80 → exit close $20.80 → **net = 20.80·0.985 / (14.80·1.015) − 1 = +36.39%**
  (underlying only moved +12.3 pts / +0.16%; ATM 0DTE gamma leverage turned that into +36% net).

## Trade 2 — LONG (reversion off the held 7535 floor)  ❌ LOSS (small, managed)

- **Entry:** 11:31 ET (15:31 UTC) · spot 7539.27 · ATM strike 7540 · `SPXW260616C07540000`
- **Exit:** 11:40 ET (15:40 UTC) · spot 7538.65
- **Chart thesis:** Price held the 7535 floor and printed a green reversal candle (11:30:
  7536.8 → 7539.3 closing on its high), turning up from the lower box while below VWAP 7549 = room
  to revert toward the 7550 pin.
- **GEX confirm:** Net gamma surged to an extreme +134M (strongest pin of the day at that point);
  king pin 7550 (+30M) sat ~11 pts overhead; floor 7535 strengthening hard (1mΔ+1.7). A textbook
  positive-gamma reversion setup — but a *thinner* one, since I was entering above the low (~11 pts
  of room vs the ~20 pts on Trade 1).
- **What went wrong / management:** The extreme pin ground sideways instead of traveling. Price poked
  7544.4, got rejected, and drifted back to my entry, then toward the floor. The push-to-pin thesis
  stalled and a 0DTE long only bleeds theta in a dead pin, so I exited fast near breakeven on the
  underlying (−0.01%) rather than hope the +127M pin would let price run. Good thing: right after,
  price dipped to 7528.57.
- **Real P&L:** entry close $10.60 → exit close $10.00 → **net = 10.00·0.985 / (10.60·1.015) − 1 = −8.45%**
  (gross −5.7% option + the ~3% round-trip cost haircut; kept small by the fast exit).

---

## Trades NOT taken (selectivity / discipline)

- **The whole midday/afternoon pin (11:41 → 14:54):** net gamma intensified from +127M to +286M,
  box tightened to 7530/7550 then 7530/7540 with a +87M king node. Textbook strong positive-gamma
  pin = untradeable. Stayed flat. Correct.
- **Three floor-break "fakeouts" at 7530 (11:45→7528.57, 13:20→7529.38, 13:35→7526.05):** each was
  bought back and the floor was rebuilt *stronger* (peaking at +46M, 1mΔ+5.3). I demanded break
  confirmation before shorting and it never came — a short would have been squeezed. Correct stand-down.
- **The real late-day breakdown (15:00–15:15, 7526 → 7513.74):** this was the day's second clean move
  and it fired *inside* a 30-min fast-forward — I missed the entry. By the time I looked (15:24), the
  pin had collapsed (net +286M → +107M) and a 7525 barney (−131M) had formed, but price was bouncing
  UP into it with only ~19 min to auto-flat and a strong 7510 floor capping downside. A two-sided
  negative-gamma inflection with no confirmed rejection and savage end-of-day theta = no clean edge.
  Stood down. This is the one place tighter granularity in the afternoon would have helped.

## Self-assessment

- **Did charts-first catch the day's move?** Yes for the tradeable one. The morning exhaustion-V
  (flush to the 7530 floor → reversal → bounce to the 7550 pin) was the cleanest, highest-probability
  0DTE opportunity of the session, and reading the chart first (hammer at the day low) with GEX only
  confirming (held pika floor + positive-gamma mean-reversion + pin target overhead) caught it for
  +36% net. Capping into the opposing node was exactly right — the pin rejected immediately.
- **What I got right:** patience through a strong pin (mostly flat, no round-trip churn), waiting for
  the reversal trigger instead of catching knives, capping the winner into the pin, and cutting the
  weak second trade fast (−8% instead of letting it become a real loss). Also correctly refused to
  short three floor-break fakeouts that a mechanical "floor giving way" rule would have taken.
- **What I'd do better:** Trade 2 was a marginal, thin-edge reversion I probably shouldn't have taken
  — same setup as Trade 1 but with a worse entry (above the low) into a pin so extreme it just grinds.
  Recognizing "extreme pin = travel is dampened, skip the mid-box longs" would have made it a
  1-trade, +36% day. And I fast-forwarded through the genuine late-day pin-collapse; in the last
  ~90 min of a day this heavily pinned, I should have dropped to finer steps to catch the resolution.
- **Net:** +27.94% across 2 trades. One A-grade discretionary win, one small disciplined loss, and a
  lot of correct flat time. Charts-first (price makes the thesis, GEX only confirms) worked.
