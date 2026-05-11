"""Capital Flow Predictor jobs CLI.

Usage:
    cfp-jobs migrate                # apply infra/migrations/*.sql
    cfp-jobs backfill --years 5     # full historical backfill
    cfp-jobs daily                  # incremental (last 7 days)
    cfp-jobs status                 # row counts + freshness
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

# Load .env into os.environ before any module that reads env vars at import time
# (LlmClient checks LLM_PROVIDER, MOONSHOT_API_KEY, etc.). pydantic-settings reads
# .env into its Settings object but does not export to os.environ.
from dotenv import load_dotenv

load_dotenv()

import psycopg  # noqa: E402
import typer  # noqa: E402
from cfp_shared.universe import FRED_SERIES, PREDICTION_TARGETS, all_yfinance_symbols  # noqa: E402
from rich.console import Console  # noqa: E402
from rich.table import Table  # noqa: E402

from cfp_jobs import agents_runner, ingestion, migrate  # noqa: E402
from cfp_jobs import features as features_mod  # noqa: E402
from cfp_jobs import train as train_mod  # noqa: E402
from cfp_jobs import watchlist as watchlist_mod  # noqa: E402
from cfp_jobs.db import to_psycopg_url  # noqa: E402
from cfp_jobs.settings import settings  # noqa: E402

app = typer.Typer(
    add_completion=False,
    help="Capital Flow Predictor — ingestion, training, and inference jobs",
)
console = Console()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)


@app.command("migrate")
def migrate_cmd() -> None:
    """Apply all SQL migrations idempotently."""
    applied = migrate.apply_all(settings.database_url)
    console.print(f"[green]Applied:[/green] {applied}")


@app.command()
def backfill(
    years: int = typer.Option(5, help="Years of history to backfill"),
    skip_prices: bool = typer.Option(False, "--skip-prices"),
    skip_macro: bool = typer.Option(False, "--skip-macro"),
) -> None:
    """Backfill prices (yfinance) and macro (FRED) for the configured universe."""
    start = datetime.now(UTC) - timedelta(days=365 * years)
    symbols = all_yfinance_symbols()

    console.print(
        f"[bold]Backfill {years}y[/bold]: "
        f"{len(symbols)} symbols + {len(FRED_SERIES)} FRED series, "
        f"since {start.date()}"
    )

    if not skip_prices:
        n = ingestion.prices.ingest(settings.database_url, symbols, start)
        console.print(f"[green]prices:[/green] {n:,} rows")

    if not skip_macro:
        n = ingestion.macro.ingest(
            settings.database_url, settings.fred_api_key, FRED_SERIES, start
        )
        console.print(f"[green]macro:[/green] {n:,} rows")


@app.command()
def daily(lookback_days: int = typer.Option(7, help="Days of recent data to refresh")) -> None:
    """Incremental ingest. Pulls last `lookback_days` to absorb late corrections."""
    start = datetime.now(UTC) - timedelta(days=lookback_days)
    symbols = all_yfinance_symbols()

    n_prices = ingestion.prices.ingest(settings.database_url, symbols, start)
    n_macro = ingestion.macro.ingest(
        settings.database_url, settings.fred_api_key, FRED_SERIES, start
    )
    console.print(f"daily: prices={n_prices:,} macro={n_macro:,}")


@app.command("features-build")
def features_build_cmd() -> None:
    """Compute and upsert features for the full universe (DESIGN.md §6.1, §6.2)."""
    counts = features_mod.build(settings.database_url)
    console.print(
        f"[green]features:[/green] cross_asset={counts['cross_asset']:,} "
        f"sector={counts['sector']:,}"
    )


@app.command("features-daily")
def features_daily_cmd(
    only_recent_days: int = typer.Option(
        7, help="Only upsert feature rows for ts >= now - N days"
    ),
) -> None:
    """Incremental feature refresh (loads ~1y of data, upserts only recent rows)."""
    since = datetime.now(UTC) - timedelta(days=400)  # ~13mo for 252d windows + buffer
    counts = features_mod.build(
        settings.database_url, since=since, only_recent_days=only_recent_days
    )
    console.print(
        f"features-daily: cross_asset={counts['cross_asset']:,} sector={counts['sector']:,}"
    )


@app.command("features-breadth")
def features_breadth_cmd() -> None:
    """Promote etf_breadth_snapshots into the breadth_v1 feature set.

    Runs after the holdings ingest snapshots constituent breadth into
    etf_breadth_snapshots; this lifts those rows into features_daily so
    panel.py can join them per (ts, ETF) for training and inference.
    """
    n = features_mod.build_breadth(settings.database_url)
    console.print(f"[green]breadth:[/green] {n:,} rows")


@app.command("train-baseline")
def train_baseline_cmd(
    horizons: str = typer.Option("5,10,20", help="Comma-separated horizons in days"),
) -> None:
    """Walk-forward XGBoost rank baseline (DESIGN.md §7.1, §7.4)."""
    h_tuple = tuple(int(x) for x in horizons.split(","))
    result = train_mod.train_baseline(settings.database_url, horizons=h_tuple)

    table = Table(title="Walk-forward OOS metrics")
    table.add_column("Horizon")
    table.add_column("AUC", justify="right")
    table.add_column("IC", justify="right")
    table.add_column("Sharpe", justify="right")
    table.add_column("Hit@1", justify="right")
    table.add_column("Folds", justify="right")
    table.add_column("Test rows", justify="right")
    for h, m in sorted(result["horizons"].items()):
        table.add_row(
            f"{h}d",
            f"{m['auc']:.3f}",
            f"{m['ic']:.3f}",
            f"{m['sharpe']:.2f}",
            f"{m['hit_rate']:.2f}",
            str(m["n_folds"]),
            f"{m['n_test_rows']:,}",
        )
    console.print(table)
    console.print(f"[green]predictions:[/green] {result['n_predictions']:,} rows")


@app.command()
def evaluate(
    horizon: int = typer.Option(10, help="Horizon to evaluate"),
) -> None:
    """Recompute metrics from the latest predictions in the DB (no retraining)."""
    out = train_mod.evaluate_latest(settings.database_url, horizon=horizon)
    console.print(out)


@app.command("watchlist-build")
def watchlist_build_cmd(
    n_top_sectors: int = typer.Option(3, help="Top-N sectors from latest predictions"),
    k_per_sector: int = typer.Option(5, help="Top-K constituents per sector"),
    horizon: int = typer.Option(10, help="Prediction horizon in days"),
    model: str = typer.Option("xgb_v1", help="Predictor model name"),
) -> None:
    """Build a watchlist by running the full agent ensemble across top constituents
    of top predicted sectors and persisting Portfolio Manager decisions.

    Defaults: 3 sectors x 5 names = 15 ensemble runs. ~10 min, ~$0.22 on Moonshot.
    """
    out = watchlist_mod.build_watchlist(
        settings.database_url,
        n_top_sectors=n_top_sectors,
        k_per_sector=k_per_sector,
        horizon=horizon,
        model=model,
    )
    console.print(
        f"[green]watchlist:[/green] {out['n_rows']} rows persisted "
        f"({out['n_sectors']} sectors, {out['n_tickers']} tickers) "
        f"sectors={out.get('sectors', [])} run_ts={out['run_ts']}"
    )


@app.command()
def watchlist() -> None:
    """Display the latest watchlist as a table."""
    df = watchlist_mod.latest_watchlist(settings.database_url)
    if df.empty:
        console.print("[yellow]no watchlist yet — run `make watchlist-build` first[/yellow]")
        return

    table = Table(title=f"Latest watchlist ({df['run_ts'].iloc[0]})")
    table.add_column("Sector")
    table.add_column("Rank", justify="right")
    table.add_column("Ticker")
    table.add_column("Signal")
    table.add_column("Conf", justify="right")
    table.add_column("Weight", justify="right")
    table.add_column("Thesis")
    for _, r in df.iterrows():
        sig_color = {"long": "green", "short": "red", "avoid": "yellow"}.get(r["final_signal"], "")
        rationale = r["rationale"]
        thesis = (rationale or {}).get("summary") if isinstance(rationale, dict) else str(rationale or "")
        table.add_row(
            r["sector"],
            str(r["rank"]),
            r["ticker"],
            f"[{sig_color}]{r['final_signal']}[/{sig_color}]" if sig_color else r["final_signal"],
            f"{r['final_confidence']:.2f}",
            f"{r['target_weight']:.3f}" if r["target_weight"] else "—",
            thesis or "",
        )
    console.print(table)


@app.command("lead-lag-build")
def lead_lag_build_cmd(
    max_lag: int = typer.Option(10),
    lookback: int = typer.Option(252, help="Business days of returns to use"),
) -> None:
    """Compute Granger lead-lag matrix (DESIGN.md §6.5). Run monthly."""
    n = features_mod.build_lead_lag(
        settings.database_url, max_lag=max_lag, lookback=lookback
    )
    console.print(f"[green]lead_lag:[/green] {n:,} pairs computed")


@app.command()
def holdings(
    etfs: str = typer.Option("", help="Comma-separated ETF list; default = all PREDICTION_TARGETS"),
) -> None:
    """Fetch top-10 ETF holdings via yfinance into sector_holdings (Phase 4a).

    FMP's /etf/holdings endpoint moved to a paid tier in late 2025; yfinance
    is free and returns top-10 by weight which is enough for the watchlist flow.
    """
    etf_list = [e.strip() for e in etfs.split(",") if e.strip()] if etfs else list(PREDICTION_TARGETS)
    n = ingestion.holdings.ingest(settings.database_url, etf_list)
    console.print(f"[green]holdings:[/green] {n:,} rows across {len(etf_list)} ETFs")


@app.command()
def analysts(
    ticker: str = typer.Argument(..., help="Stock ticker, e.g. NVDA"),
    sector: str = typer.Option("", help="Sector ETF the ticker rolls up to (optional, for telemetry)"),
    personas: bool = typer.Option(
        False,
        "--personas",
        help="Also run the 6 LLM-powered persona agents (Phase 4c). Requires ANTHROPIC_API_KEY.",
    ),
) -> None:
    """Run the agent ensemble for a ticker.

    Default: just the 4 analysts (Technicals, Fundamentals, Sentiment, News) — no LLM calls.
    With --personas: full ensemble including Buffett, Burry, Druckenmiller,
    Cathie Wood, Taleb, Damodaran (Haiku 4.5).
    """
    out = agents_runner.run_analysts(
        settings.database_url, ticker.upper(), sector=sector, include_personas=personas
    )

    table = Table(title=f"Agent signals — {ticker.upper()}")
    table.add_column("Kind")
    table.add_column("Agent")
    table.add_column("Signal")
    table.add_column("Conf", justify="right")
    table.add_column("Rationale")
    for s in out["signals"]:
        signal_color = {"bullish": "green", "bearish": "red", "neutral": "yellow"}.get(s["signal"], "")
        table.add_row(
            s.get("kind", ""),
            s["agent"],
            f"[{signal_color}]{s['signal']}[/{signal_color}]" if signal_color else s["signal"],
            f"{s['confidence']:.2f}",
            s["rationale"],
        )
    console.print(table)
    console.print(
        f"[green]agent_signals:[/green] {out['n_signals']} rows persisted "
        f"({out.get('n_analysts', 0)} analysts, {out.get('n_personas', 0)} personas, "
        f"{out.get('n_synth', 0)} synthesis) run_ts={out['run_ts']}"
    )


@app.command()
def fundamentals(
    tickers: str = typer.Option("", help="Comma-separated tickers; default = constituents of PREDICTION_TARGETS"),
    force: bool = typer.Option(False, "--force", help="Refresh even if recent"),
    period: str = typer.Option("annual", help="'annual' or 'quarter'"),
) -> None:
    """Fetch stock fundamentals from FMP into fundamentals table (Phase 4a).

    Skips tickers whose latest fiscal_period is < 90 days old (caching).
    """
    if tickers:
        ticker_list = [t.strip() for t in tickers.split(",") if t.strip()]
    else:
        # Pull from sector_holdings — top constituents across all sectors
        with psycopg.connect(to_psycopg_url(settings.database_url)) as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT DISTINCT constituent FROM sector_holdings
                WHERE sector_etf = ANY(%s) AND constituent IS NOT NULL
                ORDER BY constituent
                """,
                (list(PREDICTION_TARGETS),),
            )
            ticker_list = [r[0] for r in cur.fetchall()]
    if not ticker_list:
        console.print("[yellow]no tickers; run `make holdings` first[/yellow]")
        return

    out = ingestion.fundamentals.ingest(
        settings.database_url,
        settings.fmp_api_key,
        ticker_list,
        period=period,
        force=force,
    )
    console.print(
        f"[green]fundamentals:[/green] fetched={out['tickers_fetched']} "
        f"skipped={out['tickers_skipped']} rows={out['rows']:,} "
        f"fmp_calls={out['fmp_calls']}/250-daily"
    )


