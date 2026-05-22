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
from cfp_shared.universe import FRED_SERIES, PREDICTION_TARGETS  # noqa: E402
from cfp_jobs.ingestion.ingest_universe import full_ingest_universe  # noqa: E402
from rich.console import Console  # noqa: E402
from rich.table import Table  # noqa: E402

from cfp_jobs import agents_runner, ingestion, migrate  # noqa: E402
from cfp_jobs import delphi_evaluate as delphi_evaluate_mod  # noqa: E402
from cfp_jobs import delphi_rank as delphi_rank_mod  # noqa: E402
from cfp_jobs import features as features_mod  # noqa: E402
from cfp_jobs import morning_brief as morning_brief_mod  # noqa: E402
from cfp_jobs import rerun_stale as rerun_stale_mod  # noqa: E402
from cfp_jobs import score_explosive as score_explosive_mod  # noqa: E402
from cfp_jobs import watchlist as watchlist_mod  # noqa: E402
from cfp_jobs.db import to_psycopg_url  # noqa: E402
from cfp_jobs.ingestion import explosive as explosive_mod  # noqa: E402
from cfp_jobs.ingestion import catalysts as catalysts_mod  # noqa: E402
from cfp_jobs.ingestion import gex_spot as gex_spot_mod  # noqa: E402
from cfp_jobs.ingestion import institutional as institutional_mod  # noqa: E402
from cfp_jobs.ingestion import screeners as screeners_mod  # noqa: E402
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
    """Backfill prices (yfinance) and macro (FRED) for the full universe.

    Universe = static (sector ETFs + themes + benchmarks + cross-asset +
    cohort members) ∪ every distinct ticker UW has in uw_etf_holdings.
    The latter pulls in ETF constituents like AAPL, ABBV, and international
    names like 3800.HK / SLR.MC / ENLT.TA so the holdings drill-down can
    show real 5d/20d/60d returns for every row.
    """
    start = datetime.now(UTC) - timedelta(days=365 * years)
    symbols = full_ingest_universe(settings.database_url)

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
    """Incremental ingest. Pulls last `lookback_days` to absorb late corrections.

    Same expanded universe as `backfill` — static config ∪ uw_etf_holdings.
    """
    start = datetime.now(UTC) - timedelta(days=lookback_days)
    symbols = full_ingest_universe(settings.database_url)

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


    # train-baseline + evaluate CLI commands removed: the XGB sector-rotation
    # pipeline they served was retired after a 90-day audit showed it had
    # produced exactly one prediction snapshot ever. The whole pipeline (train
    # job, predictions table, /v1/rankings, /v1/sectors/scorecard,
    # /v1/sectors/forward-call) is gone. The sector heatmap, network graph,
    # assistant tools, and watchlist orchestrator all rank by realized return
    # now — honest, no model.


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
        except Exception as e:
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
    from cfp_jobs import predict_reddit

    out = predict_reddit.run(settings.database_url)
    console.print(f"[green]reddit_predictions:[/green] {out}")


@app.command("reddit-backfill-outcomes")
def reddit_backfill_outcomes_cmd() -> None:
    """Fill realized 20d/5d returns on matured reddit_predictions and reddit_posts.

    Anchor date + ~28 calendar days must have passed before a row becomes
    scoreable. Idempotent; safe to run multiple times per day. Run nightly
    after the price-data refresh."""
    from cfp_jobs import backfill_reddit_outcomes

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
            except Exception as e:
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


