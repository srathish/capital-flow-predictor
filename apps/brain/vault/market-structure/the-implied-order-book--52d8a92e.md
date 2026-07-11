---
title: The Implied Order Book
source_url: https://squeezemetrics.com/monitor/download/pdf/The_Implied_Order_Book.pdf
source_domain: squeezemetrics.com
fetched_at: '2026-07-11T06:28:09Z'
trust_tier: 2
category: market-structure
topics:
- gex
- dix
- dealer-positioning
summary: '**The stock market is a ledger of who is willing to buy or sell stock and at what price. This ledger is called the limit order book** , and it''s what every trader is always competing to get a glimpse of, because it shows where there is supply and where there is'
url_sha1: 52d8a92e4697b6dfbcfc4afdb4011609d9514374
simhash: '17771432751015164507'
status: vault
ingested_by: ingest
---

# GEX Ed. 

"The Implied Order Book:" 

6 July 2020 

**The stock market is a ledger of who is willing to buy or sell stock and at what price. This ledger is called the limit order book** , and it's what every trader is always competing to get a glimpse of, because it shows where there is supply and where there is demand. 

Over time, the limit order book has become more complex, more fragmented, and more abstract. Today, there are tens of trading venues, hundreds of order types with modifiers, and limitless algorithmic smart order routing systems, all with the express purpose of competing to get the best fill at the lowest total cost. But there is still, conceptually, one big limit order book that describes supply and demand, and the more of it that a trader sees, the better his edge. 

Because of the competitive nature of the market, most of the liquidity that is visible is, in one way or another, a bluff. The information content of a 



quote, with respect to market liquidity, is either zero or less than zero. The slew of venues, order types, and algorithms, together with the winner-take-all effect of nanosecond quoting and exchange colocation, pretty much guarantee that you're never going to get a good picture of market liquidity by looking at trading venues' order books in the traditional sense. (You could sink $50mm into data, research, and market access and that'd barely get you a seat at the table.) So we're not really interested in trying to extract an edge from trawling the ocean of dark liquidity or cutting a path through the jungle of exchange order types. No, what we're interested in is an enigmatic, decadesold order type that usually gets overlooked, but that, paradoxically, gives us a clearer view of 

market liquidity. That order type is the _option_ . 



**Options are best known for the nonlinear payoffs that they offer to the investor. But for our purposes, what's far more interesting is how that payoff is synthesized.** When you buy or sell an option, there is almost always a dealer on the other side of the trade, and that dealer is implicitly taking the inverse of your position. Because the dealer doesn't want the directional risk associated with that position, he hedges by taking a dynamic position in the underlying. The goal of that position is to replicate, as nearly as possible, the exact payoff of the option. So, for example, if you buy an at-the-money (ATM) put from a dealer, that dealer will start by shortselling about 50% of the notional value of the position (this is a 50-delta put). Then, if the underlying goes down, he will short-sell more; and if it goes up, he will cover (buy back) some of the short. 







This is called "delta-hedging," and above is the effect that it has on the market's order book. What's most important to note is that if you, the customer, sell (short) a put (and the same is true of selling calls), you are indirectly (through the agency of the option dealer) adding liquidity to the market. On the other hand, when you buy a put, you are effectively placing stop-loss orders above and below the market, which take liquidity (and, naturally, destabilize the market). In this context, it's easy to think of options as a sort of complex order type, and to view their effects as either providing or taking liquidity. But our interest is more than academic, so here's why we think all of this is actually worth understanding: 

1. S&P 500 (SPX) options are the largest, most transparent part of the broad market's "order book." 

2. We can measure, by analyzing transaction data, SPX dealers' actual option positions. 

3. We can use the Black-Scholes model to calculate, in dollar terms, where delta-hedges must occur. 

**This means that we can build a uniquely information-rich "implied order book" simply by knowing how existing options must be hedged. From this, we will be able to see where optionoriginated liquidity is abundant, and where it is scarce. But first, we need to understand** **_deltas_ a little bit better:** 



<!-- Start of picture text -->
deltas  a<br>). But more to the point: The delta is also how much the<br>in  the money, delta goes up.<br>out  of the money, delta goes down.<br><!-- End of picture text -->