@app.command("eval-agents")
def eval_agents_cmd(
    lookback: int = typer.Option(90, help="Days back to walk in agent_signals"),
) -> None:
    """Compute forward returns for old agent_signals rows -> agent_eval table.

    Run daily. Idempotent — re-running fills in newer horizons as more
    trading days accrue. After 60-90 days you'll have enough per-persona,
    per-regime data to rank personas and feed weights to the synthesizer.
    """
    from cfp_jobs import eval_agents as eval_mod

    out = eval_mod.evaluate(settings.database_url, lookback_days=lookback)
    table = Table(title="Agent eval forward-return computation")
    table.add_column("metric")
    table.add_column("value", justify="right")
    table.add_row("rows evaluated", f"{out['n_rows_evaluated']:,}")
    table.add_row("rows skipped (no horizons elapsed)", f"{out['n_skipped']:,}")
    for h, n in out["per_horizon"].items():
        table.add_row(f"hits filled at {h}d", f"{n:,}")
    console.print(table)


@app.command("flow")
def flow_cmd(
    ticker: str = typer.Argument(..., help="Stock ticker, e.g. NVDA"),
) -> None:
    """Pull all per-ticker Unusual Whales data: flow alerts, dark pool, net premium,
    short interest, greek exposure, insider transactions.

    Run this before an agent ensemble if you want fresh flow context. Costs ~6
    UW calls per ticker (well under the 80K/day quota)."""
    if not settings.unusual_whales_api_key:
        console.print("[red]UNUSUAL_WHALES_API_KEY not set[/red]")
        raise typer.Exit(1)
    out = ingestion.unusualwhales.ingest_ticker(
        settings.database_url, settings.unusual_whales_api_key, ticker
    )
    console.print(out)


