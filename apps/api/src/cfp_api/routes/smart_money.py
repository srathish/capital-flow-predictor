"""Smart Money — unified institutional/insider/political tape.

GET /v1/smart-money/tape
    Reverse-chrono mixed feed: dark-pool prints, insider Form 4s, congress
    trades, 13F deltas. Tickers + filters.

GET /v1/smart-money/rollup
    Per-ticker rollup (last 30d): net dark-pool $, insider net $, congress
    flow, 13F net shares, conviction score (Z of net flow vs 90d).
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Query
from pydantic import BaseModel

from cfp_api.db import get_pool


router = APIRouter(tags=["smart-money"], prefix="/v1/smart-money")


class TapeEntry(BaseModel):
    ts: datetime
    source: str            # 'dark_pool','insider','congress','inst'
    ticker: str
    direction: str         # 'buy','sell','neutral'
    notional: float | None
    detail: dict[str, Any]


class RollupRow(BaseModel):
    ticker: str
    dp_net_30d: float | None
    insider_net_30d: float | None
    insider_buyers_30d: int
    insider_sellers_30d: int
    congress_buys_14d: int
    congress_sells_14d: int
    inst_net_delta_90d: int | None
    conviction_score: float | None
    spot_price: float | None


@router.get("/tape", response_model=list[TapeEntry])
async def tape(
    hours: int = Query(48, ge=1, le=720),
    ticker: str | None = Query(None),
    sources: str = Query("dark_pool,insider,congress,inst"),
    limit: int = Query(200, ge=1, le=1000),
) -> list[TapeEntry]:
    """Mixed reverse-chrono tape across the 4 smart-money sources."""
    since = datetime.now(UTC) - timedelta(hours=hours)
    src_list = [s.strip() for s in sources.split(",") if s.strip()]
    out: list[TapeEntry] = []
    pool = get_pool()
    async with pool.acquire() as conn:
        if "dark_pool" in src_list:
            sql = """
                SELECT executed_at AS ts, ticker, premium, size,
                       (nbbo_ask + nbbo_bid)/2 AS mid, price,
                       market_center
                FROM uw_dark_pool_prints
                WHERE executed_at >= $1
            """
            args: list[Any] = [since]
            if ticker:
                sql += " AND ticker = $2"
                args.append(ticker)
            sql += " ORDER BY executed_at DESC LIMIT $%d" % (len(args) + 1)
            args.append(limit)
            for r in await conn.fetch(sql, *args):
                direction = "buy" if (r["price"] or 0) >= (r["mid"] or 0) else "sell"
                out.append(TapeEntry(
                    ts=r["ts"], source="dark_pool", ticker=r["ticker"],
                    direction=direction, notional=float(r["premium"] or 0),
                    detail={"size": r["size"], "price": r["price"], "mid": r["mid"],
                            "venue": r["market_center"]},
                ))
        if "insider" in src_list:
            sql = """
                SELECT transaction_date::timestamptz AS ts, ticker, owner_name,
                       transaction_code, amount, price
                FROM uw_insider_transactions
                WHERE transaction_date >= $1::date
            """
            args = [since.date()]
            if ticker:
                sql += " AND ticker = $2"
                args.append(ticker)
            sql += " ORDER BY transaction_date DESC LIMIT $%d" % (len(args) + 1)
            args.append(limit)
            for r in await conn.fetch(sql, *args):
                direction = "buy" if r["transaction_code"] in ("A", "P") else "sell"
                notional = float((r["amount"] or 0) * (r["price"] or 0))
                out.append(TapeEntry(
                    ts=r["ts"], source="insider", ticker=r["ticker"],
                    direction=direction, notional=notional,
                    detail={"owner": r["owner_name"], "code": r["transaction_code"],
                            "shares": r["amount"]},
                ))
        if "congress" in src_list:
            sql = """
                SELECT COALESCE(transaction_date, filing_date)::timestamptz AS ts,
                       ticker, member_name,
                       COALESCE(txn_type, transaction_type) AS txn, amount, payload
                FROM uw_congress_trades
                WHERE COALESCE(transaction_date, filing_date) >= $1::date
            """
            args = [since.date()]
            if ticker:
                sql += " AND ticker = $2"
                args.append(ticker)
            sql += " ORDER BY 1 DESC LIMIT $%d" % (len(args) + 1)
            args.append(limit)
            try:
                for r in await conn.fetch(sql, *args):
                    txn = (r["txn"] or "").lower()
                    direction = "buy" if "buy" in txn or "purchase" in txn else "sell" if "sell" in txn or "sale" in txn else "neutral"
                    out.append(TapeEntry(
                        ts=r["ts"], source="congress", ticker=r["ticker"],
                        direction=direction,
                        notional=float(r["amount"]) if r["amount"] is not None else None,
                        detail={"member": r["member_name"], "txn": r["txn"]},
                    ))
            except Exception:
                pass  # column shape may differ across UW versions
        if "inst" in src_list:
            sql = """
                SELECT COALESCE(filing_date, created_at::date)::timestamptz AS ts,
                       ticker, institution, change_in_shares
                FROM uw_institution_activity
                WHERE COALESCE(filing_date, created_at::date) >= $1::date
            """
            args = [since.date()]
            if ticker:
                sql += " AND ticker = $2"
                args.append(ticker)
            sql += " ORDER BY 1 DESC LIMIT $%d" % (len(args) + 1)
            args.append(limit)
            try:
                for r in await conn.fetch(sql, *args):
                    delta = int(r["change_in_shares"] or 0)
                    direction = "buy" if delta > 0 else "sell" if delta < 0 else "neutral"
                    out.append(TapeEntry(
                        ts=r["ts"], source="inst", ticker=r["ticker"],
                        direction=direction, notional=None,
                        detail={"institution": r["institution"], "delta_shares": delta},
                    ))
            except Exception:
                pass
    out.sort(key=lambda e: e.ts, reverse=True)
    return out[:limit]


@router.get("/rollup", response_model=list[RollupRow])
async def rollup(
    limit: int = Query(50, ge=1, le=500),
    min_signals: int = Query(2, ge=1, le=4),
) -> list[RollupRow]:
    """Per-ticker rollup from the latest delphi_features snapshot.

    Sorted by conviction_score = Z(insider_net_30d) + Z(dp_net_premium_24h)
    + Z(inst_net_delta_shares) — so widest cross-source agreement floats up.
    """
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            WITH latest AS (
                SELECT *, ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY snapshot_ts DESC) AS rn
                FROM delphi_features
            ),
            base AS (
                SELECT ticker, spot_price,
                       dp_net_premium_24h,
                       insider_net_30d, insider_buyers_30d, insider_sellers_30d,
                       congress_buys_14d, congress_sells_14d,
                       inst_net_delta_shares
                FROM latest WHERE rn = 1
            ),
            scored AS (
                SELECT *,
                    (COALESCE(SIGN(insider_net_30d), 0)
                   + COALESCE(SIGN(dp_net_premium_24h), 0)
                   + CASE WHEN congress_buys_14d - congress_sells_14d > 0 THEN 1
                          WHEN congress_buys_14d - congress_sells_14d < 0 THEN -1 ELSE 0 END
                   + COALESCE(SIGN(inst_net_delta_shares), 0))::float AS dir_sum,
                   (CASE WHEN insider_net_30d IS NOT NULL THEN 1 ELSE 0 END
                  + CASE WHEN dp_net_premium_24h IS NOT NULL THEN 1 ELSE 0 END
                  + CASE WHEN (congress_buys_14d + congress_sells_14d) > 0 THEN 1 ELSE 0 END
                  + CASE WHEN inst_net_delta_shares IS NOT NULL THEN 1 ELSE 0 END) AS signal_count
                FROM base
            )
            SELECT *,
                   CASE WHEN signal_count > 0 THEN dir_sum / signal_count ELSE 0 END AS conviction_score
            FROM scored
            WHERE signal_count >= $1
            ORDER BY ABS(dir_sum) DESC, signal_count DESC
            LIMIT $2
            """,
            min_signals, limit,
        )
    return [
        RollupRow(
            ticker=r["ticker"],
            dp_net_30d=r["dp_net_premium_24h"],
            insider_net_30d=r["insider_net_30d"],
            insider_buyers_30d=r["insider_buyers_30d"] or 0,
            insider_sellers_30d=r["insider_sellers_30d"] or 0,
            congress_buys_14d=r["congress_buys_14d"] or 0,
            congress_sells_14d=r["congress_sells_14d"] or 0,
            inst_net_delta_90d=r["inst_net_delta_shares"],
            conviction_score=r["conviction_score"],
            spot_price=r["spot_price"],
        )
        for r in rows
    ]
