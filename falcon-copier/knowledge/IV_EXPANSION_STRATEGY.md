# IV Expansion (into earnings) — Archi's playbook, distilled

Third-party educational synthesis of Jack's [SKY] write-up. This is a **stock/earnings** strategy — NOT the 0DTE index agent. Captured as a candidate future workstream + for the one crossover (expected-move-from-straddle) that *does* apply to the index.

## The core idea
Into a scheduled earnings date, options **IV ramps up** (they get more expensive), then **crushes** after the print. The play: **buy the IV expansion, sell before the print** — capture the premium inflation while dodging the crush. You can get **30–60% run-ups on contracts with little/no earnings (directional) risk.**

## Why premium inflates — IV RAMP
- Writers don't *set* IV; IV is the number that makes the model price = the market (bid/ask) price. When they refuse to let premium decay normally because a known catalyst sits in the option's life, the inverted IV *rises*.
- Premium = **diffusion vol** (normal day-to-day wiggle) + **event premium** (extra for expected variance around earnings/CPI/PCE). The ramp = the event premium being priced in.
- A rational market maker won't sell cheap optionality that contains a coin-flip event, **regardless of retail demand**. Demand *amplifies/accelerates* the ramp; the **event itself creates it.**

## The ramp timeline (what to watch)
- **7–10 trading days before**: slow, gradual IV climb (most visible in the contract that *contains* the earnings date).
- **Last 1–3 days**: sharp acceleration — a sudden several-point IV jump is normal.
- **Last 24–48h**: final wave of speculation/hedging.
- **Print → next open**: event resolves → **IV CRUSH.** Can drop **50–60% of the pre-event IV** overnight (100% IV → ~40–50%). OTM options get "rinsed like lint in the dryer."

## The buyer's trap (why this matters)
**You can be directionally right and still lose.** Buy calls 2 days before ER, stock gaps up, you *lose* — the IV crush destroyed more value than your directional gain. To win as a premium *buyer* into the print, realized move must beat implied move by enough to outsize the crush, *in your favor*.

## Expected move ≈ ATM straddle  ← the crossover that applies to the INDEX too
- The market's priced-in move ≈ **price of the ATM straddle** (call + put at the nearest strike) in the **first expiry after the event**. $200 stock, $10 ATM straddle → ~$10 (±5%) expected move.
- The whole earnings game reduces to one question: **will the ACTUAL move be LARGER or SMALLER than the implied move?** Buyers of premium need realized > implied; sellers win when realized < implied.
- **Inverted term structure into an event**: front expiry IV >> back months = the event premium isolated in the near contract. After the report it collapses and the curve reverts to normal upward slope. (This is the same mechanism our new `higher_timeframe` + VIX term-structure senses can surface on the index around FOMC/CPI.)

## Run-up ≠ IV ramp
- **IV ramp is universal + symmetric** — happens to every optionable stock with a scheduled ER, calls AND puts richer (variance is priced).
- **Price run-up is directional + conditional** — not universal. Documented tendencies:
  - *Over-extrapolation (Kelly et al. 2016)*: previous winners (top-decile recent returns) drift ~**+11 bps/day** in the 5 days before earnings. Cross-sectional — winners only, not the average ticker.
  - *Late reporters drift*: firms reporting later than industry peers show predictable pre-announcement drift (peers reveal the read-through). ~100 bps/month in tests.

## Structures that reduce crush exposure
- **Calendar / diagonal**: sell the front (high-IV, about-to-crush) expiry, buy a later one → net out some crush.
- **Vertical / debit spread**: long + short at different strikes, same expiry → both legs inflated, partially offsets IV.
- **Wait for the crush**: enter directional *after* the report, play post-earnings drift with normalized IV.

## Gauges
- **IV Rank / IV Percentile** — how elevated IV is vs the stock's own history (rank = past-year range, outlier-skewed; percentile = how often this high, outlier-insulated). Rich premium ≠ high raw IV.
- **Front-vs-back IV** (term structure) — how inverted = how much pure event premium.
- **Implied vs historical realized earnings moves** — straddle-implied vs how much the stock *actually* moved last several ERs → over/under-priced event.

## ARCHI'S ACTIONABLE METHOD (the playbook)
1. **Spend one earnings season taking notes** (or use a tool): 7–10 days before ER, screenshot/record current IV, then **update the inflation daily** (heavy effort the last 3 days).
2. **Monitor the premium on the ~0.4-delta contract** (the one that ramps cleanly).
3. If a ticker's IV inflation was strongly in your favor, **play the IV expansion next earnings season** — buy 7–10 days out, ride the ramp, **exit before the print** → 30–60% run-ups with little directional/earnings risk.

## How it maps to us
- **Not the 0DTE index agent** (SPXW/SPY/QQQ have no earnings). This is a **separate stock/earnings workstream** — a natural fit for the existing stock-GEX effort (screen earnings calendar → track .4-delta IV ramp → enter 7–10d out → exit pre-print).
- **The one live crossover**: *expected-move-from-the-ATM-straddle*. For the index, the **0DTE ATM straddle prices the expected daily range** — a candidate sense for the agent (set realistic targets/stops; a move beyond the implied range is significant). And around FOMC/CPI, the index shows the same event-premium ramp + crush → reinforces the **econ-calendar** need.

## Candidate build (if we pursue the earnings workstream)
Earnings-calendar screen (UW `get_upcoming_earnings`) → per ticker track IV history + the .4-delta contract's IV daily from 10d out → flag strong, consistent ramps → paper-enter 7–10d pre-ER, exit day-before-print → validate the 30–60% claim on real data before any capital. Same v2 rigor (mirror + real fills + diary) as the 0DTE system.
