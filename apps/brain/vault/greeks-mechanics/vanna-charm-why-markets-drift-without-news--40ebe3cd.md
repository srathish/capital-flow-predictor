---
title: 'Vanna & Charm: Why Markets Drift Without News'
source_url: https://gexboard.com/learn/vanna-charm-explained
source_domain: gexboard.com
fetched_at: '2026-07-11T19:00:04Z'
trust_tier: 4
category: greeks-mechanics
topics: []
summary: '- **Vanna**= how delta changes when implied volatility changes. Rising IV → dealers buy. Falling IV → dealers sell. - **Charm**= how delta decays as time passes. Even with no price move, deltas drift and dealers re-hedge. - Vanna flows are strongest at the open and around macro events. Charm flows…'
url_sha1: 40ebe3cd8166835ee526c3f7c6ff5aeee8babd4d
simhash: '193952634196984433'
status: vault
ingested_by: ingest
---

# Vanna and Charm:

The Forces That Move Options After the Open

      
    - **Vanna**= how delta changes when implied volatility changes. Rising IV → dealers buy. Falling IV → dealers sell.
- **Charm**= how delta decays as time passes. Even with no price move, deltas drift and dealers re-hedge.
- Vanna flows are strongest at the open and around macro events. Charm flows accelerate into the close.
- A **Vanna squeeze**— IV dropping after a vol spike — is one of the most reliable low-catalyst melt-up patterns.
- Both Greeks create mechanical flow that moves price without any fundamental reason.

## Beyond First-Order Greeks

Most options education stops at the first-order Greeks: delta, gamma, theta, vega. These describe a static snapshot. In reality, options risk shifts constantly — not just because the underlying price moves, but because implied volatility moves and time passes. The Greeks that capture these second-order effects are where the real structural market flows originate.

Vanna and Charm are two of the most important second-order Greeks for understanding intraday SPY market structure. They explain moves that have no obvious catalyst, create reliable time-of-day patterns, and drive some of the most frustrating-to-trade environments: the low-vol grind up that refuses to pull back.

**Important framing:**You don't need to calculate Vanna and Charm yourself. What matters is understanding the direction of the flow they generate and when that flow is active. The rest is mechanics that happens in the background.

## What is Vanna?

Vanna measures how delta changes when implied volatility changes.

Why does this matter for hedging? Dealers delta-hedge continuously. When IV rises, the delta of their options positions changes even if the underlying hasn't moved. That changed delta creates new exposure that needs to be hedged — mechanically, regardless of any view on direction.

| Option Type | IV Change | Delta Change | Dealer Hedging Action | 
|---|---|---|---|
| OTM Call | IV ↑ | Delta increases (more likely ITM) | Buy underlying to hedge | 
| OTM Put | IV ↑ | Delta decreases (more negative) | Sell underlying to hedge | 
| OTM Call | IV ↓ | Delta decreases (less likely ITM) | Sell underlying to hedge | 
| OTM Put | IV ↓ | Delta increases (less negative) | Buy underlying to hedge | 

In a market dominated by put buying (as SPY typically is), falling IV means dealers need to *buy* the underlying to re-hedge their put books. This is directionally bullish — and it happens mechanically, without any fundamental catalyst.

## How Vanna Creates Directional Pressure

The most important Vanna dynamic in SPY is what happens after a volatility spike. When IV gets elevated — during a selloff, before a major event, or during uncertainty — dealers accumulate large short-put positions with large negative delta hedges. They're holding short underlying to offset those put exposures.

When IV reverts lower, those puts lose delta rapidly. Dealers no longer need as much short exposure. They buy back the underlying to re-flatten. This buying pressure has nothing to do with earnings or economics — it's pure mechanical re-hedging.

**The Vanna tailwind:**When IV is elevated and starts to fall, the Vanna flow is systematically bullish. This is why markets can grind higher even without good news — dealers are being forced to buy by their own hedging math.

Vanna flows are most powerful under two conditions:

- **High absolute IV:**The higher the IV, the larger the dealer delta positions built up. More to unwind = more flow on the way back down.
- **Fast IV mean-reversion:**If IV drops 3 points in a morning session, that Vanna flow is compressed into a short time window and has outsized price impact.

## What is Charm?

Charm (also called delta decay, or DdeltaDtime) measures how delta changes as time passes, holding everything else constant.

As expiration approaches, out-of-the-money options lose delta. An OTM call that had a delta of 0.25 in the morning might have a delta of 0.18 by mid-afternoon — not because SPY moved, but because time passed. Dealers who were long the underlying to hedge that 0.25 delta now have too much hedge. They need to sell the excess.

## How Charm Drives Intraday Drift

