---
title: Paper4
source_url: https://www.acem.sjtu.edu.cn/sffs/2020/pdf/paper4.pdf
source_domain: www.acem.sjtu.edu.cn
fetched_at: '2026-07-11T18:59:51Z'
trust_tier: 2
category: papers
topics: []
summary: Allaudeen Hameed<sup>*</sup> and Byounghyun
url_sha1: 995a9ee97014223e8aa350404e48fcc6b911b6e8
simhash: '5352901601290618722'
status: vault
ingested_by: ingest
---

### **Why Does Option Volume Predict Stock Returns? The Role of Investor Disagreement** 

Allaudeen Hameed<sup>*</sup> and Byounghyun Jeon<sup>**</sup> 

First Version: March 15, 2018 

Current Version: February 18, 2021 

#### **Abstract** 

In addition to informed trading in options, we show that divergence in investor beliefs is an important driver of trading in options. We find a strong negative relation between disagreement-based trading volume in options and future stock returns. This relation is amplified when the underlying stock is mispriced and when stocks are costly to short. Moreover, the disagreement trades spike during earnings announcements consistent with trades motivated by differences in interpretation of public news. Our findings also suggest that heavy trading in options does not facilitate the full incorporation of investor beliefs in stock prices. 

#### **JEL Classification:** G12, G13, G14 

**Keywords:** option trading volume, investor disagreement, mispricing, and cross-section of stock returns 

We thank Marcus Brunnermeier, Suk-Joon Byun, Martin Dierker, Amit Goyal, Bruce Grundy, Lei Jiang, Travis Johnson, Inmoo Lee, Sungjune Pyun, Johan Sulaeman, Ha-chin Yi, Bart Zhou Yueshen, Xintong Zhan and seminar participants at CAFM 2018, SFS Cavalcade Asia-Pacific 2018, ABFER-CEPR-CUHK First Annual Symposium in Financial Economics, 2020 Shanghai Financial Forefront Symposium, Aalto University, Católica-Lisbon, CKGSB, Dublin City University, KAIST, Marquette University, National University of Singapore, Peking HSBC Business School and Tsinghua PBC School of Finance for helpful comments. Earlier versions of this paper were circulated under the title “Mispriced Stocks, Option Volume, and Asymmetric Stock Return Predictability”. Hameed gratefully acknowledges financial support from NUS Academic Research Grants. 

* Department of Finance, NUS Business School, National University of Singapore, Singapore; Tel: +65 65163034; Email: Allaudeen@nus.edu.sg 

> ** Department of Finance, College of Business Administration, Marquette University, Milwaukee, WI;, Tel: +1 4142888041; E-mail: bh.jeon@marquette.edu 

1 

#### **1. Introduction** 

<u>Roll, Schwartz and Subrahmanyam (2010) introduce a stock level measure of the trading</u> volume in option relative to the volume traded in the underlying stock (denoted as _O/S_ ) and suggest that variations in _O/S_ reflect informed trades in options. This is supported by findings in Johnson and So <u>(2012)</u> and <u>Ge, Lin and Pearson (2016) that high option volume negatively predicts stock returns</u> because informed investors with private information prefer to trade in options due to short-sale constraints in the underlying stocks or the implicit leverage offered by options.<sup>12</sup> 

In this paper, we propose that heavy trading in options also reflects investor disagreement about the value of the underlying stocks. In many theoretical disagreement models, where investors with heterogeneous beliefs agree to disagree, trading volume increases with investor disagreement. Trades arising from heterogeneous beliefs may stem from differences in investor interpretation of public information (Kandel and Pearson, 1995) and/or overconfidence about their different private information signals (Harrison and Kreps, 1978; Odean, 1998; Scheinkman and Xiong, 2003; Hong and Stein, 2007; <u>Banerjee, 2011). When investor disagreement is high, disagreeing investors may choose to trade in</u> options to get around the shorting constraints in the stock market and/or take advantage of leverage imbedded in options. For example, <u>Cao and Ou-Yang (2009)</u> show that option trading volume is increasing in the degree of disagreement about the precision of information signals. Buraschi and Jiltsov <u>(2006) find that trading volume on index options is related to survey-based disagreement measures.</u><sup>3</sup> Moreover, <u>Lakonishok, Lee, Pearson and Poteshman (2007)</u> find trading in the option market is 

> 1 <u>Pan and Poteshman (2006) find that large purchases of put option relative to call option contain negative private</u> ' information and hence predict low future stock returns. See also Easley, O <u>Hara and Srinivas (1998).</u> 

> 2 In a related stream of literature, information in option prices such as implied volatility spread in call and put options is shown to predict future stock returns. While some interpret the evidence as supportive of informed trading in options (Cremers and Weinbaum, 2010; An, Ang, Bali and Cakici, 2014), others argue that option prices (and option quotes) do not contain economically significant information about future stock returns after accounting for the impact of current and past stock price movements (Muravyev, Pearson and Broussard, 2013; <u>Goncalves-Pinto, Grundy, Hameed, Heijden and Zhu, 2020).</u> 

> 3 <u>Choy and Wei (2012) and Fournier, Goyenko and Grass (2017) also emphasis the role of option market as a</u> venue to extract information on disagreement among investors. Different from these papers, we segregate option volume reflecting directional informed trades from disagreement trades and show their differential effects on future stock returns. 

2 

primarily motivated by speculation while trading in the stock market may also be influenced by diversification, rebalancing and liquidity needs. Hence, we postulate that excessive trading in options is also related to elevated investor disagreement about stock valuations. 

Our proposed measure of dispersion of investor beliefs is based on the trading volume in the options market. To extract option volume due to investor disagreement, we decompose trading in options based on signed option trades by non-market makers provided by International Securities Exchange. Specifically, we compute weekly stock-level synthetic buy volume (i.e. long call and short put options) and synthetic sell volume (i.e. long put and short call options) in the option market. When the synthetic buy (sell) volume exceeds the sell (buy) volume, we classify the excess signed option volume as informed buy (sell) volume, denoted as _NetBuy_ ( _NetSell_ ).<sup>4</sup> The remaining portion of option volume (i.e. the overlap in the amount of synthetic buy and sell volume) represents trading due to investor disagreement, which we denote as _Disagmt_ . These option trading volume measures are scaled by stock trading volume, similar to the _O/S_ measure. We obtain qualitatively similar results when we compute option volume based on number of shares traded or dollar value of trading volume or when option volume is scaled by value of shares outstanding. Consistent with prevailing evidence on informed trading in options, we find that stocks with high _NetBuy (NetSell)_ predicts significantly low (high) future weekly stock returns. 

The theoretical relation between disagreement ( _Disagmt_ ) and future stock returns is unclear. Disagreement models generate overpricing when investor optimism is not arbitraged due to short-sale constraint (Miller, 1977; Harrison and Kreps, 1978). On the other hand, if investors condition on prices, concern about other investors information increases the subjective risk in rational expectations equilibrium so that high disagreement increases expected stock returns (Banerjee, 2011). The predictive effect of disagreement–based option volume on future stock returns, however, may be mitigated if heavy 

> 4 This is consistent with the idea of computing volume-synchronized probability of informed trading introduced by Easley, López de Prado and O'Hara (2012) and Ge, Lin and Pearson (2016). For example, Easley, López de <u>Prado and O'Hara (2012) classify stock volume into buy and sell volume and use the ratio of trade imbalance to</u> total volume to signify the probability of informed trades. 

3 

trading in options alleviates the short-sale constraints in the stock market (Diamond and Verrecchia, <u>1987; Figlewski and Webb, 1993).</u> 

Our findings support the disagreement models that predict overpricing of stocks when investors agree to disagree: we find a significant negative effect of _Disagmt_ on future stock returns. For example, we find that stocks with the low disagreement-based option volume outperform stocks with high disagreement-based option volume, so that the difference in the returns between the low and high _Disagmt_ quintile portfolios (labelled as _LMH_Disagmt_ ) is a significant 0.09% ( _t_ -stat=2.54) per week (or 4.8% per annum), after adjusting for exposure to the five factors in Fama and French (2015). Our findings are robust to adjustment to stock returns using alternative factor models (including StambaughYuan mispricing factor model), different definitions of disagreement-based option volume as well as controlling for many stock and option characteristics (e.g. firm size, book-to-market, market beta, past stock returns, stock volume, and idiosyncratic stock volatility, option implied volatility spread and riskneutral skewness) that describe the cross-section of stock returns. An important implication of our findings is that high disagreement-based option volume simply reflects differences in investor beliefs about stock values and does not eliminate stock mispricing by facilitating the incorporation of all investor views into stock prices. 

Next, we perform three distinct analyses to provide extensive evidence and new insights on the role of investor disagreement in explaining cross-section of stock returns. First, we examine the interaction of _Disagmt_ and stock mispricing in predicting future stock returns. Atmaz and Basak (2018) model the combined effect of investor disagreement and expectation bias on mispricing in the stock market. They show that disagreement among investors about future cash flows amplifies the mispricing in stocks arising from investor bias. For example, the arrival of good cash-flow news inflates the wealth of optimistic investors and increases the average optimistic bias in market prices and predicts low future returns. Hence, we condition the analyses of the relation between _Disagmt_ and future stock returns on stock mispricing. Our measure of mispriced stocks relies on the composite ranking of stocks across eleven well-known stock market anomalies in Stambaugh, Yu and Yuan (2012, 2015), which we denote 

4 

as _Overpricing._ A high (low) value of _Overpricing_ indicates that the stock ranks as the most (least) overpriced across all anomalies.<sup>5</sup> 

We provide new evidence that the predictive effect of the disagreement-based option volume on stock returns is amplified by mispricing in the underlying stocks, consistent with Atmaz and Basak <u>(2018). Specifically, the negative relation between</u> _Disagmt_ and future stock returns is magnified as we move from the least to the most overpriced stocks. For example, the five-factor adjusted weekly returns on the disagreement based long-short portfolio, _LMH_Disagmt_ , increases from an insignificant 0.04% when _Overpricing_ is low, to an economically large 0.27% ( _t_ -stat=2.82) (or 15% per annum) when _Overpricing_ is high. Our findings on the interaction effects of _Disagmt_ and _Overpricing_ in predicting stock returns are also highly robust, including controlling for many stock and option characteristics, alternative factor models and empirical measures of _Disagmt_ . In contrast, the predictive effect of informed option trading proxies, _NetBuy_ and _NetSell_ , on stock returns do not vary with _Overpricing_ . 

Second, we investigate the behavior of _Disagmt_ , _NetBuy_ and _NetSell_ around quarterly earnings announcements. We find that abnormal option trading volume pertaining to _NetBuy_ and _NetSell_ spikes during the days before corporate earnings announcement. Moreover, we observe significant positive (negative) 3-day cumulative abnormal stock returns ( _CAR_ ) around the earnings announcement day when _NetBuy_ ( _NetSell_ ) is high prior to the announcement date. We also find that the level and predictive effect of abnormal _NetBuy_ and _NetSell_ are muted following earnings news. These results are consistent with options facilitating private information-based trading before public announcement of earnings information. The pattern of _Disagmt_ and its effect on stock returns are slightly different. While abnormal _Disagmt_ volume increases before earning announcement, it peaks on the announcement day. Consistent with our earlier results, high abnormal _Disagmt_ before earnings announcement predicts low stock returns: stocks with high _Disagmt_ prior to earnings announcements underperform other stocks by 0.26% 

> 5 <u>Stambaugh, Yu and Yuan (2012) argue that the 11 anomaly variables capture overpricing (underpricing) due to</u> investor optimism (pessimism) since the anomaly profits vary significantly with investor sentiment. They show that averaging the stock ranking across these anomaly variables generates a measure that picks up the common stock mispricing component that is less noisy. Details on these eleven anomalies are provided in Appendix A. 

5 

( _t_ -stat=2.68) over the three days surrounding the announcement. Additionally, high abnormal _Disagmt_ during the earnings announcement period also significantly predicts low _CAR_ over the following week. The reported increase in investor disagreement about stock prices following earnings news is consistent with several theoretical disagreement models. For example, Kandel and Pearson (1995) find divergence of opinion occurs around earnings announcements because investors use different likelihood functions (or models) to interpret the public announcement. 

Third, we find that _Disagmt_ is strongly correlated with other known stock-based disagreement proxies. Specifically, _Disagmt_ is positively and significantly related to dispersion in analyst forecasts (Diether, Malloy and Scherbina, 2002; Moeller, Schlingemann and Stulz, 2007), stock volume (Cao and <u>Ou-Yang, 2009), return volatility (Ajinkya and Gift, 1985), and change in breadth of ownership (Chen, Hong and Stein, 2002). Moreover, a composite measure of disagreement (aggregated across these five</u> stock-based disagreement proxies) is strongly positively related to _Disagmt_ but not with informed option volume measures, _NetBuy_ and _NetSell_ . Hence, _Disagmt_ indeed measures investor disagreement. Additionally, we also find that the predictive effect of _Disagmt_ on stock returns is incremental to the information contained in stock-based disagreement proxies. Overall, our evidence suggests that disagreement among investors is an important reason for observing high option volume and these disagreement trades contribute to stock return predictability. 

In further analyses, we provide evidence supportive of two fundamental reasons for disagreement motivated trading in options: (a) to circumvent shorting constraints in the underlying stocks, and (b) to take advantage of leverage provided by options. Consistent with high shorting constraints together with high investor disagreement generating stock overvaluation (Miller, 1977; <u>Boehme, Danielsen and Sorescu, 2006), we find that high shorting costs magnifies the interaction</u> effects of option-based investor disagreement and stock mispricing on future stock returns. Specifically, the Fama-French five-factor alphas on the low minus high disagreement quintiles, _LMH_Disagmt,_ is a staggering 0.43% per week (25% per annum) for stocks with both high _Overpricing_ and high shortselling costs. On the other hand, we do not find evidence of predictable stock returns associated with 

6 

investor disagreement-based option volume when stocks are overpriced but shorting is not costly or when shorting costs are high, but stocks are not overpriced. These findings also indicate that high disagreement trades in options does not translate to incorporation of all opinions into stock prices. Our findings suggest that active trading in options (e.g. synthetic shorts) does not substitute difficulty in shorting stocks (see also Grundy, Lim and Verwijmeren (2012)). We also find that the negative relation between _Disagmt_ and future stock returns is stronger in high leverage options. It is possible that investors with private information display greater overconfidence in interpreting public information and, hence, prefer to trade options with bigger leverage. For example, Barber, Huang, Ko and Odean (2019) show that overconfident investors not only trade more, they also prefer to take on more leverage. 

We make two major contributions to the literature. First, we show that while part of option trading reflects directional trades by informed investors, a significant portion of option trading volume is due to trading among disagreeing investors. Second, our findings that high disagreement-based volume predicts low future stock returns, particularly when stocks are mispriced, indicate that trading in options do not undo short sale constraints in underlying stocks nor does it eliminate investor disagreement reflected in stock prices. 

The rest of the paper is organized as follows. The next section describes the data and variables employed in our empirical research. Section 3 examines how option trading activity predicts stock returns and provides robustness checks. Section 4 examines the role of short sale constraints and leverage in predicting the effects of disagreement motivated option volume. Section 5 concludes the paper. 

#### **2. Data Description** 

Our analysis is based on several data sources. Stock market data are obtained from Center for Research in Security Prices (CRSP) and accounting data are from COMPUSTAT. We obtain data on institutional holdings, security lending activities and analyst forecasts from Thomson Reuters S34, Markit Securities Finance and I/B/E/S, respectively. Risk-free rates (one-month Treasury bill rates) and <u>Fama and French (2015) five factors are sourced from Ken French’s website and the Stambaugh and</u> 

7 

<u>Yuan (2017) mispricing factors are from Yu Yuan’s website.</u><sup>6</sup> We extract signed option volume data from International Securities Exchange Open/Close Trade Profile (ISE), with additional option price data from OptionMetrics. 

Our stock market sample includes all common stocks listed on NYSE, AMEX, and NASDAQ. We include common stocks with valid prices, trading volume and number of shares outstanding. Stocks with price less than $1 (or “penny” stocks) at the end of the previous week are excluded to minimize the impact of microstructure related noise. We match the stock data with the option data obtained from ISE using ticker symbols and exclude stocks without corresponding options data. ISE is the largest option exchange that covers approximately 30% of total option trading volume in the US. Since ISE data are available from 2005, our sample period spans from May 2005 to December 2015. The merged dataset contains an average of 1,230 stocks per week with options traded on them. Our sample of optionable stocks makes up 31% of entire CRSP universe in terms of number of stocks and 85% in market capitalization, confirming that stocks in our sample are relatively larger firms and representative of the entire market. 

#### **2.1. Description of Key Variables** 

The primary objective of our paper is to establish that trades in options market reflects disagreement among investors, in addition to informed trading. We start by segregating trading volume in options into volume that reflects disagreement trades and directional (informed) trades. 

