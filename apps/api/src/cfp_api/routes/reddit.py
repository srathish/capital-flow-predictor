"""Reddit mention browser + catalyst-keyword feed.

GET /v1/reddit/mentions
  Top tickers on the latest Apewisdom snapshot, enriched with:
   - sentiment_bull_share (from reddit_posts catalyst keywords, last 7d)
   - price_change_1d / price_change_5d (from prices_daily)
   - momentum_score (slope of last-7d mention count, normalized)
   - days_in_top20_14d (count of recent snapshots ranked ≤20)
   - is_first_time_entrant (no top-100 appearance in the prior 30d)
   - audience_skew ("wsb" | "investing" | "mixed")
   - catalyst_post_count (reddit_posts touching this ticker, last 48h)
   - mentions_last_6h (live count from reddit_posts — ahead of Apewisdom)
   - sparkline_7d / per-subreddit breakdown / contrarian + stealth flags

  Filters: q, sector, exclude_meme, watchlist.
  Sorts: mentions | spike | rank_change | momentum.

GET /v1/reddit/catalysts
  Catalyst-flagged Reddit posts ordered by composite score.

GET /v1/reddit/backtest
  Aggregate stats: do mention spikes lead price moves? Returns the mean 5d
  forward return for tickers with spike_ratio ≥ threshold.
"""

from __future__ import annotations

import logging
import math
from datetime import UTC, date, datetime
from typing import Literal

from fastapi import APIRouter, Query
from pydantic import BaseModel

from cfp_api.db import get_pool

log = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/reddit", tags=["reddit"])


# ---------- catalyst keyword sentiment buckets ----------
#
# Used to derive a per-ticker bull/bear share from reddit_posts.keywords.
# Anything not listed below is treated as neutral and ignored.

_BULLISH_KEYWORDS: frozenset[str] = frozenset({
    "partnership", "partner with", "deal with", "agreement with",
    "acquisition", "acquired", "acquires", "acquiring", "buyout", "takeover",
    "fda approval", "fda approves", "fda clearance",
    "raised guidance",
    "earnings beat", "beat estimates",
    "insider buy", "insider purchase",
    "contract", "contract win", "awarded",
    "buyback", "share repurchase", "dividend hike",
    "ipo",
})

_BEARISH_KEYWORDS: frozenset[str] = frozenset({
    "trial fail",
    "lowered guidance",
    "missed estimates",
    "insider selling",
    "investigation", "lawsuit", "settlement",
    "ceo steps down",
    "halt", "halted", "delisted",
})

# Perma-WSB names — the floor noise we let users hide.
_MEME_TICKERS: frozenset[str] = frozenset({
    "GME", "AMC", "BBBY", "MULN", "KOSS", "BB", "ATER", "DJT", "NOK",
})


# ---------- response models ----------


class SubMentions(BaseModel):
    subreddit: str
    mentions: int
    rank: int | None


PredictiveSignal = Literal["buy", "fade", "watch", "neutral"]

# Ordered set of rule ids the composite scorer can flag for a row. Each rule
# has a corresponding historical win-rate row from /v1/reddit/rules.
RULE_IDS = (
    "contrarian_top",
    "stealth_setup",
    "first_time_bull",
    "wsb_only_hype",
    "investing_accumulation",
    "fading_hype",
    "price_confirming_spike",
)
RuleId = Literal[
    "contrarian_top",
    "stealth_setup",
    "first_time_bull",
    "wsb_only_hype",
    "investing_accumulation",
    "fading_hype",
    "price_confirming_spike",
]


class ScoreComponents(BaseModel):
    """Signed contribution (~ -25..+25 each) of every feature to pred_score.
    Sum of these + 50 baseline ≈ pred_score (clamped to 0..100)."""
    spike: float
    momentum: float
    sentiment: float
    audience: float
    price_confirm: float
    freshness: float
    stealth_bonus: float


class MentionRow(BaseModel):
    ticker: str
    name: str | None
    sector: str | None
    mentions_today: int
    mentions_7d_avg: float
    spike_ratio: float | None
    rank_today: int | None
    rank_7d_ago: int | None
    rank_change_7d: int | None
    upvotes_today: int
    is_contrarian_warning: bool
    is_stealth: bool
    is_first_time_entrant: bool
    is_meme: bool
    sparkline_7d: list[int]
    by_subreddit: list[SubMentions]
    audience_skew: Literal["wsb", "investing", "mixed", "unknown"]
    momentum_score: float | None
    days_in_top20_14d: int
    sentiment_bull_share: float | None
    n_bullish_kw: int
    n_bearish_kw: int
    price_change_1d: float | None
    price_change_5d: float | None
    catalyst_post_count: int
    mentions_last_6h: int
    # Predictive layer (composite + rules)
    pred_score: float           # 0..100, 50 = neutral
    pred_return_20d_pct: float  # signed % (heuristic estimate)
    pred_signal: PredictiveSignal
    pred_confidence: float      # 0..1, derived from rule win rates + history depth
    score_components: ScoreComponents
    matched_rules: list[RuleId]


class BacktestSlice(BaseModel):
    spike_threshold: float
    n_observations: int
    mean_5d_return_pct: float | None
    win_rate: float | None  # fraction of events with positive 5d return


class MentionsResponse(BaseModel):
    snapshot_date: date | None
    snapshot_age_hours: float | None
    n_total: int
    rows: list[MentionRow]
    backtest: list[BacktestSlice] | None = None


# ---------- helpers ----------


def _audience_skew(by_sub: list[SubMentions]) -> Literal["wsb", "investing", "mixed", "unknown"]:
    """Classify by where the chatter concentrates. WSB-skew = degens; investing-
    skew = quality/boring; mixed = real broad interest."""
    if not by_sub:
        return "unknown"
    total = sum(s.mentions for s in by_sub) or 0
    if total == 0:
        return "unknown"
    wsb = next((s.mentions for s in by_sub if s.subreddit == "wallstreetbets"), 0)
    inv = sum(
        s.mentions for s in by_sub
        if s.subreddit in {"investing", "stocks", "SecurityAnalysis", "ValueInvesting"}
    )
    wsb_share = wsb / total
    inv_share = inv / total
    if wsb_share >= 0.7:
        return "wsb"
    if inv_share >= 0.7:
        return "investing"
    return "mixed"


def _momentum_slope(hist: list[int]) -> float | None:
    """Linear-regression slope over the last-N mention series, normalized by
    the series mean. Positive = chatter accelerating, negative = decaying.
    Returns None if the series is too short or flat at zero."""
    n = len(hist)
    if n < 3:
        return None
    mean_y = sum(hist) / n
    if mean_y == 0:
        return None
    # x is 0..n-1, y is hist
    mean_x = (n - 1) / 2.0
    num = sum((i - mean_x) * (hist[i] - mean_y) for i in range(n))
    den = sum((i - mean_x) ** 2 for i in range(n))
    if den == 0:
        return None
    slope = num / den
    return slope / mean_y  # normalized: +0.3 means ~+30% per day on the trend


# ---------- predictive scoring + rules ----------
#
# The composite score combines existing features into a single 0..100 view
# of "what's the expected 20d edge here?". Each component contributes a
# signed ~ -25..+25 to the score; baseline 50 = neutral. We then translate
# the score into a pred_return_20d_pct using a calibration constant (rough
# fit to the historical 5d backtest, extrapolated to 20d).
#
# Rules are coarse pattern flags. They are independently backtested via
# /v1/reddit/rules — the win rates returned there feed pred_confidence.

# A reasonable default win rate when a rule has no historical evidence
# yet (data is still accumulating). 0.55 lets the rule contribute mild
# confidence but not over-weight; once /rules returns real history this
# is overridden by the cached values.
_RULE_PRIOR_WIN_RATE: dict[str, float] = {
    "contrarian_top": 0.55,
    "stealth_setup": 0.55,
    "first_time_bull": 0.55,
    "wsb_only_hype": 0.55,
    "investing_accumulation": 0.55,
    "fading_hype": 0.55,
    "price_confirming_spike": 0.55,
}

# Sign of each rule's expected forward edge. +1 = bullish, -1 = bearish.
_RULE_SIGN: dict[str, int] = {
    "contrarian_top": -1,
    "stealth_setup": +1,
    "first_time_bull": +1,
    "wsb_only_hype": -1,
    "investing_accumulation": +1,
    "fading_hype": -1,
    "price_confirming_spike": +1,
}