Charm is a time-based flow, so it's relatively predictable in terms of when it acts:

- **Pre-market / open:**Options are repriced after overnight gaps. Charm flows are reset and relatively small in the first hour.
- **Midday:**Steady, low-impact Charm decay across all expiries. Market often quietest here.
- **Final 90 minutes:**Delta decay accelerates sharply as 0DTE options approach expiry. Large OI at nearby strikes creates concentrated Charm flow — often driving the "drift" that closes the session near a key strike.

**Expiration-day Charm:**On Wednesdays (0DTE SPY chains) and Fridays (weekly expiry), Charm flows are dramatically stronger. The afternoon pin near a high-OI strike is frequently Charm-driven, not coincidence.

The key distinction: Charm doesn't require a price move to trigger hedging. Gamma hedging happens because SPY moved. Charm hedging happens because time passed. This is why expiration days sometimes see persistent gravitational pull toward a specific level with no obvious news.

## The Vanna Squeeze Pattern

The "Vanna squeeze" is one of the most recognizable patterns in SPY. Here's the setup:

- SPY sells off sharply. VIX spikes. Traders buy puts heavily for protection.
- Dealers absorb put buying and hedge with short SPY exposure. IV is elevated. Vanna positioning is large and bearish.
- The catalyst fades. Market stabilizes.
- IV begins to mean-revert lower. Dealers start reducing short SPY hedges as put deltas decay.
- The buying from Vanna unwind creates buying pressure → SPY moves higher → more delta decay → more Vanna buying. A feedback loop.
- Market grinds higher with no news, low realized volatility, tight intraday ranges.

**Why this is hard to fade:**The Vanna squeeze doesn't need a fundamental catalyst to keep running. As long as IV stays elevated and put open interest remains high, the mechanical bid from dealers continues. Selling into it feels correct but fights the flow.

## Vanna + Charm Together

In practice, Vanna and Charm often work in the same direction. After a volatile week with elevated IV and large put OI nearby, both flows can push bullish simultaneously:

- **Vanna says:**if IV drops through the session, dealers will be systematically buying to reduce short hedges → bullish.
- **Charm says:**as the day passes, those same puts lose delta → dealers reduce short hedges → bullish.

The result is often a persistent, low-drama grind higher with minimal pullbacks. When they diverge, you tend to get choppier, more directionally uncertain sessions.

GEXBoard's regime indicator captures the net effect of all dealer hedging flows, including Vanna and Charm dynamics. A **Long Gamma** reading during declining IV typically includes a significant Vanna tailwind.

### Track dealer flows live on GEXBoard

See the Long/Short Gamma regime updated continuously throughout the session — capturing Gamma, Vanna, and Charm dynamics in real time. From $19/mo during beta.

[Start for $19/mo →](https://buy.stripe.com/3cIaEZblG3jeaBQbEaaAw03)

## Frequently Asked Questions

## What is Vanna in options trading?

Vanna is the rate of change of delta with respect to implied volatility. When IV changes, delta changes — and dealers must re-hedge. Rising IV with positive Vanna exposure forces dealers to buy the underlying; falling IV forces them to sell. In SPY, which has dominant put open interest, falling IV typically creates a mechanical bid.

## What is Charm in options trading?

Charm (delta decay) is how delta changes as time passes toward expiration. Even without any price movement, option deltas drift and dealers must re-hedge. This creates predictable flows particularly in the final 90 minutes of a trading session and on expiration days — often explaining the "pinning" behavior near high-OI strikes.

## When is Vanna flow strongest during the trading day?

Vanna flows are strongest when IV is moving rapidly — at the open, around macro catalysts (CPI, FOMC, earnings), and during trending sessions. The first 30–60 minutes often carry the largest Vanna-driven hedging as IV reprices after overnight gaps or pre-market news. Post-event IV crush (like after FOMC) is a classic setup for a strong Vanna-driven move.

## What is a Vanna squeeze and how do you identify it?

A Vanna squeeze occurs after a volatility spike that builds large put open interest at elevated IV. When the underlying stabilizes and IV begins to mean-revert, dealers are forced to unwind their short hedges — creating mechanical buying without a news catalyst. Signs: VIX was recently elevated and is now falling, large put OI remains on the chain, SPY is grinding higher with low realized vol and tight daily ranges.

## How do Vanna and Charm affect SPY on expiration Fridays?

On expiration Fridays, both flows intensify. Charm decay accelerates dramatically as 0DTE and weekly expirations approach — delta falls quickly on near-the-money options and dealers re-hedge the difference. Vanna flow also intensifies if IV is moving. Together, these mechanics create the gravitational pull toward a specific strike (the "pin") that experienced traders recognize. They're not random — they're quantifiable structural flows.