@app.command("skylit-bootstrap")
def skylit_bootstrap_cmd(
    env_file: str = typer.Option(
        "",
        "--env-file",
        help="Source .env to read CLERK_* from (default: ~/gexester vexster/.env)",
    ),
    api_url: str = typer.Option(
        "",
        "--api-url",
        envvar="BELLWETHER_API_URL",
        help="Bellwether API base URL",
    ),
    api_key: str = typer.Option(
        "",
        "--api-key",
        envvar="BELLWETHER_API_KEY",
        help="API key for Bellwether",
    ),
) -> None:
    """One-time seed: read CLERK_* from a local .env and POST to /v1/skylit/credentials.

    Used the day you migrate from the standalone gexester repo to the monorepo
    layout. After this runs, the Railway-hosted gex service finds the cookies
    in Postgres on its next boot and you don't have to re-do Discord OAuth.

    Subsequent re-auths use `cfp-jobs skylit-watch` + the /gex UI button.
    """
    from pathlib import Path

    from cfp_jobs import skylit_bootstrap, skylit_login

    if not api_url or not api_key:
        console.print("[red]--api-url / BELLWETHER_API_URL and --api-key / BELLWETHER_API_KEY are required[/red]")
        raise typer.Exit(2)

    target = Path(env_file).expanduser() if env_file else skylit_login.DEFAULT_ENV_FILE
    console.print(f"Reading CLERK_* from [cyan]{target}[/cyan]")
    try:
        result = skylit_bootstrap.bootstrap_from_env(
            env_file=target, api_url=api_url, api_key=api_key,
        )
    except FileNotFoundError as e:
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(1) from e
    except RuntimeError as e:
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(1) from e
    except Exception as e:  # network, HTTP, etc.
        console.print(f"[red]Upload failed: {e}[/red]")
        raise typer.Exit(1) from e

    console.print(
        f"[green]Seeded skylit_credentials[/green] | "
        f"session {result.get('session_id_prefix', '?')}... | "
        f"captured_at {result.get('captured_at', '?')}"
    )