def _clip(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def _score_components(
    spike: float | None,
    momentum: float | None,
    bull_share: float | None,
    n_kw_total: int,
    audience: str,
    price_1d: float | None,
    price_5d: float | None,
    mentions_6h: int,
    is_stealth: bool,
) -> ScoreComponents:
    """Map raw features → signed contributions. Tuned by hand to match the
    asymmetries the page calls out (stealth = positive edge, hype top = fade,
    investing-skew accumulation = positive, WSB-only = noisy).

    Each component is bounded so no single feature can dominate."""
    # SPIKE: small spikes (1–2x) are constructive; >3x is hype, gets fade.
    if spike is None:
        spike_c = 0.0
    elif spike <= 0.5:
        # very-low chatter relative to baseline — mildly bearish (interest dying)
        spike_c = -6.0
    elif spike <= 1.5:
        spike_c = +5.0 * (spike - 1.0) / 0.5  # +0 at 1x, +5 at 1.5x
    elif spike <= 3.0:
        spike_c = +5.0 - 8.0 * (spike - 1.5) / 1.5  # +5 → -3
    else:
        spike_c = -12.0  # 3x+ : crowded top
    spike_c = _clip(spike_c, -15.0, +12.0)

    # MOMENTUM: chatter trending up (slope > 0) is positive up to a point.
    if momentum is None:
        mom_c = 0.0
    else:
        mom_c = _clip(momentum * 30.0, -10.0, +10.0)

    # SENTIMENT: catalyst-keyword bull/bear share. Needs a few keywords to count.
    if bull_share is None or n_kw_total < 2:
        sent_c = 0.0
    else:
        sent_c = _clip((bull_share - 0.5) * 25.0, -12.0, +12.0)

    # AUDIENCE: investing-skew quality > mixed > wsb-only.
    aud_c = {"investing": +6.0, "mixed": +1.0, "wsb": -5.0, "unknown": 0.0}[audience]

    # PRICE CONFIRMATION: forward chatter + recent up-move is constructive;
    # chatter into a 5d down-move is the fade pattern.
    price_c = 0.0
    if price_5d is not None:
        price_c += _clip(price_5d * 0.4, -6.0, +6.0)
    if price_1d is not None:
        price_c += _clip(price_1d * 0.3, -3.0, +3.0)

    # FRESHNESS: live mentions in last 6h (above what Apewisdom 24h rolling
    # captures) signal incoming attention. Mild positive contribution.
    fresh_c = _clip(math.log(1 + mentions_6h) * 1.5, 0.0, +6.0)

    # STEALTH BONUS: low chatter + on-the-radar is the asymmetric setup.
    stealth_c = +8.0 if is_stealth else 0.0

    return ScoreComponents(
        spike=round(spike_c, 2),
        momentum=round(mom_c, 2),
        sentiment=round(sent_c, 2),
        audience=round(aud_c, 2),
        price_confirm=round(price_c, 2),
        freshness=round(fresh_c, 2),
        stealth_bonus=round(stealth_c, 2),
    )


def _detect_rules(
    spike: float | None,
    rank_today: int | None,
    is_stealth: bool,
    is_first_time: bool,
    audience: str,
    bull_share: float | None,
    n_kw_total: int,
    mentions_today: int,
    price_5d: float | None,
    momentum: float | None,
) -> list[str]:
    """Pattern flags. Stays in lockstep with _RULE_SIGN / _RULE_PRIOR_WIN_RATE
    above and the SQL in /v1/reddit/rules. Adding a rule? Update all three."""
    out: list[str] = []
    if spike is not None and spike >= 3.0 and rank_today is not None and rank_today <= 20:
        out.append("contrarian_top")
    if is_stealth:
        out.append("stealth_setup")
    if is_first_time and bull_share is not None and bull_share >= 0.6 and n_kw_total >= 2:
        out.append("first_time_bull")
    if (
        audience == "wsb"
        and spike is not None and spike >= 2.0
        and mentions_today >= 10
    ):
        out.append("wsb_only_hype")
    if (
        audience == "investing"
        and spike is not None and 1.2 <= spike <= 3.0
        and (bull_share is None or bull_share >= 0.4)
    ):
        out.append("investing_accumulation")
    if momentum is not None and momentum < -0.1 and spike is not None and spike < 0.8:
        out.append("fading_hype")
    if (
        spike is not None and spike >= 1.5
        and price_5d is not None and price_5d >= 2.0
        and (bull_share is None or bull_share >= 0.5)
    ):
        out.append("price_confirming_spike")
    return out


def _compose_signal(
    components: ScoreComponents,
    matched_rules: list[str],
    rule_win_rates: dict[str, float],
) -> tuple[float, float, PredictiveSignal, float]:
    """Combine score components + matched rules into:
      (pred_score 0..100, pred_return_20d_pct, pred_signal, pred_confidence)
    """
    raw = (
        components.spike
        + components.momentum
        + components.sentiment
        + components.audience
        + components.price_confirm
        + components.freshness
        + components.stealth_bonus
    )

    # Rule adjustment: each matched rule nudges raw by its sign × rule-strength.
    # The strength is anchored on the rule's historical win rate over a 50%
    # coin-flip baseline (so a 65% win-rate rule contributes ±3.0).
    rule_adj = 0.0
    for rule in matched_rules:
        wr = rule_win_rates.get(rule, _RULE_PRIOR_WIN_RATE.get(rule, 0.5))
        rule_adj += _RULE_SIGN.get(rule, 0) * (wr - 0.5) * 20.0

    composite = raw + rule_adj
    pred_score = _clip(50.0 + composite, 0.0, 100.0)

    # Calibration: a +30 composite ≈ +6% expected 20d return. Linear mapping
    # (chosen so the score range maps to ±10% in extremes — matches the
    # backtest endpoint's observed magnitudes when extrapolated to 20d).
    pred_return = composite * 0.2

    if pred_score >= 62:
        signal: PredictiveSignal = "buy"
    elif pred_score <= 38:
        signal = "fade"
    elif matched_rules:
        signal = "watch"
    else:
        signal = "neutral"

    # Confidence = mean of matched-rule win rates, shrunk toward 0.5 when no
    # rules match. Reflects "how much historical backing does this row have?"
    if matched_rules:
        mean_wr = sum(
            rule_win_rates.get(r, _RULE_PRIOR_WIN_RATE.get(r, 0.5)) for r in matched_rules
        ) / len(matched_rules)
        # Distance from coin-flip → 0..1 confidence
        confidence = _clip(abs(mean_wr - 0.5) * 2.0, 0.0, 1.0)
    else:
        confidence = 0.1  # nothing matched → very low conviction by definition

    return pred_score, pred_return, signal, round(confidence, 3)


# ---------- /mentions ----------


@router.get("/mentions", response_model=MentionsResponse)
async def get_mentions(
    limit: int = Query(60, ge=1, le=300),
    sort: Literal[
        "mentions", "spike", "rank_change", "momentum", "predicted",
    ] = Query("mentions"),
    q: str | None = Query(None, description="Ticker prefix search (case-insensitive)"),
    sector: str | None = Query(None, description="Filter to tickers in this watchlist sector"),
    exclude_meme: bool = Query(False, description="Drop perma-WSB names (GME, AMC, …)"),
    watchlist: bool = Query(False, description="Restrict to tickers in the latest watchlists run"),
    backtest: bool = Query(False, description="Include 5d forward-return aggregates by spike bucket"),
) -> MentionsResponse:
    pool = get_pool()

    main_sql = """
        WITH latest AS (
            SELECT MAX(snapshot_date) AS d FROM reddit_mentions WHERE subreddit = 'all-stocks'
        ),
        today AS (
            SELECT * FROM reddit_mentions, latest
            WHERE subreddit = 'all-stocks' AND snapshot_date = latest.d
        ),
        avg7 AS (
            SELECT ticker, AVG(mentions)::float AS avg_m
            FROM reddit_mentions
            WHERE subreddit = 'all-stocks'
              AND snapshot_date BETWEEN (SELECT d FROM latest) - 7
                                    AND (SELECT d FROM latest) - 1
            GROUP BY ticker
        ),
        rank_7d AS (
            SELECT DISTINCT ON (ticker) ticker, rank AS rank_7d_ago
            FROM reddit_mentions
            WHERE subreddit = 'all-stocks'
              AND snapshot_date <= (SELECT d FROM latest) - 7
            ORDER BY ticker, snapshot_date DESC
        ),
        spark AS (
            SELECT ticker, ARRAY_AGG(mentions ORDER BY snapshot_date) AS hist
            FROM reddit_mentions
            WHERE subreddit = 'all-stocks'
              AND snapshot_date >= (SELECT d FROM latest) - 6
            GROUP BY ticker
        ),
        days_top20 AS (
            SELECT ticker, COUNT(*)::int AS n
            FROM reddit_mentions
            WHERE subreddit = 'all-stocks'
              AND snapshot_date >= (SELECT d FROM latest) - 13
              AND rank IS NOT NULL AND rank <= 20
            GROUP BY ticker
        ),
        prior_30d AS (
            SELECT ticker, COUNT(*)::int AS n_appearances
            FROM reddit_mentions
            WHERE subreddit = 'all-stocks'
              AND snapshot_date BETWEEN (SELECT d FROM latest) - 30
                                    AND (SELECT d FROM latest) - 1
              AND rank IS NOT NULL AND rank <= 100
            GROUP BY ticker
        )
        SELECT
          t.ticker, t.name, t.mentions, t.upvotes, t.rank, t.last_fetched,
          a.avg_m, r.rank_7d_ago, s.hist,
          COALESCE(d.n, 0) AS days_top20_14d,
          COALESCE(p.n_appearances, 0) AS prior_appearances_30d
        FROM today t
        LEFT JOIN avg7 a       ON a.ticker = t.ticker
        LEFT JOIN rank_7d r    ON r.ticker = t.ticker
        LEFT JOIN spark s      ON s.ticker = t.ticker
        LEFT JOIN days_top20 d ON d.ticker = t.ticker
        LEFT JOIN prior_30d p  ON p.ticker = t.ticker
        ORDER BY t.mentions DESC
    """

    sub_sql = """
        SELECT ticker, subreddit, mentions, rank
        FROM reddit_mentions
        WHERE subreddit <> 'all-stocks'
          AND ticker = ANY($1::text[])
          AND snapshot_date = (
            SELECT MAX(snapshot_date) FROM reddit_mentions WHERE subreddit='all-stocks'
          )
    """

    # Sector lookup uses the latest watchlists run.
    sector_sql = """
        WITH last_run AS (SELECT MAX(run_ts) AS rt FROM watchlists)
        SELECT ticker, sector
        FROM watchlists
        WHERE run_ts = (SELECT rt FROM last_run)
          AND ticker = ANY($1::text[])
    """

    # Watchlist allowlist (latest run only).
    watchlist_sql = """
        WITH last_run AS (SELECT MAX(run_ts) AS rt FROM watchlists)
        SELECT DISTINCT ticker FROM watchlists WHERE run_ts = (SELECT rt FROM last_run)
    """

    # Catalyst-keyword aggregates over the last 7d.
    # NOTE: we unnest both tickers AND keywords and ARRAY_AGG the scalar `kw`.
    # Aggregating `keywords` directly yields a 2-D text array which postgres
    # rejects when posts have different keyword counts ("cannot accumulate
    # arrays of different dimensionality"). Counting posts requires
    # COUNT(DISTINCT id) since the keyword unnest multiplies rows.
    posts_sql = """
        SELECT t AS ticker,
               COUNT(DISTINCT p.id) FILTER (WHERE p.created_at >= NOW() - INTERVAL '48 hours') AS n_48h,
               COUNT(DISTINCT p.id) FILTER (WHERE p.created_at >= NOW() - INTERVAL '6 hours') AS n_6h,
               ARRAY_AGG(kw) AS kws_flat
        FROM reddit_posts p, UNNEST(p.tickers) AS t, UNNEST(p.keywords) AS kw
        WHERE p.created_at >= NOW() - INTERVAL '7 days'
          AND t = ANY($1::text[])
        GROUP BY t
    """

    # Prices: for each ticker, get latest 6 closes (most recent first).
    prices_sql = """
        WITH ranked AS (
            SELECT symbol, ts, close,
                   ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY ts DESC) AS rn
            FROM prices_daily
            WHERE symbol = ANY($1::text[])
              AND ts >= NOW() - INTERVAL '20 days'
        )
        SELECT symbol,
               MAX(close) FILTER (WHERE rn = 1) AS px0,
               MAX(close) FILTER (WHERE rn = 2) AS px_1,
               MAX(close) FILTER (WHERE rn = 6) AS px_5
        FROM ranked
        GROUP BY symbol
    """

    async with pool.acquire() as conn:
        rows = await conn.fetch(main_sql)
        all_tickers = [r["ticker"] for r in rows]
        if not all_tickers:
            return MentionsResponse(
                snapshot_date=None,
                snapshot_age_hours=None,
                n_total=0,
                rows=[],
                backtest=None,
            )

        # All look-ups bounded to the universe of tickers we actually have today.
        sub_rows = await conn.fetch(sub_sql, all_tickers)
        sec_rows = await conn.fetch(sector_sql, all_tickers)
        post_rows = await conn.fetch(posts_sql, all_tickers)
        price_rows = await conn.fetch(prices_sql, all_tickers)
        wl_rows: list = []
        if watchlist:
            wl_rows = await conn.fetch(watchlist_sql)

    # Index lookup tables.
    by_ticker_subs: dict[str, list[SubMentions]] = {}
    for r in sub_rows:
        by_ticker_subs.setdefault(r["ticker"], []).append(SubMentions(
            subreddit=r["subreddit"],
            mentions=int(r["mentions"] or 0),
            rank=int(r["rank"]) if r["rank"] is not None else None,
        ))

    sector_map: dict[str, str] = {r["ticker"]: r["sector"] for r in sec_rows}

    sentiment_map: dict[str, tuple[int, int, int, int]] = {}
    # ticker -> (n_bullish_kw, n_bearish_kw, catalyst_post_count_48h, mentions_last_6h)
    for r in post_rows:
        n_bull = 0
        n_bear = 0
        for kw in (r["kws_flat"] or []):
            if kw in _BULLISH_KEYWORDS:
                n_bull += 1
            elif kw in _BEARISH_KEYWORDS:
                n_bear += 1
        sentiment_map[r["ticker"]] = (
            n_bull,
            n_bear,
            int(r["n_48h"] or 0),
            int(r["n_6h"] or 0),
        )

    price_map: dict[str, tuple[float | None, float | None, float | None]] = {}
    for r in price_rows:
        price_map[r["symbol"]] = (
            float(r["px0"]) if r["px0"] is not None else None,
            float(r["px_1"]) if r["px_1"] is not None else None,
            float(r["px_5"]) if r["px_5"] is not None else None,
        )

    wl_set: set[str] | None = {r["ticker"] for r in wl_rows} if watchlist else None

    # Rule win-rate cache — used by _compose_signal to weight matched rules
    # by their historical edge. Cheap one-shot, swallowed on failure so
    # the page still works when no history is accumulated yet.
    rule_win_rates_cache: dict[str, float] = await _rule_win_rates_cached()

    # Snapshot freshness.
    snapshot_date: date | None = None
    snapshot_age_hours: float | None = None
    if rows:
        first = rows[0]
        d = first["last_fetched"]
        if isinstance(d, datetime):
            d_aware = d if d.tzinfo else d.replace(tzinfo=UTC)
            snapshot_age_hours = max(0.0, (datetime.now(UTC) - d_aware).total_seconds() / 3600)
        async with pool.acquire() as conn:
            sd = await conn.fetchval(
                "SELECT MAX(snapshot_date) FROM reddit_mentions WHERE subreddit='all-stocks'"
            )
            if sd:
                snapshot_date = sd if isinstance(sd, date) else datetime.fromisoformat(str(sd)).date()

    # Build rows.
    out: list[MentionRow] = []
    q_upper = (q or "").strip().upper()

    for r in rows:
        ticker = r["ticker"]

        if q_upper and not ticker.startswith(q_upper):
            continue
        if exclude_meme and ticker in _MEME_TICKERS:
            continue
        if sector and sector_map.get(ticker) != sector:
            continue
        if wl_set is not None and ticker not in wl_set:
            continue

        mentions_today = int(r["mentions"] or 0)
        avg_m = float(r["avg_m"] or 0.0)
        spike = (mentions_today / avg_m) if avg_m > 0 else None
        rank_today = int(r["rank"]) if r["rank"] is not None else None
        rank_7d_ago = int(r["rank_7d_ago"]) if r["rank_7d_ago"] is not None else None
        rank_change = (
            rank_today - rank_7d_ago
            if (rank_today is not None and rank_7d_ago is not None)
            else None
        )
        contrarian = (
            spike is not None and spike > 3.0
            and rank_today is not None and rank_today <= 20
        )
        stealth = mentions_today < 5 and (rank_today is None or rank_today > 100)
        hist = [int(x or 0) for x in (r["hist"] or [])]
        is_first_time = int(r["prior_appearances_30d"] or 0) == 0 and rank_today is not None and rank_today <= 100

        subs = by_ticker_subs.get(ticker, [])
        skew = _audience_skew(subs)

        n_bull, n_bear, n_48h, n_6h = sentiment_map.get(ticker, (0, 0, 0, 0))
        bull_share: float | None
        if n_bull + n_bear == 0:
            bull_share = None
        else:
            bull_share = n_bull / (n_bull + n_bear)

        px0, px1, px5 = price_map.get(ticker, (None, None, None))
        chg_1d = ((px0 - px1) / px1 * 100.0) if (px0 is not None and px1) else None
        chg_5d = ((px0 - px5) / px5 * 100.0) if (px0 is not None and px5) else None

        momentum = _momentum_slope(hist)

        # --- predictive layer ---
        components = _score_components(
            spike=spike,
            momentum=momentum,
            bull_share=bull_share,
            n_kw_total=n_bull + n_bear,
            audience=skew,
            price_1d=chg_1d,
            price_5d=chg_5d,
            mentions_6h=n_6h,
            is_stealth=stealth,
        )
        matched = _detect_rules(
            spike=spike,
            rank_today=rank_today,
            is_stealth=stealth,
            is_first_time=is_first_time,
            audience=skew,
            bull_share=bull_share,
            n_kw_total=n_bull + n_bear,
            mentions_today=mentions_today,
            price_5d=chg_5d,
            momentum=momentum,
        )
        pred_score, pred_return, pred_signal, pred_conf = _compose_signal(
            components, matched, rule_win_rates_cache,
        )

        out.append(MentionRow(
            ticker=ticker,
            name=r["name"],
            sector=sector_map.get(ticker),
            mentions_today=mentions_today,
            mentions_7d_avg=avg_m,
            spike_ratio=spike,
            rank_today=rank_today,
            rank_7d_ago=rank_7d_ago,
            rank_change_7d=rank_change,
            upvotes_today=int(r["upvotes"] or 0),
            is_contrarian_warning=contrarian,
            is_stealth=stealth,
            is_first_time_entrant=is_first_time,
            is_meme=ticker in _MEME_TICKERS,
            sparkline_7d=hist,
            by_subreddit=subs,
            audience_skew=skew,
            momentum_score=momentum,
            days_in_top20_14d=int(r["days_top20_14d"] or 0),
            sentiment_bull_share=bull_share,
            n_bullish_kw=n_bull,
            n_bearish_kw=n_bear,
            price_change_1d=chg_1d,
            price_change_5d=chg_5d,
            catalyst_post_count=n_48h,
            mentions_last_6h=n_6h,
            pred_score=round(pred_score, 1),
            pred_return_20d_pct=round(pred_return, 2),
            pred_signal=pred_signal,
            pred_confidence=pred_conf,
            score_components=components,
            matched_rules=list(matched),  # type: ignore[arg-type]
        ))

    if sort == "mentions":
        out.sort(key=lambda r: -r.mentions_today)
    elif sort == "spike":
        out.sort(key=lambda r: -(r.spike_ratio or 0))
    elif sort == "rank_change":
        out.sort(key=lambda r: r.rank_change_7d if r.rank_change_7d is not None else 999)
    elif sort == "momentum":
        out.sort(key=lambda r: -(r.momentum_score or -math.inf))
    elif sort == "predicted":
        # Best predicted edge first. Tie-break on confidence so well-
        # backed signals beat heuristic-only rows of the same score.
        out.sort(key=lambda r: (-r.pred_score, -r.pred_confidence))

    backtest_slices: list[BacktestSlice] | None = None
    if backtest:
        backtest_slices = await _compute_backtest()

    return MentionsResponse(
        snapshot_date=snapshot_date,
        snapshot_age_hours=snapshot_age_hours,
        n_total=len(out),
        rows=out[:limit],
        backtest=backtest_slices,
    )


# ---------- /backtest ----------


async def _compute_backtest() -> list[BacktestSlice]:
    """Mean 5d forward return for tickers whose mention count spiked above
    each threshold. Cheap one-shot — runs over the last 60d of snapshots."""
    pool = get_pool()
    sql = """
        WITH events AS (
            SELECT m.ticker, m.snapshot_date, m.mentions,
                   AVG(m2.mentions) AS avg7
            FROM reddit_mentions m
            JOIN reddit_mentions m2
              ON m2.ticker = m.ticker
             AND m2.subreddit = 'all-stocks'
             AND m2.snapshot_date BETWEEN m.snapshot_date - 7 AND m.snapshot_date - 1
            WHERE m.subreddit = 'all-stocks'
              AND m.snapshot_date >= CURRENT_DATE - 60
              AND m.snapshot_date <= CURRENT_DATE - 5
            GROUP BY m.ticker, m.snapshot_date, m.mentions
        ),
        priced AS (
            SELECT e.ticker, e.snapshot_date, e.mentions, e.avg7,
                   (e.mentions::float / NULLIF(e.avg7, 0)) AS spike,
                   p0.close AS px0,
                   p5.close AS px5
            FROM events e
            LEFT JOIN LATERAL (
                SELECT close FROM prices_daily
                WHERE symbol = e.ticker AND ts::date <= e.snapshot_date
                ORDER BY ts DESC LIMIT 1
            ) p0 ON true
            LEFT JOIN LATERAL (
                SELECT close FROM prices_daily
                WHERE symbol = e.ticker AND ts::date <= e.snapshot_date + 5
                ORDER BY ts DESC LIMIT 1
            ) p5 ON true
            WHERE p0.close IS NOT NULL AND p5.close IS NOT NULL
        )
        SELECT
          COUNT(*) AS n,
          AVG((px5 - px0) / px0 * 100.0) AS mean_5d,
          AVG(CASE WHEN px5 > px0 THEN 1.0 ELSE 0.0 END) AS win_rate,
          (CASE
            WHEN spike >= 5.0 THEN 5.0
            WHEN spike >= 3.0 THEN 3.0
            WHEN spike >= 1.5 THEN 1.5
            ELSE 0.0
          END) AS bucket
        FROM priced
        WHERE spike IS NOT NULL
        GROUP BY bucket
        ORDER BY bucket
    """
    async with pool.acquire() as conn:
        try:
            rows = await conn.fetch(sql)
        except Exception as e:
            log.warning("backtest query failed: %s", e)
            return []

    out: list[BacktestSlice] = []
    for r in rows:
        bucket = float(r["bucket"] or 0)
        if bucket == 0.0:
            continue  # skip the no-spike base bucket — confounds the lift signal
        out.append(BacktestSlice(
            spike_threshold=bucket,
            n_observations=int(r["n"] or 0),
            mean_5d_return_pct=float(r["mean_5d"]) if r["mean_5d"] is not None else None,
            win_rate=float(r["win_rate"]) if r["win_rate"] is not None else None,
        ))
    return out


@router.get("/backtest", response_model=list[BacktestSlice])
async def get_backtest() -> list[BacktestSlice]:
    """Standalone endpoint for the same backtest stats so the front-end can
    lazy-load it without slowing the main /mentions request."""
    return await _compute_backtest()


# ---------- /rules: per-pattern 20d backtest ----------


class RuleStats(BaseModel):
    """Backtested win rate + mean 20d forward return for a named pattern.

    A row was "matched" on a given (snapshot_date, ticker) if the pattern's
    SQL predicate evaluated true for that snapshot. Forward return is the
    20-trading-day close-to-close move after the snapshot. n_events is the
    count of matched (date, ticker) pairs. Until ≥20 events accumulate the
    UI displays this as "calibrating"."""
    rule_id: RuleId
    description: str
    expected_direction: Literal["long", "short"]
    n_events: int
    win_rate: float | None
    mean_20d_return_pct: float | None
    edge_vs_baseline_pct: float | None  # mean_20d − baseline mean 20d return


# SQL predicates for each rule. Kept close to _detect_rules logic. The
# events query lateral-joins onto avg7 / rank_24h / etc so the predicate
# can use the same enriched view that the live scorer does.
_RULE_PREDICATES: dict[str, tuple[str, str, Literal["long", "short"]]] = {
    "contrarian_top": (
        "Crowded top: spike ≥ 3× and rank ≤ 20 → expect fade.",
        "spike >= 3.0 AND rank <= 20",
        "short",
    ),
    "stealth_setup": (
        "Stealth: low chatter, off the radar — asymmetric setup.",
        "mentions < 5 AND (rank IS NULL OR rank > 100)",
        "long",
    ),
    "first_time_bull": (
        "First-time entrant: no top-100 appearance in prior 30d.",
        "prior_30d_n = 0 AND rank IS NOT NULL AND rank <= 100",
        "long",
    ),
    "wsb_only_hype": (
        "WSB-only hype: spike ≥ 2× from wallstreetbets alone.",
        "wsb_share >= 0.7 AND spike >= 2.0 AND mentions >= 10",
        "short",
    ),
    "investing_accumulation": (
        "Investing-skew accumulation: quality subs noticing the name.",
        "inv_share >= 0.7 AND spike BETWEEN 1.2 AND 3.0",
        "long",
    ),
    "fading_hype": (
        "Fading hype: chatter decaying (spike < 0.8, momentum negative).",
        "spike < 0.8 AND momentum_slope < -0.1",
        "short",
    ),
    "price_confirming_spike": (
        "Spike + 5d price up: retail chasing a real move.",
        "spike >= 1.5 AND price_5d_pct >= 2.0",
        "long",
    ),
}


# 20 trading days ≈ 28 calendar days; using a hard 28-day window is the
# pragmatic match given prices_daily is daily and we want the lateral
# joins to stay cheap (no row_number windowing).
_RULES_BACKTEST_SQL = """
WITH bounds AS (
    SELECT MAX(snapshot_date) AS d_max FROM reddit_mentions WHERE subreddit='all-stocks'
),
events AS (
    SELECT
        m.snapshot_date, m.ticker, m.mentions, m.rank,
        a.avg_m,
        (m.mentions::float / NULLIF(a.avg_m, 0)) AS spike,
        COALESCE((
            SELECT SUM(sm.mentions)::float / NULLIF(SUM(SUM(sm.mentions)) OVER (), 0)
            FROM reddit_mentions sm
            WHERE sm.snapshot_date = m.snapshot_date AND sm.ticker = m.ticker
              AND sm.subreddit = 'wallstreetbets'
            GROUP BY sm.snapshot_date, sm.ticker
        ), 0) AS wsb_share,
        COALESCE((
            SELECT SUM(sm.mentions)::float / NULLIF(SUM(SUM(sm.mentions)) OVER (), 0)
            FROM reddit_mentions sm
            WHERE sm.snapshot_date = m.snapshot_date AND sm.ticker = m.ticker
              AND sm.subreddit IN ('investing','stocks','SecurityAnalysis','ValueInvesting')
            GROUP BY sm.snapshot_date, sm.ticker
        ), 0) AS inv_share,
        COALESCE((
            SELECT COUNT(*)::int FROM reddit_mentions p
            WHERE p.subreddit='all-stocks' AND p.ticker = m.ticker
              AND p.snapshot_date BETWEEN m.snapshot_date - 30 AND m.snapshot_date - 1
              AND p.rank IS NOT NULL AND p.rank <= 100
        ), 0) AS prior_30d_n,
        -- 7d trailing mention slope, normalized by mean (matches the python
        -- _momentum_slope helper). Returns NULL when <3 observations.
        (
            SELECT CASE
                WHEN COUNT(*) < 3 OR AVG(mentions) = 0 THEN NULL
                ELSE
                    REGR_SLOPE(mentions::float, EXTRACT(EPOCH FROM snapshot_date)::float / 86400.0)
                    / NULLIF(AVG(mentions), 0)
            END
            FROM reddit_mentions s
            WHERE s.subreddit='all-stocks' AND s.ticker = m.ticker
              AND s.snapshot_date BETWEEN m.snapshot_date - 6 AND m.snapshot_date
        ) AS momentum_slope
    FROM reddit_mentions m
    JOIN bounds b ON true
    LEFT JOIN LATERAL (
        SELECT AVG(mentions)::float AS avg_m
        FROM reddit_mentions
        WHERE subreddit='all-stocks' AND ticker = m.ticker
          AND snapshot_date BETWEEN m.snapshot_date - 7 AND m.snapshot_date - 1
    ) a ON true
    WHERE m.subreddit='all-stocks'
      AND m.snapshot_date <= b.d_max - 28
      AND m.snapshot_date >= b.d_max - 365
),
priced AS (
    SELECT e.*,
           p0.close AS px0,
           pf.close AS pxf,
           p5b.close AS px_5d_back,
           pb.close AS px0_baseline,
           pbf.close AS pxf_baseline
    FROM events e
    LEFT JOIN LATERAL (
        SELECT close FROM prices_daily
        WHERE symbol = e.ticker AND ts::date <= e.snapshot_date
        ORDER BY ts DESC LIMIT 1
    ) p0 ON true
    LEFT JOIN LATERAL (
        SELECT close FROM prices_daily
        WHERE symbol = e.ticker AND ts::date <= e.snapshot_date + 28
        ORDER BY ts DESC LIMIT 1
    ) pf ON true
    LEFT JOIN LATERAL (
        SELECT close FROM prices_daily
        WHERE symbol = e.ticker AND ts::date <= e.snapshot_date - 5
        ORDER BY ts DESC LIMIT 1
    ) p5b ON true
    LEFT JOIN LATERAL (
        SELECT close FROM prices_daily
        WHERE symbol = 'SPY' AND ts::date <= e.snapshot_date
        ORDER BY ts DESC LIMIT 1
    ) pb ON true
    LEFT JOIN LATERAL (
        SELECT close FROM prices_daily
        WHERE symbol = 'SPY' AND ts::date <= e.snapshot_date + 28
        ORDER BY ts DESC LIMIT 1
    ) pbf ON true
    WHERE p0.close IS NOT NULL AND pf.close IS NOT NULL
),
enriched AS (
    SELECT
        *,
        (pxf - px0) / px0 * 100.0 AS ret_20d,
        CASE
            WHEN px_5d_back IS NOT NULL AND px_5d_back > 0
            THEN (px0 - px_5d_back) / px_5d_back * 100.0
            ELSE NULL
        END AS price_5d_pct,
        CASE
            WHEN px0_baseline IS NOT NULL AND pxf_baseline IS NOT NULL
            THEN (pxf_baseline - px0_baseline) / px0_baseline * 100.0
            ELSE NULL
        END AS spy_ret_20d
    FROM priced
)
SELECT
    COUNT(*) AS n_events,
    AVG(ret_20d) AS mean_ret,
    AVG(CASE WHEN ret_20d > 0 THEN 1.0 ELSE 0.0 END) AS win_rate,
    AVG(spy_ret_20d) AS mean_spy_ret
FROM enriched
WHERE {predicate}
"""


# In-process cache for the rule win-rate table. SQL is expensive to run on
# every /mentions request; the values change only when fresh snapshots
# land, so a 10-minute TTL is plenty.
_rule_cache: dict[str, tuple[float, dict[str, float]]] = {}
_RULE_CACHE_TTL_SEC = 600.0


async def _rule_win_rates_cached() -> dict[str, float]:
    """Return {rule_id: win_rate} for the live scorer. Falls back to priors
    when the SQL has no events (no accumulated history) or errors out."""
    import time
    now = time.monotonic()
    cached = _rule_cache.get("v1")
    if cached and (now - cached[0]) < _RULE_CACHE_TTL_SEC:
        return cached[1]
    try:
        stats = await _compute_rule_stats()
    except Exception as e:  # pragma: no cover — defensive
        log.warning("rule stats query failed: %s", e)
        return dict(_RULE_PRIOR_WIN_RATE)
    out = dict(_RULE_PRIOR_WIN_RATE)
    for s in stats:
        if s.win_rate is not None and s.n_events >= 5:
            out[s.rule_id] = s.win_rate
    _rule_cache["v1"] = (now, out)
    return out


async def _compute_rule_stats() -> list[RuleStats]:
    pool = get_pool()
    out: list[RuleStats] = []
    async with pool.acquire() as conn:
        for rule_id in RULE_IDS:
            desc, predicate, direction = _RULE_PREDICATES[rule_id]
            sql = _RULES_BACKTEST_SQL.format(predicate=predicate)
            try:
                row = await conn.fetchrow(sql)
            except Exception as e:
                log.warning("rule '%s' backtest failed: %s", rule_id, e)
                row = None
            n_events = int(row["n_events"] or 0) if row else 0
            mean_ret = float(row["mean_ret"]) if row and row["mean_ret"] is not None else None
            win_rate = float(row["win_rate"]) if row and row["win_rate"] is not None else None
            mean_spy = float(row["mean_spy_ret"]) if row and row["mean_spy_ret"] is not None else None
            edge = (mean_ret - mean_spy) if (mean_ret is not None and mean_spy is not None) else None
            out.append(RuleStats(
                rule_id=rule_id,  # type: ignore[arg-type]
                description=desc,
                expected_direction=direction,
                n_events=n_events,
                win_rate=win_rate,
                mean_20d_return_pct=mean_ret,
                edge_vs_baseline_pct=edge,
            ))
    return out


@router.get("/rules", response_model=list[RuleStats])
async def get_rule_stats() -> list[RuleStats]:
    """Backtested historical edge for every predictive rule. Used by the UI
    to show how much past evidence backs each matched-rule chip on a row."""
    return await _compute_rule_stats()


# ---------- /predict: ML model output ----------


class ModelPrediction(BaseModel):
    """One row in the latest `reddit_predictions` snapshot.

    pred_return_20d is the model's raw expected 20-trading-day return in
    percent. pred_score is a 0..100 percentile rank within the snapshot
    (anchors the UI badge across model versions / scales). Features is
    the raw input vector — useful for debugging / explanation hovers."""
    ticker: str
    pred_return_20d_pct: float | None
    pred_score: float | None
    features: dict | None


class PredictResponse(BaseModel):
    """Wrapper around the latest model predictions. status='calibrating'
    when /reddit_predictions is empty (i.e. not enough matured history
    yet to fit the model — see predict_reddit._MIN_TRAIN_EVENTS)."""
    status: Literal["ok", "calibrating"]
    snapshot_date: date | None
    model_version: str | None
    trained_at: datetime | None
    n_predictions: int
    predictions: list[ModelPrediction]


@router.get("/predict", response_model=PredictResponse)
async def get_predictions(
    limit: int = Query(60, ge=1, le=500),
    sort: Literal["pred_return", "pred_score"] = Query("pred_score"),
) -> PredictResponse:
    """Return the latest ML predictions (one row per ticker for the most
    recent snapshot). Calibrating until the model has enough matured
    history to train responsibly."""
    pool = get_pool()
    async with pool.acquire() as conn:
        latest = await conn.fetchrow("""
            SELECT snapshot_date, model_version, MAX(trained_at) AS trained_at
            FROM reddit_predictions
            WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM reddit_predictions)
            GROUP BY snapshot_date, model_version
            ORDER BY trained_at DESC
            LIMIT 1
        """)
        if latest is None:
            return PredictResponse(
                status="calibrating",
                snapshot_date=None,
                model_version=None,
                trained_at=None,
                n_predictions=0,
                predictions=[],
            )
        order_clause = "pred_score DESC NULLS LAST" if sort == "pred_score" else "pred_return_20d DESC NULLS LAST"
        rows = await conn.fetch(
            f"""
                SELECT ticker, pred_return_20d, pred_score, features
                FROM reddit_predictions
                WHERE snapshot_date = $1 AND model_version = $2
                ORDER BY {order_clause}
                LIMIT $3
            """,
            latest["snapshot_date"], latest["model_version"], limit,
        )

    return PredictResponse(
        status="ok",
        snapshot_date=latest["snapshot_date"],
        model_version=latest["model_version"],
        trained_at=latest["trained_at"],
        n_predictions=len(rows),
        predictions=[
            ModelPrediction(
                ticker=r["ticker"],
                pred_return_20d_pct=float(r["pred_return_20d"]) if r["pred_return_20d"] is not None else None,
                pred_score=float(r["pred_score"]) if r["pred_score"] is not None else None,
                features=r["features"],
            )
            for r in rows
        ],
    )


# ---------- catalyst-keyword feed ----------


class CatalystScoreBreakdown(BaseModel):
    """Components of the composite catalyst_score so the UI can show *why*
    a post scored highly. The stored score is frozen at ingest, so these are
    derived from the formula using the post's current hours_old + ticker /
    keyword counts; trust is inferred as the residual."""
    base: float            # min(log(1+n_t)*log(1+n_k)/3, 1) — breadth factor
    recency: float         # 1.0 (≤6h) decaying linearly to 0.2 (≥48h)
    trust: float | None    # author-trust factor, inferred from score / (base*recency)
    n_tickers: int
    n_keywords: int


class CatalystPost(BaseModel):
    id: str
    created_at: datetime
    subreddit: str
    author: str | None
    title: str
    permalink: str | None
    tickers: list[str]
    keywords: list[str]
    catalyst_score: float
    hours_old: float
    # Engagement (best-effort from RSS — may be 0 for very fresh posts)
    upvotes: int | None
    num_comments: int | None
    # Score breakdown
    score_breakdown: CatalystScoreBreakdown
    # Price reaction for the *first* (lead) ticker. Daily granularity only —
    # `prices_daily` is the finest source we have. Returns are in percent.
    lead_ticker: str | None
    price_at_post: float | None          # close on/before created_at
    price_next_day: float | None         # next trading day close
    price_now: float | None              # latest close
    return_next_day_pct: float | None    # (price_next_day / price_at_post - 1) * 100
    return_since_post_pct: float | None  # (price_now / price_at_post - 1) * 100


class CatalystsResponse(BaseModel):
    n_total: int
    posts: list[CatalystPost]


def _score_breakdown(
    n_tickers: int,
    n_keywords: int,
    hours_old: float,
    stored_score: float,
) -> CatalystScoreBreakdown:
    """Reconstruct score components from the same formula used at ingest
    (apps/jobs/.../reddit_rss.py:_catalyst_score). `trust` is the residual
    once base + recency are factored out — exact for the frozen stored
    score even though hours_old has drifted since ingest."""
    if n_tickers == 0 or n_keywords == 0:
        return CatalystScoreBreakdown(
            base=0.0, recency=0.0, trust=None,
            n_tickers=n_tickers, n_keywords=n_keywords,
        )
    base = min(math.log(1 + n_tickers) * math.log(1 + n_keywords) / 3.0, 1.0)
    if hours_old <= 6:
        recency = 1.0
    elif hours_old >= 48:
        recency = 0.2
    else:
        recency = 1.0 - 0.8 * (hours_old - 6) / 42.0
    trust: float | None = None
    denom = base * recency
    if denom > 1e-9:
        t = stored_score / denom
        # Trust is bounded 0.5..1.0 by construction; clamp to that range.
        trust = max(0.5, min(1.0, t))
    return CatalystScoreBreakdown(
        base=base, recency=recency, trust=trust,
        n_tickers=n_tickers, n_keywords=n_keywords,
    )


# Per-category track record — mirrors the client classifier at
# apps/web/lib/catalyst-categories.ts. Keep these rule lists in sync.
# Order matters: more specific buckets first so e.g. "fda approval" lands in
# `regulatory` instead of `partnership`.
_CATALYST_CATEGORY_RULES: list[tuple[str, tuple[str, ...]]] = [
    ("regulatory", (
        "fda", "approval", "approved", "clinical", "trial", "phase 3",
        "phase 2", "phase iii", "phase ii", "recall", "doj", "antitrust",
        "lawsuit", "sued", "settlement", "ftc", "sec", "investigation",
        "subpoena",
    )),
    ("earnings", (
        "earnings", "beat", "miss", "missed", "guidance", "guide", "guides",
        "eps", "revenue", "raised guidance", "lowered guidance", "raises",
        "lowered", "preannounce", "pre-announce",
    )),
    ("insider", (
        "insider", "form 4", "13d", "13g", "ceo sell", "cfo sell", "ceo buy",
        "insider buy", "insider sell",
    )),
    ("mna", (
        "acquisition", "acquire", "acquires", "acquired", "merger", "merge",
        "buyout", "takeover", "take private", "spinoff", "spin-off",
    )),
    ("partnership", (
        "partnership", "partner", "partners", "deal", "contract", "awarded",
        "supplier", "win", "wins",
    )),
    ("product", (
        "launch", "launches", "release", "released", "unveil", "unveils",
        "announce", "announces", "announced", "reveal", "reveals", "rollout",
    )),
    ("leak", (
        "leak", "leaked", "rumor", "rumored", "scoop", "alleged", "report",
        "reports", "sources say", "according to sources",
    )),
]


def _classify_primary_category(keywords: list[str]) -> str:
    """Returns the first matching category, or 'other' if no rule matches."""
    if not keywords:
        return "other"
    lowered = [k.lower() for k in keywords]
    for cat_id, tokens in _CATALYST_CATEGORY_RULES:
        for t in tokens:
            if any(k == t or t in k for k in lowered):
                return cat_id
    return "other"


class CategoryTrackRecord(BaseModel):
    """Backtest of a single catalyst category over the lookback window.

    Hit rate = fraction of posts with positive +1d return. Avg returns are
    in percent. n_with_return excludes posts that haven't seen the next
    trading day close yet (very recent posts, weekends)."""
    category: str
    n_posts: int           # total catalyst posts classified into this bucket
    n_with_return: int     # subset with a usable +1d return
    hit_rate: float | None
    avg_return_next_day_pct: float | None
    median_return_next_day_pct: float | None
    avg_return_since_post_pct: float | None


class CatalystTrackRecordResponse(BaseModel):
    window_days: int
    n_total_posts: int
    n_total_with_return: int
    overall_hit_rate: float | None
    overall_avg_return_next_day_pct: float | None
    categories: list[CategoryTrackRecord]


@router.get("/catalyst-track-record", response_model=CatalystTrackRecordResponse)
async def get_catalyst_track_record(
    days: int = Query(30, ge=1, le=180, description="Lookback window in days"),
    min_score: float = Query(0.05, ge=0.0, le=1.0),
) -> CatalystTrackRecordResponse:
    """Per-category hit rate and average next-trading-day return for
    catalyst-flagged Reddit posts. Lets the UI show whether the signal has
    measurable edge before users trust the live feed."""
    pool = get_pool()
    sql = """
        SELECT
            p.keywords,
            p0.close AS price_at_post,
            p1.close AS price_next_day,
            pnow.close AS price_now
        FROM reddit_posts p
        LEFT JOIN LATERAL (
            SELECT close FROM prices_daily
            WHERE p.tickers IS NOT NULL AND array_length(p.tickers, 1) > 0
              AND symbol = p.tickers[1]
              AND ts <= p.created_at
            ORDER BY ts DESC LIMIT 1
        ) p0 ON true
        LEFT JOIN LATERAL (
            SELECT close FROM prices_daily
            WHERE p.tickers IS NOT NULL AND array_length(p.tickers, 1) > 0
              AND symbol = p.tickers[1]
              AND ts > p.created_at
            ORDER BY ts ASC LIMIT 1
        ) p1 ON true
        LEFT JOIN LATERAL (
            SELECT close FROM prices_daily
            WHERE p.tickers IS NOT NULL AND array_length(p.tickers, 1) > 0
              AND symbol = p.tickers[1]
            ORDER BY ts DESC LIMIT 1
        ) pnow ON true
        WHERE p.created_at >= NOW() - ($1 || ' days')::interval
          AND p.catalyst_score >= $2
          AND p.keywords IS NOT NULL
          AND array_length(p.keywords, 1) > 0
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, str(days), min_score)

    # Bucket per-post returns by primary category. Keep median tractable by
    # holding the raw list per bucket — n is bounded by lookback × throughput.
    cat_rets_next: dict[str, list[float]] = {}
    cat_rets_since: dict[str, list[float]] = {}
    cat_total_posts: dict[str, int] = {}
    n_total = 0
    n_total_with_return = 0
    all_next_returns: list[float] = []

    for r in rows:
        n_total += 1
        kw = list(r["keywords"]) if r["keywords"] else []
        cat = _classify_primary_category(kw)
        cat_total_posts[cat] = cat_total_posts.get(cat, 0) + 1

        px0 = float(r["price_at_post"]) if r["price_at_post"] is not None else None
        px1 = float(r["price_next_day"]) if r["price_next_day"] is not None else None
        pxn = float(r["price_now"]) if r["price_now"] is not None else None
        if px0 and px1 and px0 > 0:
            ret_next = (px1 / px0 - 1.0) * 100.0
            cat_rets_next.setdefault(cat, []).append(ret_next)
            all_next_returns.append(ret_next)
            n_total_with_return += 1
        if px0 and pxn and px0 > 0 and px0 != pxn:
            cat_rets_since.setdefault(cat, []).append((pxn / px0 - 1.0) * 100.0)

    def _median(xs: list[float]) -> float:
        s = sorted(xs)
        n = len(s)
        if n == 0:
            return 0.0
        mid = n // 2
        return s[mid] if n % 2 == 1 else (s[mid - 1] + s[mid]) / 2.0

    categories: list[CategoryTrackRecord] = []
    all_cat_ids = {cat for cat, _ in _CATALYST_CATEGORY_RULES} | {"other"} | set(cat_total_posts)
    for cat in sorted(all_cat_ids):
        n_posts = cat_total_posts.get(cat, 0)
        rets_next = cat_rets_next.get(cat, [])
        rets_since = cat_rets_since.get(cat, [])
        n_ret = len(rets_next)
        hit_rate = (sum(1 for x in rets_next if x > 0) / n_ret) if n_ret else None
        avg_next = (sum(rets_next) / n_ret) if n_ret else None
        median_next = _median(rets_next) if n_ret else None
        avg_since = (sum(rets_since) / len(rets_since)) if rets_since else None
        categories.append(CategoryTrackRecord(
            category=cat,
            n_posts=n_posts,
            n_with_return=n_ret,
            hit_rate=hit_rate,
            avg_return_next_day_pct=avg_next,
            median_return_next_day_pct=median_next,
            avg_return_since_post_pct=avg_since,
        ))

    # Sort: buckets with most evidence first, but keep ones with no posts last.
    categories.sort(key=lambda c: (c.n_posts == 0, -c.n_posts))

    overall_hit = (
        sum(1 for x in all_next_returns if x > 0) / len(all_next_returns)
        if all_next_returns else None
    )
    overall_avg = (
        sum(all_next_returns) / len(all_next_returns) if all_next_returns else None
    )

    return CatalystTrackRecordResponse(
        window_days=days,
        n_total_posts=n_total,
        n_total_with_return=n_total_with_return,
        overall_hit_rate=overall_hit,
        overall_avg_return_next_day_pct=overall_avg,
        categories=categories,
    )


@router.get("/catalysts", response_model=CatalystsResponse)
async def get_catalysts(
    limit: int = Query(50, ge=1, le=200),
    min_score: float = Query(0.05, ge=0.0, le=1.0),
    ticker: str | None = Query(None, description="Filter to posts mentioning this ticker"),
    hours: int = Query(48, ge=1, le=168, description="Lookback window in hours"),
) -> CatalystsResponse:
    """Catalyst-flagged Reddit posts ordered by composite score, enriched
    with engagement (upvotes/comments), score breakdown, and lead-ticker
    price reaction (daily granularity)."""
    pool = get_pool()
    # LATERAL joins compute the lead-ticker price reaction inline. Cost is
    # bounded — `tickers` is GIN-indexed and prices_daily has (symbol, ts)
    # locality, so each LATERAL is a single index probe.
    base_select = """
        SELECT
            p.id, p.created_at, p.subreddit, p.author, p.title, p.permalink,
            p.tickers, p.keywords, p.catalyst_score,
            p.upvotes, p.num_comments,
            (CASE WHEN array_length(p.tickers, 1) > 0 THEN p.tickers[1] END) AS lead_ticker,
            p0.close AS price_at_post,
            p1.close AS price_next_day,
            pnow.close AS price_now
        FROM reddit_posts p
        LEFT JOIN LATERAL (
            SELECT close FROM prices_daily
            WHERE p.tickers IS NOT NULL AND array_length(p.tickers, 1) > 0
              AND symbol = p.tickers[1]
              AND ts <= p.created_at
            ORDER BY ts DESC LIMIT 1
        ) p0 ON true
        LEFT JOIN LATERAL (
            SELECT close FROM prices_daily
            WHERE p.tickers IS NOT NULL AND array_length(p.tickers, 1) > 0
              AND symbol = p.tickers[1]
              AND ts > p.created_at
            ORDER BY ts ASC LIMIT 1
        ) p1 ON true
        LEFT JOIN LATERAL (
            SELECT close FROM prices_daily
            WHERE p.tickers IS NOT NULL AND array_length(p.tickers, 1) > 0
              AND symbol = p.tickers[1]
            ORDER BY ts DESC LIMIT 1
        ) pnow ON true
    """
    if ticker:
        sql = (
            base_select
            + """
            WHERE p.created_at >= NOW() - ($1 || ' hours')::interval
              AND p.catalyst_score >= $2
              AND $3 = ANY(p.tickers)
            ORDER BY p.catalyst_score DESC NULLS LAST, p.created_at DESC
            LIMIT $4
        """
        )
        async with pool.acquire() as conn:
            rows = await conn.fetch(sql, str(hours), min_score, ticker.upper(), limit)
    else:
        sql = (
            base_select
            + """
            WHERE p.created_at >= NOW() - ($1 || ' hours')::interval
              AND p.catalyst_score >= $2
            ORDER BY p.catalyst_score DESC NULLS LAST, p.created_at DESC
            LIMIT $3
        """
        )
        async with pool.acquire() as conn:
            rows = await conn.fetch(sql, str(hours), min_score, limit)

    now_utc = datetime.now(UTC)
    posts: list[CatalystPost] = []
    for r in rows:
        ts = r["created_at"]
        ts_aware = ts if ts.tzinfo else ts.replace(tzinfo=UTC)
        delta = (now_utc - ts_aware).total_seconds() / 3600
        tickers_list = list(r["tickers"]) if r["tickers"] else []
        keywords_list = list(r["keywords"]) if r["keywords"] else []
        stored_score = float(r["catalyst_score"] or 0.0)

        px0 = float(r["price_at_post"]) if r["price_at_post"] is not None else None
        px1 = float(r["price_next_day"]) if r["price_next_day"] is not None else None
        pxn = float(r["price_now"]) if r["price_now"] is not None else None
        ret_next = ((px1 / px0) - 1.0) * 100.0 if (px0 and px1 and px0 > 0) else None
        ret_since = ((pxn / px0) - 1.0) * 100.0 if (px0 and pxn and px0 > 0) else None
        # If the latest close *is* the close-at-post (post predates only one
        # bar), there's no "since post" move yet — suppress the 0% noise.
        if ret_since is not None and px0 == pxn:
            ret_since = None

        posts.append(CatalystPost(
            id=r["id"],
            created_at=ts,
            subreddit=r["subreddit"],
            author=r["author"],
            title=r["title"],
            permalink=r["permalink"],
            tickers=tickers_list,
            keywords=keywords_list,
            catalyst_score=stored_score,
            hours_old=max(0.0, delta),
            upvotes=int(r["upvotes"]) if r["upvotes"] is not None else None,
            num_comments=int(r["num_comments"]) if r["num_comments"] is not None else None,
            score_breakdown=_score_breakdown(
                len(tickers_list), len(keywords_list), max(0.0, delta), stored_score,
            ),
            lead_ticker=r["lead_ticker"],
            price_at_post=px0,
            price_next_day=px1,
            price_now=pxn,
            return_next_day_pct=ret_next,
            return_since_post_pct=ret_since,
        ))

    return CatalystsResponse(n_total=len(posts), posts=posts)


# ---------- /scorecard: model + subreddit + author predictive value ----------


class ScorecardCalibrationBucket(BaseModel):
    """One row of the calibration ladder: predictions falling in this score
    band, and how their realized returns actually came in. If the model is
    well-calibrated, mean_realized rises monotonically with score_bucket."""
    score_bucket: str        # e.g. "0-20", "20-40", ...
    n: int
    mean_predicted_pct: float | None
    mean_realized_pct: float | None
    hit_rate: float | None   # fraction with sign(predicted) == sign(realized)


class ScorecardCall(BaseModel):
    """One historical prediction with its realized outcome — used for the
    top-hits / top-misses lists on the UI panel."""
    snapshot_date: date
    ticker: str
    predicted_pct: float
    realized_pct: float
    pred_score: float | None
    error_pct: float         # realized - predicted


class SubredditEdge(BaseModel):
    """Realized predictive value of a subreddit: across every reddit_post that
    matured and had a primary_ticker, what's the average realized 20d return
    of the ticker after the post? > 0 means posts there have led to upside."""
    subreddit: str
    n_matured: int
    mean_realized_20d_pct: float
    hit_rate_up: float       # fraction with realized_20d > 0
    mean_realized_5d_pct: float | None


class AuthorEdge(BaseModel):
    """Same idea per author. We only list authors with ≥ 3 matured posts so
    the leaderboard isn't dominated by single lucky calls."""
    author: str
    subreddit: str | None    # most-frequent subreddit they post in
    n_matured: int
    mean_realized_20d_pct: float
    hit_rate_up: float


class ScorecardResponse(BaseModel):
    """Production scorekeeping for /reddit/predict and reddit_posts.

    status='calibrating' when nothing has matured yet (≤28 calendar days
    since the first prediction landed). Once mature, the model section
    becomes meaningful; subreddit/author edges populate independently as
    catalyst posts age into their 20d window."""
    status: Literal["ok", "calibrating"]
    model_version: str | None
    window_days: int
    n_matured: int
    hit_rate: float | None
    mean_predicted_pct: float | None
    mean_realized_pct: float | None
    mean_abs_error_pct: float | None
    bullish_hit_rate: float | None  # accuracy when model said up
    bearish_hit_rate: float | None  # accuracy when model said down
    calibration: list[ScorecardCalibrationBucket]
    top_hits: list[ScorecardCall]
    top_misses: list[ScorecardCall]
    subreddit_edges: list[SubredditEdge]
    author_edges: list[AuthorEdge]


@router.get("/scorecard", response_model=ScorecardResponse)
async def get_scorecard(
    window_days: int = Query(90, ge=14, le=365),
    model_version: str = Query("xgb_reddit_v1"),
) -> ScorecardResponse:
    """How well has the predictor + the reddit feed actually called the
    market? Looks at every prediction / catalyst post with a matured 20d
    return inside [today - window_days, today] and computes hit rates,
    mean error, calibration, and a leaderboard of best/worst calls plus
    per-subreddit + per-author predictive edge."""
    pool = get_pool()
    async with pool.acquire() as conn:
        # ---- model accuracy ----
        rows = await conn.fetch(
            """
            SELECT snapshot_date, ticker, pred_return_20d, pred_score,
                   realized_return_20d
            FROM reddit_predictions
            WHERE model_version = $1
              AND realized_return_20d IS NOT NULL
              AND snapshot_date >= CURRENT_DATE - $2
            """,
            model_version, window_days,
        )

        n = len(rows)
        if n == 0:
            return ScorecardResponse(
                status="calibrating",
                model_version=model_version,
                window_days=window_days,
                n_matured=0,
                hit_rate=None,
                mean_predicted_pct=None,
                mean_realized_pct=None,
                mean_abs_error_pct=None,
                bullish_hit_rate=None,
                bearish_hit_rate=None,
                calibration=[],
                top_hits=[],
                top_misses=[],
                subreddit_edges=await _subreddit_edges(conn, window_days),
                author_edges=await _author_edges(conn, window_days),
            )

        preds = [float(r["pred_return_20d"]) for r in rows if r["pred_return_20d"] is not None]
        reals = [float(r["realized_return_20d"]) for r in rows if r["pred_return_20d"] is not None]

        def _sgn(x: float) -> int:
            return 1 if x > 0 else (-1 if x < 0 else 0)

        hits = sum(1 for p, a in zip(preds, reals, strict=False) if _sgn(p) == _sgn(a) and _sgn(p) != 0)
        directional = sum(1 for p in preds if _sgn(p) != 0)
        hit_rate = (hits / directional) if directional else None

        mean_pred = sum(preds) / len(preds) if preds else None
        mean_real = sum(reals) / len(reals) if reals else None
        mae = sum(abs(a - p) for p, a in zip(preds, reals, strict=False)) / len(preds) if preds else None

        bull_pairs = [(p, a) for p, a in zip(preds, reals, strict=False) if p > 0]
        bear_pairs = [(p, a) for p, a in zip(preds, reals, strict=False) if p < 0]
        bull_hr = (sum(1 for _, a in bull_pairs if a > 0) / len(bull_pairs)) if bull_pairs else None
        bear_hr = (sum(1 for _, a in bear_pairs if a < 0) / len(bear_pairs)) if bear_pairs else None

        # ---- calibration ladder by pred_score bucket ----
        buckets: dict[str, list[tuple[float, float]]] = {
            "0-20": [], "20-40": [], "40-60": [], "60-80": [], "80-100": [],
        }
        for r in rows:
            s = r["pred_score"]
            if s is None or r["pred_return_20d"] is None or r["realized_return_20d"] is None:
                continue
            sv = float(s)
            key = (
                "0-20" if sv < 20 else
                "20-40" if sv < 40 else
                "40-60" if sv < 60 else
                "60-80" if sv < 80 else
                "80-100"
            )
            buckets[key].append((float(r["pred_return_20d"]), float(r["realized_return_20d"])))

        calibration: list[ScorecardCalibrationBucket] = []
        for label in ["0-20", "20-40", "40-60", "60-80", "80-100"]:
            pairs = buckets[label]
            if not pairs:
                calibration.append(ScorecardCalibrationBucket(
                    score_bucket=label, n=0,
                    mean_predicted_pct=None, mean_realized_pct=None, hit_rate=None,
                ))
                continue
            ps = [p for p, _ in pairs]
            as_ = [a for _, a in pairs]
            dir_ = [(p, a) for p, a in pairs if _sgn(p) != 0]
            hr = (sum(1 for p, a in dir_ if _sgn(p) == _sgn(a)) / len(dir_)) if dir_ else None
            calibration.append(ScorecardCalibrationBucket(
                score_bucket=label,
                n=len(pairs),
                mean_predicted_pct=sum(ps) / len(ps),
                mean_realized_pct=sum(as_) / len(as_),
                hit_rate=hr,
            ))

        # ---- top hits / misses ----
        scored: list[ScorecardCall] = []
        for r in rows:
            p = r["pred_return_20d"]
            a = r["realized_return_20d"]
            if p is None or a is None:
                continue
            scored.append(ScorecardCall(
                snapshot_date=r["snapshot_date"],
                ticker=r["ticker"],
                predicted_pct=float(p),
                realized_pct=float(a),
                pred_score=float(r["pred_score"]) if r["pred_score"] is not None else None,
                error_pct=float(a) - float(p),
            ))

        # A "hit" = sign agreement; rank within hits by realized magnitude (best
        # bullish call = biggest realized rip when we said up).
        agreers = [c for c in scored if _sgn(c.predicted_pct) == _sgn(c.realized_pct) and _sgn(c.predicted_pct) != 0]
        misses = [c for c in scored if _sgn(c.predicted_pct) != _sgn(c.realized_pct) and _sgn(c.predicted_pct) != 0]
        agreers.sort(key=lambda c: abs(c.realized_pct), reverse=True)
        misses.sort(key=lambda c: abs(c.error_pct), reverse=True)

        return ScorecardResponse(
            status="ok",
            model_version=model_version,
            window_days=window_days,
            n_matured=n,
            hit_rate=hit_rate,
            mean_predicted_pct=mean_pred,
            mean_realized_pct=mean_real,
            mean_abs_error_pct=mae,
            bullish_hit_rate=bull_hr,
            bearish_hit_rate=bear_hr,
            calibration=calibration,
            top_hits=agreers[:5],
            top_misses=misses[:5],
            subreddit_edges=await _subreddit_edges(conn, window_days),
            author_edges=await _author_edges(conn, window_days),
        )


async def _subreddit_edges(conn, window_days: int) -> list[SubredditEdge]:
    """Aggregate realized 5d/20d returns across reddit_posts grouped by
    subreddit. Filtered to posts with primary_ticker + matured 20d realized
    return inside the window. Sorted by mean_realized_20d_pct desc."""
    rows = await conn.fetch(
        """
        SELECT subreddit,
               COUNT(*)                              AS n,
               AVG(realized_return_20d)              AS mean_20d,
               AVG(realized_return_5d)               AS mean_5d,
               AVG(CASE WHEN realized_return_20d > 0 THEN 1.0 ELSE 0.0 END) AS hit_up
        FROM reddit_posts
        WHERE realized_return_20d IS NOT NULL
          AND primary_ticker IS NOT NULL
          AND created_at::date >= CURRENT_DATE - $1
        GROUP BY subreddit
        HAVING COUNT(*) >= 5
        ORDER BY mean_20d DESC NULLS LAST
        """,
        window_days,
    )
    out: list[SubredditEdge] = []
    for r in rows:
        out.append(SubredditEdge(
            subreddit=r["subreddit"],
            n_matured=int(r["n"]),
            mean_realized_20d_pct=float(r["mean_20d"]) if r["mean_20d"] is not None else 0.0,
            hit_rate_up=float(r["hit_up"]) if r["hit_up"] is not None else 0.0,
            mean_realized_5d_pct=float(r["mean_5d"]) if r["mean_5d"] is not None else None,
        ))
    return out


async def _author_edges(conn, window_days: int) -> list[AuthorEdge]:
    """Per-author predictive edge. Requires ≥3 matured posts so a single
    lucky call doesn't dominate the leaderboard. Returns top 25 by
    mean_realized_20d_pct."""
    rows = await conn.fetch(
        """
        WITH base AS (
            SELECT author, subreddit, realized_return_20d
            FROM reddit_posts
            WHERE realized_return_20d IS NOT NULL
              AND primary_ticker IS NOT NULL
              AND author IS NOT NULL
              AND created_at::date >= CURRENT_DATE - $1
        ),
        per_author AS (
            SELECT author,
                   COUNT(*)                                AS n,
                   AVG(realized_return_20d)                AS mean_20d,
                   AVG(CASE WHEN realized_return_20d > 0 THEN 1.0 ELSE 0.0 END) AS hit_up
            FROM base
            GROUP BY author
            HAVING COUNT(*) >= 3
        ),
        modal_sub AS (
            SELECT DISTINCT ON (author) author, subreddit
            FROM base
            GROUP BY author, subreddit
            ORDER BY author, COUNT(*) DESC
        )
        SELECT p.author, m.subreddit, p.n, p.mean_20d, p.hit_up
        FROM per_author p
        LEFT JOIN modal_sub m USING (author)
        ORDER BY p.mean_20d DESC NULLS LAST
        LIMIT 25
        """,
        window_days,
    )
    return [
        AuthorEdge(
            author=r["author"],
            subreddit=r["subreddit"],
            n_matured=int(r["n"]),
            mean_realized_20d_pct=float(r["mean_20d"]) if r["mean_20d"] is not None else 0.0,
            hit_rate_up=float(r["hit_up"]) if r["hit_up"] is not None else 0.0,
        )
        for r in rows
    ]
