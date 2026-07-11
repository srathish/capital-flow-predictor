---
title: UW Real-Pricing Research — Consolidated 15-Study Report
source_url: repo://apps/gex/research/uw/out/UW_RESEARCH_REPORT.md
source_domain: bellwether-repo
fetched_at: '2026-07-11T18:16:47Z'
trust_tier: 1
category: my-findings
topics:
- own-research
- gex
- 0dte
- unusual-whales
- flow
summary: '**Isolated research module. Nothing in the live trading path changed. Revert: `rm -rf'
url_sha1: 4283258492fad3d24636a8b576e7e8e46bdee66d
simhash: '10765039208459211334'
status: vault
ingested_by: seed
---

# UW Real-Pricing Research — Consolidated 15-Study Report

**Isolated research module. Nothing in the live trading path changed. Revert: `rm -rf apps/gex/research/uw`.**

Data: real 1-minute option candles for every replayed fire's exact contract (UW, ~2,900 contracts inc. moneyness variants), UW per-minute net-premium flow (SPY/QQQ/SPX × 64 days), joined to the Skylit archive (surfaces, VIX) and the 64-day fire replay. Sample for trade studies: the 537 final-system plays (G7-PC + dedupe), priced with the live exit rule unless stated. Raw outputs: `UW_DEEP_RAW.md`, `UW_DEEP2_RAW.md`, `UW_DEEP3_RAW.md`, `priced_plays.csv`.

---

## THE HEADLINE

**In real option dollars the frozen system is negative: −$12,310 (−3.5%) entering ATM at the fire candle.** The 30bps proxy used in all prior validation could not see theta, real entry pricing, or premium structure. Every prior gate decision retested tonight against real marks.

**And the fix stack, discovered from these studies, flips it:**

| Layer | n | Real P&L | Win |
|---|---|---|---|
| L0 current system, at-fire | 537 | −3.5% | 52% |
| L1 + 1-min option-up confirmation | 224 | +2.7% | 57% |
| L2 + 5-min flow agreement | 120 | +12.3% | 59% |
| **L3 + flow not one-sided (exhaustion veto)** | **83** | **+21.2%** | **59%** |

Overfit control: the S13 regime matrix shows the L3 stack **positive in every single regime cell** (GEX+/−/0, VIX up/dn/flat, up/down/flat days, trend/chop, Fri/Mon-Thu: +5.4% to +36.5%), and the S15 no-trade score survives an odd/even-day holdout in ordering (below). Still: filters were selected on this data — forward validation required before sizing.

---

## Study-by-study verdicts

**S1/S11 — Contract selection & moneyness (final, full 537-play sample per variant):**
The partial-sample OTM edge in GEX−/neutral largely washed out at full sample (2-OTM +3.5%, 1-OTM +3.0% vs ATM +3.3%; 2-ITM actually leads that cell at +4.2%) — treat moneyness tweaks as noise-level. The claim that SURVIVED at full sample: **next-expiry ATM is the most defensive contract in every cell — −0.1% overall vs ATM −3.5%, and only −1.6% even in GEX+.** One extra day of expiry nearly eliminates the theta bleed that makes 0DTE ATM negative. VIX-falling still favors 1-OTM (+5.0%). In GEX+ every contract loses — skip the trade, don't fix the contract. True 25Δ/35Δ targeting deferred (needs historical greeks).

**S2 — Entry timing (major, cheap to adopt):** at-fire is the WORST entry (−3.5%). +1 min −0.2%, and the option actually gets *cheaper* on average 1 min after the fire (−0.2% reprice) — there is no urgency premium. **Confirmation entry (only if the option is up 1 min later): +2.7% and 57% win while halving trade count.**

**S3 — Exit grid (validates current exits, kills profit targets):** most regime-robust rules are loss-bounded: SL−30% (avg rank 3.4), SL−20%, time-60min. **Every fixed profit target destroys P&L (PT+20/30/50%: −6.4 to −7.4%)** — they amputate the convexity tail that pays for the book. The live struct+trail is mid-pack standalone but interacts well inside the stack (hard SL on top of the full stack *reduced* it: +21.2% → +6.2%). Verdict: keep structural exits + trail, no profit targets, no hard stop.

**S4 — MFE/MAE:** median play peaks +28% at 13 min, troughs −33% at 19 min. 54% of losers never worked (MFE<10%) vs only 19% "signal right, exit failed" → in dollars the leak is **entry selection**, not exits — consistent with S2/S15.

**S5 — Overpriced at entry:** terciles by realized-move ÷ premium: cheap tercile +7.1%/58% vs overpriced −8.0%. Loss decomposition: 40% of losses = option too expensive/no move, 60% = direction/timing. Premium-vs-expected-move is a real feature family (ex-ante version = breakeven distance, used in S15).

