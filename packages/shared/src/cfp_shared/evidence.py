"""Canonical evidence bundle: one source of truth per (ticker, run_ts).

Every agent in the ensemble — 5 analysts, 13 personas, 3 synthesis nodes —
sees the same EvidenceBundle. Personas differ in their *lens* (which fields
they emphasize in their prompt), not in what data they had access to.

This eliminates two prior failure modes:
  1. Personas with extra_context() hooks saw richer evidence than personas
     without them; the synthesizer couldn't reconcile because it didn't
     know who saw what.
  2. Personas were anchored to upstream analyst conclusions, which produced
     groupthink (every persona skewed the same direction the technicals
     analyst already declared).

Bundles are built by `cfp_jobs.agents_runner.build_evidence_bundle` and
persisted to the `run_evidence` table for replay / audit. Schema is
versioned; bumping `schema_version` requires a migration consumer-side.

Tier-2 sub-models (MarketRegimeCtx, VolSurfaceCtx, SectorContextCtx) are
declared with all-optional fields so they can be populated incrementally
as new UW endpoints land without breaking existing readers.
"""

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field


class _Frozen(BaseModel):
    """Common base — bundles are immutable per run_ts."""

    model_config = ConfigDict(frozen=False, extra="ignore")


# ---------- instrument ----------


class Instrument(_Frozen):
    """The ticker, framed positively. Kills the 'every unknown ticker is an
    ETF' hallucination. Sourced from UW /stock/{T}/info, FMP /profile fallback."""

    ticker: str
    type: str = "stock"  # 'stock' | 'etf' | 'adr' | 'fund'
    company_name: str
    sector: str = "Unknown"
    industry: str | None = None
    marketcap_size: str | None = None  # 'small' | 'medium' | 'large' | 'big'
    short_description: str | None = None
    next_earnings_date: date | None = None


# ---------- price ----------


class PriceContext(_Frozen):
    """Summary stats from prices_daily. Computed once at bundle-build time;
    the technicals analyst reads these instead of re-deriving from OHLCV."""

    last_close: float | None = None
    last_date: date | None = None
    bars_count: int = 0
    ma50_dist: float | None = None      # (last - MA50) / MA50
    ma200_dist: float | None = None
    rsi_14: float | None = None
    return_5d: float | None = None
    return_20d: float | None = None
    return_60d: float | None = None
    realized_vol_20d: float | None = None  # annualized stdev of daily returns
    volume_z_20d: float | None = None       # 20d z-score of latest bar's volume


# ---------- fundamentals ----------


class FundamentalsCtx(_Frozen):
    """Latest annual snapshot from the fundamentals table. has_data=False when
    nothing has been ingested yet (the personas are told to fall back to price
    + flow reasoning rather than hallucinating an ETF frame)."""

    has_data: bool = False
    revenue: float | None = None              # latest annual
    market_cap: float | None = None
    roe: float | None = None
    roic: float | None = None
    free_cash_flow: float | None = None
    debt_to_equity: float | None = None
    pe_ratio: float | None = None
    price_to_book: float | None = None
    gross_margin: float | None = None
    net_margin: float | None = None


# ---------- options flow ----------


class TopTrade(_Frozen):
    ts: datetime | None = None
    type: str | None = None
    expiry: date | None = None
    strike: float | None = None
    total_premium: float | None = None
    ask_prem: float | None = None
    bid_prem: float | None = None
    alert: str | None = None
    option_chain: str | None = None


class OptionsFlowCtx(_Frozen):
    """5-day rolling option flow with sticky/transient breakdown."""

    alert_count_5d: int = 0
    net_call_premium_5d: float = 0.0
    net_put_premium_5d: float = 0.0
    leap_call_premium_5d: float = 0.0   # >90 DTE call premium
    leap_put_premium_5d: float = 0.0
    call_at_ask_pct: float = 0.5         # fraction lifted at ask
    put_at_ask_pct: float = 0.5
    sticky_premium_5d: float = 0.0       # absorbed into OI next day
    transient_premium_5d: float = 0.0    # OI flat or shrank
    sticky_pct: float = 0.5
    sticky_chain_ratio: float = 0.5      # sticky_chains / total_chains
    top_trades: list[TopTrade] = Field(default_factory=list)


