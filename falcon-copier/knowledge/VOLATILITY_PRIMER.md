# Volatility Primer — field notes for the agent (from hazy / Architect / Jack, Sky community)

Third-party educational synthesis. Distilled for the 0DTE index agent (SPXW/SPY/QQQ). "How it maps to us" callouts mark what's actionable now.

## 1. VIX pivot — the market-wide bull/bear tilt
- A **pivot line** = the dividing line for who controls momentum (bulls vs bears).
- VIX usually moves **inverse** to price (VIX up → spot down) ~80% of the time.
- **VIX above its pivot → market bearish tilt. VIX below pivot → bullish tilt.**
- The pivot (and VIX targets) act as **support/resistance** — VIX bounces off them.
- **The 10-min / 2-candle rule:** once VIX crosses the pivot on the 5-min chart, wait for **two consecutive 5-min candles to close FULLY beyond** it (no wick touches the pivot) to confirm the bull/bear flip.
- **How it maps to us:** the pivot *value* is posted discretionarily by Architect (not auto-fetchable). We compute tilt + the 2-candle confirmation ourselves, default the pivot to prior-day VIX close (proxy), and read a manual override from `falcon-copier/vix_pivot.json` `{ "pivot": <n>, "targets": [...] }` when Architect posts it.

## 2. VIX term structure — your market bias
- VIX futures term structure = price of vol at each future expiry; shows WHEN the market expects stress.
- **CONTANGO** (front < back, upward slope) = normal/healthy = **coasting → neutral-to-BULLISH bias.**
- **BACKWARDATION** (front > back) = near-term vol at a premium = **market stressed → BEARISH bias.**
- It's a **delayed signal** (takes days to backwardate under stress). Shorts can work in contango but the market is long-biased there.
- **How it maps to us:** approximate the curve from VIX1D / VIX9D / VIX(30d) / VIX3M (all pullable). Front<back = contango, front>back = backwardation. This is a standing macro bias the agent should weigh. Check https://vixcentral.com for the real curve.

## 3. Spot-vol correlation & skew (why VIX rises when price falls)
- Market is structurally long via **equities** (401k/pensions), hedged with **OTM puts** (cheap insurance).
- Constant put demand → **OTM puts richer than OTM calls = skew.** VIX is derived from OTM options, so **puts disproportionately drive VIX.**
- Price falls → puts bid up → VIX rises → IV across options rises → **feedback loop** (spot down / VIX up).
- VIX can rise WITH price when funds chase via calls (rarer, temporary).

## 4. VIX & price action — the regimes (hazy's bands)
- **Low VIX (≤16):** hard for price to move; **chops/grinds up slowly.** Options cheap but slow (snail P/L).
- **Moderate VIX (17–24):** the **sweet spot** — pay a bit more, but moves are meaningful; well-timed entries pay fast.
- **High VIX (≥25):** options inflated, moves **violent in BOTH directions**, **levels get blown through**, expensive + dangerous → **size down**, expect whipsaw.
- **How it maps to us:** drives entry style + size. Low = trend-friendly, pins hold, can chase a rip. High = favor pullback entries, smaller conviction/size, wider stops, don't trust levels as much.

## 5. The volatility measures (by horizon / index)
| Measure | Horizon | Note |
|---|---|---|
| **VIX1D** | 0DTE | **most relevant to us** — today's expected vol |
| VIX9D | ~weekly | 0DTE/weekly exposure |
| VIX (30d) | 30 days | the standard gauge |
| VIX3M | 3 months | less reactive |
| VIX6M / VIX1Y | 6mo/1yr | mean-reverting, unreactive, long-term risk |
| **VXN** | Nasdaq | **QQQ-specific vol** (runs higher, higher beta) |
| RVX | Russell | twitchiest (small caps) |
| VXD | Dow | smoothest, lowest vol |

## 6. IV expansion / crush (event premium) — for scheduled events
- Into a scheduled high-variance event (earnings; for the **index: FOMC / CPI / PCE / NFP**), option writers won't let premium decay normally → **IV ramps** (7–10 days out slow climb, sharp acceleration last 1–3 days).
- Premium = **diffusion vol** (normal wiggle) + **event premium** (extra for the known catalyst). The ramp is the event premium being priced in.
- When the event resolves, **IV crushes** (can drop 50–60% overnight). OTM options get "rinsed."
- **The buyer's trap:** you can be **directionally right and still lose** — the IV crush destroys more than the directional gain. Buy calls before the event, gap up, still lose.
- **Expected move ≈ ATM straddle** (call+put at spot) of the first expiry after the event. The game reduces to: **will realized move > implied move?**
- **Inverted term structure into an event** (front IV > back IV) isolates the event premium.
- Structures that dodge crush: calendar/diagonal (sell front, buy back), verticals/debit spreads, or **wait for the crush** and play post-event drift.
- **How it maps to us:** on the index this is the **macro-event premium** (FOMC/CPI days). Reinforces the need for the **econ calendar** sense: before a scheduled event, near-dated index options carry event premium (buying them = fighting the crush); after, IV normalizes. A 0DTE long into an event that doesn't move enough = double-bled (theta + crush).

## 7. IV Rank vs IV Percentile (judging if premium is rich)
- **IV Rank:** where IV sits in the past year's range (outlier-skewed by one big event).
- **IV Percentile:** how OFTEN IV has been this high (outlier-insulated).
- High rank + high percentile = genuinely rich (often pre-event). Low rank + low percentile = cheap.
- Sell-side "traps" = writers jack IV ahead of a known event. Tell by a 1-yr chart: is recent realized vol actually elevated, or is IV just being pumped for the event?

## Resources (from the community drop)
vixcentral.com (term structure) · gexstream.com · godelterminal.com · quantocracy.com · trendfollowing.com/resources · sklearn supervised learning · plus book/orderflow drives (see chat 8/1).

## What we're building from this (actionable senses)
1. **VIX block v2**: level + band (≤16/17-24/≥25) + **VIX1D** (0DTE vol) + **term structure** (contango/backwardation → bias) + **pivot/tilt/2-candle-confirmation** + VXN (QQQ vol).
2. **Doctrine**: the agent reads vol regime → low=trend/chase/pins-hold, high=chop/pullback/size-down; term structure = standing bull/bear bias; VIX pivot tilt = directional lean; near a macro event, near-dated premium is event-inflated (crush risk).
3. **Later**: real econ calendar (FOMC/CPI) for event timing; manual `vix_pivot.json` override for Architect's pivot; VXN into QQQ decisions.