Volume of options traded on a stock is measured as total number of contracts traded in all options on stock _i_ on day _d_ (aggregated across all listed options). Our main measure of option volume is scaled by the total share trading volume in stock _i,_ analogous to the _O/S_ ratio in Roll, Schwartz and <u>Subrahmanyam (2010) and Johnson and So (2012). As we show later in the paper, our findings are</u> robust to alternative measures of option volume, including dollar trading volume, delta-equivalent share 

> 6 Ken French’s website is <u>http://mba.tuck.dartmouth.edu/pages/faculty/ken.french</u> and Yu Yuan’s website is <u>http://www.saif.sjtu.edu.cn/facultylist/yyuan</u> 

8 

volume and scaling option volume by number of shares outstanding. 

In order to distinguish option trading volume due to investor disagreement from informed trading in options, we decompose option trading volume into disagreement-based trades and order imbalance that reflects the direction of trades. The decomposition is based on daily volume data, provided by International Securities Exchange (ISE) Open/Close Trade Profile. ISE records daily volume on opening and closing of long and short positions of all ISE-listed options. The volume tracks all trades on ISE, initiated by non-market makers. For each option traded on a stock, we divide total daily trading volume into synthetic long (long call and short put) and short positions (short call and long put). For each stock _i_ on day _d_ , we aggregate the volume on synthetic long positions ( _Li,d_ ) and synthetic short positions ( _Si,d_ ) across all options so that _L_ and _S_ represents non-market makers’ aggregated directional bets.<sup>7</sup> We decompose the total daily option volume into three additive components: 

Option Volume _i,d_ = _Li,d_ + _Si,d_ = | _Li,d_ – _Si,d_ | + ( _Li,d_ + _Si,d_ − | _Li,d_ − _Si,d_ |) 



The first term in equation (1), _Max_ ( _Li,d_ – _Si,d ,_ 0 ) represents the trading volume on synthetic long positions that exceeds the volume on synthetic short positions, and hence, indicates the amount of net buy volume, an imbalance that is likely to be informed buys. Similarly, the second term, _Max_ ( _Si,d_ − _Li,d_ , 0 ) reflects the amount of informed net sells. The last term, 2× _Min_ ( _Li,d_ , _Si,d_ ), represents amount of buy volume that is matched by sell volume, a natural measure of disagreement among investors. To illustrate, suppose 1,000 contracts of options were traded in synthetic long position and 300 contracts in synthetic short position, the 1,300 contracts of total volume is broken down into informed buy option volume of 700 contracts (i.e. 1000−300) and disagreement option volume of 600 (i.e. 300×2). This classification of trade imbalance as informed trading is consistent with the trade imbalance being proportional to probability of informed trades (Easley, López de Prado and O'Hara (2012), Ge, Lin and 

> 7 We combine the volume traded by the two groups reported in ISE: consumers and broker/dealers. Detailed profile of the trades can be found at https://www.nasdaq.com/solutions/nasdaq-openclose-trade-profiles-ise-and- <u>gemx</u> 

9 

<u>Pearson (2016) and Fournier, Goyenko and Grass (2017)). In our data, the decomposition in equation</u> (1) classifies 40% of option volume as informed buy or sell option volume and the remaining 60% as disagreement option volume. 

For each stock, we accumulate the daily disagreement volume, 2× _Min_ ( _Li,d_ , _Si,d_ ), over the week to get the weekly disagreement volume. The weekly disagreement volume is scaled by weekly stock trading volume and is denoted _Disagmt_ . Intuitively, high _Disagmt_ implies that a high proportion of option trading volume stems from matched synthetic buy and sell option trades during the week, consistent with the notion that it signifies high investor disagreement. Similarly, we cumulate directional daily sell volume, _Max_ ( _Si,d_ – _Li,d ,_ 0 ), and daily buy volume, _Max_ ( _Li,d_ – _Si,d ,_ 0 ) during the week. When the weekly sell volume exceeds the buy volume, we classify the excess synthetic option volume as informed sell volume. This excess sell volume is scaled by weekly stock volume, to obtain our informed sell volume measure, denoted as _NetSell._ A high _NetSell_ implies that there is a large amount of daily imbalance reflecting net sell volume for the stock during the week. The counterpart for weekly informed buy volume, _NetBuy_ , is similarly defined. 

In our first set of analyses, we examine the cross-sectional relation between the three components of option volume ( _Disagmt_ , _NetSell_ and _NetBuy_ ) and future stock returns. Specifically, we investigate if the predictive relation between these option volume components and stock returns are related to stock mispricing. The stock mispricing proxy is constructed using the eleven prominent anomalies employed in Stambaugh, Yu and Yuan (2012, 2015), which have been shown to survive after controlling for the stock exposure to the Fama-French three-factors. Specifically, the anomalies comprise of the following: financial distress (Campbell, Hilscher and Szilagyi, 2008; Chen, Novy-Marx <u>and Zhang, 2011), O-score bankruptcy probability (Ohlson, 1980; Chen, Novy-Marx and Zhang, 2011),</u> net stock issues (Ritter, 1991; Loughran and Ritter, 1995), composite equity issues (Daniel and Titman, <u>2006), total accruals (Sloan, 1996), net operating assets (Hirshleifer, Hou, Teoh and Zhang, 2004), price</u> - momentum (Jegadeesh and Titman, 1993), gross profitability (Novy <u>Marx, 2013), asset growth (Cooper, Gulen and Schill, 2008), return on assets (Fama and French, 2006), and investment to assets (Titman,</u> 

10 

<u>Wei and Xie, 2004). To ensure that each anomaly variable is available at portfolio formation date, we</u> assume that accounting data from fiscal year _t_ is available from July of calendar year _t_ +1. Following <u>Stambaugh, Yu and Yuan (2012, 2015), we focus on the composite ranking across all eleven anomalies.</u> Each week, stocks are ranked based on each anomaly variable, so that the stock with the highest (lowest) rank is the most (least) overpriced. We require that the stock has valid rankings for at least 5 anomalies to be included in the ranking. We take the average of ranking percentiles across the eleven anomalies so that the stock with the highest (lowest) composite ranking is the most overpriced (underpriced) and refer to this composite anomaly proxy as _Overpricing_ . By combining the anomalies, we obtain the mispricing component that is common across all anomalies and, hence, is less noisy. Detailed description of the construction of the anomaly variables is provided in Appendix A. 

#### **2.2 Descriptive Statistics** 

Since our primary objective is to investigate the role of disagreement in options market, we provide a description of the attributes associates with stocks with high and low disagreement option volume, _Disagmt_ . In Table 1, we first sort stocks into quintiles based on _Disagmt_ in each week and report average values of option and stock characteristics across the quintiles. As shown in Panel A of Table 1, _Disagmt_ exhibits positive skewness: the average _Disagmt_ among the first four quintiles is between 0.08% to 2.5% and increases considerably to 10% for the highest _Disagmt_ quintile. We get a similar pattern when for the directional option trading components, _NetBuy_ and _NetSell._ For example _, NetBuy_ averages between 0.13% to 0.47% in _Disagmt_ quintiles 1 to 4, and spikes to 0.8% in the highest _Disagmt_ quintile. In unreported results, the rank correlation between _Disagmt_ and _NetBuy_ ( _NetSell_ ) is 27% (28%), while _NetBuy_ and _NetSell_ are uncorrelated. The low correlations indicate that _Disagmt_ is different from the decomposed directional option trading components. 

Panel B of Table 1 reports the average stock characteristics across the _Disagmt_ quintiles. Stocks with high _Disagmt_ tend to be large, growth-oriented, have high stock turnover and past oneweek winners. Incidentally, all these stock characteristics have also been shown to be negatively related 

11 

to future stock returns in prior work.<sup>8</sup> 

Several papers document option implied characteristics that are related to future stock returns. <u>Cremers and Weinbaum (2010) and An, Ang, Bali and Cakici (2014)</u> find that the large, negative differences in the option implied volatility between call and put options are associated with low future stocks returns. <u>Xing, Zhang and Zhao (2010) report lower returns for stocks with high risk-neutral</u> skewness implied by put and call option prices. Panel C of Table 1 shows that the differences in the call and put option implied volatility (extracted from the OptionMetrics volatility surface with a delta of 0.5 and an expiration of 30 days) and option implied risk-neutral skewness are significantly lower for stocks in the high _Disagmt_ quintile relative to those in the low _Disagmt_ quintile. 

#### **3. Investor Disagreement and Trading Volume in Options** 

#### **3.1 Option Volume, Mispriced Stocks and Stock Return Predictability** 

In this sub-section, we investigate the role of option volume-based disagreement measure ( _Disagmt_ ) in predicting stock returns, particularly when stocks are mispriced. We also examine if directional (informed) trading in options ( _NetBuy_ , _NetSell_ ) predict stock returns as expected. 

#### **3.1.1 Disagreement Option Volume and Future Stock Returns** 

We begin the investigation of the relation between option volume and stock returns by sorting stocks into quintiles based on disagreement option volume, _Disagmt,_ in week _t_ and examine the quintile portfolio returns in week _t+1_ . To account for the exposure of these portfolios to common factors, we compute the Fama and French (2015) five factor-adjusted returns by running the following time-series regression: 

𝑟𝑡 −𝑟𝑓,𝑡 = 𝛼+ 𝛽𝑀𝐾𝑇𝑀𝐾𝑇𝑡 + 𝛽𝑆𝑀𝐵𝑆𝑀𝐵𝑡 + 𝛽𝐻𝑀𝐿𝐻𝑀𝐿𝑡 + 𝛽𝑅𝑀𝑊𝑅𝑀𝑊𝑡 + 𝛽𝐶𝑀𝐴𝐶𝑀𝐴𝑡 + 𝜖𝑡 (2) 

> 8 The cross-sectional predictive relation between these firm characteristics and future stock returns has been well documented. For example, <u>Daniel and Titman (1997) provide evidence for firm size, book-to-market; Ang, Hodrick, Xing and Zhang (2009) for idiosyncratic volatility and Frazzini and Pedersen (2014) for beta</u> characteristics. Incidentally, the optional stocks in our sample are liquid and Amihud (2002) stock illiquidity estimates do not vary with option volume. 

12 

where 𝑟𝑡 is the raw return of a portfolio in week _t_ , 𝑟𝑓,𝑡 is the weekly risk-free (T-bill) rate. The factoradjustment is based on the Fama and French (2015) five factor model comprising of the market factor (excess return on the value-weighted CRSP market index over the one month T-bill rate, MKT), the size factor (small minus big return premium, SMB), the book-to-market factor (high book-to-market minus low book-to-market return premium, HML), the profitability factor (robust (strong) profitability minus weak profitability return premium, RMW), and the investment factor (conservative (low) investment minus aggressive (high) investment return premium, CMA). The regression intercept α and the five factor 𝛽 coefficients correspond to the five-factor alpha and the factor loadings, respectively. 

#### [Table 2] 

In Panel A of Table 2, we report the weekly returns on stocks sorted into quintiles by _Disagmt_ and _Overpricing_ as well as the 5×5 portfolios of stocks that fall into the intersection of quintiles sorted independently by _Overpricing_ and _Disagmt_ . Specifically, the portfolios are formed based on _Disagmt_ and _Overpricing_ in week _t_ and we report the week _t+1_ (equal-weighted) Fama-French five-factor alphas in each of these portfolios. The first row of Table 2 Panel A presents the average five-factor alphas on stocks sorted into _Disagmt_ quintile portfolios. The difference in returns between the low and high _Disagmt_ quintile portfolio is labelled as _LMH_Disagmt_ . The weekly five-factor alpha of the stocks in the high _Disagmt_ quintile is significantly negative at 0.07% ( _t_ -stat=−2.21), while the low _Disagmt_ quintile returns are not different from zero. The weekly factor-adjusted return on the low minus high disagreement portfolio, _LMH_Disagmt_ , is a significant 0.09% ( _t_ -stat=2.54), with primary contribution to the predictive effect coming from the short-leg of the portfolio. The results indicate a strong unconditional negative relation between investor disagreement (measured using option volume) and future stock returns. 

The column labelled “All” in Table 2, Panel A presents the five-factor alpha for stocks sorted by the mispricing variable, _Overpricing_ . Stocks with high _Overpricing_ in week _t_ earn low risk-adjusted returns during the following week _t+1_ . The five-factor-adjusted anomaly profits obtained by longing stocks in the low _Overpricing_ quintile (i.e. least overpriced stocks) and shorting the high _Overpricing_ 

13 

quintile is 0.14% per week ( _t_ -stat=1.89). Hence, we affirm that the anomaly variables in Stambaugh, <u>Yu and Yuan (2015) significantly predict stock returns in our sample. Consistent with Stambaugh, Yu and Yuan (2015), the predictive effect is stronger in the short-leg of the anomaly portfolios.</u> 

The remaining columns and rows in Panel A of Table 2 present the five-factor alphas for the 5×5 portfolios sorted independently on _Overpricing_ and _Disagmt_ . We find the effect of _Disagmt_ volume on the future stock returns varies substantially across mispriced stocks. Moving from the lowest _Overpricing_ quintile to the highest _Overpricing_ quintile, we find that the negative relation between _Disagmt_ and future stock returns is strongest in the most overpriced stocks: the factor-adjusted returns on _LMH_Disagmt_ portfolio jumps from an insignificant 0.04% in stocks with low _Overpricing_ to an economically large 0.27% per week ( _t_ -stat=2.82) among high _Overpricing_ stocks. Panel A also presents the factor-adjusted anomaly returns across disagreement quintiles in columns 1 (Low _Disagmt_ ) to 5 (High _Disagmt_ ). We find that the anomaly returns in the last row “1−5” of Panel A concentrates in high _Disagmt_ stocks, and is large at 0.28% per week ( _t_ -stat=3.09), with the profits emanating from the most overpriced quintile (the short-leg). To be specific, the corner portfolio of stocks that are most overpriced and has the highest investor disagreement earn the most negative alpha of −0.29% ( _t_ -stat=−3.34). The factor-adjusted stock return is close to zero when either _Disagmt_ or _Overpricing_ is low. 

To provide a picture of the evolution of the returns on the portfolio formed using investor disagreement, we plot the cumulative Fama-French five-factor alpha on the low minus high _Disagmt_ quintile portfolios (i.e. _LMH_Disagmt_ ) in Figure 1. For all stocks in the sample, the unconditional _LMH_Disagmt_ portfolio returns accumulate to 50% over the decade from 2005 to 2015. Figure 1 also plots the five-factor alphas for the sub-sample of stocks in the top and bottom _Overpricing_ quintiles. For stocks in the top _Overpricing_ quintile, the _LMH_Disagmt_ portfolio returns cumulate to a substantially higher value of 140%. For stocks in the bottom _Overpricing_ quintile, on the contrary, investor disagreement reflected in option trading volume does not predict future stock returns. Hence, high disagreement trades in options predicts low future stock returns, especially among overpriced stocks. 

14 

#### [Figure 1] 

The evidence suggests that stock returns are expected to earn the lowest return when both investor disagreement and stock overpricing is high. This amplification effect of differences in investor opinion on overpriced stocks supports the theoretical model in Atmaz and Basak (2018). Atmaz and <u>Basak (2018)</u> show that when a stock is overpriced, investor disagreement amplifies the investor optimism bias and pushes stock prices higher and lowers future returns. Our findings suggest that the negative effect of disagreement in overpriced stocks generates a negative unconditional disagreementmean return relation. As we show in Section 3.1.3 and Section 3.4, the effect of investor disagreement (measured using option volume) on stock returns and the amplification effect of stock mispricing are highly robust across different empirical specifications, including controls for stock and option characteristics. 

#### **3.1.2 Directional Option Volume and Future Stock Returns** 

Several papers document that volume of options traded contains private information, which are revealed in subsequent stock price changes (Johnson and So, 2012; Ge, Lin and Pearson, 2016). The directional option volume in our decomposition is designed to capture the informed trading component of option volume. Next, we examine the predictive effect of directional net option volume on future stock returns. If informed traders choose to trade in options, then high _NetBuy_ represents informed excess synthetic buy trades in the options market and we expect high _NetBuy_ to predict high future stock returns. In a similar vein, we postulate that high _NetSell_ (informed sell) predicts low future stock returns. 

Each week _t_ , stocks in the _NetBuy_ group are split into _High NetBuy_ ( _Low NetBuy_ ) category if the stock’s _NetBuy_ volume is above (below) the median value. Similarly, stocks are sorted on the value of _NetSell_ into _High NetSell_ and _Low NetSell_ groups using the median value in week _t_ as the cutoff. In Panel B of Table 2, row marked “All” presents the weekly five-factor alphas for stocks in each of the four groups based on high and low _NetBuy_ and _NetSell_ option volume _._ As expected, we find that _NetBuy_ positively predicts stock returns: the alpha on the _High NetBuy_ group is 0.09% ( _t_ -stat=2.55) while the 

