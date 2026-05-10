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


@app.command("flow-holdings")
def flow_holdings_cmd(
    etfs: str = typer.Option("", help="Comma-separated ETF tickers; default = PREDICTION_TARGETS"),
) -> None:
    """Refresh full ETF constituent lists via Unusual Whales /etfs/{etf}/holdings.

    Replaces the yfinance top-10 stub with the full holding list including
    per-constituent pricing + options sentiment. Powers /sectors/[etf]."""
    if not settings.unusual_whales_api_key:
        console.print("[red]UNUSUAL_WHALES_API_KEY not set[/red]")
        raise typer.Exit(1)
    etf_list = [e.strip().upper() for e in etfs.split(",") if e.strip()] if etfs else list(PREDICTION_TARGETS)
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