@app.command("flow-universe")
def flow_universe_cmd(
    tickers: str = typer.Option(
        "",
        help="Comma-separated tickers; default = top constituents of PREDICTION_TARGETS + the ETFs themselves",
    ),
    max_tickers: int = typer.Option(
        80,
        help="Cap on tickers per run to stay within UW quota (~6 calls each)",
    ),
) -> None:
    """Refresh per-ticker UW flow/dark-pool/insider/etc. across a universe.

    Wires the same `ingest_ticker` call that `cfp-jobs flow NVDA` does, but
    iterates over the top constituents of the sector ETFs. Drives the /flow
    page + the whale-conviction scorer. Run hourly during RTH."""
    if not settings.unusual_whales_api_key:
        console.print("[red]UNUSUAL_WHALES_API_KEY not set[/red]")
        raise typer.Exit(1)

    if tickers:
        ticker_list = [t.strip().upper() for t in tickers.split(",") if t.strip()]
    else:
        with psycopg.connect(to_psycopg_url(settings.database_url)) as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT ticker, MAX(weight) AS w
                FROM uw_etf_holdings
                WHERE etf = ANY(%s)
                  AND ticker IS NOT NULL
                GROUP BY ticker
                ORDER BY w DESC NULLS LAST
                LIMIT %s
                """,
                (list(PREDICTION_TARGETS), max_tickers),
            )
            ticker_list = [r[0] for r in cur.fetchall()]
            # Include the ETFs themselves so SPY/QQQ/XLK get refreshed too.
            ticker_list = sorted({*ticker_list, *PREDICTION_TARGETS})

    ticker_list = ticker_list[:max_tickers]
    console.print(f"[bold]flow-universe[/bold]: {len(ticker_list)} tickers")
    n_ok = 0
    n_err = 0
    for t in ticker_list:
        try:
            out = ingestion.unusualwhales.ingest_ticker(
                settings.database_url, settings.unusual_whales_api_key, t
            )
            n_ok += 1
            total = sum(v for v in out.values() if isinstance(v, int))
            console.print(f"  [green]{t}[/green] {total} rows")
        except Exception as e:  # noqa: BLE001
            n_err += 1
            console.print(f"  [red]{t}[/red] {type(e).__name__}: {e}")
    console.print(f"[green]done:[/green] ok={n_ok} err={n_err}")


@app.command("flow-holdings")
def flow_holdings_cmd(
    etfs: str = typer.Option("", help="Comma-separated ETF tickers; default = PREDICTION_TARGETS"),
) -> None:
    """Refresh full ETF constituent lists via Unusual Whales /etfs/{etf}/holdings.

    Replaces the yfinance top-10 stub with the full holding list including
    per-constituent pricing + options sentiment. Powers /sectors/[etf].

    If UNUSUAL_WHALES_API_KEY is unset, falls back to yfinance top-10 for every
    ETF — enough to render the page without options-sentiment fields."""
    etf_list = [e.strip().upper() for e in etfs.split(",") if e.strip()] if etfs else list(PREDICTION_TARGETS)
    if not settings.unusual_whales_api_key:
        console.print("[yellow]UNUSUAL_WHALES_API_KEY not set — using yfinance fallback for all ETFs[/yellow]")
    out = ingestion.unusualwhales.ingest_etf_holdings(
        settings.database_url, settings.unusual_whales_api_key, etf_list
    )
    console.print(f"[green]etf_holdings:[/green] {out}")


@app.command("flow-etfs")
def flow_etfs_cmd(
    etfs: str = typer.Option("", help="Comma-separated ETF tickers; default = PREDICTION_TARGETS"),
) -> None:
    """Refresh ETF in/out flow (creation/redemption) for all sector ETFs.
    Powers the sector-rotation narrative."""
    if not settings.unusual_whales_api_key:
        console.print("[red]UNUSUAL_WHALES_API_KEY not set[/red]")
        raise typer.Exit(1)
    etf_list = [e.strip().upper() for e in etfs.split(",") if e.strip()] if etfs else list(PREDICTION_TARGETS)
    out = ingestion.unusualwhales.ingest_etfs(
        settings.database_url, settings.unusual_whales_api_key, etf_list
    )
    console.print(f"[green]etf_flow:[/green] {out}")


@app.command("reddit")
def reddit_cmd() -> None:
    """Snapshot today's Reddit mention counts via Apewisdom (free, no OAuth).

    Pulls the top ~150 tickers across r/wallstreetbets, r/stocks, r/options,
    r/investing, plus the union 'all-stocks' aggregate. Idempotent per day."""
    out = ingestion.reddit_apewisdom.ingest(settings.database_url)
    console.print(f"[green]reddit_mentions:[/green] {out}")


@app.command("reddit-catalysts")
def reddit_catalysts_cmd() -> None:
    """Pull catalyst-keyword Reddit posts via RSS (free, no OAuth).

    Surfaces posts mentioning a known ticker AND a catalyst keyword
    (partnership, leak, FDA, acquisition, etc.) — designed for AAPL/INTC
    partnership-style pre-announcement chatter. Run every 15-30 min."""
    out = ingestion.reddit_rss.ingest(settings.database_url)
    console.print(f"[green]reddit_posts:[/green] {out}")


@app.command("reddit-predict")
def reddit_predict_cmd() -> None:
    """Train an XGB regressor on (reddit mention features + price context)
    → 20d forward return, then emit predictions for the latest snapshot.

    Safe to run from day one — exits with status='calibrating' until at
    least ~200 matured rows accumulate. Run nightly after `cfp-jobs reddit`."""
    from cfp_jobs import predict_reddit  # noqa: PLC0415 — defer xgboost import

    out = predict_reddit.run(settings.database_url)
    console.print(f"[green]reddit_predictions:[/green] {out}")


@app.command("reddit-backfill-outcomes")
def reddit_backfill_outcomes_cmd() -> None:
    """Fill realized 20d/5d returns on matured reddit_predictions and reddit_posts.

    Anchor date + ~28 calendar days must have passed before a row becomes
    scoreable. Idempotent; safe to run multiple times per day. Run nightly
    after the price-data refresh."""
    from cfp_jobs import backfill_reddit_outcomes  # noqa: PLC0415

    out = backfill_reddit_outcomes.run(settings.database_url)
    console.print(f"[green]reddit_outcomes:[/green] {out}")


@app.command("market-tide")
def market_tide_cmd() -> None:
    """Refresh the market-wide net call/put premium tape ('Market Tide').

    UW returns ~1-min buckets for the current RTH session. Run every ~5min
    during market hours; the Whale Conviction scorer reads this to decide
    whether a single-name bet is with-tape or against-tape."""
    if not settings.unusual_whales_api_key:
        console.print("[red]UNUSUAL_WHALES_API_KEY not set[/red]")
        raise typer.Exit(1)
    n = ingestion.unusualwhales.ingest_market_tide(
        settings.database_url, settings.unusual_whales_api_key
    )
    console.print(f"[green]market_tide:[/green] {n} rows")


@app.command("flow-volatility")
def flow_volatility_cmd(
    tickers: str = typer.Option(
        "",
        help="Comma-separated tickers; default = constituents of PREDICTION_TARGETS + sector ETFs",
    ),
) -> None:
    """Snapshot per-ticker IV regime (iv30, iv_rank, iv_percentile, rv30).

    Powers the Whale Conviction scorer's vol-regime multiplier. Run nightly
    after the holdings ingest. ~1 UW call per ticker."""
    if not settings.unusual_whales_api_key:
        console.print("[red]UNUSUAL_WHALES_API_KEY not set[/red]")
        raise typer.Exit(1)
    if tickers:
        ticker_list = [t.strip().upper() for t in tickers.split(",") if t.strip()]
    else:
        with psycopg.connect(to_psycopg_url(settings.database_url)) as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT DISTINCT ticker FROM uw_etf_holdings
                WHERE etf = ANY(%s) AND ticker IS NOT NULL
                """,
                (list(PREDICTION_TARGETS),),
            )
            ticker_list = sorted({r[0] for r in cur.fetchall()} | set(PREDICTION_TARGETS))
    cli_log = logging.getLogger(__name__)
    n_ok = 0
    with ingestion.unusualwhales.UwClient(settings.unusual_whales_api_key) as uw, \
         psycopg.connect(to_psycopg_url(settings.database_url)) as conn:
        for t in ticker_list:
            try:
                body = uw.volatility_stats(t)
                if ingestion.unusualwhales._upsert_volatility_stats(conn, t, body):
                    n_ok += 1
            except Exception as e:  # noqa: BLE001 — keep going on a single-ticker failure
                cli_log.warning("volatility for %s failed: %s", t, e)
        conn.commit()
    console.print(f"[green]volatility:[/green] {n_ok}/{len(ticker_list)} tickers")


