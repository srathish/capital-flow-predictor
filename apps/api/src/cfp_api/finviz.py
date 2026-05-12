"""Finviz preset screener fetcher.

Public-source screener URLs the community uses to surface candidate tickers
(short-squeeze, oversold-reversal, breakout, CANSLIM, etc.). We fetch the
HTML page and extract symbols from the standard Finviz quote-link pattern:

    <a ... href="quote.ashx?t=TICKER&..." class="screener-link-primary">

Results are cached in-process for 15 minutes (Finviz throttles aggressive
scraping, and ticker lists rarely change intra-hour anyway).

The shipped preset URLs are the exact ones the user provided in chat; if
Finviz ever changes its DOM, the regex below is the single point of failure.
"""

from __future__ import annotations

import asyncio
import re
import time
from typing import Final

import httpx

# Preset key → Finviz screener URL.  Keys are stable identifiers used in API
# query params and UI labels; descriptions live in PRESET_META below.
PRESETS: Final[dict[str, str]] = {
    "shorted": "https://finviz.com/screener.ashx?v=131&f=cap_smallover,geo_usa,sh_avgvol_o500,sh_curvol_o500,sh_opt_optionshort,sh_price_o3,sh_relvol_o1,sh_short_high&o=-shortinterestshare",
    "short_squeeze": "https://finviz.com/screener.ashx?v=131&f=sh_avgvol_o100,sh_instown_u50,sh_price_o2,sh_short_o15&ft=4&o=-shortinterestshare",
    "earnings_gap_up": "https://finviz.com/screener.ashx?v=141&f=earningsdate_tomorrowafter,sh_avgvol_o400,sh_curvol_o50,sh_short_u25,ta_averagetruerange_o0.5,ta_gap_u2&ft=4&o=-perfytd",
    "bankruptcy_squeeze": "https://finviz.com/screener.ashx?v=131&f=fa_pb_low,sh_short_o30&ft=4&o=-shortinterestshare",
    "uptrend_weekly_lows": "https://finviz.com/screener.ashx?v=141&f=sh_avgvol_o400,ta_pattern_channelup,ta_perf_1wdown&ft=4&o=perf1w",
    "bounce_ma": "https://finviz.com/screener.ashx?v=141&f=sh_avgvol_o400,sh_curvol_o2000,sh_relvol_o1,ta_sma20_pa,ta_sma50_pb&ft=4&o=-perf1w",
    "oversold_reversal": "https://finviz.com/screener.ashx?v=111&f=sh_price_o5,sh_relvol_o2,ta_change_u,ta_rsi_os30&ft=4&o=price",
    "oversold_earnings": "https://finviz.com/screener.ashx?v=141&f=cap_smallover,earningsdate_thismonth,fa_epsqoq_o15,fa_grossmargin_o20,sh_avgvol_o750,sh_curvol_o1000,ta_perf_52w10o,ta_rsi_nob50&ft=4&o=perfytd",
    "new_highs": "https://finviz.com/screener.ashx?v=141&f=an_recom_buy,sh_price_u7,ta_change_u,ta_highlow20d_nh,ta_highlow50d_nh,ta_highlow52w_nh,ta_perf_dup&ft=4&o=-perf1w",
    "breakout": "https://finviz.com/screener.ashx?v=141&f=fa_debteq_u1,fa_roe_o20,sh_avgvol_o100,ta_highlow50d_nh,ta_sma20_pa,ta_sma200_pa,ta_sma50_pa&ft=4&o=-perf1w",
    "sma_crossover": "https://finviz.com/screener.ashx?v=141&f=fa_pe_profitable,sh_avgvol_o400,sh_relvol_o1,sh_short_low,ta_beta_o1,ta_sma50_cross20b&ft=4",
    "high_earnings_growth": "https://finviz.com/screener.ashx?v=141&f=fa_epsqoq_o25,fa_epsyoy_o25,fa_epsyoy1_o25,fa_salesqoq_o25,sh_avgvol_o400,ta_rsi_nos50,ta_sma200_pa&ft=4&o=-perfytd",
    "high_sales_growth": "https://finviz.com/screener.ashx?v=111&f=fa_debteq_u0.5,fa_roe_o15,fa_sales5years_o20,fa_salesqoq_o20,sh_avgvol_o200,sh_instown_o60,sh_price_o5,sh_short_u5&ft=4",
    "high_rel_volume": "https://finviz.com/screener.ashx?v=131&f=fa_curratio_o1,fa_epsqoq_o15,fa_quickratio_o1,fa_salesqoq_o15,sh_avgvol_o400,sh_price_o5,sh_relvol_o1.5,ta_sma20_pa,ta_sma200_sb50,ta_sma50_sa200&ft=4&o=instown",
    "consistent_growth_bullish": "https://finviz.com/screener.ashx?v=141&f=fa_eps5years_pos,fa_epsqoq_o20,fa_epsyoy_o25,fa_epsyoy1_o15,fa_estltgrowth_pos,fa_roe_o15,sh_instown_o10,sh_price_o15,ta_highlow52w_a90h,ta_rsi_nos50&ft=4&o=-perfytd",
    "buy_and_hold_value": "https://finviz.com/screener.ashx?v=121&f=cap_microover,fa_curratio_o1.5,fa_estltgrowth_o10,fa_peg_o1,fa_roe_o15,ta_beta_o1.5,ta_sma20_pa&ft=4&o=-forwardpe",
    "undervalued_dividend": "https://finviz.com/screener.ashx?v=111&f=cap_largeover,fa_div_pos,fa_epsyoy1_o5,fa_estltgrowth_o5,fa_payoutratio_u50,fa_pe_u20,fa_peg_low&ft=4&o=-pe",
    "low_pe_value": "https://finviz.com/screener.ashx?v=141&f=cap_smallunder,fa_pb_low,fa_pe_low,fa_peg_low,fa_roa_pos,fa_roe_pos,sh_price_o5&ft=4&o=-perfytd",
    "canslim": "https://finviz.com/screener.ashx?v=111&f=fa_eps5years_o20,fa_epsqoq_o20,fa_epsyoy_o20,fa_sales5years_o20,fa_salesqoq_o20,sh_curvol_o200&ft=4",
}