The Black-Scholes delta of an option is a convention that takes an option price, assumes that the day-to-day movement of the underlying is normally distributed, and imputes a distribution of returns, from which we can derive a proxy for the probability that the option ends 

up in the money at expiration ( _*deep breath*_ ). But more to the point: The delta is also how much the option price will change per unit change in the underlying. For example, if an option has a delta of 30 (or 0.30), the price of the option contract should move about $0.30 for every $1.00 that the underlying moves. As the underlying price pushes the option further _in_ the money, delta goes up. As the underlying price pushes the option further _out_ of the money, delta goes down. 

**What we really care about, though, for the purposes of tracking liquidity, is** **_change_ in delta.** It's when an option's delta _changes_ enough that an option dealer is compelled to re-hedge his exposure, and that means buying or selling the underlying. The fact that this hedging schedule is necessary to the survival of the dealer and fundamentally predictable in its disposition is what will allow us to build something that resembles a limit order book from option data. 

## **So what causes option deltas to change?** 

Three things: 

|1.<br>2.|changes<br>changes|in_underlying price_<br>in_implied volatility_|
|---|---|---|
|3.|changes|in_time_|



To options practitioners, these three delta sensitivities are known as . . . . 







To the extent that each of these factors exposes option dealers to delta risk, we want to measure these exposures. But even a rudimentary analysis of the three reveals that _charm_ constitutes too small an effect to have practical utility. Where we're going, we don't need charm. 

And so we're left with these two prospects: 

<u>Gamma exposure (GEX): An option dealer's delta</u> sensitivity to changes in the price of the underlying. 

<u>Vanna exposure (VEX): An option dealer's delta</u> sensitivity to changes in options' implied volatility. 

**But before we go about measuring the GEX and VEX of all S&P 500 (SPX) options, we have to acknowledge an interim step: The derivation of Dealer Directional Open Interest (DDOI).** 



<!-- Start of picture text -->
EXPIRY STRIKE TYPE VOLUME OI<br>2020-06-09 3000 Call 102 5200<br>2020-06-09 3000 Put 6    1846<br>DDOI is a measurement of whether option dealers are short or long any particular option<br>expiration, strike, and type. Because publicly reported open interest (OI) only tells us the number of<br>contracts in existence on any given day, we have to delve into transaction-level data to assess the<br>direction  (buy/sell) of every SPX option trade and to bin it according to how it ought to affect open<br>interest, and then finally, to  verify<br>Every option contract must be tracked through time in this manner to maintain an accurate picture<br>of dealers' option exposures (DDOI). It's difficult, but by taking this step, a much more granular<br>view of option-originated liquidity becomes possible.<br>With the benefit of DDOI, and the understanding that what we're trying to do is measure changes<br>in options' deltas,<br>With this handy function, we can not only compute the current delta of every existing SPX option,<br>but we can also compute exactly how these deltas will change as the implied vol and index price<br>change.<br><!-- End of picture text -->



|EXPIRY<br>STRIKE|TYPE|VOLUME|OI<br>DDOI|
|---|---|---|---|
|2020-06-09<br>3000|Call|102|5200<br>+2630|
|2020-06-09<br>3000|Put|6|1846<br>-438|



DDOI is a measurement of whether option dealers are short or long any particular option expiration, strike, and type. Because publicly reported open interest (OI) only tells us the number of contracts in existence on any given day, we have to delve into transaction-level data to assess the _direction_ (buy/sell) of every SPX option trade and to bin it according to how it ought to affect open interest, and then finally, to _verify_ trade direction by tracking the subsequent actual change in OI. Every option contract must be tracked through time in this manner to maintain an accurate picture of dealers' option exposures (DDOI). It's difficult, but by taking this step, a much more granular view of option-originated liquidity becomes possible. 

