"""Athena CLI.

Usage:
    athena cycle --once --ticker SPY      # one decision cycle (add --no-llm for features only)
    athena run                            # market-hours loop at the configured cadence
    athena report                         # today's journal summary
    athena journal                        # recent cycles
    athena kill / athena unkill           # flip the kill switch
    athena endpoints                      # show the spec-verified UW whitelist
"""

from __future__ import annotations

import json

from dotenv import load_dotenv

load_dotenv()

import logging  # noqa: E402

import typer  # noqa: E402
from rich.console import Console  # noqa: E402
from rich.table import Table  # noqa: E402

from athena import config, orchestrator  # noqa: E402
from athena.journal import store  # noqa: E402
from athena.risk import gatekeeper  # noqa: E402

app = typer.Typer(add_completion=False, help="Athena — advisory signal generator (no execution)")
console = Console()

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@app.command()
def cycle(
    ticker: str | None = typer.Option(None, "--ticker", help="Single ticker (default: watchlist)"),
    once: bool = typer.Option(True, "--once/--loop"),
    no_llm: bool = typer.Option(False, "--no-llm", help="Features only, skip reasoning"),
) -> None:
    """Run one decision cycle (or the full loop with --loop)."""
    if not once:
        orchestrator.loop()
        return
    tickers = [ticker] if ticker else config.watchlist()
    for t in tickers:
        result = orchestrator.run_cycle(t, no_llm=no_llm)
        console.print_json(json.dumps(result, default=str))


@app.command()
def run() -> None:
    """Market-hours loop (09:31-16:00 ET, every CYCLE_MINUTES)."""
    orchestrator.loop()


@app.command()
def report() -> None:
    """Today's journal summary."""
    console.print_json(json.dumps(store.daily_report()))


@app.command()
def journal(limit: int = typer.Option(20, "--limit")) -> None:
    """Recent journal rows."""
    table = Table(title="Athena journal")
    for col in ("id", "ts", "ticker", "approved", "alerted", "gate_reasons", "error"):
        table.add_column(col)
    for r in store.recent(limit):
        table.add_row(str(r["id"]), r["ts"], r["ticker"], str(r["approved"]),
                      str(r["alerted"]), r["gate_reasons"] or "", r["error"] or "")
    console.print(table)


@app.command()
def eod(
    day: str = typer.Option(None, "--day", help="Trading day YYYY-MM-DD (default: today ET)"),
) -> None:
    """End-of-day pass: stamp node-dynamics (handoff precursor) on king_zone_obs."""
    from datetime import datetime
    from zoneinfo import ZoneInfo

    day = day or datetime.now(ZoneInfo("America/New_York")).date().isoformat()
    n = store.eod_king_pass(day)
    console.print(f"[green]stamped {n} ticker-day groups[/green] for {day}")


@app.command()
def kill() -> None:
    """Activate the kill switch — blocks every alert until `athena unkill`."""
    gatekeeper.kill(True)
    console.print("[red]KILL SWITCH ACTIVE[/red] — all alerts blocked")


@app.command()
def unkill() -> None:
    gatekeeper.kill(False)
    console.print("[green]kill switch cleared[/green]")


@app.command()
def ui(port: int = typer.Option(8321, "--port")) -> None:
    """Serve the Athena Console (local dashboard) at http://127.0.0.1:PORT."""
    from athena.ui.server import serve

    console.print(f"[bold]🦉 Athena Console[/bold] -> http://127.0.0.1:{port}")
    serve(port)


@app.command()
def endpoints() -> None:
    """Show the spec-verified UW endpoint whitelist."""
    from athena.perception.endpoints import WHITELIST

    for name, path in WHITELIST.items():
        console.print(f"{name:32s} {path}")


if __name__ == "__main__":
    app()