15 

alpha on the _Low NetBuy_ group is an insignificant 0.03%. The difference in the predicted weekly stock returns between High and Low _NetBuy_ portfolios, _LMH_NetBuy,_ is a significant 0.06% ( _t_ -stat=2.43). Similarly, high _NetSell_ option volume predicts low future stock returns: _High NetSell_ group earns negative alpha of −0.12% per week ( _t_ -stat=−4.43) while the low _NetSell_ group earns an insignificant −0.02%. The difference between the portfolio, _LMH_NetSell_ of 0.10% is highly significant. The strong positive (negative) predictive effect of high _NetBuy_ ( _NetSell_ ) on stock returns supports the notion that these quantities reflect informed trading components of option volume, as expected. 

Table 2, Panel B, also reports the average five-factor alphas of the four _NetBuy/NetSell_ stock portfolios across the _Overpricing_ quintiles. The stocks in each of the four _NetBuy/NetSell_ groups are further sorted into 5 sub-groups based on stock level _Overpricing_ . We find that the predictive content of high _NetBuy_ in options is not systematically related to stock mispricing. For instance, _High NetBuy_ generates high stock returns in all mispricing quintiles (0.09% to 0.14% per week), except the group with highest _Overpricing_ . For the high _Overpricing_ quintile, it is likely that the low future returns associated with high _Overpricing_ offsets the positive return predicted by high _NetBuy_ . This suggests that high _NetBuy_ option volume predicts high stock returns because of informed buying in options based on (private) information beyond the anomaly variables in _Overpricing._ Similarly, _NetSell_ is weakly related to underlying stock mispricing. While _High NetSell_ generates the most negative weekly returns when the underlying stocks are most overpriced, we continue to find significant low returns for stocks in the middle _Overpricing_ quintiles (ranging from −0.06% to −0.12% per week). This is not surprising since the High _NetSell_ stocks as well as high _Overpricing_ stocks are expected to have the lowest stock returns. Moreover, as we show in Section 3.1.3, the interaction effect between _Overpricing_ and _NetSell/NetBuy_ on future stock returns becomes statistically insignificant when we control for firm characteristics that drive future stock returns. Thus, the stock return predictability of directional (informed) option trading is not related to mispricing in the stock market and possibly contains private information (Pan and Poteshman, 2006; Johnson and So, 2012). Taken together with the predictive content of _Disagmt_ trades on stock returns and the amplification effect of stock mispricing (Atmaz and 

16 

<u>Basak, 2018), the evidence points to a significant role of disagreement trades driving option volume.</u><sup>9</sup> 

#### **3.1.3 Fama-Macbeth Regressions** 

As can be seen from Table 1, high _Disagmt_ stocks also exhibit other characteristics associated with low future stock returns, such as larger firm size, more growth oriented, higher beta and idiosyncratic volatility. The high _Disagmt_ stocks also have higher option implied volatility spread that predicts low future stock returns. We use the Fama-MacBeth regression approach to examine if our main findings are explained by stock and option characteristics that describe the cross-section of stock returns.<sup>10</sup> Specifically, we regress stock returns on lagged stock characteristics (i.e. firm size, book-tomarket, market beta, lagged stock returns, and idiosyncratic stock volatility) as well as option characteristics (i.e. option implied volatility spread and risk-neutral skewness) and examine if the interaction of _Overpricing_ with _Disagmt, NetBuy_ and _NetSell_ continue to play a predictive role. To minimize the effect of skewed distribution of option trading volume (see Table 1), we convert the option volume into dummy variables. _I_Disagmt_ is a dummy variable that takes a value of one if a stock belongs to the High _Disagmt_ quintile. _I_NetBuy_ ( _I_NetSell_ ) take the value of one if a stock belongs to the High _NetBuy_ ( _NetSell_ ) group, defined as stocks with _NetBuy_ ( _NetSell_ ) values above the median of all stocks. 

#### [Table 3] 

As shown in Table 3, Model 1, the relation between _I_Disagmt_ and future stock returns is negative after controlling for other determinants of stock returns. The coefficient on _I_Disagmt_ is −0.0669 ( _t_ -stat=−2.67), indicating that High _Disagmt_ stocks underperform by 0.07% per week, similar to the magnitude based on portfolio sorts in Table 2, Panel A. This suggests that the univariate effect of _Disagmt_ on stock returns is not explained by the stock characteristics that might be correlated with 

> 9 In unreported results (available upon request), we find strong predictive relation between _O/S_ and future stock returns, both in our sample and in the broader CBOE sample for the period 1996 to 2015, similar to Johnson and So (2012). 

> 10 We consider firm size, book-to-market, market beta, lagged stock returns, idiosyncratic stock volatility, option implied volatility spread, and risk-neutral skewness presented in Table 1. 

17 

future stock returns. In Model 2, we add the directional informed trading components of option volume to the regression and find that _NetBuy_ is significantly positively correlated with future stock returns. The regression coefficient of 0.1028 ( _t_ -stat=4.52), indicates that stocks in high _NetBuy_ group outperforms by 0.10% per week. Furthermore, stocks with high _I_NetSell_ earn a significant negative 0.08% ( _t_ -stat=−3.73). Hence, the main findings of the differential predictive effects of _NetBuy, NetSell_ and _Disagmt_ on stock returns that we report in Table 2 withstand controls for various stock characteristics. 

In Model 3, we add the interaction of _I_Disagmt_ and _Overpricing_ to examine whether stock mispricing amplifies the effect of disagreement on future stock returns. The coefficient on _I_Disagmt_ is positive 0.1720 ( _t_ -stat=2.34) and the coefficient on the interaction term between _I_Disagmt_ and _Overpricing_ is large at −0.5012 ( _t_ -stat=−2.89). To interpret the economic magnitude of the results, consider the predictive effect of _Disagmt_ on stock returns when the stock is highly overpriced at, say, the 90<sup>th</sup> percentile of O _verpricing_ . At this level of overpricing, stocks in the high _I_Disagmt_ underperform by 0.16% per week.<sup>11</sup> The magnitude of this estimate, after controlling for various firm characteristics, is economically large. Also, the predictive effect estimated is unchanged when we add _NetBuy_ and _NetSell_ components of option volume as control variables in Model 4. 

In Model 5, we investigate if the predictable stock returns associated with informed trading components of option trading volume also interacts with _Overpricing_ . In contrast to the results arising from interactions with disagreement volume, the coefficient on the interaction of _Overpricing_ with _NetBuy_ and _NetSell_ are statistically insignificant. For example, the coefficient on the interaction between _Overpricing_ and _I_NetSell_ is −0.1997 ( _t_ -stat=−1.38), indicating that the stock return predictability due to _NetBuy_ and _NetSell_ are not significantly related to mispricing in the underlying stocks. Finally, the estimates are unaffected when we add controls for option characteristics in Models 6 and 7. Hence, the effects of investor disagreement (using option volume) on future stock returns are 

> 11 Since the 90th percentile of _Overpricing_ is 0.67, the combined effect of the coefficient on _Disagmt_ on stock returns is given by (0.1720+0.67×(−0.5012)) =−0.1638. 

18 

similar across the two methods using portfolio sorts in Table 2 and cross-sectional regressions in Table 

#### 3. 

#### **3.2. Option Volume and Stock Returns around Earnings Announcement** 

Recent papers document the impact of option trading activity around the stock’s earnings announcement date on future stock prices. For example, <u>Roll, Schwartz and Subrahmanyam (2010)</u> report that (unsigned) option volume increases before earnings announcement, contains significant private information and predicts the (absolute) stock price response to earnings announcement. Johnson <u>and So (2012)</u> also find private information about earnings announcement contained in (unsigned) option volume which subsequently gets incorporated in stock prices after the announcement. In this section, we examine the behavior of the segregated informed option volume and disagreement motivated option volume around earnings announcement date and the corresponding stock price reactions to these quantities. In addition, we also investigate the predictive content of the informed and disagreement option volume after the public revelation of earnings information. 

To investigate informed trading around earnings announcements, we compute _NetBuy_ and _NetSell_ around the earnings announcement date, relative to the amount of _NetBuy_ and _NetSell_ ten trading days before the earnings date and plot the relative values in Figure 2. Specifically, relative _NetBuy_ on day _t_ + _k_ is defined as the _NetBuy_ on day _t_ + _k_ divided by _NetBuy_ on day _t_ −10, for days k=−9 to =+10, with day _t_ being the earnings date. Relative _NetSell_ is similarly defined. Figure 3 shows that both relative _NetBuy_ and relative _NetSell_ increase steadily from 3 days before earnings announcement, spiking one day before the announcement. For example, _NetBuy_ and _NetSell_ on the day before the earnings announcement (day _t_ −1) is 58% and 33% higher than the respective volume on day _t_ −10, respectively. The relative _NetBuy_ and _NetSell_ volume revert back to zero (i.e. normal) level on and immediately after the public release of earnings information. Hence, Figure 2 suggests that _NetBuy_ and _NetSell_ contain private information on the upcoming earnings disclosure and the release of earnings information substantially attenuates the informed trading volume, consistent with earlier studies. 

Figure 2 also presents the pattern of disagreement-based option volume ( _Disagmt_ ) around the 

19 

earnings announcement date. Similar to the informed trading measures, _Disagmt_ increases before earnings announcement: _Disagmt_ on the day before the announcement ( _t_ −1) is 80% higher than the volume on day _t_ −10. It confirms that disagreement about the imminent earnings announcement generates large trading in options before the announcement. In contrast to informed trading volume which drops on earnings date, _Disagmt_ volume reaches its peak on earnings date, at 85% higher than _Disagmt_ on day _t_ −10. Even on the day after the public announcement of earnings ( _t_ +1), _Disagmt_ continues to be 18% higher than day _t_ −10. Although the release of earnings information resolves disagreement about earnings, Figure 2 shows elevated _Disagmt_ , supporting models that predict public news to increases investor disagreement about stock valuations. 

#### [Figure 2] 

Next, we examine the predictability of stock returns around earnings announcement based on the volume of options traded. Specifically, we estimate Fama-Macbeth regressions of cumulative abnormal stock returns ( _CAR_ ) around earnings announcements on the three measures of option volume ( _NetBuy_ , _NetSell_ and _Disagmt_ ) over two windows around the announcement event date. Each stock’s cumulative abnormal returns ( _CAR)_ is defined as the cumulative sum of CRSP value-weighted market index adjusted return. The first set of Fama-MacBeth regressions, presented in Panel A of Table 4, involves regressing the stock’s _CAR_ over the three days surrounding the earnings announcement day _t_ , from day _t_ −1 to day _t_ +1. Daily option volume, measured by _NetBuy, NetSell_ and _Disagmt_ is cumulated over the week prior to the _CAR_ measurement window from day _t_ −6 to day _t_ −2. We convert the option volume variables to indicator variables _,_ with _I_NetBuy, I_NetSell_ , and _I_Disagmt_ taking on a value of 1 for a stock whose respective _NetBuy_ , _NetSell_ and _Disagmt_ volume is high relative to other stocks, as defined in Section 3.1.3 (and in Table 3). The regressions also control for the same stock and option characteristics used in Table 3. 

#### [Table 4] 

As shown in Model 2, high _NetBuy_ stocks earn a positive subsequent 3-day _CAR_ which is higher by 0.26% ( _t_ -stat=3.82) and the _CAR_ on high _NetSell_ stocks is lower by 0.20% ( _t_ -stat=−2.01), 

20 

consistent with informed trading in options preceding the announcement of earnings news (Roll, <u>Schwartz and Subrahmanyam, 2010; Johnson and So, 2012). The results are similar when we exclude</u> the controls for stock and option characteristics in Model 1. Moreover, Model 2 also shows that stocks with high _Disagmt_ prior to earnings announcements earn lower returns upon earnings announcements: the high _Disagmt_ stocks underperform other stocks by 0.26% ( _t_ -stat=−2.68) during the announcement period. These results reaffirm our main findings on the differential effect of informed and disagreement trades on stock prices. 

Panel B of Table 4 reports the results for the second event window. Here we investigate how high option volume ( _I_NetBuy, I_NetSell_ or _I_Disagmt_ ) measured during earnings announcement period (days _t_ to _t_ +1) predicts the stock’s abnormal returns during the subsequent week (i.e. _CAR_ measured over days _t_ +2 to _t_ +6). We estimate Fama-MecBeth regressions of the stock’s _CAR_ following the earnings announcement period on option volume during the announcement period, controlling for stock and option characteristics. In Models 3 and 4, the coefficients associated with _I_NetBuy_ and _I_NetSell_ are both small in magnitude and statistically indistinguishable from zero. This is what we would expect if the informed trading measures are related to private information about earnings which lose their predictive effect on stock returns with the release of earnings information. Interestingly, Models 3 and 4 show that high disagreement-based option volume during the earnings announcement period continues to predict low future stock returns: the coefficient associated with _I_Disagmt_ is −0.09% and is significant ( _t_ -stat=−2.54). Different from the findings for informed trading, we find elevated disagreement-based trading on earnings announcement and high _Disagmt_ around the announcement day is followed by negative abnormal returns over the subsequent week. Although there is resolution of disagreement about the actual earnings, it does not eliminate investor disagreement about stock valuations. The increase in investor disagreement associated with public announcement of earnings is consistent with heterogeneity in investors’ interpretation about the news due to differences in their likelihood functions or models as postulated in <u>Kandel and Pearson (1995). There are also other</u> disagreement models that predict an increase in disagreement-based volume around public news. For example, Kondor (2012) shows that the presence of short-term speculative investors (e.g. option traders) 

21 

increases higher-order disagreement (i.e. an agent’s opinion about the opinion of others) about price following public announcements that decreases fundamental disagreement. 

Overall, our findings of high option-based trading volume surrounding earnings news is consistent with both a concentration of production or acquisition of private information and differential interpretation of public signals around earnings announcements. 

#### **3.3 Is There Incremental Information about Investor Disagreement in Option Volume?** 

We start the analyses by showing that the option volume-based disagreement measure, _Disagmt,_ is correlated with stock-based disagreement proxies advocated in the literature. We compare _Disagmt_ with five traditional disagreement proxies. Two of these proxies rely on dispersion on analysts’ long-term growth (LTG) forecast (Moeller, Schlingemann and Stulz, 2007) and EPS forecast (Diether, <u>Malloy and Scherbina, 2002). Analyst dispersion based on LTG forecast (</u> _Disp_LTG_ ) is defined as the standard-deviation of forecasts on long-term growth. Analyst dispersion based on EPS forecasts ( _Disp_EPS_ ) is computed as the standard-deviation of forecasts on yearly EPS scaled by their average. The next two disagreement proxies are stock trading volume ( _Turn_ ), which is ratio of weekly stock trading volume to number of shares outstanding, and return volatility ( _RetVol_ ) (Ajinkya and Gift, 1985). Return volatility ( _RetVol_ ) is defined as standard deviation of daily raw return in a previous calendar month. The last disagreement proxy that we consider is the change in breadth of ownership ( _DBreadth_ ) which has been shown to be negatively related to investor disagreement (Chen, Hong and Stein, 2002). It is defined as the increase in the ratio of the number of mutual funds that hold a long position in the stock to the total number of mutual funds in the sample for that quarter. Unlike the above proxies, _DBreadth_ is the only proxy that is expected to be lower when investor disagreement is high. Hence, we take the negative of _DBreadth_ (− _DBreadth_ ) so that all the stock-based proxies are increasing in investor disagreement. Finally, we aggregate the information in all five stock-based disagreement proxies into a composite index (lablelled as _Composite_ ). Each week, we rank stocks based on each stock-based disagreement proxy, and the average of five ranking percentiles defines _Composite_ . We require that the stock has at least three valid rankings to be included in _Composite_ . Therefore, _Composite_ minimizes the 

22 

noise in each proxy and captures the common variation among these stock-based measures of disagreeement. 

#### [Table 5] 

Table 5 shows that _Disagmt_ is significantly and positively correlated with each of the disagreement proxies. We run weekly Fama-Macbeth regressions, where the dependent variable is _Disagmt_ and independent variables include all the stock-based disagreement proxies, where each weekly observation is standardized by its cross-sectional standard deviation except for _Composite_ . Model 1 confirms that the option-based disagreement volume, _Disagmt_ , is significantly and positively related to all five stock-based disagreement proxies. For example, one standard deviation increase in the dispersion in long-term earnings forecast, _Disp_LTG_ , increases _Disagmt_ by a significant 0.22 bp ( _t_ - stat=11.62). Similarly, _Composite,_ the rank average of the five disagreement proxies, is also strongly related to _Disagmt_ in Model 3, with a positive regression coefficient 0.98 ( _t_ -stat=14.17). These regression estimates are robust to controlling for the effects of other stock and option-based characteristics, as shown in Models 2 and 4. Hence, the evidence corroborates our assertion that option trading volume partly reflects trades among disagreeing investors and that _Disagmt_ indeed captures investor disagreement. 

