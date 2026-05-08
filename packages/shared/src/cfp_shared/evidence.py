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


# ---------- smart money ----------


class CongressTrade(_Frozen):
    name: str | None = None
    chamber: str | None = None
    type: str | None = None  # 'Buy' | 'Sell'
    amount_band: str | None = None
    transaction_date: date | None = None


class SmartMoneyCtx(_Frozen):
    insider_buys_30d: int = 0
    insider_sells_30d: int = 0
    insider_net_amount_30d: float = 0.0  # signed $
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


# ---------- ETF context ----------


class EtfContextCtx(_Frozen):
    sector_etf: str | None = None
    in_flow_5d: float = 0.0
    n_days: int = 0


# ---------- Tier-2 reservations (populated when endpoints land) ----------


class MarketRegimeCtx(_Frozen):
    """Reserved for Tier 2: VIX, breadth, term structure, FOMC proximity."""

    vix: float | None = None
    spx_trend: str | None = None
    fomc_proximity_days: int | None = None


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
    market_regime: MarketRegimeCtx = Field(default_factory=MarketRegimeCtx)
    vol_surface: VolSurfaceCtx = Field(default_factory=VolSurfaceCtx)
    sector_context: SectorContextCtx = Field(default_factory=SectorContextCtx)
