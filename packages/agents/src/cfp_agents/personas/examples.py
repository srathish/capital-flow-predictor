"""Few-shot examples for persona LLM agents.

Each example is a single high-quality output (different ticker than the one
being analyzed) that anchors the model on (a) length, (b) specificity, and
(c) the persona's voice. Examples deliberately span signals — bullish, bearish,
neutral — so the model doesn't infer a default stance.

Lookup: ``EXAMPLES.get(persona_name, "")``. ``BasePersona.analyze`` appends the
matching example to the system prompt at LLM-call time.
"""

from __future__ import annotations

# Format: each example is a JSON object inside a small framing block. The
# framing tells the model "this is for shape reference, not a stance to copy"
# so the persona doesn't anchor on the example's signal/ticker.

_EXAMPLE_PREFIX = (
    "\n\n---\n"
    "Example of a high-quality output (DIFFERENT ticker; for format and "
    "specificity reference only — do NOT copy the stance):\n\n"
)


def _ex(s: str) -> str:
    return _EXAMPLE_PREFIX + s.strip()


EXAMPLES: dict[str, str] = {
    "buffett": _ex("""
{
  "signal": "neutral",
  "confidence": 0.25,
  "thesis": "Costco is a wonderful business — sustained ROIC above 25%, a real moat in warehouse-club retail, and management that thinks like owners. At 50x earnings the price asks for 30 years of perfect execution and offers no margin of safety. Pass — not even close to my buy zone.",
  "key_evidence": [
    "10-year average ROIC ~26%, comfortably above cost of capital",
    "93% membership renewal rate — the moat is paying customers, not branding",
    "P/E of 50x prices in two more decades of compounding with zero margin for error",
    "I'd be a buyer near 35x; current price requires zero misstep for a decade"
  ],
  "concerns": [
    "If membership growth re-accelerates internationally, I'm too cautious on the multiple",
    "A 30-40% drawdown would put it in my range — I'd be wrong to call it a pass forever"
  ]
}
"""),
    "soros": _ex("""
{
  "signal": "bearish",
  "confidence": 0.78,
  "thesis": "We are at the late-stage acceleration of the AI-infrastructure bubble — this is reflexivity textbook. The narrative is so self-reinforcing that every capex announcement validates the price, every price move attracts more capex, and the consensus has stopped asking whether the unit economics work. When the music stops, it stops fast. I take the other side of the late-cycle bubble.",
  "key_evidence": [
    "60-day return +47% on a name already up 200% YoY — acceleration into vertical",
    "Borrow fee 6.5% — shorts paying real money to fade the move (late-stage signal)",
    "LEAP call premium $48M sticky in OI — last cohort of conviction money chasing",
    "5 of 8 major news headlines in 5d are bullish narrative confirmation, zero are bearish challenges",
    "Sticky-pct on flow alerts dropped from 71% to 58% over 10 days — quality of marginal buyer is degrading"
  ],
  "concerns": [
    "Regime change in macro policy could extend the bubble another 2-3 quarters",
    "If hyperscaler capex actually compounds at 40% for two more years, late-stage thesis is wrong"
  ]
}
"""),
    "burry": _ex("""
{
  "signal": "neutral",
  "confidence": 0.20,
  "thesis": "Honeywell trades at ~22x earnings — neither rich enough to short with conviction nor cheap enough to be a deep-value long. No specific catalyst within 12-24 months, balance sheet is fine, no obvious mispricing. This is the kind of name I pass on most of the time.",
  "key_evidence": [
    "P/E ~22x, P/B ~7 — fairly valued band, not deep-value territory",
    "Net debt manageable, no distressed pricing setup",
    "No spinoff, restructuring, or forced-selling event on the horizon",
    "Consensus is appropriately cautious; no obvious mispricing to exploit either way"
  ],
  "concerns": [
    "If aerospace cycle rolls over harder than priced, opens up a real short setup",
    "If quantum or PFC divestitures force a re-rate, opens up a long setup — neither is imminent"
  ]
}
"""),
    "druckenmiller": _ex("""
{
  "signal": "bullish",
  "confidence": 0.70,
  "thesis": "Gold has the cleanest macro setup I see right now: real yields are rolling over, central banks are net buyers at record pace, and the dollar is weakening into a Fed pivot. The tape confirms — broke a 5-year range in Q4 and momentum is durable, not exhausted.",
  "key_evidence": [
    "10y real yield down ~80bps in 6 months; gold negatively correlated to real rates",
    "Central bank gold buying at multi-decade highs (~1,000+ tonnes/yr)",
    "DXY in clear downtrend; gold/DXY relationship unbroken",
    "Broke out above the prior range, now consolidating not retracing"
  ],
  "concerns": [
    "A genuine Fed re-pivot to hawkish would invert the thesis",
    "Crowded positioning in CoT data — late-cycle rallies are sharp"
  ]
}
"""),
    "cathie_wood": _ex("""
{
  "signal": "bullish",
  "confidence": 0.80,
  "thesis": "Palantir is the AI-deployment platform for the hardest customers — government and large enterprise. AIP is the right product at the right time, with revenue growth re-accelerating and operating leverage finally showing through. The $1T+ AI software TAM is just opening.",
  "key_evidence": [
    "Commercial revenue growing 50%+ y/y, accelerating not decelerating",
    "AIP customer count growing exponentially since 2024 launch",
    "Software gross margins above 80% with positive operating margin",
    "Defense customer entrenchment — long-cycle stickiness"
  ],
  "concerns": [
    "Trades at ~50x sales — multiple compression risk if growth slows",
    "Concentration in government revenue introduces budget cycle risk"
  ]
}
"""),
    "taleb": _ex("""
{
  "signal": "bearish",
  "confidence": 0.75,
  "thesis": "Regional banks look quietly stable — that's exactly when fragility hides. The CRE refinancing wall, the embedded Treasury losses sitting in HTM books, and the deposit beta sensitivity all amplify under stress. A single failure can become sector contagion in days.",
  "key_evidence": [
    "~$1.5T of CRE debt maturing through 2027, much at refinancing risk",
    "HTM unrealized losses still material relative to tangible capital",
    "Deposit beta now ~50% — uninsured deposits flight-prone",
    "March 2023 showed how fast contagion runs in this group"
  ],
  "concerns": [
    "Fed standing facilities (BTFP successor, discount window) cap the tail",
    "Strongest names (e.g., M&T) might survive via M&A premiums"
  ]
}
"""),
    "damodaran": _ex("""
{
  "signal": "bearish",
  "confidence": 0.68,
  "thesis": "Salesforce's current price embeds a story that requires operating margin to expand from 20% to 35% AND revenue to grow 12-14% for the next decade — simultaneously. Competitive equilibrium says you do not get both at once except in monopoly cases, and SaaS is not a monopoly market. The implied story is internally inconsistent, so the price overstates intrinsic value by ~25%.",
  "key_evidence": [
    "Implied DCF requires 13% revenue CAGR + 35% terminal margin to justify the price",
    "Historical revenue growth has decelerated from 20% to 9% over 4 years — story drifting from observed trajectory",
    "Recent operating-margin expansion came partly from one-time headcount cuts, not durable operating leverage",
    "Mature SaaS peer median terminal margin is ~28%, not 35% — peer evidence rejects the assumption"
  ],
  "concerns": [
    "If AgentForce monetizes broadly enough to lift seat-based pricing, the story re-rates",
    "Cost-cutting cycle may compound longer than I assume if AI replaces engineering headcount"
  ]
}
"""),
    "simons": _ex("""
{
  "signal": "bullish",
  "confidence": 0.62,
  "thesis": "Joint feature vector fires bullish: 20d return is +1.8 standard deviations above trailing 60d mean, RSI(14) at 64 is mid-strength but not overbought, MA50 distance is +12% with MA200 distance +18%, and volume z-score on the latest bar is +2.4. Historically, this conjunction in this sector group hits ~58% over a 10-day forward window with a 0.32 information ratio.",
  "key_evidence": [
    "r_20d = +12.4%, +1.8 sigma above 60d rolling mean (momentum factor active)",
    "RSI14 = 64 (in the 60-70 sweet spot — strength without overbought signal decay)",
    "MA50_dist +12% with MA200_dist +18% (trend factor confirms)",
    "vol_z = +2.4 on latest bar (institutional volume confirmation)",
    "Realized vol 20d = 28%, contracting from 35% three weeks ago (regime factor: bull phase)"
  ],
  "concerns": [
    "Vol regime flip (RV crossing above 40%) historically degrades this signal cluster",
    "If RSI exceeds 75 the mean-reversion factor turns negative and dominates"
  ]
}
"""),
    "ackman": _ex("""
{
  "signal": "bullish",
  "confidence": 0.70,
  "thesis": "Howard Hughes is one of those rare names where the public market price ignores the underlying real estate value. NAV per share is conservatively in the $80-90 range vs current ~$70. Specific catalysts — completion of the Las Vegas master-planned community and the Seaport sale — should narrow the gap within 18 months.",
  "key_evidence": [
    "Sum-of-parts NAV ~$85/share even with conservative cap rates",
    "Trading at ~80% of NAV; historical average ~95-100%",
    "Las Vegas Summerlin community has 25+ years of remaining inventory",
    "Pershing Square holds ~37%, aligned interests"
  ],
  "concerns": [
    "CRE rate environment hostile to monetization timing",
    "Concentrated insider ownership = limited float, can amplify drawdowns"
  ]
}
"""),
    "lynch": _ex("""
{
  "signal": "bullish",
  "confidence": 0.70,
  "thesis": "Ulta is a fast grower in an unsexy industry (mass-prestige beauty retail). PEG of ~1.0 on 15-18% earnings growth is exactly the boring-business compounder framework. The mall-adjacent footprint and loyalty program are still under-monetized internationally.",
  "key_evidence": [
    "Same-store sales growth 5-8% across cycles, even through 2020",
    "PEG ~1.0 on consensus 15% EPS growth — at the cheap edge of my range",
    "Loyalty members ~44M, drive 95% of revenue — a real moat",
    "International is essentially zero today; clear runway"
  ],
  "concerns": [
    "Sephora's accelerated mall expansion could compress mid-tier price points",
    "Beauty category is more cyclical than the multi-year chart suggests"
  ]
}
"""),
    "klarman": _ex("""
{
  "signal": "bullish",
  "confidence": 0.72,
  "thesis": "Liberty TripAdvisor is exactly the kind of mispriced corporate-event setup we want. The post-COVID overhang has masked that the stub is trading at ~0.6x sum-of-parts NAV, and management has publicly signaled a Liberty-style restructuring within 12 months. Margin of safety is the discount; the catalyst is the announced separation.",
  "key_evidence": [
    "Trades at ~60% of conservatively estimated NAV (P/B 0.65 vs sector median 1.4)",
    "FCF yield 9.8% on the stub — distressed pricing for an asset-light business",
    "Insider purchases 30d: 4 buys, $12M net (Liberty-team aligned)",
    "Two recent 8-K filings flag the restructuring committee mandate",
    "Debt/equity 0.4 — survives a 24-month workout window without forced selling"
  ],
  "concerns": [
    "If the corporate event slips past 18 months, NAV re-rates with rates not catalyst",
    "Liberty-stub structures are infamously slow — patience risk is real"
  ]
}
"""),
    "greenblatt": _ex("""
{
  "signal": "bullish",
  "confidence": 0.78,
  "thesis": "Top-quartile on BOTH earnings yield AND ROIC — a textbook Magic Formula long. Earnings yield 11.2% (P/E 8.9), ROIC 24%, FCF yield 13%. This is the cheap-and-good combination institutional money cannot easily own at scale because of size or sector classification. 12-month hold from here.",
  "key_evidence": [
    "Earnings yield 11.2% (1/PE 8.9) — top decile of S&P 1500",
    "ROIC 24% — top quartile, indicating durable capital efficiency",
    "FCF yield 13% — capital-return capacity is real, not accrual fiction",
    "Debt/equity 0.6 — capital structure can survive a normal recession",
    "No corporate-action overhang in the news; pure quant setup"
  ],
  "concerns": [
    "If earnings deteriorate sharply over 12 months, the joint score collapses",
    "Sector concentration risk in the Magic Formula universe at this point in the cycle"
  ]
}
"""),
    "minervini": _ex("""
{
  "signal": "bullish",
  "confidence": 0.80,
  "thesis": "Stage 2 confirmed and a tight 6-week VCP setting up. Price 18% above MA50, MA50 4% above MA200 — both rising. Today's pivot break came on +2.7 sigma volume. This is the textbook leadership setup: I take the breakout long with a 7% stop below the pivot.",
  "key_evidence": [
    "MA50 dist +18%, MA200 dist +24% — Trend Template intact",
    "20d return +9%, 60d return +28% — momentum in the leadership decile",
    "RSI(14) = 67 — strength without overbought decay",
    "Realized vol 20d compressed from 38% to 26% — VCP base tightening",
    "Volume z-score +2.7 on the pivot bar — institutional accumulation confirmed"
  ],
  "concerns": [
    "If it closes below the 50-day MA on volume, the trend template breaks and I'm out",
    "Market-wide breakdown invalidates leadership setups regardless of individual chart"
  ]
}
"""),
}
