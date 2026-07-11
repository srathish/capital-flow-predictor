---
title: Differential Machine Learning for 0DTE Options with Stochastic Volatility and Jumps
source_url: http://arxiv.org/abs/2603.07600v4
source_domain: arxiv.org
fetched_at: '2026-07-11T06:29:41Z'
trust_tier: 2
category: papers
topics:
- academic
summary: We present a differential machine learning method for zero-days-to-expiry (0DTE) options under a stochastic-volatility jump-diffusion model. To handle the ultra-short-maturity regime, we express the option price in Black-Scholes form with a maturity-gated variance correction, combining supervision…
url_sha1: 48864b89608b8858c723762b9c589a42b53c733c
simhash: '4419446651060851225'
status: vault
ingested_by: ingest
---

# Differential Machine Learning for 0DTE Options with Stochastic Volatility and Jumps

**Authors:** Takayuki Sakuma

**Published:** 2026-03-08T12:10:24Z

**Link:** http://arxiv.org/abs/2603.07600v4

## Abstract

We present a differential machine learning method for zero-days-to-expiry (0DTE) options under a stochastic-volatility jump-diffusion model. To handle the ultra-short-maturity regime, we express the option price in Black-Scholes form with a maturity-gated variance correction, combining supervision on prices and Greeks with a PIDE-residual penalty. Prices and Greeks are derived from a single trained pricing network, while jump-term identifiability is ensured by a jump-operator network fitted jointly in a three-stage procedure. The method improves jump-term approximation relative to one-stage baselines while maintaining comparable pricing errors. Furthermore, it reduces errors in Greeks, produces stable one-day delta hedges, and offers significant speedups over Fourier-based benchmarks. Calibration experiments demonstrate the network's efficiency as a pricer and incorporating jump-intensity price sensitivity into the learning process further improves the overall model fit. We also consider a jump rough Heston model.