@app.command("skylit-watch")
def skylit_watch_cmd(
    api_url: str = typer.Option(
        "",
        "--api-url",
        envvar="BELLWETHER_API_URL",
        help="Bellwether API base URL (e.g. https://capital-flow-predictor-production.up.railway.app)",
    ),
    api_key: str = typer.Option(
        "",
        "--api-key",
        envvar="BELLWETHER_API_KEY",
        help="API key for Bellwether (matches API_KEYS on the server)",
    ),
    env_file: str = typer.Option(
        "",
        "--env-file",
        help="Target .env to update (default: ~/gexester vexster/.env)",
    ),
    oauth_timeout: int = typer.Option(
        300,
        "--oauth-timeout",
        help="Max seconds to wait for Discord OAuth after browser opens",
    ),
) -> None:
    """Long-poll Bellwether for UI-initiated re-auth requests; run Playwright.

    Designed to run on your laptop. When the operator clicks the "Re-auth
    skylit" button in the Bellwether UI tab, this daemon's next long-poll
    returns the claimed request, Chromium opens, you complete Discord OAuth,
    and the captured cookies land in gexester's .env automatically.

    Keep this running in a terminal (or wire into your laptop's launch
    items). Ctrl-C to stop.
    """
    from cfp_jobs import skylit_watch

    skylit_watch.cli_run(
        api_url=api_url, api_key=api_key,
        env_file=env_file or None, oauth_timeout=oauth_timeout,
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


@app.command("flow-backfill")
def flow_backfill_cmd(
    ticker: str = typer.Argument(..., help="Ticker symbol, e.g. NVDA"),
    days: int = typer.Option(365, help="Calendar days to walk back."),
    chunk_days: int = typer.Option(30, help="Page size in days (shrink for busy names)."),
) -> None:
    """Backfill UW flow alerts for a single ticker.

    The default ingest only pulls the most recent 200 alerts. This command
    walks back in `chunk_days` windows so per-ticker history matches UW
    retention. Idempotent — re-run safely to fill gaps.
    """
    api_key = (settings.unusual_whales_api_key or "").strip()
    if not api_key:
        console.print("[red]UNUSUAL_WHALES_API_KEY not set; aborting.[/]")
        raise typer.Exit(code=1)
    result = ingestion.unusualwhales.ingest_flow_history(
        settings.database_url, api_key, ticker, days=days, chunk_days=chunk_days,
    )
    console.print(
        f"{result['ticker']}: fetched {result['fetched']} alerts, "
        f"upserted {result['upserted']} (requested ~{result['days_requested']}d)"
    )


@app.command("ensemble-rerun-stale")
def ensemble_rerun_stale_cmd(
    max_tickers: int = typer.Option(30, help="Cap on how many tickers to re-analyze."),
    flow_premium: float = typer.Option(1_000_000.0, help="Min $ premium for flow-alert inclusion."),
    stale_hours: int = typer.Option(48, help="Re-include tickers whose latest PM run is older than this."),
    dry_run: bool = typer.Option(False, help="Pick candidates and print, but do not run the ensemble."),
) -> None:
    """Catalyst-triggered ensemble re-runs.

    Picks tickers worth analyzing today (custom watchlist + big flow + insider
    buys + earnings tomorrow + stale PM signals), dedups, caps, and runs the
    ensemble on each. Designed for the daily 06:00 ET cron — cheap enough
    that the screener stays fresh without scanning a fixed universe.
    """
    summary = rerun_stale_mod.run(
        settings.database_url,
        max_tickers=max_tickers,
        flow_premium_threshold=flow_premium,
        stale_hours=stale_hours,
        dry_run=dry_run,
    )
    console.print(f"sources: {summary['sources']}")
    console.print(f"queue ({len(summary['queue'])}): {[q['ticker'] for q in summary['queue']]}")
    if not dry_run:
        console.print(f"ran ok: {len(summary['ran'])}  failed: {len(summary['failed'])}")
        for f in summary["failed"]:
            console.print(f"  ✗ {f['ticker']}: {f['error']}")


@app.command("score-discord-plays")
def score_discord_plays_cmd(
    days: int = typer.Option(30, help="Calendar days of open plays to (re)score."),
) -> None:
    """Mark-to-market the parsed Discord plays in discord_alert_plays.

    For each open play, snapshots entry_underlying (if missing) using the
    underlying price closest to captured_at, refreshes current_underlying
    to the latest print, recomputes direction-adjusted pnl_pct_underlying,
    and marks final status for plays whose expiry has passed. Idempotent.

    Designed to run on a Railway cron every 5 min during RTH (or GH Actions).
    """
    from cfp_jobs import score_discord_plays

    summary = score_discord_plays.run(settings.database_url, days=days)
    console.print(
        f"[green]discord-plays:[/green] seen={summary['seen']} "
        f"updated={summary['updated']} closed={summary['closed']} "
        f"finished={summary['finished_at']}"
    )


@app.command("dispatch-discord-notifications")
def dispatch_discord_notifications_cmd(
    lookback: int = typer.Option(
        30, help="Minutes of recent messages to consider for dispatch."
    ),
) -> None:
    """Push high-confluence Discord alerts to configured webhooks.

    Reads discord_notification_rules and the discord_alert_scores cache;
    for each (rule, message, ticker) tuple that meets the rule's confluence
    threshold and hasn't been dispatched yet, POSTs to ntfy or a Discord
    webhook URL. Idempotent via discord_notifications PK.
    """
    from cfp_jobs import dispatch_discord_notifications

    summary = dispatch_discord_notifications.run(
        settings.database_url, lookback_minutes=lookback
    )
    console.print(
        f"[green]discord-notify:[/green] seen={summary['seen']} "
        f"dispatched={summary['dispatched']} failed={summary['failed']} "
        f"finished={summary['finished_at']}"
    )


@app.command("score-gex-plans")
def score_gex_plans_cmd(
    days: int = typer.Option(7, help="Calendar days of gex_feed plans to (re)score."),
) -> None:
    """Score brief/monitor plan calls against actual SPY/QQQ/SPXW price action.

    Parses CALLS/PUTS plan lines from gex_feed, pulls yfinance intraday bars
    for the trading day, determines whether the break level was crossed and
    whether target hit before stop, and upserts one row per (feed_id, ticker,
    side) into gex_plan_outcomes. Idempotent — designed for the GH Actions
    nightly cron at ~22:00 ET.
    """
    from cfp_jobs import score_gex_plans

    summary = score_gex_plans.run(settings.database_url, days=days)
    console.print(
        f"[green]gex-plan-scoring:[/green] seen={summary['plans_seen']} "
        f"scored={summary['scored']} errors={summary['errors']} "
        f"finished={summary['finished_at']}"
    )


@app.command("morning-brief")
def morning_brief_cmd(
    webhook: str = typer.Option(
        "",
        envvar="MORNING_BRIEF_WEBHOOK_URL",
        help=(
            "Discord/Slack webhook URL. If empty, the brief is printed to stdout "
            "and NOT posted. Read from MORNING_BRIEF_WEBHOOK_URL env if unset."
        ),
    ),
    dry_run: bool = typer.Option(False, help="Build the brief but never post."),
) -> None:
    """Build the pre-market brief and (optionally) POST it to a webhook.

    Designed for the GH Actions data-refresh cron at 09:00 ET on weekdays.
    """
    target = "" if dry_run else webhook
    brief = morning_brief_mod.run(settings.database_url, webhook_url=target)
    n = sum(len(brief.get(k, [])) for k in ("rank_movers", "watchlist_deltas", "stale_tables", "earnings_today_tomorrow"))
    console.print(f"morning-brief: {n} entries across all sections")
    if target:
        console.print(f"  posted: {brief.get('_post_status')}")


@app.command("explosive-ingest")
def explosive_ingest_cmd(
    max_tickers: int = typer.Option(
        80,
        help="Cap on per-ticker pulls per run; keeps UW request budget healthy",
    ),
) -> None:
    """Refresh all UW endpoints feeding the /explosive tab:
      1. Market screeners (contract_screener, short_screener, FDA, IPO)
      2. Catalyst universe (contract_screener ∪ FDA ∪ IPO ∪ earnings-next-10d)
      3. Per-ticker flow/IV/max-pain/FTD for everyone in the universe

    Each per-ticker pull is 5 calls. With universe ≈80 and screeners = 4 calls,
    a run uses ~404 UW calls — well inside the 20K/day budget. Run every ~15min
    during RTH."""
    if not settings.unusual_whales_api_key:
        console.print("[red]UNUSUAL_WHALES_API_KEY not set[/red]")
        raise typer.Exit(1)
    out = explosive_mod.ingest_explosive_universe(
        settings.database_url,
        settings.unusual_whales_api_key,
        max_tickers=max_tickers,
    )
    console.print(
        f"[green]explosive-ingest:[/green] universe={out.get('universe_size', 0)} "
        f"screeners={out.get('phase', {}).get('screeners')}"
    )


@app.command("explosive-score")
def explosive_score_cmd() -> None:
    """Compute and persist explosive_scores from the tables refreshed by
    `cfp-jobs explosive-ingest`. Run immediately after ingestion."""
    out = score_explosive_mod.score_all(settings.database_url)
    console.print(f"[green]explosive-score:[/green] {out.get('count')} tickers scored")
    for entry in out.get("top", []):
        console.print(f"  {entry['ticker']:6s}  {entry['score']:>5.1f}")


@app.command("explosive-drilldown")
def explosive_drilldown_cmd(
    history_limit: int = typer.Option(40, help="How many top contracts to backfill history for"),
    correlations_limit: int = typer.Option(25, help="How many top tickers to fetch peer correlations for"),
) -> None:
    """Drilldown refresh: per-contract history for the top scored contracts +
    peer correlations for the top tickers. Run AFTER `explosive-score` so the
    "top contracts" are based on the latest ranking. Powers the per-ticker
    detail page at /explosive/{ticker}."""
    if not settings.unusual_whales_api_key:
        console.print("[red]UNUSUAL_WHALES_API_KEY not set[/red]")
        raise typer.Exit(1)
    hist_counts = explosive_mod.ingest_top_contract_history(
        settings.database_url, settings.unusual_whales_api_key, limit=history_limit
    )
    corr_n = explosive_mod.ingest_correlations_for_top(
        settings.database_url, settings.unusual_whales_api_key, limit=correlations_limit
    )
    console.print(
        f"[green]explosive-drilldown:[/green] history contracts={len(hist_counts)} "
        f"correlations rows={corr_n}"
    )


# ---------- catalysts / spot-GEX / institutional (migrations 0028-0030) ----


def _explosive_universe() -> list[str]:
    """Resolve the per-ticker pull list. Same catalyst-aware watchlist the
    explosive scanner already uses, so we keep one universe definition."""
    return explosive_mod.resolve_explosive_universe(settings.database_url)


@app.command("catalysts-ingest")
def catalysts_ingest_cmd(
    days_ahead: int = typer.Option(7, help="Calendar window for earnings + economic"),
    skip_per_ticker: bool = typer.Option(
        False, help="Skip per-ticker dividends/splits (slower)"
    ),
) -> None:
    """Pull UW catalyst feeds: earnings pre/post calendar, analyst ratings,
    economic calendar (market-wide) + dividends/splits per universe ticker."""
    if not settings.unusual_whales_api_key:
        console.print("[red]UNUSUAL_WHALES_API_KEY not set[/red]")
        raise typer.Exit(1)
    mkt = catalysts_mod.ingest_market_catalysts(
        settings.database_url, settings.unusual_whales_api_key, days_ahead=days_ahead
    )
    console.print(
        f"[green]catalysts (market):[/green] earnings_pre={mkt['earnings_pre']} "
        f"earnings_post={mkt['earnings_post']} analyst={mkt['analyst_ratings']} "
        f"econ={mkt['economic']}"
    )
    if not skip_per_ticker:
        universe = _explosive_universe()
        if universe:
            pt = catalysts_mod.ingest_per_ticker_catalysts(
                settings.database_url, settings.unusual_whales_api_key, universe
            )
            console.print(
                f"[green]catalysts (per-ticker):[/green] tickers={pt['tickers']} "
                f"dividends={pt['dividends']} splits={pt['splits']}"
            )


@app.command("spot-gex-ingest")
def spot_gex_ingest_cmd(
    tickers: str = typer.Option(
        "",
        help="Comma-separated tickers; if empty, uses the explosive universe",
    ),
) -> None:
    """Pull 1-minute spot-GEX series from UW for each ticker.
    Persists to uw_spot_gex_intraday."""
    if not settings.unusual_whales_api_key:
        console.print("[red]UNUSUAL_WHALES_API_KEY not set[/red]")
        raise typer.Exit(1)
    if tickers:
        universe = [t.strip().upper() for t in tickers.split(",") if t.strip()]
    else:
        universe = _explosive_universe()
    if not universe:
        console.print("[yellow]spot-gex-ingest:[/yellow] no tickers")
        return
    out = gex_spot_mod.ingest_spot_gex_intraday(
        settings.database_url, settings.unusual_whales_api_key, universe
    )
    console.print(
        f"[green]spot-gex:[/green] tickers={out['tickers']} rows={out['rows']} "
        f"failed={out['failed']}"
    )


@app.command("institutional-ingest")
def institutional_ingest_cmd(
    skip_per_ticker: bool = typer.Option(
        False, help="Skip per-ticker ownership / insider buy-sell pulls"
    ),
) -> None:
    """Pull UW institutional feeds: activity firehose, latest 13F filings,
    market-wide insider buy/sells (market-wide) + per-ticker ownership +
    insider buy/sell aggregates for the explosive universe."""
    if not settings.unusual_whales_api_key:
        console.print("[red]UNUSUAL_WHALES_API_KEY not set[/red]")
        raise typer.Exit(1)
    mkt = institutional_mod.ingest_market_institutional(
        settings.database_url, settings.unusual_whales_api_key
    )
    console.print(
        f"[green]institutional (market):[/green] activity={mkt['activity']} "
        f"latest_filings={mkt['latest_filings']} market_insider={mkt['market_insider']}"
    )
    if not skip_per_ticker:
        universe = _explosive_universe()
        if universe:
            pt = institutional_mod.ingest_per_ticker_institutional(
                settings.database_url, settings.unusual_whales_api_key, universe
            )
            console.print(
                f"[green]institutional (per-ticker):[/green] tickers={pt['tickers']} "
                f"ownership={pt['ownership']} stock_insider={pt['stock_insider']}"
            )


@app.command("uw-screeners-ingest")
def uw_screeners_ingest_cmd() -> None:
    """Phase A: refresh all market-level UW endpoints feeding the funnel.

    Pulls:
      - /screener/stocks         -> uw_screener_stocks (primary universe seed)
      - /market/oi-change        -> uw_market_oi_change
      - /lit-flow/recent         -> uw_lit_flow_recent
      - /darkpool/recent         -> uw_darkpool_recent
      - /news/headlines (global) -> uw_news_global

    Designed to run every 15 minutes. Each endpoint is independent — if
    one 403/404/500s on the current subscription tier, the others still
    populate.
    """
    if not settings.unusual_whales_api_key:
        console.print("[red]UNUSUAL_WHALES_API_KEY not set[/red]")
        raise typer.Exit(1)
    out = screeners_mod.ingest_uw_market_layer(
        settings.database_url, settings.unusual_whales_api_key
    )
    console.print(
        f"[green]uw-screeners-ingest:[/green] "
        f"screener_stocks={out.get('screener_stocks', 0)} "
        f"market_oi_change={out.get('market_oi_change', 0)} "
        f"lit_flow_recent={out.get('lit_flow_recent', 0)} "
        f"darkpool_recent={out.get('darkpool_recent', 0)} "
        f"news_global={out.get('news_global', 0)}"
    )


@app.command("uw-gex-ingest")
def uw_gex_ingest_cmd(
    tickers: str = typer.Option(
        "",
        help="Comma-separated tickers. If empty, uses the explosive universe.",
    ),
) -> None:
    """Phase A: per-ticker deep GEX ingest.

    For each ticker pulls:
      - /stock/{t}/greek-exposure/strike -> uw_greek_exposure_strike
      - /stock/{t}/greek-exposure/expiry -> uw_greek_exposure_expiry
      - /stock/{t}/greek-flow            -> uw_greek_flow
      - /lit-flow/{t}                    -> uw_lit_flow_ticker

    Run after `uw-screeners-ingest` so the universe is already built.
    """
    if not settings.unusual_whales_api_key:
        console.print("[red]UNUSUAL_WHALES_API_KEY not set[/red]")
        raise typer.Exit(1)
    if tickers.strip():
        symbols = [t.strip().upper() for t in tickers.split(",") if t.strip()]
    else:
        symbols = _explosive_universe()
    if not symbols:
        console.print("[yellow]no tickers[/yellow]")
        return
    totals = {"strike": 0, "expiry": 0, "flow": 0, "lit": 0}
    for sym in symbols:
        counts = screeners_mod.ingest_gex_for_ticker(
            settings.database_url, settings.unusual_whales_api_key, sym
        )
        totals["strike"] += counts.get("strike", 0)
        totals["expiry"] += counts.get("expiry", 0)
        totals["flow"] += counts.get("flow", 0)
        lit = screeners_mod.ingest_lit_flow_ticker(
            settings.database_url, settings.unusual_whales_api_key, sym
        )
        totals["lit"] += lit
    console.print(
        f"[green]uw-gex-ingest:[/green] tickers={len(symbols)} "
        f"strike={totals['strike']} expiry={totals['expiry']} "
        f"flow={totals['flow']} lit={totals['lit']}"
    )


@app.command("delphi-rank")
def delphi_rank_cmd(
    candidate_limit: int = typer.Option(
        50,
        help="Max candidates to pull from uw_screener_stocks; controls fan-out per run.",
    ),
) -> None:
    """Run the Delphi ranker — Stage 3 of the funnel.

    Consumes the latest uw_screener_stocks snapshot + uw_greek_exposure_strike
    walls and writes one prediction per (ticker, signal_timeframe, horizon)
    combination into delphi_predictions. Predictions are frozen; never
    mutated after creation. Outcomes get filled by delphi-evaluate once the
    horizon closes.
    """
    out = delphi_rank_mod.rank(
        settings.database_url, candidate_limit=candidate_limit
    )
    console.print(
        f"[green]delphi-rank:[/green] candidates={out.get('candidates', 0)} "
        f"written={out.get('predictions_written', 0)} "
        f"skipped={out.get('skipped_reachability', 0)} "
        f"horizons={out.get('horizons', {})}"
    )


@app.command("delphi-evaluate")
def delphi_evaluate_cmd(
    max_batch: int = typer.Option(
        500,
        help="Max predictions to score in one run; cap protects DB during backlog catch-up.",
    ),
) -> None:
    """Score every Delphi prediction whose horizon has closed.

    Reads daily bars between created_at and horizon_ends_at, classifies the
    outcome (win/loss/invalidated/breakeven), writes delphi_outcomes. Run
    hourly — idempotent against already-scored predictions.
    """
    out = delphi_evaluate_mod.evaluate(settings.database_url, max_batch=max_batch)
    console.print(
        f"[green]delphi-evaluate:[/green] due={out.get('due', 0)} "
        f"scored={out.get('scored', 0)} "
        f"wins={out.get('wins', 0)} losses={out.get('losses', 0)} "
        f"invalidated={out.get('invalidated', 0)} "
        f"skipped_no_data={out.get('skipped_no_price_data', 0)}"
    )


if __name__ == "__main__":
    app()