Next, we investigate if _Disagmt_ provides incremental information about investor disagreement beyond those captured by the stock-based measures. To examine the unique role of the options market in reflecting trades among disagreeing investors, we compare the effects of option-based _Disagmt_ with stock-based disagreement proxies and show that the _Disagmt_ incrementally predicts stock returns. 

Each week, we run a Fama-Macbeth cross-sectional regression of weekly stock returns on lagged _Disagmt_ and stock-based disagreement proxies ( _Composite_ ), controlling for _Overpricing_ as well as other stock and option characteristics. We use an indicator variable, _I_Disagmt_ , as our measure of high _Disagmt_ , as defined in Section 3.3.1 and in Table 3. 



23 

As presented in Model 1 of Table 6, _Disagmt_ is a significant predictor of future weekly stock returns after controlling for _Composite_ and stock and option characteristics _._ On the other hand, _Composite_ does not significantly predict stock returns. Models 2 and 3 show that _Composite_ as well as _Disagmt_ interact significantly with _Overpricing_ in predicting stock return in the following week: stock returns are significantly lower when there is high _Composite_ or _Disagmt_ among stocks that are overpriced. Model 3 in Table 6 shows that the coefficient corresponding to the interaction between _Overpricing_ and _Composite_ is −0.6992 ( _t_ -stat=−3.06), which suggests that stock-based disagreement proxies significantly lower stock returns among overpriced stocks. Similarly, the coefficient on the interaction between _Overpricing_ and _Disagmt_ is also significant at −0.3614 ( _t_ -stat=−2.04). Hence, the high _Disagmt_ reflects disagreement among investors about stock value and the information contained in _Disagmt_ is not subsumed by other disagreement proxies. 

In Model 4, 5, and 6 of Table 6, we present results when weekly stock turnover ( _Turn_ ) is used as the stock-based disagreement proxy. Since the construction of _Disagmt_ includes stock volume in the denominator, our results may be driven by cross-sectional variation in stock volume instead of disagreement-based option volume. As Model 4 presents, _Disagmt_ predicts future stock returns but _Turn_ does not. Model 6 shows that low returns on stocks with high _Disagmt_ and high _Overpricing_ is not explained by the interaction between _Overpricing_ and stock turnover. The prediction of low stock returns due to high _Disagmt_ and _Overpricing_ holds in all specifications. 

#### **3.4 Disagreement-based Option Volume and Cross-Section of Stock Returns: Robustness Checks** 

#### **3.4.1 Alternative Factor Model** 

The negative relation between _Disagmt_ and returns on mispriced stocks is robust to alternative factor models. Parsimonious factor models are useful in explaining the cross-sectional variations in expected returns due to risk or mispricing. We consider the mispricing factor model in Stambaugh and <u>Yuan (2017), who propose a four-factor model by combining the market and size factors with two</u> “mispricing” factors. The two mispricing factors are constructed by aggregating information across the eleven prominent anomalies that we use in this paper. Stambaugh and Yuan (2017) show that their four- 

24 

factor model adequately explains the monthly anomaly profits across the eleven anomalies as well as in a broader set that includes many other anomalies. 

Similar to the findings in Stambaugh and Yuan (2017), Panel A of Table 7 shows that the fourfactor model fully accommodates the composite of eleven anomalies that gives rise to the crosssectional variation in stock returns. As shown in the “All” column in Panel A, the alphas of high and low _Overpricing_ quintiles are not different from zero after adjusting for the Stambaugh-Yuan fourfactors. However, the returns on high _Disagmt_ stocks are robust to this alternative factor model specification. First, the high _Disagmt_ stocks earn a significant Stambaugh-Yuan four factor alpha, with the _LMH_Disagmt_ portfolio registering a weekly alpha of 0.08% ( _t_ -stat=2.28). Moreover, we find significantly large predictive effect of _Disagmt_ when we implement the strategy among overpriced stocks: the Stambaugh-Yuan alpha is highly significant at −0.23% per week ( _t_ -stat=3.26) among stocks with high _Disagmt_ and high _Overpricing_ . Specifically, the weekly Stambaugh-Yuan four factor alpha for the Low minus High Disagmt ( _LMH_Disagmt_ ) portfolio increases noticeably from 0.03% ( _t_ - stat=0.82) to 0.26% ( _t_ -stat=2.59) when we move from low to high _Overpricing_ quintile stocks. While the Stambaugh-Yuan mispricing factors help to explain the unconditional anomaly profits, these factors do not fully explain the low returns associated with investor disagreement captured by high option volume. 

#### **3.4.2 Change in Disagreement-based Option Volume** 

We consider the stock return predicted by a change in disagreement-motivated option volume or Δ _Disagmt,_ defined as percentage change in _Disagmt_ in week _t_ relative to its past 52-week average. We do this to mitigate potential concern that the base result is driven by some static (unobserved) firm characteristics that generate high option trading ( _Disagmt_ ) and low future alphas. In Panel B of Table 7, we report future weekly Fama-French five-factor alphas of the low and high Δ _Disagmt_ quintile stock portfolios constructed within the low and high _Overpricing_ quintile. The spread in returns between the low and high Δ _Disagmt_ quintiles increases from an insignificant 0.04% in the low _Overpricing_ quintile to 0.16% ( _t_ -stat=1.86) for the high _Overpricing_ quintile. Moreover, the weekly anomaly profits increase 

25 

from 0.09% (t-stat=0.97) among low _Disagmt_ stocks to 0.22% (t-stat=2.59) when _Disagmt_ is high. Hence, the effect of _Disagmt_ on future stock returns is robust to using changes in the investor disagreement-based option volume. 

#### [Table 7] 

#### **3.4.3 Predictability at Monthly Horizon** 

The anomaly variables used in this paper and Stambaugh and Yuan (2017) have traditionally been used to explain cross-section of stock returns at monthly horizon. The results we present above, on the other hand, examines cross-section of weekly stock returns, consistent with the weekly horizon used in the option volume literature (e.g. <u>Johnson and So (2012)</u> and <u>Ge, Lin and Pearson (2016)).</u> Hence, as an additional robustness check, we construct _Disagmt_ at monthly frequency and investigate how _Disagmt_ predicts the stock returns in the following month across _Overpricing_ quintiles. Monthly _Disagmt_ is constructed by aggregating daily _Disagmt_ within a month, which we use to explore its crosssectional relation with subsequent monthly stock returns. Panel C reports the Stambaugh-Yuan mispricing factor monthly alphas of portfolios sorted by monthly _Disagmt_ and _Overpricing_ . We find that the High _Disagmt_ stocks significantly underperform Low _Disagmt_ stocks to generate an unconditional alpha of 0.35% per month for the _LMH_Disagmt_ portfolio. Additionally, the predictability of stock returns concentrates in stocks which are overpriced. The _LMH_Disagmt_ portfolio earns a five-factor monthly alpha of 0.90% ( _t_ -stat=2.25) among High _Overpricing_ stocks, and the alpha diminishes to an insignificant 0.30% ( _t_ -stat=1.25) among Low _Overpricing_ stocks. 

#### **3.4.4 Alternative measures of option-volume based investor disagreement** 

The analyses in Roll, Schwartz and Subrahmanyam (2010) rely on option volume measured by both the dollar value of trades as well as the number of shares traded. Next, we consider option volume constructed using dollar trading volume instead of number of contracts. We do this this by multiplying the number of contracts traded with option price obtained from the end of day option midquote. For stock dollar trading volume, we multiply the number of shares traded with closing price at 

26 

the end of the day. We repeat the analyses in Table 3 using option volume components based on the dollar trading volume and report the estimates in Models 1 and 2 of Table 8. Model 1 shows that the coefficient on _I_Disagmt_ is −0.0502 (t-stat=−1.99), indicating that high _Disagmt_ group underperforms by 0.05% per week. Moreover, the negative predictive effect of _Disagmt_ is significantly amplified among overpriced stocks, as shown in Model 2. 

<u>Hu (2014) suggests option trading volume be measured using delta-equivalent share positions.</u> Following Hu (2014), for each option, we first multiply number of option contracts traded with absolute value of delta. Then, for each stock, we aggregate delta-equivalent option volume across all listed options. Models 3 and 4 in Table 8 report the regression estimates when option volume is measured by delta-equivalent share volume. Again, our results on the relation between _Disagmt_ and stock returns are qualitatively similar using this adjustment to option volume. 

To show that our results are not driven by option volume component, rather stock volume that is used to scale the variables, we also report the results when _Disagmt_ , _NetBuy_ and _NetSell_ are scaled by number of shares outstanding. As shown in the results in Models 5 and 6 in Table 8, our main findings remain unaltered. 

#### **3.4.5 Alternative Regression Specifications** 

The construction of the dummy variable used in the Fama-MacBeth regressions in Table 3 has the advantage that it avoids the situation where the findings are driven by extreme values of option volume. However, it discards information on return predictability from intermediate quintiles. We consider an alternative specification adopted by Johnson and So (2012) and Ge, Lin and Pearson (2016) and use quantile ranks. For _Disagmt_ , each stock is assigned the rank of 0 (lowest _Disagmt_ quintile), 1, 2, 3, and 4 (highest _Disagmt_ quintile). _I_Disagmt_ takes integer values from 0 (low _Disagmt_ quintile) to 4 (high _Disagmt_ quintile). We apply the same idea to convert _NetBuy_ and _NetSell_ to rank variables. _I_NetBuy_ takes value 0 (zero _NetBuy_ ), 1 (below median value of _NetBuy_ ), or 2 (above median value of _NetBuy_ ). _I_NetSell_ is defined similarly and takes on the value of 0, 1 or 2. We report the regression estimates in Models 7 and 8 of Table 8. Again, our main findings in Table 3 remain intact: there is a 

27 

significant negative relation between _Disagmt_ and future stock returns and the relation gets stronger for overpriced stocks. 

Overall, our main findings on the negative effect of investor disagreement constructed from option trading volume on future stock returns is highly robust. Moreover, we provide strong evidence to suggest that the negative effect of the disagreement-based option volume is amplified when the underlying stocks are overpriced. 

#### [Table 8] 

#### **4. Why Do Disagreeing Investors Choose to Trade in the Options Market?** 

In this section, we explore two potential motives for investors to prefer to trade in option market over stock market: short-sale constraint and leverage. Johnson and So (2012) find that the ratio of option to stock volume ( _O/S_ ) negatively predicts stock returns and argue that this is due to investors with negative private information choosing to trade heavily in options to circumvent short-sale constraint in the underlying stock market. Using signed option volume data, Ge, Lin and Pearson (2016) emphasize that the negative relation between _O/S_ and stock returns is driven by leverage implicit in options. We investigate if either or both channels contribute to our main findings on stock return predictability associated with disagreement ( _Disagmt_ ) and directional trading ( _NetBuy_ and _NetSell_ ) in the options market. 

#### **4.1 The Role of Short Sale Constraints** 

Models of investor disagreement predict that dispersion of investor opinion is more likely to lead to overvaluation when short-sale constraints bind, as pessimistic investors stay out of the market and high shorting costs impedes arbitrage. For example, <u>Boehme, Danielsen and Sorescu (2006)</u> emphasize that short-sale constraints and disagreement are both necessary conditions for overvaluation 

28 

and stocks “are not systematically overvalued when either one of these two conditions are not met”.<sup>12</sup> Options market provides an alternative venue for pessimists to trade on their information. If trading in options does not undo the short-sale constraints, we expect high disagreement-based trades in options, _Disagmt,_ to predict low future stock returns, particularly when shorting is costly. 

To examine the interaction effect of option volume and short sale constraints, we compute cost of borrowing shares for shorting as our main proxy for shorting costs. We gather the institutional lending data from Markit Securities Finance, for the period from May 2005 to December 2013. Markit Securities provides monthly information on stock lending by institutions, including hedge funds, prime brokers, and other institutional investors. This source of data is used in studies on short-selling costs in D’Avolio <u>(2002) and Geczy, Musto and Reed (2002) among others. Our measure of short selling cost (</u> _SSC_ ), _loan fee_ , is the value-weighted average of fees received by the lenders on all currently outstanding shares on loan for shorting. High _loan fee_ represents high _SSC_ since investors incur a high cost of borrowing the shares for shorting. 

As a robustness check, we also compute an alternate measure of shorting constraints suggested by (Nagel, 2005). Using data from the Thompson Reuters Institutional Managers (13F) holdings database, we first compute the percentage of institutional ownership for stock _i_ in month _t_ ( _IOit_ ) as number of shares owned by all reporting institutions divided by total number of outstanding shares for the stock. Since the institutional holding data is reported at quarterly frequency, the monthly _IOit_ is based on the institutional ownership at the end of the previous quarter. Following Nagel (2005), we adjust for the effect of firm size to obtain the _residual institutional ownership_ , which is the residual (𝜖𝑖,𝑡) from the following cross-sectional regression: 



where _MEi,t_ is the stock market capitalization of firm _i_ in month _t_ . A low value of _residual institutional_ 

> 12 See also Miller (1977), <u>Harrison and Kreps (1978), Duffie, Gârleanu and Pedersen (2002), Scheinkman and Xiong (2003), Boehme, Danielsen and Sorescu (2006) and Hong, Scheikman and Xiong (2006).</u> 

29 

_ownership_ (or low 𝜖𝑖,𝑡 ) represents high short-sale costs ( _SSC_ ) since low ownership of stocks by institutions reduces the supply of loanable shares. The _residual institutional ownership_ measure of shorting constraints, available for a large set of firms for the full sample period, generates qualitatively similar to those based on _loan fee_ and is reported in the Internet Appendix. 

#### [Figure 3] 

At the end of each week, stocks are sorted into terciles of low, medium, and high short selling costs ( _SSC)_ groups. Within each SSC tercile, stocks are then sorted into quintile based on _Disagmt_ . We report the five-factor alpha on the portfolio _LMH_Disagmt_ , which represents the difference in the alphas between low _Disagmt_ and high _Disagmt_ portfolios within each _SSC_ group. Panel A of Figure 3 shows that _LMH_Disagmt_ portfolio earns insignificant returns when shorting costs are low or medium. On the other hands, the alpha on _LMH_Disagmt_ jumps to about 0.2% per week when shorting is costly. These findings are consistent with the argument in disagreement models that dispersion in beliefs together with high shorting constraints predicts low future stock returns, consistent with Boehme, Danielsen and <u>Sorescu (2006).</u> 

Within each _SSC_ tercile group of stocks, we also divide stocks in the _NetBuy_ groups into High _NetBuy_ and Low _NetBuy_ based on median _NetBuy_ as defined in Table 2. High _NetSell_ and Low _NetSell_ categories of stocks are similarly defined based on the median _NetSell_ . Panel A of Figure 3 reports the five-factor alphas on the portfolio constructed by going long on stocks in high _NetBuy_ group and going short on stocks in low _NetBuy_ group ( _HML_NetBuy_ ) as well as the five-factor alpha for _LMH_NetSell_ portfolio which buys stocks in the low _NetSell_ group and shorts stocks in the high _NetSell_ stocks. Interestingly, the return on the _HML_NetBuy_ and _LMH_NetSell_ portfolios shows no clear and definite relation to the short-sale constraint and suggests that the predictive effects of informed trades in options are not fully explained by shorting costs (Ge, Lin and Pearson, 2016). 

Next, we examine the interaction effect of disagreement component of option volume ( _Disagmt_ ) and shorting costs ( _SSC_ ) on stocks with different degree of mispricing. At the end of each week, stocks are sorted into terciles of low, medium, and high _SSC_ groups. Within each SSC tercile, 

30 

stocks are then (independently) sorted into 3x5 portfolios based on _Disagmt_ and _Overpricing_ . Within each _SSC_ - _Overpricing_ cohort, we compute Fama-French five-factor alpha for a portfolio that longs the stocks in the low _Disagmt_ quintile and shorts the stocks in the high _Disagmt_ quintile or _LMH_Disagmt_ . 

Panel B of Figure 3 provides strong support for the notion that high investor disagreement ( _Disagmt_ ) predicts low risk-adjusted stock returns for stocks that face high shorting costs but are also overpriced. _LMH_Disagmt_ portfolio returns are not different from zero across _Overpricing_ quintiles when shorting cost is low or medium. This implies that our measure of investor disagreement using option volume ( _Disagmt_ ) does not predict future stock returns when shorting is easy, irrespective of the degree of stock mispricing. Additionally, we also find that _Disagmt_ does not predict stock returns when across all shorting costs groups when stocks are not overpriced, suggesting that high _SSC_ alone is not enough to generate low future returns. Most importantly, among stocks with the highest shorting costs (high _SSC_ tercile), _LMH_Disagmt_ portfolio returns increase with _Overpricing_ . We find that _LMH_Disagmt_ produces a staggering 0.43% per week (i.e. 25% per year) when high shorting constraints accompanies high _Overpricing_ . Our findings in Figure 3 supports the idea that effect of heavy disagreement-based trading in options on future stock returns is strongest when stocks are overpriced, and shorting is most costly or difficult. While investors may choose to trade in options due to short sale constraint, our findings suggest that options trades do not result in stock prices that fully reflect the views of all investors.<sup>13</sup> 