**S6 — Liquidity proxies:** premium band $0.50-2 = +6.9%/59% vs $2-10 = −11.4%/43% (largely the SPXW effect). Thin entry-candle volume −6.3%. True bid/ask spreads unavailable in candles — flagged as the top data gap.

**S7 — Flow confirmation tiers:** the 5-minute window is the signal (agree +3.1% vs disagree −10.9%; 1-min = nothing, 15-min weaker). Acceleration agrees: +1.3 vs −9.4%. **Best cell: agreeing but MIXED flow +5.9%/60% — one-sided agreeing flow is already exhausted (−7.1%/42%).** → `flow_confirmation_score` = agree(f5) AND not one-sided(f15).

**S8 — Flow exhaustion:** top-decile bullish flow → zero 30-min follow-through (−0.0bps); by time of day: **morning extremes FADE (bull-extreme −5.1bps), afternoon extremes CONTINUE (+2.8bps)**. Mirror for bear flow. VIX co-movement adds nothing. → exhaustion is real, time-dependent, and already embedded in the stack via one-sidedness.

**S9 — GEX/VEX regimes in dollars (biggest structural insight):** positive-GEX fires −8.9% vs neutral +5.4% / negative +1.2%. Distance to target-side wall: sweet spot 50-100bps (+6.5%); <20bps = no room (−7.6%). Gamma-flip proximity: 30-100bps away is the sweet spot (+6.0%); >100bps (deep in pin territory) −9.9%. **TREND days +6.3% vs CHOP days −12.6%.** The map regime decides whether premium can be paid at all.

**S10 — Time of day:** the bleed is **13:30-15:00 (−15.7%)**; lunch is actually fine (+3.3%); 9:30-10 negative in dollars (−4.1%) despite good direction — options at the open are priced for the move. Median time-to-peak only 8-21 min everywhere → this is a scalp-tempo system whatever we intended.

**S12 — Convexity:** only 36% of plays clear breakeven by EOD. Per 10bps of favorable underlying move: SPY +6.3%, QQQ +4.3%, SPXW +3.6% — SPXW pays the most premium for the least convexity. Ticker ranking in dollars: QQQ +3.6% > SPY −1.2% > SPXW −4.5%.

**S13 — Regime matrix:** base system negative in most cells; **stack positive in all 13 cells**. Best stack cells: down days +36.5%, trend days +36.5%, up days +35.1% — worst: chop +5.4%. The stack needs no regime switch; regimes only modulate size.

**S14 — Events:** NFP days +6.3% (stack +47.6%), FOMC +2.6% (stack +21.2%), big-open days flat (stack +31.2%), OPEX/Fridays fine. **No event-day exclusions warranted** — event volatility feeds the stack.

**S15 — NO-TRADE SCORE (the synthesis):** six red flags — afternoon window (13:30-15:00), posGEX+no-room-to-wall, flow exhausted, flow against, pin on spot, breakeven >30bps:

| Red flags | n | Real P&L | Win |
|---|---|---|---|
| 0 | 60 | **+35.4%** | 60% |
| 1 | 178 | −5.4% | 48% |
| 2 | 162 | −7.1% | 54% |
| 3 | 101 | −14.5% | 53% |
| 4 | 31 | −16.7% | 39% |

Monotone. Odd/even-day holdout: ≤1-flag beats ≥2-flag on both halves (+8.3% vs −11.9%; −0.2% vs −8.0%) — the *ordering* is robust, absolute level varies. The cleanest tradeable statement of everything above: **only 0-flag fires, sized normally; everything else is observation.**

---

## What we need to ADD (ranked)

1. **Live feature logging (do before tomorrow's open, zero risk):** stamp every live fire with the stack features — 1-min confirmation outcome, f5 flow sign, one-sidedness, red-flag count, GEX regime/wall distance. Pure observation into `supporting_state`; builds the forward-validation sample automatically.
2. **True spread data:** candles carry no NBBO. Sample entry-time spreads from UW's per-trade flow endpoint for a subset to finish S6 properly (the last unpriced execution cost).
3. **Delta-targeted variants (25Δ/35Δ):** needs historical greeks per contract; approximated by moneyness tonight.
4. **Sweeps-vs-blocks flow tier:** needs the raw flow tape; would refine `flow_confirmation_score`.
5. **More history / other regimes:** 64 days, one macro up-trend. Re-run the whole suite quarterly as the archive grows; the infrastructure is one command per module now.
6. **Forward-validate the stack ≥2 weeks before any sizing** — the standing bar.

## Recommended v2 changes (pending forward validation)

- Entry: fire → wait 1 candle → enter only if option up AND f5 flow agrees AND flow not one-sided AND 0 red flags
- Contracts: prefer QQQ/SPY over SPXW ATM; consider next-expiry ATM when premium >30bps breakeven; OTM only in GEX−/neutral
- Exits: unchanged (structural + trail) — validated; no profit targets, no hard stops
- No-trade: 13:30-15:00 window; posGEX with <20bps room; pins