# ---------- dark pool ----------


class DarkPoolCtx(_Frozen):
    prints_5d: int = 0
    premium_5d: float = 0.0
    above_vwap_pct: float = 0.5  # fraction of $ traded above NBBO midpoint


# ---------- positioning (short data + dealer greeks) ----------


class PositioningCtx(_Frozen):
    short_shares_available: int | None = None
    fee_rate: float | None = None        # %
    rebate_rate: float | None = None
    call_delta: float | None = None
    put_delta: float | None = None
    call_gamma: float | None = None
    put_gamma: float | None = None
    gex_total: float | None = None        # call_gamma + put_gamma
    as_of_date: date | None = None

    # ---- skylit.ai / Heatseeker structural snapshot (option 2) ----
    # All optional; populated when the gexester-vexster bridge succeeds.
    skylit_spot: float | None = None
    skylit_regime_score: float | None = None         # signed_total / total_abs, in [-1, +1]
    skylit_signed_total_gamma: float | None = None
    skylit_king_strike: float | None = None
    skylit_king_gamma: float | None = None
    skylit_floor_strike: float | None = None
    skylit_floor_significance: float | None = None
    skylit_ceiling_strike: float | None = None
    skylit_ceiling_significance: float | None = None
    skylit_air_pockets: list[dict] | None = None     # [{low, high, span}, ...]
    skylit_liquidity_vacuums: list[dict] | None = None
    skylit_expiration: str | None = None
    skylit_fetched_at_ms: int | None = None

    # ---- 0DTE Trinity (option 3) — only populated for SPY/QQQ/SPX/SPXW ----
    trinity_classification: str | None = None        # high_confidence_directional, ...
    trinity_direction: str | None = None             # 'calls' | 'puts' | 'informational_only'
    trinity_avg_bias: float | None = None            # -100..+100
    trinity_spread: float | None = None
    trinity_bias_spx: float | None = None
    trinity_bias_spy: float | None = None
    trinity_bias_qqq: float | None = None
    trinity_whipsaw: bool | None = None
    trinity_age_minutes: float | None = None


# ---------- smart money ----------


class CongressTrade(_Frozen):
    name: str | None = None
    chamber: str | None = None
    type: str | None = None  # 'Buy' | 'Sell'
    amount_band: str | None = None
    transaction_date: date | None = None


class InsiderActor(_Frozen):
    """A single insider's aggregated activity over the 30d window.

    Surfaces the buy/sell narrative depth that the old summary (`insider_buys_30d`
    + `insider_net_amount_30d`) flattened away. A net of +$1M reads identically
    whether it's "10 directors each bought $100k" or "the CFO bought $1M solo" —
    very different conviction signals. Personas now see the top participants
    by side so they can frame that asymmetry.
    """

    filer: str
    title: str | None = None
    side: str  # 'buy' | 'sell'
    total_amount: float
    txn_count: int


class SmartMoneyCtx(_Frozen):
    insider_buys_30d: int = 0
    insider_sells_30d: int = 0
    insider_net_amount_30d: float = 0.0  # signed $
    # Buy/sell asymmetry — the unsigned totals on each side. With these +
    # the count fields you can answer "5 buyers vs 1 seller" or "$5M bought,
    # $4.8M sold (net only +$200k but flow was heavy on both sides)".
    insider_total_buy_amount_30d: float = 0.0
    insider_total_sell_amount_30d: float = 0.0
    # Unique insider headcount on each side — distinguishes one mega-buyer
    # from many small ones (and vice versa).
    insider_unique_buyers_30d: int = 0
    insider_unique_sellers_30d: int = 0
    # Top participants by side. Empty when no transactions; capped at 3 per
    # side so the prompt stays compact even on heavily-traded names.
    top_insider_buyers: list[InsiderActor] = Field(default_factory=list)
    top_insider_sellers: list[InsiderActor] = Field(default_factory=list)
    congress_trades: list[CongressTrade] = Field(default_factory=list)


