---
title: 'Inferring Latent Market Forces: Evaluating LLM Detection of Gamma Exposure Patterns via Obfuscation Testing'
source_url: http://arxiv.org/abs/2512.17923v2
source_domain: arxiv.org
fetched_at: '2026-07-11T06:29:41Z'
trust_tier: 2
category: papers
topics:
- academic
summary: We introduce obfuscation testing, a novel methodology for validating whether large language models detect structural market patterns through causal reasoning rather than temporal association. Testing three dealer hedging constraint patterns (gamma positioning, stock pinning, 0DTE hedging) on 242…
url_sha1: a33119ab1614a10d7fb3083dd7d616bc091429b2
simhash: '5335042533004149833'
status: vault
ingested_by: ingest
---

# Inferring Latent Market Forces: Evaluating LLM Detection of Gamma Exposure Patterns via Obfuscation Testing

**Authors:** Christopher Regan, Ying Xie

**Published:** 2025-12-08T15:48:57Z

**Link:** http://arxiv.org/abs/2512.17923v2

## Abstract

We introduce obfuscation testing, a novel methodology for validating whether large language models detect structural market patterns through causal reasoning rather than temporal association. Testing three dealer hedging constraint patterns (gamma positioning, stock pinning, 0DTE hedging) on 242 trading days (95.6% coverage) of S&P 500 options data, we find LLMs achieve 71.5% detection rate using unbiased prompts that provide only raw gamma exposure values without regime labels or temporal context. The WHO-WHOM-WHAT causal framework forces models to identify the economic actors (dealers), affected parties (directional traders), and structural mechanisms (forced hedging) underlying observed market dynamics. Critically, detection accuracy (91.2%) remains stable even as economic profitability varies quarterly, demonstrating that models identify structural constraints rather than profitable patterns. When prompted with regime labels, detection increases to 100%, but the 71.5% unbiased rate validates genuine pattern recognition. Our findings suggest LLMs possess emergent capabilities for detecting complex financial mechanisms through pure structural reasoning, with implications for systematic strategy development, risk management, and our understanding of how transformer architectures process financial market dynamics.