#### **4.1.1 Regulation SHO: A Natural Experiment** 

In July 2004, the SEC adopted Regulation SHO which contains a pilot program that exempted a third of the stocks in the Russell 3000 index from all price restrictions such as “uptick” rule. Stocks in Russell 3000 index were ranked based on their average daily trading volume levels, and every third 

> 13 The evidence on whether the option market fully undo underlying stock market frictions is mixed. See, for example (Diamond and Verrecchia, 1987; Figlewski and Webb, 1993; Danielsen and Sorescu, 2001; Grundy, <u>Lim and Verwijmeren, 2012), Muravyev, Pearson and Broussard (2013) and Goncalves-Pinto, Grundy, Hameed, Heijden and Zhu (2020).</u> 

31 

securities were selected as pilot stocks. This program went into effect on May 2, 2005 and ended on August 6, 2007. We follow the procedure in <u>Chu, Hirshleifer and Ma (2017)</u> who use the same experiment to demonstrate the causal effect of short-sale constraints on stock market anomaly returns.<sup>14</sup> By comparing pilot stocks and non-pilot stocks in the Russell 3000 index, we can establish causal relation between short-sale constraint and the predictive effect of disagreement-based option volume on returns on mispriced stocks. 

#### [Table 9] 

In Table 9, we replicate our base results in Table 3 with pilot stocks, and non-pilot stocks, and compare the results from two different groups of stocks during the pilot period. Table 9 reports FamaFrench five-factor alphas of the low and the high _Disagmt_ quintile portfolios constructed among stocks within each _Overpricing_ quintile (these are similar to the 5×5 independently sorted portfolios in Table 3). For the short sample in Table 9, we find significant unconditional five-factor alpha of 0.22% per week ( _t_ -stat=3.32) for the _LMH_Disagmt_ portfolio in the non-pilot sample, where short-sale restrictions are binding. Additionally, the alpha for _LMH_Disagmt_ for the non-pilot stocks when stocks are most overpriced is a high 0.68% per week ( _t_ -stat=4.88). The corresponding returns for the _LMH_Disagmt_ portfolio weaken considerably when the shorting constraint is relaxed. In particular, for pilot stocks in Panel A of Table 9, the _LMH_Disagmt_ portfolio among high _Overpricing_ stocks earn a lower alpha of 0.49% per week ( _t_ -stat=1.88). 

Overall, we find that high short-sale constraints exacerbate the prediction that high investor disagreement reflected in option volume lowers future stock returns. Therefore, the evidence points to the central role played by short sale constraints in motivating disagreeing investors to choose to trade in options and collaborates the finding in Grundy, Lim and Verwijmeren (2012) that trading in options does not alleviate the short-sale constraints. 

> 14 See <u>Chu, Hirshleifer and Ma (2017) for detailed description on the pilot program. Consistent with Chu, Hirshleifer and Ma (2017), there is no unconditional anomaly profits among pilot stocks in Table 8.</u> 

32 

#### **4.2. The Role of Leverage** 

