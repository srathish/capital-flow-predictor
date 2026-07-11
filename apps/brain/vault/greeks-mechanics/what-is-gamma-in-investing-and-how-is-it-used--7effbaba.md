---
title: What Is Gamma in Investing and How Is It Used?
source_url: https://www.investopedia.com/terms/g/gamma.asp
source_domain: www.investopedia.com
fetched_at: '2026-07-11T06:23:45Z'
trust_tier: 3
category: greeks-mechanics
topics:
- greeks
- options-mechanics
summary: Gamma measures how much an option's delta shifts when the price of the underlying asset changes by one
url_sha1: 7effbabaa51ccba4247d91e04aec74f40969132b
simhash: '17111131746795378675'
status: vault
ingested_by: ingest
---

Gamma measures how much an option's delta shifts when the price of the underlying asset changes by one point.

## What Is Gamma?

 Gamma (Γ) is an [options](https://www.investopedia.com/terms/o/option.asp) risk metric that represents the sensitivity of an option's delta to movements in the underlying asset, indicating how much delta will change when the underlying price shifts by one point. Therefore, gamma is a measure of how the rate of change of an option's price will change with fluctuations in the underlying price. The higher the gamma, the more volatile the price of the option is.

 Gamma is an important measure of the convexity of a [derivative's](https://www.investopedia.com/terms/d/derivative.asp) value in relation to the underlying asset. It is one of the "options [Greeks](https://www.investopedia.com/terms/g/greeks.asp)," along with [delta](https://www.investopedia.com/terms/d/delta.asp), [rho](https://www.investopedia.com/terms/r/rho.asp), [theta](https://www.investopedia.com/terms/t/theta.asp), and [vega](https://www.investopedia.com/terms/v/vega.asp). These are used to assess the different types of risk in options portfolios.

### Key Takeaways

- Gamma is the rate of change for an option's delta based on a single-point move in the delta's price.
- It is a second-order risk factor, sometimes known as the delta of the delta.
- Gamma is at its highest when an option is at the money and is at its lowest when it is further away from the money.
- Gamma is also highest for options closer to expiration than farther-dated ones, all else equal.
- Gamma is used when trying to gauge how movements in the underlying asset will affect an option's moneyness.
- Delta-gamma hedging immunizes an options position against moves in the underlying asset.

Get personalized, AI-powered answers built on 27+ years of trusted expertise.

## Understanding Gamma

 Gamma is the first derivative of delta and is used when trying to gauge the price movement of an option, relative to the amount it is [in the money](https://www.investopedia.com/terms/i/inthemoney.asp) or [out of the money](https://www.investopedia.com/terms/o/outofthemoney.asp). It describes how the delta will change as the underlying asset changes. So if an option's delta is +40 and the gamma is 10, a $1 increase in the underlying price would result in that option's delta becoming +50.

 When the option being measured is deep in or out of the money, gamma is small. When the option is near or [at the money](https://www.investopedia.com/terms/a/atthemoney.asp), gamma is at its largest. Gamma is also largest for options with near-term expirations relative to longer-dated options.

 Gamma is an important metric because it accounts for [convexity](https://www.investopedia.com/terms/c/convexity.asp) issues when engaging in options hedging strategies. Some portfolio managers or traders may be involved with portfolios of such large values that even more precision is needed when engaged in hedging. A third-order derivative named "color" can be used. Color measures the rate of change of gamma and is important for maintaining a gamma-hedged portfolio.

### Fast Fact

As an analogy to physics, the delta of an option is its "speed," while the gamma of an option is its "acceleration."

## What Is Gamma Used for?

 Since an option's delta measure is only valid for a short period of time, gamma gives traders a more precise picture of how the option's delta will change over time as the underlying price changes. Delta is how much the option price changes with respect to a change in the underlying asset's price.

Gamma decreases, approaching zero, as an option gets deeper in the money, and delta approaches one. Gamma also approaches zero the deeper an option gets out of the money. Gamma is at its highest when the price is at the money.

 The calculation of gamma is complex and requires financial software or spreadsheets to find a precise value. However, the following demonstrates an approximate calculation of gamma. Consider a [call option](https://www.investopedia.com/terms/c/calloption.asp) on an underlying stock that currently has a delta of 0.40. If the stock value increases by $1.00, the option will increase in value by 40 cents, and its delta will also change. After the $1 increase, assume the option's delta is now 0.53. The 0.13 difference in deltas can be considered an approximate value of gamma.

### Important

All options that are a [long](https://www.investopedia.com/terms/l/long.asp) position have a positive gamma, while all [short](https://www.investopedia.com/terms/s/short.asp) options have a negative gamma.

## Example of Gamma

Suppose a stock is trading at $10 and its option has a delta of 0.5 and a gamma of 0.10. Then, for every $1 move in the stock's price, the delta will be adjusted by a corresponding 0.10. This means that a $1.00 increase will mean that the option's delta will increase to 0.60. Likewise, a $1.00 decrease will result in a corresponding decline in delta to 0.40.

## How Do Traders Hedge Gamma?

[Gamma hedging](https://www.investopedia.com/terms/g/gamma-hedging.asp) is a strategy that tries to maintain a constant delta in an [options](https://www.investopedia.com/terms/o/option.asp) position. This is done by buying and selling options in such a way as to offset each other, resulting in a net gamma of just around zero. At such a point, the position is said to be [gamma-neutral](https://www.investopedia.com/terms/g/gammaneutral.asp). Often, a trader will want to maintain zero gamma around a [delta-neutral](https://www.investopedia.com/terms/d/deltaneutral.asp) (zero-delta) position as well. This is done via [delta-gamma hedging](https://www.investopedia.com/terms/d/deltagamma-hedging.asp), where [both net delta and net gamma](https://www.investopedia.com/articles/optioninvestor/07/gamm_delta_neutral.asp) are close to zero. In such a case, an options position's value is immunized against price changes in the underlying asset.

## What Is a Long Gamma Strategy?

If traders are long gamma, the delta of their options position increases with price movements in the underlying asset. For example, a long gamma position will see an ever-increasing delta as the underlying price rises, or ever-decreasing deltas as the price falls. If the trader can sell deltas as prices rise and then buy deltas as prices fall, the long-gamma exposure can lead to net profits by incentivizing the trader to consistently buy low and sell high.

## What Is Gamma Risk?

For options positions that are short gamma, there is a risk that price movements in the underlying will cause compounding losses. For instance, if such a position begins delta-neutral and the stock rises, it will produce increasingly short deltas for the position, so that as the underlying rises, the options will lose more and more money. The risk, however, is that if the deltas are bought at these ever-higher prices, the underlying asset can reverse direction and fall, creating long deltas on the way down, compounding those earlier losses.

## The Bottom Line

Gamma measures the rate of change in the delta for each one-point increase in the underlying asset. It is a valuable tool in helping traders forecast changes in the delta of an option or an overall position. Gamma will be larger for at-the-money options and goes progressively lower for both in- and out-of-the-money options. Unlike delta, gamma is always positive for being long both calls and puts.

 *Investopedia does not provide tax, investment, or financial services and advice. The information is presented without consideration of the investment objectives, risk tolerance, or financial circumstances of any specific investor and might not be suitable for all investors. Investing involves risk, including the possible loss of principal.*