# ---------- catalysts (earnings + news) ----------


class NewsHeadline(_Frozen):
    ts: datetime
    source: str | None = None
    headline: str
    sentiment: str | None = None  # 'positive' | 'neutral' | 'negative'
    is_major: bool = False


class CatalystCtx(_Frozen):
    next_earnings_date: date | None = None
    days_to_earnings: int | None = None
    earnings_proximity: bool = False     # True if next earnings within 7 days
    expected_move_perc: float | None = None
    news_5d: list[NewsHeadline] = Field(default_factory=list)
    sentiment_score_5d: float | None = None  # (positive - negative) / total
    # Headline-sentiment rollup over the same 5d window. Per-headline
    # `sentiment` tags are already in news_5d but personas had no aggregate;
    # exposing the counts directly lets them say "net 3 positive vs 1
    # negative" without re-counting from the headline list.
    news_sentiment_positive_5d: int = 0
    news_sentiment_neutral_5d: int = 0
    news_sentiment_negative_5d: int = 0


# ---------- reddit (chatter intensity, asymmetry) ----------


class RedditSubredditMentions(_Frozen):
    """Per-subreddit mention snapshot for one ticker."""

    subreddit: str
    mentions: int = 0
    upvotes: int = 0
    rank: int | None = None
    rank_24h_ago: int | None = None
    mentions_24h_ago: int | None = None


class RedditPostExcerpt(_Frozen):
    """A single Reddit catalyst-feed post, trimmed for prompt budget.

    Replaces the "10 posts mention NVDA" volume-only view with actual content
    excerpts so personas can distinguish substantive theses ("bull case on
    NVDA: data center growth, Mellanox synergy, no AMD pressure") from pump
    spam ("🚀🚀🚀 NVDA to 1500"). Title + ~300-char body slice + engagement
    metadata keeps each excerpt ~400 tokens so 5 excerpts stays under 2k tokens.
    """

    subreddit: str
    title: str
    body_excerpt: str = ""                # first ~300 chars of selftext
    upvotes: int | None = None
    num_comments: int | None = None
    keywords: list[str] = Field(default_factory=list)   # catalyst keywords matched
    posted_at: datetime | None = None
    permalink: str | None = None


class RedditCtx(_Frozen):
    """Reddit chatter signals from Apewisdom.

    Two asymmetry flags personas should care about:
      - is_contrarian_warning: high mentions + price already moving = late
      - is_stealth: low mentions + bullish setup elsewhere = unnoticed
    Burry uses contrarian_warning as a froth flag; Soros uses spike_ratio
    to identify which stage of the reflexive cycle we're in."""

    has_data: bool = False
    mentions_today: int = 0
    mentions_7d_avg: float = 0.0
    spike_ratio: float | None = None       # mentions_today / mentions_7d_avg
    rank_today: int | None = None
    rank_7d_ago: int | None = None
    rank_change_7d: int | None = None      # negative = climbing the ranks (more attention)
    is_contrarian_warning: bool = False     # high chatter (>3x avg) + already in WSB top-20
    is_stealth: bool = False                # low chatter (<0.5x avg) + not in top-100
    by_subreddit: list[RedditSubredditMentions] = Field(default_factory=list)
    # Catalyst-feed chatter (reddit_posts table — RSS-scraped posts tagged with
    # rumor/partnership/FDA/etc. keywords). Independent of Apewisdom: a ticker
    # can have zero Apewisdom mentions yet several catalyst posts (BTBT-style).
    # Counted toward has_data so the sentiment analyst doesn't go neutral when
    # there's clear catalyst chatter just not enough volume for the top-150.
    catalyst_posts_7d: int = 0
    catalyst_posts_bullish_7d: int = 0    # subset matched against bullish keyword set
    catalyst_posts_bearish_7d: int = 0    # subset matched against bearish keyword set
    # Up to ~5 most-engaged recent catalyst posts so the sentiment analyst
    # and personas can read what's actually being said, not just count
    # mentions. Capped + trimmed in _build_reddit_ctx to keep prompt budget
    # reasonable. Empty when reddit_posts has nothing for this ticker.
    recent_post_excerpts: list[RedditPostExcerpt] = Field(default_factory=list)