@app.command("whale-conviction")
def whale_conviction_cmd() -> None:
    """Re-derive whale_conviction_signals from the latest flow + dark pool +
    insider + congress + IV regime + market tide. Run every ~5min during RTH.

    Heuristic 0..100 score per (ticker, window ∈ {4h, 24h}) with the why
    captured as a JSON list so the UI can render the rationale pills."""
    from cfp_jobs import score_whale_conviction

    out = score_whale_conviction.run(settings.database_url)
    console.print(f"[green]whale_conviction:[/green] {out}")


@app.command("flow-congress")
def flow_congress_cmd(
    limit: int = typer.Option(500, help="Max recent trades to ingest"),
) -> None:
    """Pull recent congressional trades."""
    if not settings.unusual_whales_api_key:
        console.print("[red]UNUSUAL_WHALES_API_KEY not set[/red]")
        raise typer.Exit(1)
    n = ingestion.unusualwhales.ingest_congress(
        settings.database_url, settings.unusual_whales_api_key, limit=limit
    )
    console.print(f"[green]congress_trades:[/green] {n} new rows")


@app.command("verify-insiders")
def verify_insiders_cmd(
    ticker: str = typer.Argument(..., help="Stock ticker, e.g. NVDA"),
    days: int = typer.Option(180, help="Lookback window in days"),
) -> None:
    """Cross-check uw_insider_transactions for a ticker against SEC EDGAR Form 4.

    Reports matches and discrepancies on transaction date. Useful for confirming
    that the chart's insider-sell markers correspond to real SEC filings, and
    for catching gaps in the Unusual Whales feed."""
    from cfp_jobs import verify_insiders as vi

    try:
        report = vi.verify(settings.database_url, ticker, days=days)
    except Exception as e:  # network / SEC throttle / parse — surface clearly
        console.print(f"[red]verify failed:[/red] {e}")
        raise typer.Exit(1) from e

    console.print(f"[bold]{report['ticker']}[/bold] insider verification, since {report['since']}")
    console.print(f"  DB rows:      {report['db_count']}")
    console.print(f"  EDGAR rows:   {report['edgar_count']}")
    console.print(f"  matched dates: {len(report['matched_dates'])}")
    if report["db_only_dates"]:
        console.print(f"  [yellow]DB-only dates ({len(report['db_only_dates'])}):[/yellow] "
                      f"{', '.join(report['db_only_dates'][:10])}")
    if report["edgar_only_dates"]:
        console.print(f"  [yellow]EDGAR-only dates ({len(report['edgar_only_dates'])}):[/yellow] "
                      f"{', '.join(report['edgar_only_dates'][:10])}")
    if report["edgar_sample_urls"]:
        console.print("  Sample EDGAR filings:")
        for url in report["edgar_sample_urls"]:
            console.print(f"    {url}")