The second potential motive for investors to trade in options is leverage. Embedded leverage of options attracts investors to trade in option market (Easley, O'Hara and Srinivas, 1998). Examining the effect of informed trading in options, <u>Ge, Lin and Pearson (2016) provide evidence that trading</u> volume in highly levered options carry more information about future stock returns than volume in low leverage options. Pan and Poteshman (2006) also document that put to call ratio constructed from out of the money, options have higher return predictability. On the contrary, Johnson and So (2012) finds that _O/S_ constructed from in the money options predict returns better, implying that the benefit of higher leverage in out of the money options is more than offset by lower liquidity in these options. Additionally, <u>Barber, Huang, Ko and Odean (2019) show that overconfident investors not only trade more, they also</u> use more leverage. If disagreement trades in options is related to investor overconfidence about their private signals, we expect disagreement trades in options to be higher in high leverage options. In this sub-section, we investigate if leverage matters in producing the negative relation between disagreementbased option volume and future stock returns. 

#### [Table 10] 

In order to gauge the effect of leverage, we construct _NetBuy_ , _NetSell_ and _Disagmt_ separately for three subsets of options: in the money options ( _ITM_ ), at the money options ( _ATM_ ) and out of the money options ( _OTM_ ). Each option is classified into one of the three categories based on its option delta, following <u>Bollen and Whaley (2004).</u><sup>15</sup> We implement the Fama-MacBeth cross-sectional regression of future stock returns on dummy variables of option volume (described in Section 3.3, and Table 3) within each option leverage category. 

Model 1, 2, and 3 of Table 10 suggest that individually, disagreement volume constructed from 

> 15 Following Bollen and Whaley (2004), the range of option deltas for ITM, ATM and OTM call options are defined to be between 0.625-0.98, 0.373-0.625, and 0.02-0.375 respectively. The corresponding delta ranges for put options are analogously defined (given the put-call parity conditions) and options with absolute deltas below 0.02 and above 0.98 are excluded. 

33 

each moneyness category replicates our main findings. In all the three moneyness categories, high _NetBuy_ and high _NetSell_ significantly predict future stock returns and the magnitude of the predictive effect increases with leverage and is highest for _OTM_ options, consistent with the findings in Ge, Lin <u>and Pearson (2016). In models 1, 2 and 3, we find that high</u> _Disagmt_ predicts low future stocks for overpriced stocks across all moneyness groups, with stronger magnitude for _OTM_ options. For example, the regression coefficient associated with the interaction between _Overpricing_ and high _Disagmt_ ( _I_Disagmt_ ) becomes more negative from −0.49 ( _t_ -stat=−2.30) for _ITM_ group to −0.57 ( _t_ -stat=−3.21) for the OTM group. Models 4 and 5 in Table 10 considers the joint model that includes all three option groups. Here we find that the interaction effect of _Overpricing_ and _I_Disagmt (OTM)_ dominates, emphasizing that disagreeing investors may trade in options market to take on more leverage in options. 

#### **5. Conclusion** 

We decompose the volume of option traded on a stock into trades due to differences in opinion ( _Disagmt_ ) and informed buy ( _NetBuy_ ) and informed sell ( _NetSell_ ). In support of disagreement models that predict overvaluation of stocks when investors agree to disagree, we find that high disagreementbased option trading volume ( _Disagmt_ ) predicts low future stock returns. We also find that high _NetBuy_ ( _NetSell_ ) predicts high (low) future stock returns, consistent with informed trading in options. Our findings suggest that heavy trading in options does not undo frictions in the underlying stocks. 

We perform additional investigations that shed new insights on the role of investor disagreement. First, we document a novel finding that the predictive content of disagreement-based option volume increases with stock mispricing. We use the anomaly based overpricing measure in <u>Stambaugh, Yu and Yuan (2012, 2015) to measure mispricing. Specifically, the weekly five-factor</u> adjusted difference in returns on low and high disagreement stocks, _LMH_Disagmt_ , monotonically increases with the degree of overpricing in the underlying stocks, from an insignificant 0.04% when stock overpricing is low, to an economically and statistically significant 0.27% ( _t_ -stat=2.82) when overpricing is high. Moreover, the negative relation between _Disagmt_ and future stock returns is highly 

34 

robust to exposure to different factor models (including Stambaugh and Yuan (2017) mispricing factors), controls for stock and option characteristics and different definitions of option volume. The amplification effect of stock mispricing on the relation between disagreement volume and future stock returns supports the predictions in the disagreement model in Atmaz and Basak (2018). 

Second, the disagreement component of option trading volume is strongly correlated with traditional stock-based disagreement measures such as dispersion in analyst earnings forecasts, stock trading volume, stock return volatility and breadth of ownership of the firm. Moreover, we show that _Disagmt_ provides incremental information in predicting stock returns, beyond the stock-based disagreement proxies. 

Third, we find that disagreement volume in options ( _Disagmt)_ peaks on the public announcement of earnings, which is different from informed option trading volume ( _NetBuy_ and _NetSell_ ) which spike prior to earnings announcements. As predicted by informed trading hypothesis, we find that high _NetBuy_ ( _NetSell_ ) _before_ earnings announcement predicts positive (negative) stock returns around the announcement date. We also find that high _Disagmt_ during the public release of earnings news predicts low stock returns over the week after earning news, consistent with trading emanating from differential interpretation of public news (Kandel and Pearson, 1995). Hence, the negative stock return predicted by high total option volume in the literature is, at least partially, explained by high disagreement-based trading in options. 

The negative relation between disagreement-based option volume and future stock returns is enhanced via two channels. First, _Disagmt_ constructed from out of the money options yield stronger predictability on future stock returns, consistent with overconfident investors choosing to trade their private signals in high leverage options. Second, stock return predictability based on _Disagmt_ concentrates in stocks that are costly to short and are overpriced: the long-short strategy based on _Disagmt_ generates a staggering 0.43% per week (25% per annum). The latter finding is consistent with disagreeing investors choosing to trade in option market to circumvent short sale constraints. Overall, our findings emphasize the central role played by dispersion in investor beliefs in driving option trading 

35 

volume and its associated predictability of stock returns. 

36 

#### **References** 

- Ajinkya, B.B., Gift, M.J., 1985. Dispersion of Financial Analysts' Earnings Forecasts and the (Option Model) Implied Standard Deviations of Stock Returns. _Journal of Finance_ 40, 1353-1365. 

- An, B.-J., Ang, A., Bali, T.G., Cakici, N., 2014. The Joint Cross Section of Stocks and Options. _Journal of Finance_ 69, 2279-2337. 

- Ang, A., Hodrick, R.J., Xing, Y., Zhang, X., 2009. High Idiosyncratic Volatility and Low Returns: International and Further U.S. Evidence. _Journal of Financial Economics_ 91, 1-23. 

- Atmaz, A., Basak, S., 2018. Belief Dispersion in the Stock Market. _Journal of Finance_ 73, 1225-1279. Banerjee, S., 2011. Learning from Prices and the Dispersion in Beliefs. _Review of Financial Studies_ 24, 3025-3068. 

- Barber, B.M., Huang, X., Ko, K.J., Odean, T., 2019. Leveraging Overconfidence. _Available at SSRN 3445660_ 

- Boehme, R.D., Danielsen, B.R., Sorescu, S.M., 2006. Short-Sale Constraints, Differences of Opinion, and Overvaluation. _Journal of Financial and Quantitative Analysis_ 41, 455-487. 

- Bollen, N.P.B., Whaley, R.E., 2004. Does Net Buying Pressure Affect the Shape of Implied Volatility Functions? _Journal of Finance_ 59, 711-753. 

- Buraschi, A., Jiltsov, A., 2006. Model Uncertainty and Option Markets with Heterogeneous Beliefs. _Journal of Finance_ 61, 2841-2897. 

- Campbell, J.Y., Hilscher, J., Szilagyi, J.A.N., 2008. In Search of Distress Risk. _Journal of Finance_ 63, 2899-2939. 

- Cao, H.H., Ou-Yang, H., 2009. Differences of Opinion of Public Information and Speculative Trading in Stocks and Options. _Review of Financial Studies_ 22, 299-335. 

- Chen, J., Hong, H., Stein, J.C., 2002. Breadth of Ownership and Stock Returns. _Journal of Financial Economics_ 66, 171-205. 

- Chen, L., Novy-Marx, R., Zhang, L., 2011. An Alternative Three-Factor Model. _Available at SSRN 1418117_ 

- Choy, S.K., Wei, J., 2012. Option Trading: Information or Differences of Opinion? _Journal of Banking and Finance_ 36, 2299-2322. 

- Chu, Y., Hirshleifer, D., Ma, L., 2017. The Causal Effect of Limits to Arbitrage on Asset Pricing Anomalies. _NBER Working Paper No.24144_ 

- Cooper, M.J., Gulen, H., Schill, M.J., 2008. Asset Growth and the Cross-Section of Stock Returns. _Journal of Finance_ 63, 1609-1651. 

- Cremers, M., Weinbaum, D., 2010. Deviations from Put-Call Parity and Stock Return Predictability. _Journal of Financial and Quantitative Analysis_ 45, 335-367. 

- D’Avolio, G., 2002. The Market for Borrowing Stock. _Journal of Financial Economics_ 66, 271-306. 

37 

Daniel, K., Titman, S., 1997. Evidence on the Characteristics of Cross Sectional Variation in Stock Returns. _Journal of Finance_ 52, 1-33. 

- Daniel, K., Titman, S., 2006. Market Reactions to Tangible and Intangible Information. _Journal of Finance_ 61, 1605-1643. 

Danielsen, B.R., Sorescu, S.M., 2001. Why Do Option Introductions Depress Stock Prices? A Study of Diminishing Short Sale Constraints. _Journal of Financial and Quantitative Analysis_ 36, 451484. 

- Diamond, D.W., Verrecchia, R.E., 1987. Constraints on Short-Selling and Asset Price Adjustment to Private Information. _Journal of Financial Economics_ 18, 277-311. 

Diether, K.B., Malloy, C.J., Scherbina, A., 2002. Differences of Opinion and the Cross Section of Stock Returns. _Journal of Finance_ 57, 2113-2141. 

- Duffie, D., Gârleanu, N., Pedersen, L.H., 2002. Securities Lending, Shorting, and Pricing. _Journal of Financial Economics_ 66, 307-339. 

Easley, D., López de Prado, M.M., O'Hara, M., 2012. Flow Toxicity and Liquidity in a High-Frequency World. _Review of Financial Studies_ 25, 1457-1493. 

- Easley, D., O'Hara, M., Srinivas, P.S., 1998. Option Volume and Stock Prices: Evidence on Where Informed Traders Trade. _Journal of Finance_ 53, 431-465. 

- Fama, E.F., French, K.R., 1993. Common Risk Factors in the Returns on Stocks and Bonds. _Journal of Financial Economics_ 33, 3-56. 

- Fama, E.F., French, K.R., 2006. Profitability, Investment and Average Returns. _Journal of Financial Economics_ 82, 491-518. 

- Fama, E.F., French, K.R., 2015. A Five-Factor Asset Pricing Model. _Journal of Financial Economics_ 116, 1-22. 

- Figlewski, S., Webb, G.P., 1993. Options, Short Sales, and Market Completeness. _Journal of Finance_ 48, 761-777. 

- Fournier, M., Goyenko, R., Grass, G., 2017. When the Options Market Disagrees. _Available at SSRN 2788325_ 

Frazzini, A., Pedersen, L.H., 2014. Betting against Beta. _Journal of Financial Economics_ 111, 1-25. 

- Ge, L., Lin, T.-C., Pearson, N.D., 2016. Why Does the Option to Stock Volume Ratio Predict Stock Returns? _Journal of Financial Economics_ 120, 601-622. 

- Geczy, C.C., Musto, D.K., Reed, A.V., 2002. Stocks Are Special Too: An Analysis of the Equity Lending Market. _Journal of Financial Economics_ 66, 241-269. 

- Goncalves-Pinto, L., Grundy, B.D., Hameed, A., Heijden, T.v.d., Zhu, Y., 2020. Why Do Option Prices Predict Stock Returns? The Role of Price Pressure in the Stock Market. _Management Science_ 66, 3903-3926. 

Grundy, B.D., Lim, B., Verwijmeren, P., 2012. Do Option Markets Undo Restrictions on Short Sales? 

38 

Evidence from the 2008 Short-Sale Ban. _Journal of Financial Economics_ 106, 331-348. 

Harrison, J.M., Kreps, D.M., 1978. Speculative Investor Behavior in a Stock Market with Heterogeneous Expectations. _Quarterly Journal of Economics_ 92, 323-336. 

- Hirshleifer, D., Hou, K., Teoh, S.H., Zhang, Y., 2004. Do Investors Overvalue Firms with Bloated Balance Sheets? _Journal of Accounting and Economics_ 38, 297-331. 

- Hong, H., Scheikman, J., Xiong, W., 2006. Asset Float and Speculative Bubbles. _Journal of Finance_ 61, 1073-1117. 

- Hong, H., Stein, J.C., 2007. Disagreement and the Stock Market. _Journal of Economic Perspectives_ 21, 109-128. 

- Hu, J., 2014. Does Option Trading Convey Stock Price Information? _Journal of Financial Economics_ 111, 625-645. 

- Jegadeesh, N., Titman, S., 1993. Returns to Buying Winners and Selling Losers: Implications for Stock Market Efficiency. _Journal of Finance_ 48, 65-91. 

- Johnson, T.L., So, E.C., 2012. The Option to Stock Volume Ratio and Future Returns. _Journal of Financial Economics_ 106, 262-286. 

Kandel, E., Pearson, N.D., 1995. Differential Interpretation of Public Signals and Trade in Speculative Markets. _Journal of Political Economy_ 103, 831-872. 

- Kondor, P., 2012. The More We Know About the Fundamental, the Less We Agree on the Price. _Review of Economic Studies_ 79, 1175-1207. 

- Lakonishok, J., Lee, I., Pearson, N.D., Poteshman, A.M., 2007. Option Market Activity. _Review of Financial Studies_ 20, 813-857. 

- Loughran, T.I.M., Ritter, J.R., 1995. The New Issues Puzzle. _Journal of Finance_ 50, 23-51. 

- Miller, E.M., 1977. Risk, Uncertainty, and Divergence of Opinion. _Journal of Finance_ 32, 1151-1168. Moeller, S.B., Schlingemann, F.P., Stulz, R.M., 2007. How Do Diversity of Opinion and Information Asymmetry Affect Acquirer Returns? _Review of Financial Studies_ 20, 2047-2078. 

- Muravyev, D., Pearson, N.D., Broussard, J.P., 2013. Is There Price Discovery in Equity Options? _Journal of Financial Economics_ 107, 259-283. 

- Nagel, S., 2005. Short Sales, Institutional Investors and the Cross-Section of Stock Returns. _Journal of Financial Economics_ 78, 277-309. 

- Novy-Marx, R., 2013. The Other Side of Value: The Gross Profitability Premium. _Journal of Financial Economics_ 108, 1-28. 

- Odean, T., 1998. Volume, Volatility, Price, and Profit When All Traders Are above Average. _Journal of Finance_ 53, 1887-1934. 

- Ohlson, J.A., 1980. Financial Ratios and the Probabilistic Prediction of Bankruptcy. _Journal of Accounting Research_ 18, 109-131. 

- Pan, J., Poteshman, A.M., 2006. The Information in Option Volume for Future Stock Prices. _Review of_ 

39 

_Financial Studies_ 19, 871-908. 

Ritter, J.R., 1991. The Long-Run Performance of Initial Public Offerings. _Journal of Finance_ 46, 3-27. 

Roll, R., Schwartz, E., Subrahmanyam, A., 2010. O/S: The Relative Trading Activity in Options and Stock. _Journal of Financial Economics_ 96, 1-17. 

Scheinkman, José A., Xiong, W., 2003. Overconfidence and Speculative Bubbles. _Journal of Political Economy_ 111, 1183-1220. 

Sloan, R.G., 1996. Do Stock Prices Fully Reflect Information in Accruals and Cash Flows About Future Earnings? _Accounting Review_ 71, 289-315. 

Stambaugh, R.F., Yu, J., Yuan, Y., 2012. The Short of It: Investor Sentiment and Anomalies. _Journal of Financial Economics_ 104, 288-302. 

Stambaugh, R.F., Yu, J., Yuan, Y., 2015. Arbitrage Asymmetry and the Idiosyncratic Volatility Puzzle. _Journal of Finance_ 70, 1903-1948. 

Stambaugh, R.F., Yuan, Y., 2017. Mispricing Factors. _Review of Financial Studies_ 30, 1270-1315. 

Titman, S., Wei, K.C.J., Xie, F., 2004. Capital Investments and Stock Returns. _Journal of Financial and Quantitative Analysis_ 39, 677-700. 

Xing, Y., Zhang, X., Zhao, R., 2010. What Does the Individual Option Volatility Smirk Tell Us About Future Equity Returns? _Journal of Financial and Quantitative Analysis_ 45, 641-662. 

40 

**Figure 1. Cumulative Five-Factor Alphas of Low-minus-high Disagreement Portfolios.** This figure plots cumulative five-factor alphas of LMH Disagmt_ portfolios constructed within the full sample (solid line) as well as the sub-sample of stocks in high (dashed line) and low (dotted line) _Overpricing_ quintiles. _LMH_Disagmt_ is a long-short portfolio that takes a long position in stocks in the lowest disagreement-based option volume ( _Disagmt_ ) quintile and shorts stocks in the highest _Disagmt_ quintile. _Overpricing_ is defined based on the composite stock ranking according to eleven anomaly variables in Stambaugh, Yu and Yuan (2012). 



<!-- Start of picture text -->
1.8<br>1.6<br>1.4<br>1.2<br>1<br>0.8<br>0.6<br>0.4<br>0.2<br>0<br>-0.2<br>-0.4<br>2005 2007 2010 2012 2015<br>All Stocks High Overpricing Low Overpricing<br>Cumulative Five-factor Alpha<br><!-- End of picture text -->

41 

##### **Figure 2. Option Volume around Earnings Announcements.** 

This figure plots average levels of each of the option volume surrounding earnings announcements. From a pooled sample of earnings announcements, we calculate the average level of daily disagreement-based option volume ( _Disagmt_ ), informed buy option volume ( _NetBuy_ ) and informed sell option volume ( _NetSell_ ) for 10 days surrounding earnings announcement day 0 (from day −10 to day _+_ 10). For ease of comparison, each option volume component is presented as a percentage of the volume on day −10. 



42 

**Figure 3. Long-Short Portfolio Returns: Short Selling Costs, Option Volume, and Mispriced Stocks** This figure plots Fama-French five-factor alphas of portfolios constructed among stocks in low, medium, and high short selling costs ( _SSC_ ) terciles. We use the loan fee charged by lenders of stocks in the shorting market as a proxy for _SSC_ . We construct a long-short portfolio, _LMH_Disagmt,_ that takes a long position in stocks in the lowest disagreement-based option volume ( _Disagmt_ ) quintile and shorts stocks in the highest _Disagmt_ quintile. We also report _HML_NetBuy_ that buys stocks in the High informed buy volume in options ( _NetBuy_ ) group and shorts stocks in the Low _NetBuy_ group. _LMH_NetSell_ is constructed similarly based on the informed sell volume in options. In Panel A, red circles report the five-factor alphas of _LMH_Disagmt_ portfolios for stocks with low, medium, and high _SSC_ groups. Green triangles and blue squares represent the five factor alphas of _HML_NetBuy_ and _LMH_NetSell_ , across the three _SSC_ sorted stock groups. In Panel B, within each _SSC_ tercile, stocks are sorted into quintiles based on _Overpricing_ and _Disagmt,_ where high and low stock _Overpricing_ is defined based on the stock ranking according to eleven anomaly variables in Stambaugh, Yu and Yuan (2012). Within each _SSC_ - _Overpricing_ cohort, we report Fama-French five-factor alpha for _LMH_Disagmt_ portfolio, where × represents the mean alpha. Error bars represent 95% confidence intervals. Numbers on y-axis are in percent. The sample covers the period from May 2005 to Jan 2014. 

**Panel A: Unconditional Return Predictability** 



**Panel B: LMH** **_Disagmt_ alpha within each** **_Overpricing_ Quintile** 



43 

##### **Table 1. Disagreement-based Option Volume and Firm Characteristics** 

This table reports average values of the stock and option characteristics based on stocks sorted into quintiles based on weekly disagreement-based option volume ( _Disagmt_ ). Panel A reports the weekly average option volume based on _Disagmt_ , _NetBuy_ (informed buy volume in options) and _NetSell_ (informed sell volume in options), where all option volume measures are scaled by weekly stock volume. Panel B and C presents the average stock and option characteristics for stocks sorted into quintiles based _Disagmt_ . Column 1−5 in Panels B and C reports the difference in the means between quintiles 1 and 5, with Newey-West corrected _t_ -statistics with 12 lags reported in <u>parenthesis. Appendix A provides the detailed definition of all variables.</u> 

|**Panel A:****_Disagm_**|**_t_, ****_NetBuy_ and****_Ne_**|**_tSell_ **|_Disagmt_|_Quintiles_|||
|---|---|---|---|---|---|---|
||1<br>(Low)|2|3||4|5<br>(High)|
|_Disagmt_(%)|0.0769|0.4018|1.0|752|2.5468|10.0240|
|_NetBuy_(%)|0.1301|0.1974|0.3|174|0.4739|0.8038|
|_NetSell_ (%)|0.1282|0.2022|0.3|268|0.4899|0.8321|
|**Panel B: Stock**|**Characteristics**||||||
||||_Disagmt_|_Quintiles_|||
||1|2|3|4|5|1–5|
||(Low)||||(High)||
|_Overpricing_|0.4924|0.4852|0.4813|0.4721|0.4708|−0.0215<br>(−6.48)|
|_Beta_|1.2808|1.2974|1.3149|1.3130|1.3319|0.0512<br>(1.83)|
|log(_ME_)|21.0567|21.5713|21.7987|22.1715|22.4994|1.4427<br>(16.09)|
|_BM_|0.6371|0.5943|0.5599|0.5182|0.4648|−0.1723<br>(−12.41)|
|lag(_Return_)|0.0003|0.0018|0.0029|0.0034|0.0041|0.0038<br>(8.62)|
|_Ivol_|0.0183|0.0184|0.0186|0.0185|0.0189|0.0006<br>(2.08)|
|_Turn_|0.0465|0.0609|0.0681|0.0768|0.0913|0.0448<br>|
|||||||(30.10)|
|**Panel C: Option**|**Characteristics**||||||
||||_Disagmt_|_Quintiles_|||
||1|2|3|4|5|1–5|
||(Low)||||(High)||
|_Volspread_|−0.0106|−0.0101|−0.0109|−0.0120|−0.0143|−0.0037<br>(−5.15)|
|_Qskew_|0.0671|0.0578|0.0553|0.0545|0.0562|−0.0109<br>(−2.49)|



44 

**Table 2. Stock Return Predictability based on Disagreement Volume, Informed Option Volume and Mispriced Stocks** 

This table reports weekly Fama-French five-factor alphas of portfolios constructed by the 3 components of option volume ( _Disagmt, NetBuy_ and _NetSell_ ) and stock mispricing measure, _Overpricing_ . Panel A reports alphas of stocks sorted into quintiles by _Disagmt_ (or _Overpricing_ ) as well as the 5×5 portfolios of stocks that fall into the intersection of quintiles sorted independently by _Overpricing_ and _Disagmt_ . The last column reports the alpha of a long-short portfolio, _LMH_Disagmt,_ that takes a long position in stocks in the lowest disagreement-based option volume quintile ( _Disagmt_ quintile 1) and shorts stocks in the highest _Disagmt_ quintile (quintile 5). Panel B reports alphas of stocks grouped into four portfolios based on Low and High synthetic net buy volume in options ( _NetBuy_ ) and Low and High synthetic sell option volume ( _NetSell)_ where Low and High are defined by whether the option volume is below or above the median values. The column _HML_NetBuy_ reports differences in alphas between the High _NetBuy_ and the Low _NetBuy_ portfolios. _LMH_NetSell_ is the difference in alphas between the Low _NetSell_ and High _NetSell_ portfolios. Alphas are reported in percent per week. Newey-West corrected _t_ -statistics with 12 lags are reported in parenthesis. 

**Panel A:** **_Overpricing_ and** **_Disagmt_** 

||||||_Disa_<br>|_gmt_<br>|||
|---|---|---|---|---|---|---|---|---|
|||All|1<br>(Low)|2|3|4|5<br>(High)|_LMH__<br>_Disagmt_|
||All||0.02|0.02|0.02|−0.03|−0.07|0.09|
||||(0.65)|(0.68)|(0.70)|(−1.11)|(−2.21)|(2.54)|
||1|0.03|0.04|0.04|0.01|0.04|0.00|0.04|
||(Low)|(1.38)|(1.14)|(1.32)|(0.50)|(1.34)|(−0.09)|(0.98)|
||2|0.01|0.02|0.03|0.06|−0.03|0.01|0.01|
|||(0.73)|(0.54)|(1.07)|(2.21)|(−0.72)|(0.25)|(0.13)|
||3|0.03|0.07|0.04|0.06|0.02|−0.01|0.08|
|_Overricin_||(1.20)|(2.27)|(0.93)|(1.30)|(0.42)|(−0.32)|(1.69)|
|_pg_|4|0.00|0.03|0.02|0.01|−0.02|−0.08|0.11|
|||(−0.11)|(0.67)|(0.40)|(0.14)|(−0.31)|(−1.31)|(1.99)|
||5|−0.11|−0.02|−0.03|−0.05|−0.16|−0.29|0.27|
||(High)|(−1.70)|(−0.18)|(−0.33)|(−0.78)|(−2.08)|(−3.34)|(2.82)|
||1−5|0.14|0.05|0.07|0.07|0.20|0.28|−0.23|
|||(1.89)|(0.52)|(0.74)|(0.84)|(2.29)|(3.09)|(−2.42)|



**Panel B:** **_Overpricing_ and** **_NetSell_ /** **_NetBuy_** 

||(45<br>|_NetBuy_>0<br>% of the samp<br>|le)<br>|(55<br>|_NetSell_>0<br>% of the samp<br>|le)<br>|
|---|---|---|---|---|---|---|
||High<br>_NetBuy_|Low<br>_NetBuy_|_HML__<br>_NetBuy_|Low<br>_NetSell_|High<br>_NetSell_|_LMH__<br>_NetSell_|
|All|0.09|0.03|0.06|−0.02|−0.12|0.10|
||(2.55)|(0.92)|(2.43)|(−0.90)|(−4.43)|(4.12)|
|1|0.09|0.03|0.06|0.01|−0.02|0.04|
|(Low)|(2.56)|(1.08)|(1.61)|(0.52)|(−0.85)|(1.42)|
|2|0.07|0.04|0.04|0.02|−0.08|0.10|
||(2.64)|(1.29)|(1.12)|(0.75)|(−2.58)|(2.66)|
|3|0.11|0.10|0.01|0.01|−0.06|0.06|
|_Overricin_|(2.97)|(2.80)|(0.35)|(0.20)|(−1.56)|(1.95)|
|_pg_<br>4|0.14|0.00|0.14|−0.02|−0.12|0.10|
||(2.46)|(0.08)|(2.59)|(−0.46)|(−2.56)|(2.36)|
|5|0.02|−0.02|0.04|−0.16|−0.31|0.16|
|(High)|(0.25)|(−0.22)|(0.58)|(−2.42)|(−4.61)|(2.59)|
|1−5|0.06|0.05|0.02|0.17|0.29|−0.12|
||(0.69)|(0.48)|(0.22)|(2.31)|(3.70)|(−1.88)|



45 

##### **Table 3. Fama-Macbeth Regressions** 

This table reports results of Fama-Macbeth regressions of weekly stock returns on the 3 components of option volume ( _Disagmt, NetBuy_ and _NetSell_ ) and stock mispricing measure, _Overpricing_ . The option volume components are converted to dummy variables. _I_Disagmt_ takes value 1 if a stock belongs to the high _Disagmt_ group and zero otherwise. _I_NetBuy_ ( _I_NetSell)_ takes value 1 if a stock belongs to the high _NetBuy_ ( _NetSell_ ) group. Control variables comprising of stock and option characteristics are winsorized at the top and the bottom 1% and scaled with its cross-sectional standard deviation. Stock controls include market beta, log of firm size, book-to-market ratio, one-week lagged stock return, and idiosyncratic stock volatility. Option controls include call-put implied volatility spread, and risk-neutral skewness. All coefficients are in percent. Newey-West corrected _t_ -statistics with 12 lags are reported in parenthesis. 

||(1)|(2)|(3)|(4)|(5)|(6)|(7)|
|---|---|---|---|---|---|---|---|
|_Overpricing_|−0.4651<br>(−3.07)|−0.4657<br>(−3.07)|−0.3606<br>(−2.29)|−0.3597<br>(−2.29)|−0.3893<br>(−2.18)|−0.4524<br>(−3.13)|−0.3560<br>(−2.40)|
|_ID_|−0.0669|−0.0725|0.1720|0.1697|0.1787|−0.0605|0.1594|
|__isagmt_|(−2.67)|(−2.87)|(2.34)|(2.29)|(2.45)|(−2.60)|(2.18)|
|_I_Disagmt_|||−0.5012|−0.5086|−0.5308||−0.4622|
|×_Overpricing_|||(−2.89)|(−2.94)|(−3.07)||(−2.68)|
|_INB_||0.1028||0.1039|−0.0467|0.1050|0.1057|
|__etuy_||(4.52)||(4.57)|(−0.57)|(4.49)|(4.52)|
|_I_NetBuy_|||||0.3152|||
|×_Overpricing_|||||(1.70)|||
|||−0.0764||−0.0750|0.0195|−0.0734|−0.0722|
|_I_NetSell_||(−3.73)||(−3.70)|(0.32)|(−3.71)|(−3.68)|
|_I_NetSell_|||||−0.1997|||
|×_Overpricing_|||||(−1.38)|||
||0.0342|0.0339|0.0336|0.0334|0.0351|0.0458|0.0454|
|_Beta_|(1.21)|(1.20)|(1.19)|(1.18)|(1.24)|(1.49)|(1.48)|
|_LME_|−0.0073|−0.0049|−0.0081|−0.0057|−0.0065|−0.0112|−0.0121|
|_og()_|(−0.32)|(−0.21)|(−0.36)|(−0.25)|(−0.29)|(−0.50)|(−0.54)|
|_B/M_|−0.0045<br>(−0.13)|−0.0038<br>(−0.11)|−0.0054<br>(−0.16)|−0.0047<br>(−0.14)|−0.0044<br>(−0.13)|−0.0129<br>(−0.43)|−0.0137<br>(−0.45)|
|_Lag(Ret)_|−0.0447<br>(−1.98)|−0.0405<br>(−1.80)|−0.0443<br>(−1.96)|−0.0402<br>(−1.79)|−0.0392<br>(−1.75)|−0.0335<br>(−1.56)|−0.0330<br>(−1.54)|
||−0.0166|−0.0169|−0.0172|−0.0175|−0.0179|−0.0120|−0.0126|
|_Ivol_|(−0.63)|(−0.64)|(−0.65)|(−0.66)|(−0.68)|(−0.50)|(−0.52)|
|_Cpspread_||||||0.0703<br>(4.53)|0.0702<br>(4.50)|
|_Qskew_||||||−0.0078<br>(−0.52)|−0.0072<br>(−0.48)|
|_No. Obs._|608,516|608,516|608,516|608,516|608,516|606,022|606,022|
|_Adj. R_<sup>_2_ </sup>(%)|5.86|5.91|5.95|6.01|6.09|6.37|6.46|



46 

**Table 4. Cumulative Abnormal Returns Around Earnings Announcement and Option Volume.** This table reports results of quarterly Fama-Macbeth regressions of cumulative abnormal stock returns ( _CAR_ ) around earnings announcement on the 3 components of option volume ( _Disagmt, NetBuy_ and _NetSell_ ) measured around the announcement date _t_ . In Panel A, _CAR_ is market adjusted return cumulated over 3 days surrounding earnings announcement (days _t−1_ to _t+1_ ). The 3 option volume components are measured over the week prior to the _CAR_ measurement window (i.e. days _t−6_ to _t−2_ ). In Panel B, _CAR_ is market adjusted return cumulated over a week after earnings announcement (days _t+2_ to _t+6_ ). The 3 option volume components are measured over the 2 days prior to the _CAR_ measurement window (i.e. days _t_ to _t+1_ ). The option volume components are converted to dummy variables. _I_Disagmt_ takes value 1 if a stock belongs to the high _Disagmt_ group and zero otherwise. _I_NetBuy_ ( _I_NetSell_ ) takes value 1 if a stock belongs to the high _NetBuy_ ( _NetSell_ ) group. Control variables in Models 2 and 4 include stock and option characteristics. Stock controls include market beta, log of firm size, book-to-market ratio, one-week lagged stock return, and idiosyncratic volatility. Option controls include call-put implied volatility spread, and risk-neutral skewness. All coefficients are in percent. Newey-West corrected _t_ - statistics with 12 lags are reported in parenthesis. 

||Panel A: Annou<br>_CAR_[−|ncement Return<br>1.+1]|Panel B: Post-Ann<br>_CAR_[+|ouncement Return<br>2,+6]|
|---|---|---|---|---|
||(1)|(2)|(3)|(4)|
|_I_Disagmt_[−6,−2]|−0.3562<br>(−4.30)|−0.2625<br>(−2.68)|||
|_I_NetBuy_[−6,−2]|0.2345<br>(2.93)|0.2622<br>(3.82)|||
|_INetSell_[−6−2]|−0.2715|−0.2039|||
|___,|(−2.41)|(−2.01)|||
|_I_Disagmt_[0,1]|||−0.1910<br>(−5.48)|−0.0919<br>(−2.54)|
|_I_NetBuy_[0,1]|||0.0632<br>(0.56)|0.0355<br>(0.31)|
|_I_NetSell_[0,1]|||0.0428<br>(0.65)|−0.0010<br>(−0.01)|
|_B_||0.1712||0.0594|
|_eta_||(4.31)||(0.73)|
|_Log(ME)_||0.0519<br>(0.82)||−0.0244<br>(−0.67)|
|_B/M_||−0.0469<br>(−1.23)||0.0122<br>(0.36)|
|_Lag(Ret)_||0.0480<br>(1.09)||−0.2055<br>(−4.01)|
|_Il_||−0.2826||−0.0423|
|_vo_||(−5.56)||(−1.08)|
|_Cpspread_||0.0814<br>(2.59)||0.1744<br>(1.98)|
|_Qskew_||0.0305<br>(0.97)||0.0063<br>(0.26)|
|_No. Obs._|46,159|40,163|46,174|40,184|
|_Adj. R_<sup>_2_</sup> (%)|0.16|0.75|0.30|2.69|



47 

**Table 5. Relation between Disagreement-based Option Volume and Stock-based Disagreement Proxies.** This table reports results of weekly Fama-Macbeth regressions of disagreement-based option volume ( _Disagmt_ ) on traditional stock-based disagreement proxies. The stock-based disagreement proxies include dispersion in analysts’ long-term growth forecast ( _Disp_LTG_ ), dispersion in forecasts of earnings per share ( _Disp_EPS_ ), stock turnover ( _Turn_ ), total return volatility ( _RetVol_ ), and negative change in breadth of ownership (− _DBreadth_ ). A composite disagreement proxy, _Composite_ , is defined as average percentile rank across the five stock-based disagreement proxies. Stock-based disagreement proxies are scaled by their cross-sectional standard deviations. Control variables comprising of stock and option characteristics are included but not reported for brevity. Stock controls include market beta, log of firm size, book-to-market ratio, and one-week lagged stock return. Option controls include call-put implied volatility spread, and risk-neutral skewness. Newey-West corrected _t_ -statistics with 12 lags are reported in parenthesis. 

||(1)|(2)|(3)|(4)|
|---|---|---|---|---|
|_DisLTG_|0.2150|0.2230|||
|_p__|(11.62)|(12.27)|||
|_DiEPS_|0.1280|0.1175|||
|_sp__|(4.46)|(4.43)|||
|_T_|1.2259|1.2216|||
|_urn_|(15.68)|(15.46)|||
|_RtVl_|0.3868|0.3540|||
|_eo_|(12.16)|(10.67)|||
|_−DBdh_|0.0688|0.0676|||
|_reat_|(2.29)|(2.28)|||
|_Comosite_|||0.9835|0.9728|
|_p_|||(14.17)|(13.69)|
|_Stock Controls_|Yes|Yes|Yes|Yes|
|_Option Controls_|No|Yes|No|Yes|
|_No. Obs._|393,470|393,227|608,143|605,682|
|_Adj. R_<sup>_2_ </sup>(%)|16.75|17.31|9.84|10.86|



48 

##### **Table 6. Fama-Macbeth Regression: Disagreement-based Option Volume, Stock-based Disagreement Measures and Stock Turnover.** 

This table reports results of Fama-Macbeth regressions of weekly stock returns on option-based disagreement measure ( _Disagmt_ ) and a composite measure of stock-based disagreement proxies ( _Composite_ ), as well as their interactions with _Overpricing_ (measuring overpricing in stocks based on anomalies). We also separately consider stock-based disagreement measure, stock turnover ( _Turn_ ). These variables are converted to dummy variables. _I_Disagmt_ takes value 1 if a stock belongs to the high _Disagmt_ group and zero otherwise. _I_Composite_ takes value 1 if a stock belongs to the top _Composite_ quintile and zero otherwise. _I_Turn_ takes value 1 if a stock belongs to the top _Turn_ quintile and zero otherwise. _I_NetBuy_ ( _I_NetSell_ ) takes value 1 if a stock belongs to the high _NetBuy_ ( _NetSell_ ) group and zero otherwise. Control variables comprising of stock and option characteristics are included but not reported for brevity. Stock controls include market beta, log of firm size, book-to-market ratio, one-week lagged stock return, and idiosyncratic stock volatility. Option controls include call-put implied volatility spread, and risk-neutral skewness. All coefficients are in percent. Newey-West corrected _t_ -statistics with 12 lags are reported in parenthesis. 

||(1)|(2)|(3)|(4)|(5)|(6)|
|---|---|---|---|---|---|---|
|_Overpricing_|−0.4416<br>(−3.09)|−0.2909<br>(−1.90)|−0.2202<br>(−1.43)|−0.4565<br>(−3.32)|−0.3066<br>(−2.16)|−0.2179<br>(−1.52)|
|_IDisamt_|−0.0608||0.1075|−0.0625||0.1339|
|__g_|(−2.66)||(1.44)|(−2.76)||(1.77)|
|_I_Disagmt_|||−0.3614|||−0.4182|
|×_Overpricing_|||(−2.04)|||(−2.34)|
|_I_Composite_|0.0227<br>(0.58)|0.3913<br>(3.41)|0.3903<br>(3.36)||||
|_I_Composite_||−0.7103|−0.6992||||
|×_Overpricing_||(−3.18)|(−3.06)||||
|_I_Turn_||||0.0008<br>(0.02)|0.3329<br>(3.03)|0.3234<br>(2.88)|
|_I_Turn_|||||−0.6646|−0.6280|
|×_Overpricing_|||||(−2.73)|(−2.52)|
|_INetBu_|0.1041|0.0888|0.1031|0.1053|0.0918|0.1054|
|__y_|(4.54)|(3.93)|(4.54)|(4.57)|(4.03)|(4.52)|
|_INetSell_|−0.0731|−0.0887|−0.0737|−0.0750|−0.0872|−0.0734|
|___|(−3.69)|(−4.34)|(−3.72)|(−3.64)|(−4.09)|(−3.59)|
|Stock Controls|Yes|Yes|Yes|Yes|Yes|Yes|
|Option Controls|Yes|Yes|Yes|Yes|Yes|Yes|
|_No. Obs._|606,022|606,022|606,022|606,022|606,022|606,022|
|_Adj. R_<sup>_2_</sup> (%)|6.59|6.67|6.82|6.64|6.70|6.86|



49 

##### **Table 7. Robustness Checks.** 

This table reports the weekly Fama-French five-factor alphas for portfolios constructed by lagged option-based disagreement volume ( _Disagmt_ ) and lagged stock overpricing measure, _Overpricing_ . At the end of each week, stocks are independently double sorted into quintiles based on _Overpricing_ and _Disagmt_ , which results in 25 (5×5) portfolios. Rows labelled “All” reports alphas to each of the quintile portfolios sorted by _Disagmt_ . The last column reports the alpha of a long-short portfolio, _LMH_Disagmt,_ that takes a long position in stocks in the lowest disagreement-based option volume quintile ( _Disagmt_ quintile 1) and shorts stocks in the highest _Disagmt_ quintile (quintile 5). We also report the alphas for _Overpricing_ quintiles 1 and 5 for All stocks as well as stocks within each _Disagmt_ quintile ( _Disagmt_ quintile 1 to 5). Panel A reports Stambaugh and Yuan (2017) mispricing factor alpha. Panel B measures option trading activity based on the change in _Disagmt_ , defined as _Disagmt_ in week t divided by its past 52-week average. Panel C reports monthly Stambaugh-Yuan mispricing factor alphas of portfolios double sorted by _Overpricing_ and a monthly construct of _Disagmt_ . Alphas are reported in percent. Newey-West corrected _t_ -statistics with 12 lags are reported in parenthesis. 

|||||_Disagmt_||||
|---|---|---|---|---|---|---|---|
||All|1<br>(Low)|2|3|4|5<br>(High)|_LMH__<br>_Disagmt_|
|**Panel A: Stambaugh-Y**|**uan Mispric**|**ing Factor A**<br>|**lpha**<br>|||||
|All||0.02<br>(0.71)|0.02<br>(0.88)|0.03<br>(1.07)|−0.03<br>(−0.97)|−0.06<br>(−2.07)|0.08<br>(2.28)|
|_Oii_<br>1|0.00|0.01|0.01|−0.02|0.01|−0.03|0.03|
|_verprcng_<br>(Low)|(−0.12)|(0.17)|(0.29)|(−0.65)|(0.31)|(−0.86)|(0.82)|
|5|−0.06|0.03|0.03|0.00|−0.11|−0.23|0.26|
|(High)|(−1.28)|(0.31)|(0.44)|(0.08)|(−1.54)|(−3.26)|(2.59)|
|1−5|0.05|−0.02|−0.02|−0.02|0.12|0.20|−0.23|
||(1.13)|(−0.24)|(−0.27)|(−0.37)|(1.53)|(2.85)|(−2.26)|
|**Panel B: Change in****_Dis_**|**_agmt_**|||||||
|All||0.03|0.02|−0.03|−0.01|−0.02|0.05|
|||(0.94)|(0.56)|(−0.84)|(−0.48)|(−0.74)|(1.52)|
|_O_<br>1|0.03|0.04|−0.02|0.06|0.02|0.00|0.04|
|_verpricing_<br>(Low)|(1.29)|(1.10)|(−0.49)|(2.21)|(0.86)|(−0.02)|(0.97)|
|5|−0.11|−0.06|0.03|−0.16|−0.14|−0.22|0.16|
|(High)|(−1.60)|(−0.63)|(0.36)|(−1.87)|(−2.10)|(−2.82)|(1.86)|
|1−5|0.13|0.09|−0.05|0.22|0.17|0.22|−0.13|
||(1.81)|(0.97)|(−0.47)|(2.37)|(2.21)|(2.59)|(−1.46)|
|**Panel C: Monthly Opti**|**on Volume (**|**Stambaugh-**<br>|**Yuan Misp**<br>|**ricing Facto**<br>|**r Alpha)**<br>|||
|||0.05|0.11|−0.01|0.20|−0.30|0.35|
|All||(0.66)|(1.34)|(−0.21)|(2.64)|(−2.08)|(2.09)|
|<br>1|0.04|0.29|0.05|−0.18|0.12|−0.01|0.30|
|_Overpricing_<br>(Low)|(0.57)|(2.38)|(0.47)|(−2.07)|(1.15)|(−0.05)|(1.25)|
|5|−0.17|0.13|0.20|−0.21|0.14|−0.77|0.90|
|(High)|(−0.94)|(0.84)|(0.71)|(−1.67)|(0.63)|(−1.95)|(2.25)|
|1−5|0.20|0.16|−0.15|0.03|−0.03|0.76|−0.60|
||(1.02)|(0.78)|(−0.56)|(0.17)|(−0.09)|(1.49)|(−1.26)|



50 

##### **Table 8. Alternative Measures of Option Volume and Regression Specifications** 

This table reports results of Fama-Macbeth regressions of weekly stock returns on the 3 components of option volume ( _Disagmt, NetBuy_ and _NetSell_ ) and stock mispricing measure, _Overpricing_ . In Model 1 and 2, we use dollar trading volume to measure option and stock volume, where dollar trading volume is computed by multiplying end of the day price with number of contracts (or shares) traded during the day. In Model 3 and 4, we use delta-equivalent share volume to measure option volume. For each option, we multiply number of contracts traded with absolute value of delta. Then, for each stock, we aggregate delta-equivalent option volume across all listed options. In Model 5 and 6, we divide three components of option volume by shares outstanding instead of stock trading volume. In Model 7 and 8, we use quantile rank instead of dummy variable for _I_Disagmt_ , _I_NetBuy_ , and _I_NetSell_ . Specifically, _I_Disagmt_ is quintile rank that takes integer value from 0 (bottom _Disagmt_ quintile) to 4 (top _Disagmt_ quintile). _I_NetBuy_ takes value 0 (zero _NetBuy_ ), 1 (bottom 50% _NetBuy_ ), or 2 (top 50% _NetBuy_ ). _I_NetSell_ is defined similarly. Control variables comprising of stock and option characteristics are included but not reported for brevity. Stock controls include market beta, log of firm size, book-to-market ratio, one-week lagged stock return, and idiosyncratic stock volatility. Option controls include call-put implied volatility spread, and risk-neutral skewness. All coefficients are in percent. Newey-West corrected _t_ -statistics with 12 lags are reported in parenthesis. 

||Dollar<br>|Volume<br>|Delta-eq<br>Vol<br>|uivalent<br>ume<br>|Scaled b<br>Outsta<br>|y Shares<br>nding<br>|Quantil<br>|e Rank<br>|
|---|---|---|---|---|---|---|---|---|
||(1)|(2)|(3)|(4)|(5)|(6)|(7)|(8)|
|_O_|−0.4481|−0.3364|−0.4766|−0.3882|−0.4461|−0.2837|−0.4480|−0.2194|
|_verpricing_|(−3.12)|(−2.25)|(−3.21)|(−2.53)|(−3.08)|(−1.89)|(−3.10)|(−1.18)|
|_IDi_|−0.0502|0.1941|−0.0456|0.1569|−0.0627|0.3047|−0.0179|0.0355|
|__sagmt_|(−1.99)|(1.85)|(−1.85)|(2.15)|(−2.85)|(3.33)|(−2.38)|(1.45)|
|_I_Disagmt_||−0.4933||−0.4255||−0.7491||−0.1110|
|×_Overpricing_||(−2.27)||(−2.56)||(−3.85)||(−2.10)|
|_INB_|0.1119|0.1102|0.1192|0.1191|0.1076|0.1073|0.0617|0.0616|
|__etuy_|(5.07)|(5.00)|(4.76)|(4.77)|(4.23)|(4.17)|(3.67)|(3.67)|
|_INSll_|−0.0724|−0.0728|−0.0879|−0.0870|−0.0692|−0.0683|−0.0150|−0.0140|
|__ete_|(−3.28)|(−3.32)|(−4.31)|(−4.27)|(−3.47)|(−3.44)|(−1.20)|(−1.12)|
|Stock Controls|Yes|Yes|Yes|Yes|Yes|Yes|Yes|Yes|
|Option Controls|Yes|Yes|Yes|Yes|Yes|Yes|Yes|Yes|
|_No. Obs._|605,938|605,938|607,628|607,628|606,022|606,022|606,022|606,022|
|_Adj. R_<sup>_2_ </sup>(%)|6.44|6.56|6.45|6.39|6.46|6.59|6.39|6.46|



51 

**Table 9. Stock Return Predictability based on** **_Disagmt_ and** **_Overpricing_ : Regulation SHO.** 

This table reports the weekly Fama-French five-factor alphas for portfolios constructed by _Overpricing_ and _Disagmt_ . At the end of each week, stocks are independently double sorted into quintiles based on _Overpricing_ and _Disagmt_ , which results in 25(5×5) portfolios. Rows labelled “All” reports returns to each of the quintile portfolios sorted by _Disagmt_ . We also report the alphas for _Overpricing_ quintiles 1 and 5 for All stocks as well as stocks within each _Disagmt_ quintile ( _Disagmt_ quintile 1 to 5). The last column reports the alpha of a long-short portfolio, _LMH_Disagmt,_ that takes a long position in stocks in the lowest disagreement-based option volume quintile ( _Disagmt_ quintile 1) and shorts stocks in the highest _Disagmt_ quintile (quintile 5). In order to investigate the effect of Regulation SHO, we compare sample of pilot stocks (Panel A) and non-pilot stocks (Panel B) during the pilot period (June 2005-July 2007). Alphas are reported in percent per week. Newey-West corrected _t_ -statistics with 12 lags are reported in parenthesis. 

|||All|1<br>(Low)|2|_Disagmt_<br>3|4|5<br>(High)|_LMH__<br>_Disagmt_|
|---|---|---|---|---|---|---|---|---|
|**Panel A: Pilo**|**t Stocks**||||||||
||All||0.08|0.08|0.03|0.03|0.02|0.06|
||||(0.94)|(1.68)|(0.45)|(0.54)|(0.29)|(0.57)|
||1|0.05|0.29|0.06|0.02|−0.09|0.08|0.20|
|_Oii_|(Low)|(1.02)|(2.11)|(0.90)|(0.13)|(−0.81)|(0.65)|(1.08)|
|_verprcng_|5|0.07|0.44|0.25|−0.31|−0.08|−0.06|0.49|
||(High)|(0.93)|(2.44)|(1.96)|(−2.11)|(−0.36)|(−0.36)|(1.88)|
||1−5|−0.02|−0.17|−0.19|0.34|0.00|0.15|−0.33|
|||(−0.17)|(−0.79)|(−1.51)|(1.37)|(−0.01)|(0.77)|(−1.02)|
|**Panel B: Non**|**-pilot Stoc**|**ks**|||||||
||All||0.13|0.03|0.00|−0.11|−0.09|0.22|
||||(2.98)|(0.48)|(0.01)|(−2.15)|(−1.38)|(3.32)|
||1|0.06|0.10|0.04|0.10|−0.01|0.04|0.06|
||(Low)|(1.48)|(1.05)|(0.78)|(1.35)|(−0.08)|(0.34)|(0.45)|
|_Overpricing_|5|−0.12|0.41|0.11|−0.19|−0.47|−0.28|0.68|
||(High)|(−1.79)|(2.89)|(0.89)|(−1.75)|(−3.92)|(−2.47)|(4.88)|
||1−5|0.18|−0.31|−0.07|0.29|0.46|0.31|−0.62|
|||(2.89)|(−2.11)|(−0.52)|(2.31)|(3.39)|(2.72)|(−3.54)|



52 

##### **Table 10. Option Moneyness.** 

This table reports results of Fama-Macbeth regressions of weekly stock returns on the 3 components of option volume ( _Disagmt, NetBuy_ and _NetSell_ ) and stock mispricing measure, _Overpricing._ To gauge the effect of leverage, we compute the 3 components of option volume within 3 sets of options based on their leverage: ITM, ATM and OTM options. All options fall into one of three moneyness categories based on its delta following Bollen <u>and Whaley (2004). The option volume components are converted to dummy variables as in Table 3. Control</u> variables comprising of stock and option characteristics are included but not reported for brevity. Stock controls include market beta, log of firm size, book-to-market ratio, one-week lagged stock return, and idiosyncratic stock volatility. Option controls include call-put implied volatility spread, and risk-neutral skewness. All coefficients are in percent. Newey-West corrected _t_ -statistics with 12 lags are reported in parenthesis. 

||(1)|(2)|(3)|(4)|(5)|
|---|---|---|---|---|---|
|_Overpricing_|−0.3577<br>(−2.23)|−0.4052<br>(−2.56)|−0.3370<br>(−2.14)|−0.2806<br>(−1.73)|−0.2900<br>(−1.90)|
|_IDi_ITM|0.1585|||0.0964|0.0500|
|__sagmt_()|(1.51)|||(0.85)|(0.46)|
|_IDisamt_(ATM)||0.1238||0.0389|0.0490|
|__g_||(1.77)||(0.49)|(0.63)|
|_IDisamt_(OTM)|||0.2003|0.1397|0.1529|
|__g_|||(2.62)|(1.79)|(2.00)|
|_I_Disagmt_(ITM)|−0.4925|||−0.3318|−0.2060|
|×_Overpricing_|(−2.30)|||(−1.41)|(−0.93)|
|_I_Disagmt_(ATM)||−0.3826||−0.1550|−0.1730|
|×_Overpricing_||(−2.35)||(−0.84)|(−0.95)|
|_I_Disagmt_(OTM)|||−0.5706|−0.3860|−0.4039|
|×_Overpricing_|||(−3.21)|(−2.10)|(−2.25)|
|_INtB_(ITM)|0.0674|||0.0628|0.0627|
|__euy_|(3.54)|||(3.25)|(3.28)|
|_INtB_ATM||0.0678||0.0687|0.0729|
|__euy_()||(3.83)||(3.81)|(4.04)|
|_I_NetBuy_(OTM)|||0.0845<br>(3.37)|0.0885<br>(3.34)|0.0802<br>(3.37)|
|_I_NetSell_(ITM)|−0.0468<br>(−2.00)|||−0.0440<br>(−1.88)|−0.0410<br>(−1.76)|
|_INtSll_(ATM)||−0.0505||−0.0500|−0.0424|
|__ee_||(−2.69)||(−2.68)|(−2.31)|
|_INSll_OTM|||−0.0591|−0.0544|−0.0595|
|__ete_()|||(−3.18)|(−2.94)|(−3.30)|
|_Stock Controls_|Yes|Yes|Yes|Yes|Yes|
|_Option Controls_|No|No|No|No|Yes|
|_No. Obs._|608,429|608,429|608,429|608,429|605,937|
|_Adj. R_<sup>_2_</sup>|6.03|5.85|6.03|6.29|6.74|



53 

## **Appendix A: Variable Definitions** 

#### **A.1 Construction of Mispricing Proxy** 

Most of the variables are updated annually since they are defined using annual firm fundamentals. To ensure that overpricing proxy is computed using available data at the portfolio formation, we assume that firm fundamentals from fiscal year ending in calendar year _t_ is available from the July of year _t_ +1. The exceptions are anomaly 1 (financial distress) and anomaly 9 (return on assets), which use quarterly fundamental data, and anomaly 10 (momentum) which is updated monthly. Detailed definition is described below and it closely mimics Stambaugh and Yuan (2017). Symbols are COMPUSTAT code. Each week, we use the value of mispricing proxy from previous calendar month. 

**Financial distress:** We closely mimic Campbell, Hilscher and Szilagyi (2008) and Chen, Novy-Marx <u>and Zhang (2011) to construct a measure of financial distress.</u> 

**O-score bankruptcy probability:** Following Ohlson (1980), O-score is defined as: 

O = −1.32 – 0.407log(ATt) + 6.03(DLCt+DLTTt)/ATt − 1..43(ACTt−LCTt)/ATt + 0.076LCTt/ACTt − 1.72Xt − 2.37NIt/ATt − 1.83(PIt/LTt) + 0.285Yt − (NIt−NIt−1)/(|NIt|+| NIt−1|) 

where Xt is 1 if LT>AT, and 0 otherwise, Yt is 1 if NIt−1 and NIt−2 is both negative, and 0 otherwise. 

**Net stock issues:** Annual growth in split-adjusted number of shares outstanding, which is defined as log(CSHOt × AJEXt)− log(CSHOt−1 × AJEXt−1). 

**Composite equity issues:** Growth in the firm’s total market value of equity minus the stock’s rate of return measured over the past 5 fiscal years. We closely mimic Daniel and Titman (2006). 

**Total accruals:** Accruals scaled by average of past two year’s assets following Sloan (1996), where accruals is defined as 

ΔACTt – ΔCHEt − (ΔLCTt – ΔDLCt − ΔTXPt) − DPt. 

Δ refers to year-on-year change. 

**Net operating assets:** Net operating assets scaled by last year’s assets. Following <u>Hirshleifer, Hou, Teoh and Zhang (2004), net operating assets is defined as</u> 

(ATt−CHEt)−(ATt−DLCt−DLTTt−MBt−PSTKt−CEQt). 

**Momentum:** Cumulative returns during the past 1-year, skipping the most recent month following <u>Jegadeesh and Titman (1993)</u> 

- **Gross profitability:** Gross profits scaled by assets. Following <u>Novy Marx (2013), gross profits is</u> defined as sales (REVTt) minus cost of goods sold (COGSt). 

54 

**Asset growth:** Year-on-year growth in total assets. (ATt / ATt−1 − 1) 

**Return on assets:** Quarterly earnings (IBQt) to the last quarter’s assets (ATQt−1). Quarterly earnings data is assumed to be available from its announcement date (RDQ). 

**Investment to assets:** Investment to assets is defined as (ΔPPEGTt+ ΔINVTt)/ATt−1. 

#### **A.2. Definition of Stock and Option Control Variables** 

Definitions of firm-specific variables is provided below. Firm characteristics at the end of week _t_ are used to predict subsequent stock returns during week _t_ +1. If a variable is measured in monthly frequency, we use the value from the previous calendar month. 

**Market beta (** **_Beta_ ):** Sum of three betas estimated from the equation below using the past 6 months daily individual/market return data. 



At least 50 valid daily observations are required 

**Size (** **_ME_ ):** Share price times the number of shares outstanding at the end of week _t_ 

**Book-to-market ratio (** **_BM_ ):** The ratio of book equity at the end of month _t_ to the market equity. We follow the methodology outlined by <u>Fama and French (1993) to compute value of book equity. We</u> assume that the book equity data for all fiscal year-ends in calendar year _t_ is available from the July of year _t_ . 

**Idiosyncratic volatility (** **_Ivol_ ):** Standard deviation of residuals from the daily return regression during month _t_ of the following equation. 

𝑟𝑖,𝑑 = 𝛼𝑖 + 𝛽1,𝑖𝑟𝑀,𝑑 + 𝛽2,𝑖𝑟𝑀,𝑑−1 + 𝛽3,𝑖𝑟𝑀,𝑑−2 + 𝜀𝑖,𝑑 

**Volatility spread (** **_Volspread_ ):** Difference in call and put option implied volatility at the last trading day of week _t_ . Implied volatility is extracted from OptionMetrics volatility surface data with a delta of 0.5 and an expiration of 30 days following Cremers and Weinbaum (2010) and An, Ang, Bali and Cakici <u>(2014).</u> 

**Risk-neutral skewness (** **_Qskew_ ):** At the last trading day of week _t_ , we calculate risk-neutral skewness from volatility surface data with an expiration of 30 days. It is defined as implied volatility of put options with delta 0.2 minus the average implied volatility of call and put options with delta 0.5. 

55 

#### **A.3. Definition of proxies for short-selling costs** 

**Residual institutional ownership:** From 13F institutional holdings data, we first compute the percentage of institutional ownership for stock _i_ in month _t_ ( _IOit_ ) as number of shares owned by all institutions divided by total number of shares outstanding. Since the institutional holding data is reported at quarterly frequency, the monthly _IOit_ is based on the institutional ownership at the end of the previous quarter. We obtain the residual institutional ownership as the residual (𝜖𝑖,𝑡) from the following cross-sectional regressions: 



**Loan fee:** We use institutional lending data from Markit Securities Finance, for the period from May 2005 to December 2013. Loan fee is value-weighted average of fees received by the lenders on all currently outstanding shares on loan for shorting during month t. 

#### **A.4. Definition of proxies for analyst dispersion** 

**Analyst dispersion based on long-term growth forecast (Disp_LTG):** Standard deviation of analyst forecast on long-term growth rate. We require at least two valid records at the end of each month. Forecast on long-term growth rate is obtained from IBES by applying filters with FPI=0, REPORT_CURR=USD, non-missing review date and non-missing announcement date. A forecast is valid from the month it was announced to the month of the review date provided by IBES. When there are more than two forecasts issued by the same analyst, we only keep the most recently announced forecast. 

**Analyst dispersion based on EPS forecast (Disp_EPS):** Standard deviation of analyst forecast on yearly EPS scaled by mean forecasts. We require at least two valid records at the end of each month. Forecast on EPS is obtained from IBES by applying filters with MEASURE=EPS, FPI=1, REPORT_CURR=USD, non-missing review date and non-missing announcement date. A forecast is valid from the month it was announced to the month of the review date provided by IBES. When there are more than two forecasts issued by the same analyst, we only keep the most recently announced forecast. 

**Stock volume (TURN):** Weekly sum of daily dollar trading volume of stock i divided by its market capitalization at the end of week t. Dollar trading volume is calculated by multiplying number of shares traded with price per share. 

56 

**Total return volatility (RetVol):** Standard deviation of daily returns during month t of stock i. 

**Change in breadth of ownership (DBreadth):** We follow (Chen, Hong and Stein, 2002) to compute change in breadth of ownership. 

**Composite disagreement proxy (Composite):** Composite ranking of five disagreement proxies (Disp_LTG, Disp_EPS, TURN, RetVol, and −DBreadth). For each week t, we average ranking percentile of each disagreement proxies. We require at least 3 proxies to be valid. 

57 

# **<u>Internet Appendix</u>** 

**Why Does Option Volume Predict Stock Returns? The Role of Investor Disagreement** 

58 

**Figure A1. Stock Returns, Short Selling Costs, Disagreement-based Option Volume, and Mispriced Stocks.** This figure plots Fama-French five-factor alphas of portfolios constructed among stocks in low, medium, and high short selling costs ( _SSC_ ) terciles. We use the residual institutional ownership as a proxy for _SSC_ . We construct a long-short portfolio, _LMH_Disagmt,_ that takes a long position in stocks in the lowest _Disagmt_ quintile and shorts stocks in the highest _Disagmt_ quintile. We also consider _HML_NetBuy_ that buys stocks in the High _NetBuy_ group and shorts stocks in the Low _NetBuy_ group. _LMH_NetSell_ is constructed similarly. In Panel A, red circles report the five-factor alphas of _LMH_Disagmt_ portfolios for stocks with low, medium, and high _SSC_ . Green triangles and blue squares represent the five factor alphas of _HML_NetBuy_ and _LMH_NetSell_ , across the three _SSC_ sorted stock groups. In Panel B, within each _SSC_ tercile, stocks are sorted into quintiles based on _Overpricing and Disagmt,_ where high and low stock _Overpricing_ is defined based on the stock ranking according to eleven anomaly variables in Stambaugh, Yu and Yuan (2012). Within each _SSC_ - _Overpricing_ cohort, we report Fama-French fivefactor alpha for _LMH_Disagmt_ portfolio, where × represents the mean alpha. Error bars represent 95% confidence intervals. Numbers on y-axis are in percent. 

**Panel A: Unconditional Return Predictability** 



**Panel B: LMH** **_Disagmt_ for each** **_Overpricing_ Quintile** 



59