# ---------- ETF context ----------


class EtfContextCtx(_Frozen):
    sector_etf: str | None = None
    in_flow_5d: float = 0.0
    n_days: int = 0


# ---------- Tier-2 reservations (populated when endpoints land) ----------


class MarketRegimeCtx(_Frozen):
    """Market regime + structural risk signals fed to every agent.

    `regime` is one of {bull, chop, bear, unknown}. `risk_multiplier` (0..1)
    is the position-sizing knob: 1.0 in bull, 0.5 in chop, 0.0 in bear.
    """

    vix: float | None = None
    spx_trend: str | None = None
    fomc_proximity_days: int | None = None
    regime: str = "unknown"
    risk_multiplier: float = 0.5
    breadth_pct_above_50d: float | None = None
    spy_above_50d: bool | None = None
    spy_above_200d: bool | None = None
    # Tier-3 add-ons: insider sentiment + dark-pool ratio + reddit velocity.
    # These three signals are read by the same risk-on/off lens that uses
    # VIX/breadth, so keeping them on this ctx avoids a flag-day on the schema.
    insider_net_buy_30d_usd: float | None = None
    dark_pool_volume_ratio: float | None = None
    reddit_mention_velocity_7d: float | None = None


class VolSurfaceCtx(_Frozen):
    """Reserved for Tier 2: ATM IV, IV-RV gap, skew z, gamma flip."""

    atm_iv: float | None = None
    iv_rank_30d: float | None = None
    iv_minus_rv: float | None = None
    skew_z: float | None = None
    gamma_flip_distance: float | None = None
    call_wall: float | None = None
    put_wall: float | None = None


class SectorContextCtx(_Frozen):
    """Reserved for Tier 2: peer relative strength, XGB rank."""

    xgb_rank: int | None = None
    n_sectors: int | None = None
    peer_relative_strength_z: float | None = None


# ---------- the bundle ----------


class EvidenceBundle(_Frozen):
    """Canonical evidence per (run_ts, ticker). All agents read this; nothing
    else is allowed to drift in.

    Persisted to run_evidence(run_ts, ticker, bundle_json, schema_version).
    """

    schema_version: str = "1.0"
    run_ts: datetime
    instrument: Instrument
    price_context: PriceContext = Field(default_factory=PriceContext)
    fundamentals: FundamentalsCtx = Field(default_factory=FundamentalsCtx)
    options_flow: OptionsFlowCtx = Field(default_factory=OptionsFlowCtx)
    dark_pool: DarkPoolCtx = Field(default_factory=DarkPoolCtx)
    positioning: PositioningCtx = Field(default_factory=PositioningCtx)
    smart_money: SmartMoneyCtx = Field(default_factory=SmartMoneyCtx)
    catalysts: CatalystCtx = Field(default_factory=CatalystCtx)
    etf_context: EtfContextCtx = Field(default_factory=EtfContextCtx)
    reddit: RedditCtx = Field(default_factory=RedditCtx)
    market_regime: MarketRegimeCtx = Field(default_factory=MarketRegimeCtx)
    vol_surface: VolSurfaceCtx = Field(default_factory=VolSurfaceCtx)
    sector_context: SectorContextCtx = Field(default_factory=SectorContextCtx)
