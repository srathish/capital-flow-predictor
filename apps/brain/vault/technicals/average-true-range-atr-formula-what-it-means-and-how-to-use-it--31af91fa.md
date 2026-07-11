---
title: Average True Range (ATR) Formula, What It Means, and How to Use It
source_url: https://www.investopedia.com/terms/a/atr.asp
source_domain: www.investopedia.com
fetched_at: '2026-07-11T06:26:20Z'
trust_tier: 3
category: technicals
topics:
- technicals
- indicators
summary: '- The ATR is typically derived from the 14-day simple moving average of a series of true range indicators. - The ATR was initially developed for use in commodities markets but has since been applied to all types of securities. - The ATR shows investors the average range of prices for an investment…'
url_sha1: 31af91fa5a47fbec088bd0fb823c4abafa2187a8
simhash: '7348984683289757651'
status: vault
ingested_by: ingest
---

### Key Takeaways

- The ATR is typically derived from the 14-day simple moving average of a series of true range indicators.
- The ATR was initially developed for use in commodities markets but has since been applied to all types of securities.
- The ATR shows investors the average range of prices for an investment over a specified period.
- Consider our list of the [best online brokers](https://www.investopedia.com/best-online-brokers-4587872)if you'd like to put this information to use.

Get personalized, AI-powered answers built on 27+ years of trusted expertise.

## What Is the Average True Range (ATR)?

The average true range (ATR) is a technical analysis indicator introduced by market technician J. Welles Wilder Jr. in his book "New Concepts in Technical Trading Systems." It measures market volatility by decomposing the entire range of an asset price for that period.

The true range indicator is taken as the greatest of the following:

- The current high less the current low
- The absolute value of the current high less the previous close and
- The absolute value of the current low less the previous close

The ATR is then a moving average of the true ranges, generally using 14 days. Traders can use shorter periods than 14 days to generate more trading signals. Longer periods have a higher probability of generating fewer trading signals.

## The Average True Range (ATR) Formula

The formula to calculate ATR for an investment with a previous ATR calculation is:


If there is not a previous ATR calculated, you must use:


### Fast Fact

The capital sigma symbol (Σ) represents the summation of all the terms for *n* periods starting at *i*, or the period specified. If there is no number following *i*, it is assumed that the starting point is the first period. You may see *i=1*, noting to start summing at the first term.

You must first use the following formula to calculate the true range:


## How to Calculate the ATR

The first step in calculating ATR is to find a series of true range values for a security. The price range of an asset for a given trading day is its high minus its low. To find an asset's true range value, you first determine the three terms from the formula.

Suppose that XYZ's stock had a trading high today of $21.95 and a low of $20.22. It closed yesterday at $21.51. Using the three terms, we use the highest result:




The number you'd use would be $1.73 because it is the highest value.

Because you don't have a previous ATR, you must use the ATR formula:


Using 14 days as the number of periods, you'd calculate the TR for each of the 14 days. Assume the following prices from the table.

| Daily Values | |||
|---|---|---|---|
| High | Low | Yesterday's Close | |
| Day 1 | $ 21.95 | $ 20.22 | $ 21.51 | 
| Day 2 | $ 22.25 | $ 21.10 | $ 21.61 | 
| Day 3 | $ 21.50 | $ 20.34 | $ 20.83 | 
| Day 4 | $ 23.25 | $ 22.13 | $ 22.65 | 
| Day 5 | $ 23.03 | $ 21.87 | $ 22.41 | 
| Day 6 | $ 23.34 | $ 22.18 | $ 22.67 | 
| Day 7 | $ 23.66 | $ 22.57 | $ 23.05 | 
| Day 8 | $ 23.97 | $ 22.80 | $ 23.31 | 
| Day 9 | $ 24.29 | $ 23.15 | $ 23.68 | 
| Day 10 | $ 24.60 | $ 23.45 | $ 23.97 | 
| Day 11 | $ 24.92 | $ 23.76 | $ 24.31 | 
| Day 12 | $ 25.23 | $ 24.09 | $ 24.60 | 
| Day 13 | $ 25.55 | $ 24.39 | $ 24.89 | 
| Day 14 | $ 25.86 | $ 24.69 | $ 25.20 | 

You'd use these prices to calculate the TR for each day.

| Trading Range | |||
|---|---|---|---|
| H-L | H-C p | L-C p | |
| Day 1 | $ 1.73 | $ 0.44 | $ (1.29) | 
| Day 2 | $ 1.15 | $ 0.64 | $ (0.51) | 
| Day 3 | $ 1.16 | $ 0.67 | $ (0.49) | 
| Day 4 | $ 1.12 | $ 0.60 | $ (0.52) | 
| Day 5 | $ 1.15 | $ 0.61 | $ (0.54) | 
| Day 6 | $ 1.16 | $ 0.67 | $ (0.49) | 
| Day 7 | $ 1.09 | $ 0.61 | $ (0.48) | 
| Day 8 | $ 1.17 | $ 0.66 | $ (0.51) | 
| Day 9 | $ 1.14 | $ 0.61 | $ (0.53) | 
| Day 10 | $ 1.15 | $ 0.63 | $ (0.52) | 
| Day 11 | $ 1.16 | $ 0.61 | $ (0.55) | 
| Day 12 | $ 1.14 | $ 0.63 | $ (0.51) | 
| Day 13 | $ 1.16 | $ 0.66 | $ (0.50) | 
| Day 14 | $ 1.17 | $ 0.66 | $ (0.51) | 

You find that the highest values for each day are from the (H - L) column, so you'd add up all the results from the (H - L) column and multiply the result by 1/n, per the formula.




The average volatility for this asset is therefore $1.18.

Now that you have the ATR for the previous period, you can use it to determine the ATR for the current period using the following formula:


This formula is much simpler because you only have to calculate the TR for one day. Assuming on Day 15, the asset has a high of $25.55, a low of $24.37, and closed the previous day at $24.87; its TR works out to $1.18:





The stock closed the day again with an average volatility (ATR) of $1.18.

## What Does the ATR Tell You?

 Wilder originally developed the ATR for [commodities](https://www.investopedia.com/terms/c/commodity.asp), although the indicator can also be used for stocks and indices as well. A stock experiencing a high level of volatility has a higher ATR, and a lower ATR indicates lower volatility for the period evaluated.

The ATR may be used by market technicians to enter and exit trades and is a useful tool to add to a trading system. It was created to allow traders to more accurately measure the daily volatility of an asset by using simple calculations. The indicator does not indicate the price direction. It is primarily used to measure volatility caused by gaps and limit up or down moves. The ATR is relatively simple to calculate and only needs historical price data.

 The ATR is commonly used as an exit method that can be applied regardless of how the entry decision is made. One popular technique is known as the "chandelier exit," developed by Chuck LeBeau. The chandelier exit places a [trailing stop](https://www.investopedia.com/terms/t/trailingstop.asp) under the highest high the stock has reached since you entered the trade. The distance between the highest high and the stop level is defined as some multiple multiplied by the ATR.

 The ATR can also give a trader an indication of what size trade to use in the [derivatives](https://www.investopedia.com/terms/d/derivative.asp) markets. It is possible to use the ATR approach to position sizing that will account for an individual trader's willingness to accept risk and the volatility of the underlying market.

## Example of How to Use the ATR

Assume the first value of a five-day ATR is calculated at 1.41, and the sixth day has a true range of 1.09. The sequential ATR value could be estimated by multiplying the previous value of the ATR by the number of days less one and then adding the true range for the current period to the product.

Next, divide the sum by the selected timeframe. The second value of the ATR is estimated to be 1.35, or (1.41 * (5 - 1) + (1.09)) / 5. The formula could then be repeated over the entire period.

 The ATR doesn't tell us in which direction the breakout will occur, but it can be added to the [closing price](https://www.investopedia.com/terms/c/closingprice.asp), and the trader can buy whenever the next day's price trades above that value. This idea is shown below. Trading signals occur relatively infrequently, but they usually indicate significant breakout points. The logic behind these signals is that whenever a price closes more than an ATR above the most recent close, a change in volatility has occurred.

## Limitations of the ATR

There are two main limitations to using the ATR indicator. The first is that ATR is a subjective measure. It's open to interpretation. No single ATR value will tell you with any certainty whether a trend is about to reverse. ATR readings should always be compared against earlier readings to get a feel of a trend's strength or weakness.

Second, ATR only measures volatility and not the direction of an asset's price. This can sometimes result in mixed signals, particularly when markets are experiencing pivots or when trends are at turning points. A sudden increase in the ATR following a large move counter to the prevailing trend may lead some traders to think that the ATR is confirming the old trend. However, this may not be the case.

## How Do You Use ATR in Trading?

Average true range is used to evaluate an investment's price volatility. It is used in conjunction with other indicators and tools to enter and exit trades or decide whether to purchase an asset.

## How Do You Read ATR Values?

An average true range value is the average price range of an investment over a period. So, if the ATR for an asset is $1.18, its price has an average range of movement of $1.18 per trading day.

## What Is a Good Average True Range?

A good ATR depends on the asset. If it generally has an ATR of close to $1.18, it is performing in a way that can be interpreted as normal. If the same asset suddenly has an ATR of more than $1.18, it might indicate that further investigation is required. If it has a much lower ATR, you should determine why it is happening before taking action.

## The Bottom Line

 The average true range is an indicator of the price volatility of an asset. It is best used to determine how much an investment's price has been moving in the period being evaluated, rather than as an indication of a trend. Calculating an investment's ATR is relatively straightforward, only requiring you to use price data for the period you're investigating.

 *Disclosure: This article is not intended to provide investment advice. Investing in securities entails varying degrees of risk and can result in partial or total loss of principal. The trading strategies discussed in this article are complex and should not be undertaken by novice investors. Readers seeking to engage in such trading strategies should seek extensive education on the topic.*

Get personalized, AI-powered answers built on 27+ years of trusted expertise.

## Related Articles

[
](https://www.investopedia.com/terms/r/relative_vigor_index.asp)
 
Relative Vigor Index (RVI): Master the Formula and Trading Strategies

[
](https://www.investopedia.com/investing/using-technical-analysis-gold-markets/)
 
Optimize Your Gold Miner ETF Portfolio with Technical Analysis

[
](https://www.investopedia.com/terms/d/downtrend.asp)
 
Downtrend Explained: Patterns, Examples, and Trading Techniques

[
](https://www.investopedia.com/terms/t/trending-market.asp)
 
Trending Markets Explained: Key Concepts for Traders

[
](https://www.investopedia.com/terms/r/round-triptrades.asp)
 
Round-Trip Trading: Definition, Examples, and Ethical Considerations

[
](https://www.investopedia.com/articles/technical/02/091002.asp)
 
Using Volume Rate of Change to Confirm Trends

[
](https://www.investopedia.com/terms/b/basing.asp)
 
Stock Trading Basing Patterns: Identification and Strategy Guide

[
](https://www.investopedia.com/articles/technical/112601.asp)
 
Master Key Stock Chart Patterns: Spot Trends and Signals

[
](https://www.investopedia.com/terms/f/fakeout.asp)
 
Spotting Fakeouts: Key Strategies in Technical Analysis

[
](https://www.investopedia.com/articles/active-trading/042114/overbought-or-oversold-use-relative-strength-index-find-out.asp)
 
RSI Indicator: Buy and Sell Signals

[
](https://www.investopedia.com/trading/support-and-resistance-basics/)
 
Support and Resistance Basics

[
](https://www.investopedia.com/terms/r/rangeboundtrading.asp)
 
Mastering Range-Bound Trading: Strategy, Definition, and Techniques

[
](https://www.investopedia.com/terms/s/swingtrading.asp)
 
What Is Swing Trading?

[
](https://www.investopedia.com/terms/s/seasonal-adjustment.asp)
 
What Is Seasonal Adjustment? Definition, Methods, and Examples

[
](https://www.investopedia.com/terms/p/pricebyvolume.asp)
 
Price by Volume (PBV) Charts: Definition, Uses, and Key Examples

[
](https://www.investopedia.com/terms/t/tradingrange.asp)
 
Trading Ranges Explained: Strategies and Key Occurrences
