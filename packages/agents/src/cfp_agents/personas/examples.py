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
  "confidence": 0.55,
  "thesis": "Costco is a wonderful business — sustained ROIC above 25%, a real moat in warehouse-club retail, and management that thinks like owners. But at 50x earnings the price asks for 30 years of perfect execution. I'd buy on a retracement to ~35x; until then the margin of safety isn't there.",
  "key_evidence": [
    "10-year average ROIC ~26%, comfortably above cost of capital",
    "Predictable 6-8% same-store sales across cycles, including 2022 inflation",
    "93% membership renewal rate — the moat is paying customers, not branding",
    "Net cash balance sheet, no leverage games"
  ],
  "concerns": [
    "P/E of 50x prices in two more decades of compounding",
    "International expansion has been slower than the bull thesis assumed"
  ]
}
"""),
    "munger": _ex("""
{
  "signal": "bullish",
  "confidence": 0.75,
  "thesis": "Visa is the kind of business I want to invert: what would destroy it? A central bank digital currency or a successful network competitor — both possible but slow-moving. Meanwhile they earn ROIC north of 30%, with no inventory and minimal capex. Pay a fair price, hold forever.",
  "key_evidence": [
    "Two-sided network effect: cardholders and merchants both lock in",
    "ROIC ~33% with operating margins near 65%",
    "Capex/revenue under 5% — a true asset-light compounder",
    "Multi-decade tailwind from cash-to-card secular shift internationally"
  ],
  "concerns": [
    "CBDC or merchant-pushed alternatives could compress fees",
    "Regulators occasionally push interchange caps"
  ]
}
"""),
    "burry": _ex("""
{
  "signal": "bearish",
  "confidence": 0.70,
  "thesis": "The stock trades at 80x earnings on a thesis that auto margins recover and a robotaxi business materializes. Neither is supported by the cash flows or the competitive dynamics. The catalyst is consensus being forced to mark down forward EPS as Chinese competition compresses pricing.",
  "key_evidence": [
    "Auto gross margins compressed from ~30% in 2022 to under 18%",
    "BYD now ships more EVs globally and at lower price points",
    "P/B of ~14 prices a deep moat the current market share doesn't support",
    "FSD revenue still under 3% of total — the robotaxi narrative is unfunded"
  ],
  "concerns": [
    "If FSD gets actual regulatory approval, the optionality re-prices",
    "Distribution edge in financing is real and durable"
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
  "signal": "neutral",
  "confidence": 0.55,
  "thesis": "Salesforce's current price embeds the story that operating margin expands from 20% to 35% AND revenue grows 12-14% for the next decade. That's possible if AgentForce monetizes broadly, but mathematically it's a thin tightrope — competitive equilibrium says you don't get both at once.",
  "key_evidence": [
    "Implied DCF: 13% revenue CAGR + 35% terminal margin needed to justify the price",
    "Historical: revenue growth has slowed from 20% to 9% in 4 years",
    "Operating margin expansion partly from one-time headcount cuts",
    "AgentForce traction is real but pricing is unproven"
  ],
  "concerns": [
    "If AgentForce undermines seat-based pricing, growth and margin diverge",
    "I might be too conservative on margin expansion if SaaS layoffs are durable"
  ]
}
"""),
    "graham": _ex("""
{
  "signal": "neutral",
  "confidence": 0.45,
  "thesis": "Coca-Cola passes some defensive screens — long earnings record, dividend continuity, large cap — but at P/E of ~25 and P/B of ~10 the safety is qualitative not quantitative. I would prefer a 30% discount before considering it an investment rather than speculation.",
  "key_evidence": [
    "Earnings record positive every year for 50+ years",
    "P/E ~25 (above my defensive threshold of 15)",
    "P/B ~10 (above my threshold of 1.5)",
    "Dividend coverage and balance sheet are sound"
  ],
  "concerns": [
    "Mature beverage market — no growth thesis, only quality",
    "Strong USD a structural headwind to international segments"
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
    "fisher": _ex("""
{
  "signal": "bullish",
  "confidence": 0.80,
  "thesis": "Microsoft passes the 15-point checklist in spirit. The product portfolio compounds — Azure, Office, GitHub, OpenAI partnership — and management has consistently allocated capital with multi-decade time horizons. Even at 35x earnings, the long-runway compounder lens makes this a hold-forever name.",
  "key_evidence": [
    "R&D spend $30B+/yr funding three different platform bets simultaneously",
    "Azure growth re-accelerated to 30%+ as AI workloads layer on",
    "Operating margin sustained at ~45% with R&D treated as expense",
    "Internal-promotion culture, low executive churn, strong owner alignment"
  ],
  "concerns": [
    "OpenAI relationship is governance-fragile",
    "Antitrust pressure on platform tying could cap distribution"
  ]
}
"""),
    "pabrai": _ex("""
{
  "signal": "neutral",
  "confidence": 0.50,
  "thesis": "Berkshire is a wonderful collection of businesses but the asymmetry isn't there at the current price. P/B ~1.5 on a $900B company gives modest upside — heads I win 5%/yr, tails I lose 10%/yr. That's not the dhandho setup I'm looking for.",
  "key_evidence": [
    "Trades at ~1.5x book; below buyback threshold but not deep value",
    "Insurance float still ~$170B but reinvestment rates compressed",
    "Cash hoard ~$300B is dry powder but earns the bill rate",
    "Succession risk priced in but not eliminated"
  ],
  "concerns": [
    "If a major opportunity emerges with the cash, my conservative call looks silly",
    "Munger's framework still pushes me to wait for the clear signal"
  ]
}
"""),
    "jhunjhunwala": _ex("""
{
  "signal": "bullish",
  "confidence": 0.85,
  "thesis": "TSMC sits at the intersection of three multi-decade waves: the AI compute build-out, the geopolitical reshoring of advanced semis, and the EM-to-DM industrial wealth transfer. Concentration risk is real but the operator quality and customer lock-in justify size.",
  "key_evidence": [
    "Sole-supplier for advanced nodes — 90%+ of <5nm capacity globally",
    "AI accelerator demand booked through 2026; capacity is the binding constraint",
    "CHIPS Act and Taiwan-Japan-Arizona expansion de-risks geographic concentration over time",
    "Operating margins 40%+ even through cyclical troughs"
  ],
  "concerns": [
    "Geopolitical tail risk around Taiwan is non-trivial",
    "Cyclical inventory correction could compress 2026 numbers"
  ]
}
"""),
}