With the benefit of DDOI, and the understanding that what we're trying to do is measure changes in options' deltas, **the only other thing we need is a function that returns the Black-Scholes delta.** With this handy function, we can not only compute the current delta of every existing SPX option, but we can also compute exactly how these deltas will change as the implied vol and index price change. 



<!-- Start of picture text -->
import numpy as np<br>from scipy.stats import norm<br>def delta(flag, s, k, t, r, v):<br>    d1 = (np.log(s/k)+(r+v*v/2)*t)/(v*np.sqrt(t))<br>    if flag == “C”:<br>        return norm.cdf(d1)<br>    else:<br>        return norm.cdf(-d1) # +signed put delta<br>> Type = ‘C’  # call<br>> S = 97.65  # underlying<br>> K = 100.00  # strike<br>> T = 30/365  # 30 days to expiry (in years)<br>> R = 0.00  # “risk-free” rate<br>> V = 0.12  # 12 vol<br>> delta(Type, S, K, T, R, V)<br>0.250448229<br><!-- End of picture text -->

In the Python function to the left, all you have to do is plug in new values to _S_ and _V_ and you've found how much the option's delta changes with underlying moves and implied volatility changes. And if you know how much the delta changes with respect to these sensitivities, all you have to do is convert these deltas to shares (or dollars) and you already have a rudimentary "implied order book." 

**Let's start with an example of gamma exposure (GEX).** Remember, gamma is an option's sensitivity to changes in underlying price, so in the function 

above, we'll be modifying the _S_ variable, and to bring the numbers into the problem domain of the S&P 500, let's imagine the index is trading at 3000 _(S = 3000)_ . Let's also imagine that a fund just sold a 2900-strike put with one month to expiration _(Type = 'P'; K = 2900; T = 30/365)_ , and that the option price implies a volatility of 20% _(V = 0.20)_ . Finally, let's hold the "risk-free rate" _(R)_ at zero, because really, who cares? According to our Black-Scholes function, this option has a delta of 27. 