@app.command("skylit-login")
def skylit_login_cmd(
    env_file: str = typer.Option(
        "",
        "--env-file",
        help="Target .env file to update (default: ~/gexester vexster/.env)",
    ),
    timeout: int = typer.Option(300, help="Max seconds to wait for Discord OAuth"),
) -> None:
    """Open Chromium, sign in to skylit.ai with Discord, write Clerk cookies to .env.

    Discord blocks programmatic password login (captcha + ToS), so we drive a
    real browser. You sign in once; the script captures the long-lived
    __client cookie + session id and writes them to the target .env. After
    that, the gexester-vexster Clerk auto-refresh keeps JWTs fresh for months.
    """
    from pathlib import Path

    from cfp_jobs import skylit_login

    target = Path(env_file).expanduser() if env_file else skylit_login.DEFAULT_ENV_FILE
    console.print(f"Target .env: [cyan]{target}[/cyan]")
    console.print(
        "[yellow]A Chromium window will open.[/yellow] Sign in with Discord, "
        "complete any captcha/2FA, and wait for the redirect back to app.skylit.ai."
    )
    try:
        creds = skylit_login.capture_clerk_cookies(timeout_s=timeout)
    except RuntimeError as e:
        console.print(f"[red]Login failed:[/red] {e}")
        raise typer.Exit(1) from e

    skylit_login.write_to_env_file(target, creds)
    console.print(
        f"[green]Saved Clerk cookies to {target}[/green]\n"
        f"  CLERK_SESSION_ID={creds['session_id'][:24]}...\n"
        f"  CLERK_CLIENT_COOKIE={creds['client_cookie'][:24]}...\n"
        f"  CLERK_CLIENT_UAT={creds['client_uat'][:24]}..."
    )