# Human-readable label per preset. Keep terse — these render in the UI dropdown.
PRESET_META: Final[dict[str, dict[str, str]]] = {
    "shorted": {"label": "Heavily shorted", "thesis": "bearish"},
    "short_squeeze": {"label": "Short squeeze", "thesis": "bullish"},
    "earnings_gap_up": {"label": "Earnings gap up", "thesis": "bullish"},
    "bankruptcy_squeeze": {"label": "Bankruptcy squeeze", "thesis": "bullish"},
    "uptrend_weekly_lows": {"label": "Uptrend from weekly lows", "thesis": "bullish"},
    "bounce_ma": {"label": "Bounce at moving avg", "thesis": "bullish"},
    "oversold_reversal": {"label": "Oversold reversal", "thesis": "bullish"},
    "oversold_earnings": {"label": "Oversold + upcoming earnings", "thesis": "bullish"},
    "new_highs": {"label": "New highs", "thesis": "bullish"},
    "breakout": {"label": "Breaking out", "thesis": "bullish"},
    "sma_crossover": {"label": "SMA crossover", "thesis": "bullish"},
    "high_earnings_growth": {"label": "High earnings growth", "thesis": "bullish"},
    "high_sales_growth": {"label": "High sales growth", "thesis": "bullish"},
    "high_rel_volume": {"label": "High relative volume", "thesis": "bullish"},
    "consistent_growth_bullish": {"label": "Consistent growth, bullish trend", "thesis": "bullish"},
    "buy_and_hold_value": {"label": "Buy & hold value", "thesis": "bullish"},
    "undervalued_dividend": {"label": "Undervalued dividend growth", "thesis": "bullish"},
    "low_pe_value": {"label": "Low PE value", "thesis": "bullish"},
    "canslim": {"label": "CANSLIM", "thesis": "bullish"},
}

# Finviz renders every cell in a result row as an anchor pointing to the
# ticker's quote page.  In 2025 they shortened the path from
# `quote.ashx?t=TICKER&...` to `quote?t=TICKER&...` — match both forms so we
# stay resilient to future re-renames.  Tickers are alnum + dot/dash (e.g.
# BRK.B).  Many anchors per row resolve to the same ticker; the caller dedups.
_TICKER_RE = re.compile(r'href="quote(?:\.ashx)?\?t=([A-Z0-9.\-]+)&', re.IGNORECASE)

# Finviz blocks default httpx UA; mimic a desktop browser.
_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml",
}

_CACHE_TTL_S = 15 * 60
_cache: dict[str, tuple[float, list[str]]] = {}
_locks: dict[str, asyncio.Lock] = {}


def _lock_for(preset: str) -> asyncio.Lock:
    lock = _locks.get(preset)
    if lock is None:
        lock = asyncio.Lock()
        _locks[preset] = lock
    return lock


async def fetch_preset_tickers(preset: str, *, max_pages: int = 2) -> list[str]:
    """Return tickers for a Finviz preset (cached 15 min).

    Fetches up to `max_pages` of 20 results each (Finviz's default page size),
    deduped in original rank order. Returns [] on network/parse failure
    rather than raising — the caller treats an empty list as "no universe"
    and surfaces an empty result set, which is what the user sees if their
    own Finviz filters happen to match nothing.
    """
    if preset not in PRESETS:
        raise ValueError(f"unknown preset: {preset}")

    now = time.time()
    cached = _cache.get(preset)
    if cached and now - cached[0] < _CACHE_TTL_S:
        return cached[1]

    async with _lock_for(preset):
        cached = _cache.get(preset)
        if cached and time.time() - cached[0] < _CACHE_TTL_S:
            return cached[1]

        base_url = PRESETS[preset]
        seen: list[str] = []
        seen_set: set[str] = set()
        try:
            async with httpx.AsyncClient(
                timeout=10.0, headers=_HEADERS, follow_redirects=True
            ) as client:
                for page in range(max_pages):
                    # Finviz pagination uses &r=N where N=1,21,41,...
                    url = base_url if page == 0 else f"{base_url}&r={page * 20 + 1}"
                    try:
                        resp = await client.get(url)
                        if resp.status_code != 200:
                            break
                        text = resp.text
                    except httpx.HTTPError:
                        break

                    page_matches = _TICKER_RE.findall(text)
                    if not page_matches:
                        break
                    new_on_page = 0
                    for t in page_matches:
                        sym = t.upper()
                        if sym in seen_set:
                            continue
                        seen_set.add(sym)
                        seen.append(sym)
                        new_on_page += 1
                    # If a fetched page added no new tickers, we've walked off
                    # the end of the result set — stop paging.
                    if new_on_page == 0:
                        break
        except Exception:
            seen = []

        _cache[preset] = (time.time(), seen)
        return seen


def available_presets() -> list[dict[str, str]]:
    """List preset keys + labels for the frontend dropdown."""
    return [
        {"key": k, "label": PRESET_META[k]["label"], "thesis": PRESET_META[k]["thesis"]}
        for k in PRESETS
    ]