<!-- Start of picture text -->
> Type = ‘P’<br>> S = 3000<br>> K = 2900<br>> T = 30/365<br>> R = 0.00<br>> V = 0.20<br>> delta(Type, S, K, T, R, V)<br>0.27<br>> S = 2950<br>> T = 29/365<br>> delta(Type, S, K, T, R, V)<br>0.37<br>up  (recall that<br>and  the way<br>taking<br><!-- End of picture text -->

That means that an SPX option dealer (for whom this is a long put position with short delta exposure to the market) must be long approximately 27 "dollar-units" of the SPX index. With the index trading at 3000, the dealer has to be long the S&P 500 to the tune of $81,000 ($3000 x 27) to be "flat" delta. 

But what happens when the index falls 50 points to 2950? The new delta is 37. A delta of 37 means the dealer would need $109,150 ($2950 x 37) to be flat. This is an additional $28,150 bid on the S&P 500 somewhere between 3000 and 2950. This seems useful to know! But it's also a bit vague, and a 50-point move is pretty arbitrary. What if, instead of dollars per 50 points, we solve for dollars per point? So, instead of _S = 2950,_ let's look at what would happen if _S = 2999_ . The answer is _$393_ : The option dealer needs to buy $393 of the S&P 500 _for every point_ the index falls, just to 

hedge this one put that a fund sold them. Due to the nature of gamma, this also means that the dealer will need to sell about $393 of index exposure in the event of a 1-point move _up_ (recall that when you sell an option, you cause the dealer to provide liquidity both on the way up _and_ the way down). 

So, $393 is the GEX of that put option. **To find the GEX of the whole SPX option universe, we do what we did above for every option contract in dealer directional open interest (DDOI), and then simply add them all together.** The result can be a positive number or a negative number. A positive number means that customers (funds and the like) sold enough options to cause dealers to hedge in a way that provides _stabilizing_ liquidity to the market. A negative number means the opposite—that customers are long more options, causing dealers to be "short gamma," and thus to always be _taking_ liquidity, which is destabilizing. 

A thorough analysis of SPX GEX back to 2004 yields a surprising revelation, though: 



GEX is _very rarely_ negative. 

And even when it _is_ negative, it's never been below $-200mm per SPX point. In the vast majority of cases, GEX shows us that SPX option dealers are providing a great deal of liquidity to the index— sometimes over $1 billion per point. In the context of E-mini S&P 500 futures, that'd be around 6,666 E-minis per point (with SPX at 3000). That's a lot. 

But if the proof of the pudding is in the eating, then **the proof of liquidity is in the volatility.** If there's merit to the idea that dealers' gamma exposure can be measured and that SPX options comprise a large portion of index liquidity, it should be very clear: There should be some statistical relationship between GEX and S&P 500 volatility. (And if there weren't you wouldn't be reading this.) 

So observe the scatterplot to the right, which shows GEX against 1-day close-to-close S&P 500 returns. A pattern is readily apparent: Higher GEX means tighter returns. Because higher GEX means there's more liquidity, this makes perfect sense. Nor is this the _flaky_ kind of liquidity that an HFT market-maker provides— this is high-quality, guaranteed liquidity. Hence the correlation. 



**But there's a problem,** and you may have reasoned your way to it already. The problem is, **_"What does zero GEX actually mean?"_** Because in a way, it means nothing. It means that SPX option dealers are neither providing nor taking liquidity. And maybe that's useful to know, but it's not nearly as useful as being able to say, _"A billion dollars will prop up the S&P 500 if it falls just one point."_ And this theoretical uselessness is manifested in the plot: Extreme volatility has only ever occurred when GEX was near zero, but there's also a visible "clump" of very typical, non-volatile returns around zero. This is logical, because when GEX is near zero, it "allows" other liquidity-taking factors to dominate, where it would have stifled them before. But still, GEX is not _causing_ that crazy volatility—the proximate cause must be something else. To find it, we tried asking the question: _"Why is GEX zero in the first place?"_ Well, there are two reasons that GEX could be near zero. The first is that dealers could have a very small, or very balanced, inventory of options, giving them little exposure to moves in the index. This _is_ a reason that GEX could be near zero, but it's _not_ a reason to expect market volatility. The second reason for GEX to be near zero is if implied volatilities (IVs) are really high. Because higher IVs make GEX less significant. 

You heard that right: **When implied volatilities go up, gammas (and thus GEX) move toward zero.** Since we already know that high implied volatility is associated with high realized volatility, this seems like it could point us to the reason that sometimes zero GEX leads to volatility and sometimes it doesn't. It's a start, anyway. 



<!-- Start of picture text -->
You heard that right:<br>(and thus GEX) move toward zero.<br>GEX leads to volatility and sometimes it doesn't. It's a start,<br>anyway.<br>But now you'd have to explain how high IV actually<br>liquidity to be taken from the market.<br>track the liquidity of the S&P 500  vis-á-vis<br>buckle up, because this is where the going gets weird.<br>The answer is vanna.<br>logical, and clearly causal relationship between dealer gamma<br>between vanna exposure (VEX) and S&P 500 liquidity. Recall that VEX measures dealers' delta<br>sensitivity to implied volatility. In the same way that option dealers must provide, or take, liquidity<br>based on changes in underlying price, they must provide or take liquidity based on changes in<br>implied volatility.<br>For this, we'll need some more examples,  and this is where  > Type = ‘P’<br>we return to our trusty Black-Scholes delta function, which  > S = 3000<br>will be able to tell us how and when changes in IV affect  > K = 2900> T = 30/365> T = 30/365<br>option deltas. Except this time, we're going to be playing  > R = 0.00<br>with the  V  variable instead of the  S  variable. Imagine,  > V = 0.20<br>though, that everything else is the same: A 2900-strike put<br>sold by a fund and held long by a dealer. So with that  0.27<br>established, what happens when IV rises from  20% to 25% ?<br>Answer:  The dealer will have to increase his SPX position by<br>3 deltas to hedge the change, as the delta of his long put  > T = 29/365> V = 0.25> V = 0.25<br>will rise from 27 to 30. This means buying $9,000 of the<br>index ($3000 x 3) to flatten deltas. It should be clear already<br><!-- End of picture text -->

**But now you'd have to explain how high IV actually** **_causes_ liquidity to be taken from the market.** Remember, we're here to track the liquidity of the S&P 500 _vis-á-vis_ its options, not to find some spurious correlation between VIX and realized volatility. So, buckle up, because this is where the going gets weird. 

**The answer is vanna.** In the same way that there is a provable, logical, and clearly causal relationship between dealer gamma exposure and S&P 500 liquidity, there is also a causal relationship between vanna exposure (VEX) and S&P 500 liquidity. Recall that VEX measures dealers' delta sensitivity to implied volatility. In the same way that option dealers must provide, or take, liquidity based on changes in underlying price, they must provide or take liquidity based on changes in implied volatility. 



<!-- Start of picture text -->
> Type = ‘P’<br>> S = 3000<br>> K = 2900> T = 30/365> T = 30/365<br>> R = 0.00<br>> V = 0.20<br>> delta(Type, S, K, T, R, V)<br>0.27<br>> T = 29/365> V = 0.25> V = 0.25<br>> delta(Type, S, K, T, R, V)<br>0.30<br> liquidity to the market; you buy<br>take  liquidity instead. Well,<br>, lowering it to 2800 so as to switch<br> went up: Instead of going up like<br>. This means that instead of<br>sell  some of his S&P 500<br><!-- End of picture text -->

**For this, we'll need some more examples,** and this is where we return to our trusty Black-Scholes delta function, which will be able to tell us how and when changes in IV affect option deltas. Except this time, we're going to be playing with the _V_ variable instead of the _S_ variable. Imagine, though, that everything else is the same: A 2900-strike put sold by a fund and held long by a dealer. So with that established, what happens when IV rises from _20% to 25%_ ? _Answer:_ The dealer will have to increase his SPX position by 3 deltas to hedge the change, as the delta of his long put will rise from 27 to 30. This means buying $9,000 of the index ($3000 x 3) to flatten deltas. It should be clear already that VEX is going to have a smaller dollar impact on S&P 500 liquidity than GEX. But vanna's _size_ is deceiving... 



<!-- Start of picture text -->
> Type = ‘P’<br>> S = 2800 GEX.<br>> K = 2900 causes the dealer to  supply<br>> T = 30/365<br>> R = 0.00 an option and the dealer has to  take<br>> V = 0.20<br>> delta(Type, S, K, T, R, V)<br>0.72 (ITM) put. This is reflected to the left, where the only<br>variable we changed is  S<br>the moneyness of the 2900-strike put. Now look what<br>> T = 29/365> V = 0.25 happened when IV  (V)<br>before, the  delta went down<br>> delta(Type, S, K, T, R, V)<br>buying, the option dealer must  sell<br>0.67<br>To help this make a bit more sense, we have to return to our "option-implied distributions" so we<br>can see why the deltas move the way they do. As usual, it makes perfect sense once you see the<br>probabilities.<br><!-- End of picture text -->

**To start with, VEX is a much more dynamic problem than GEX.** See, GEX is simple: You sell an option and its gamma causes the dealer to _supply_ liquidity to the market; you buy an option and the dealer has to _take_ liquidity instead. Well, that's not how VEX works. So imagine if, instead of an outof-the-money (OTM) put, a fund is short an in-the-money (ITM) put. This is reflected to the left, where the only variable we changed is _S_ , lowering it to 2800 so as to switch the moneyness of the 2900-strike put. Now look what happened when IV _(V)_ went up: Instead of going up like before, the _delta went down_ . This means that instead of buying, the option dealer must _sell_ some of his S&P 500 exposure. Suddenly, a customer short put is causing liquidity to be taken instead of supplied. For VEX, moneyness matters. 

To help this make a bit more sense, we have to return to our "option-implied distributions" so we can see why the deltas move the way they do. As usual, it makes perfect sense once you see the probabilities. 

Ok, maybe it doesn't make _perfect_ sense, but if you spend enough time looking at the cheat sheet below, you'll see exactly how IV, direction, and moneyness cause option dealers to buy or sell the underlying. 



**If you haven't already, now would be a good time to solidify in your brain that implied volatility is a measurement of market liquidity.** IVs rise when liquidity is inadequate and fall when liquidity is abundant. In the context of gamma exposure, this is interesting, because when an option is sold, it increases GEX and lowers IV (IVs go down when people sell options), and when IVs go down, GEX goes up even more! So the process of selling an option features a two-pronged effect to increase GEX (add liquidity). You'd expect the effect of buying an option to be the exact opposite, but it's not: Though buying an option does, _per se,_ decrease GEX, it also raises IV (IVs go up when people buy options), and a higher IV _reduces the negative GEX effect of buying options_ . Taken together, this means that the liquidity-making impact of gamma is always multiplied, and the liquidity- _taking_ impact is always tempered. This is why GEX is so rarely below zero! Thus, the net effect of gamma on the market is to supply liquidity—a stabilizing force. 

If this all seems too rosy, that's because it is. The most common SPX option flows, post-2008, are customers buying OTM puts and selling OTM calls. This creates and sustains a momentum effect, whereby higher prices lead to higher GEX, and higher GEX improves top-of-book (nearby bid-ask) liquidity, and better liquidity means that dips always get bought. This works to keep volatility in check... until it doesn't. **Eventually, the effect of** **_vanna_ overwhelms the effect of** **_gamma_ , and that's when things get crazy.** 

To see what we mean, look at the vanna cheat sheet above. There are two asterisks: Both are in the "IV UP" section. One is customer short OTM calls, and the other is customer long OTM puts (the biggest SPX flows). Note that both of these positions result in dealer selling when IVs rise. This is inherently unstable! We already know that IVs correspond to market liquidity, so when IVs rise, that's usually because liquidity is worsening (and the underlying is probably falling). Now add a bunch of option positions that are _guaranteed_ to compel dealers to sell into a decline... this is vanna, gamma's evil twin. 

## **And so, in the same way that we quantified SPX GEX through history, let's do VEX:** 



**Unlike GEX, VEX knows how to be negative.** In late 2008, VEX was about $-400mm per SPX point. ***** This happened again during the 2020 "corona crash." It is not a coincidence that these were the most volatile, illiquid periods in recent history—negative VEX is the _cause_ of sustained S&P 500 volatility in the era of SPX options (where the derivative tail invariably wags the index dog). And when you ponder the below scatterplot, you can see that sub-zero VEX strongly corresponds to elevated close-to-close SPX volatility. 



And this is why VEX is GEX's evil twin. GEX is capable of providing so much liquidity to the index that daily ranges tighten to an average of 0.20%. VEX, the other side of the same coin, is able to _take_ so much liquidity _from_ the index that average daily ranges rise to 6.00%! And by quantifying both of these dealer delta sensitivities in concert, we get the whole picture—the whole "implied order book"—that drives S&P 500 liquidity. 

And what's _really_ beautiful about quantifying this stuff is that it's all additive. Meaning, we can literally add VEX to GEX in order to get a full picture of option-originated top-of-book index liquidity. Convenient, no? 





**So let’s do this: Let’s add GEX and VEX together. And let’s call it GEX+ (“GEX plus”).** 



GEX+ ranges from $2bn in provided liquidity all the way down to $-500mm (in liquidity-taking). Over the last 16 years, it's clear that the impact of gamma and vanna on index liquidity has been pretty dramatic—an artifact of how options have obliquely become the "order type" of choice, i.e., the preferred method of offering and taking liquidity in the S&P 500. And viewing the scatterplot below, it should be no surprise that the index moves largely according to how much of this optionoriginated liquidity is available. Makes sense, doesn't it? All truly sophisticated market participants already understand this dynamic, and will at 



the very least, use implied volatilities (like VIX) as a proxy for gauging liquidity. And while VIX can never give us the full picture of option-originated liquidity, it has to at least get close. Why? Because if SPX option dealers routinely sold options too cheaply, they'd be out of business. 

**And this leads us to our last point.** Notice that we just said that option dealers have to be careful not to sell options too cheaply. Selling options is a tough business, since you're on the wrong end of a derivative with a convex payoff, and even if you're hedging your deltas, you can end up very bankrupt if the market moves against you quickly. Proper riskmanagement is essential. 

## **So, what happens when people start selling options without the requisite skill-set?** 

Specifically, what happens when price-insensitive investors "collect premium" by selling puts on the SPX index? Everyone who's traded for more than a couple days intuitively knows the answer: **"Eventually, they'll blow up."** But we're not interested in common-sense trader wisdom—we're interested in being able to know _when_ and _where_ the over leveraged masses are going to start taking so much liquidity that they take the market down, because crashes always look the same: A crash happens when the conditional demand for liquidity below the market is larger than people think it is, and larger than prices imply. In terms of the order book, it's when there are tons of stop-losses below the market. One spark, one catalyst, and it's an unstoppable, illiquid chain-reaction. 

**In terms of gamma and vanna, crash risk is a function of how many investors have sold puts, plain and simple.** Sold puts are, quite literally, a bunch of huge buy limit orders below the market, and then a bunch of liquidity-taking stop-losses further down. To understand why, think of gamma and vanna separately: 

1. Selling a put creates dealer long gamma, which raises GEX and decreases volatility by improving top-of-book liquidity. Remember, any time you sell an option, you push GEX up. 



2. Selling an OTM put also raises VEX, which also improves liquidity! So far, this seems pretty great. Not only will sold OTM puts cause dips to be bought (via GEX), but they will also cause increases in IV to cause SPX buying (via VEX). This literally means that if VIX (IV) spikes, option dealers _have_ to buy the index. Talk about robust liquidity! But of course, there's a catch: If, for whatever reason, those customer-sold puts end up trading in-the-money (ITM), fickle vanna starts _demanding_ liquidity whenever IVs rise. **And here's the feedback loop that crashes the market:** Liquidity deteriorates, IVs rise to compensate, and the rise in IVs, by virtue of the newly-ITM puts (negative VEX), demand that option dealers short more of the index. It becomes impossible to sate the latent demand for liquidity, and the selloff only ends when VIX is so high that it can only go lower. (Fun tidbit: When VIX _does_ go lower, VEX will then force options dealers to buy just as much as they were forced to sell before. Cue insane bear market rallies!) 





<!-- Start of picture text -->
So now let's take the final step . It's never enough to know<br>the current liquidity situation in the market. To make good<br>decisions,  we need to know about  conditional  liquidity.  Will<br>there be buyers or sellers if the S&P 500 falls 5%? How about<br>10%? What will happen to VEX liquidity if VIX goes up 20<br>points? What if it goes  down  10? To know all of this, we need<br>to draw a "map" of the order book, and by extension, a map<br>of future liquidity and volatility. We want to know where,<br>exactly, option-originated liquidity is scarce or abundant.<br>And that map looks like this:<br><!-- End of picture text -->

**So now let's take the final step** . It's never enough to know the current liquidity situation in the market. To make good decisions, **we need to know about** **_conditional_ liquidity.** Will there be buyers or sellers if the S&P 500 falls 5%? How about 10%? What will happen to VEX liquidity if VIX goes up 20 points? What if it goes _down_ 10? To know all of this, we need to draw a "map" of the order book, and by extension, a map of future liquidity and volatility. We want to know where, exactly, option-originated liquidity is scarce or abundant. And that map looks like this: 

The map above is from March 5th, 2020, just before the S&P 500 began its second leg down. The red region is where GEX+ becomes negative, and where option dealers begin taking liquidity. In other words, it's where the stop-loss orders sit, and on March 5th, any movement below 3000 SPX was a break into the illiquidity zone. But much more disconcerting than the "red zone" itself is the fact 

## that the map _ends_ ! 

To see what we mean, look at the bottom-left of the map, where SPX is below 2800 and VIX is above 60. No color corresponds to that area because at that moment in time, the demand for liquidity at those levels would be so high (GEX+ would be below $-500mm) that there's simply no historical analog. And to get a more granular view, look at the corresponding map of gamma-implied volatility (GIV) to the right. If we imagine that SPX were to fall another 7.5% to 2800, even if VIX remained unchanged, we'd be in the yellow zone. The yellow zone, according to the color key, implies 80 vol, or 4.00% average daily moves. That is some scary stuff right there. 





Another: If you imagine that SPX fell to 2800 _and_ VIX rose to 64, gamma-implied vol would be 120, or 6.00% average daily moves. This is what we call the vol market being "offsides." And by that we mean that VIX cannot _possibly_ price volatility/liquidity correctly, since _simply by moving up, VIX causes liquidity to deteriorate_ (yes, vanna is scary), and that means VIX will be underpriced all the way up to 80 or whatever. Like we said before, when customers have sold too many puts, crashes become feedback loops, where latent demand for liquidity outstrips supply, and the crash only ends when IVs can't _possibly_ go up more. 

You may recall that, somewhere up there, we noted how customer _long_ OTM puts are one of the most common positions. By comparison, short puts (which cause crashes) are rare. But before we talk about how rare they are, let's clarify why customer _long_ puts don't cause crashes. You already know that a long put position is short dealer gamma, and thus pulls GEX down, and you also know that lower GEX means worse liquidity and more volatility. This sounds bad. But since the worst kind of illiquidity is always a function of VEX, take a look at the VEX effects of a customer long put option after it becomes ITM (cheat sheet, four pages up). As IVs rise, a long ITM put causes the option dealer to _buy_ the underlying. This means that, when things get really bad, long puts actually end up _adding_ a bit of liquidity. This means that the effect of customers buying put protection tends to be short, sharp corrections—not crashes. 

To verify that this is indeed the way things work, you need only chart out the ratio of SPX puts bought to sold over time. When put-selling becomes the norm, crashes happen. 





This is full of irony. 

Ironically, bought puts, despite ostensibly being a liquidity-taking order type, and despite obviously reducing top-of-book liquidity, end up actually _adding_ a small amount of liquidity (book _depth_ ) to the market when things really start falling apart. 

Ironically, the only thing that can really cause those 20% to 30% declines in the market is when _so many people_ sign up to provide liquidity via put sales that _a mere sign of the scarcity of liquidity_ (IV going up) automatically withdraws that liquidity from the market _right when it's needed most._ 

But hey, whenever something as simple as the supply and demand of a market's limit order book becomes so abstracted, you should _expect_ to see little ironies like this, where everything is suddenly turned on its head. Of course, the underlying truths of the order book will never change—options are just one way to take and supply liquidity. What's dangerous, though (for us _and_ for the whole market), is when we conceptually distinguish options and their underlying. They are not distinct. Now more than ever, options _are_ the order book. 

Hopefully, the concepts of GEX, VEX, and the "implied order book" provide a tidy new framework with which to understand index liquidity, its drivers, and what that means for the stability of the broad market.