@app.command()
def status() -> None:
    """Report row counts and freshness per data table."""
    query = """
        SELECT 'prices_daily' AS tbl, COUNT(*) AS rows, MAX(ts)::text AS latest,
               COUNT(DISTINCT symbol) AS distinct_keys
        FROM prices_daily
        UNION ALL
        SELECT 'macro_daily', COUNT(*), MAX(ts)::text, COUNT(DISTINCT series_id)
        FROM macro_daily
        UNION ALL
        SELECT 'etf_flows_weekly', COUNT(*), MAX(week_end)::text, COUNT(DISTINCT symbol)
        FROM etf_flows_weekly
        UNION ALL
        SELECT 'gex_daily', COUNT(*), MAX(ts)::text, COUNT(DISTINCT symbol)
        FROM gex_daily
        UNION ALL
        SELECT 'features_daily', COUNT(*), MAX(ts)::text,
               COUNT(DISTINCT (symbol, feature_set))
        FROM features_daily
        UNION ALL
        SELECT 'lead_lag_matrix', COUNT(*), MAX(computed_ts)::text, COUNT(DISTINCT follower)
        FROM lead_lag_matrix
        ORDER BY tbl
    """
    with psycopg.connect(to_psycopg_url(settings.database_url)) as conn, conn.cursor() as cur:
        cur.execute(query)
        results = cur.fetchall()

    table = Table(title="Data status")
    table.add_column("Table")
    table.add_column("Rows", justify="right")
    table.add_column("Latest")
    table.add_column("Distinct keys", justify="right")
    for tbl, rows, latest, keys in results:
        table.add_row(tbl, f"{rows:,}", str(latest or "—"), str(keys))
    console.print(table)


if __name__ == "__main__":
    app()
