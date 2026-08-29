"""Nest CLI.

Usage:
    nest cycle                       # one live cycle over the watchlist (ingest+score+call)
    nest cycle --offline             # score/gate the existing log without hitting UW
    nest grade                       # grade matured Calls at 1d/5d/20d, roll up weights
    nest book                        # current conviction book (latest score per ticker)
    nest tail --limit 40             # recent events (the field viz signal-log, in text)
    nest weights                     # live source weights + hit rates
    nest calibration --horizon 5d    # nest calibration by conviction bucket
    nest digest [--send]             # build (and optionally deliver) the morning digest
    nest kill / nest unkill          # the alert kill switch
"""

from __future__ import annotations

import json

from dotenv import load_dotenv

load_dotenv()

import logging  # noqa: E402

import typer  # noqa: E402
from rich.console import Console  # noqa: E402
from rich.table import Table  # noqa: E402

from nest import config  # noqa: E402
from nest.events.log import EventLog  # noqa: E402

app = typer.Typer(add_completion=False, help="Conviction Nest — persistent signal daemon (no execution)")
console = Console()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@app.command()
def cycle(
    offline: bool = typer.Option(False, "--offline", help="Score the log without hitting UW"),
    no_deliver: bool = typer.Option(False, "--no-deliver", help="Don't post Calls to Discord"),
) -> None:
    """Run one market-wide conviction cycle (ingest feeds → enrich → score → maybe Call)."""
    from nest import orchestrator
    from nest.ingest.uw_client import UWClient

    log = EventLog()
    uw = None if offline else UWClient()
    result = orchestrator.run_cycle(log, uw, deliver=not no_deliver)
    if uw:
        uw.close()
    log.close()
    console.print_json(json.dumps(result, default=str))


@app.command()
def run() -> None:
    """Run the resident scheduler only (no web) — for launchd."""
    from nest import daemon

    daemon.run()


@app.command()
def serve(port: int = typer.Option(None, "--port", help="Default: $PORT or 8080")) -> None:
    """Serve the field UI + /api/state AND run the scheduler — the hosted entrypoint."""
    from nest.ui.server import serve as _serve

    _serve(port)


@app.command()
def grade() -> None:
    """Grade matured Calls at 1d/5d/20d and roll up source weights."""
    from nest.ingest.uw_client import UWClient
    from nest.tracker import grader

    log = EventLog()
    uw = UWClient()
    written = grader.grade_due(log, grader._uw_price_fn(uw))
    uw.close()
    log.close()
    console.print(f"[green]wrote {len(written)} grades[/green]")


@app.command()
def book(limit: int = typer.Option(25, "--limit")) -> None:
    """Current conviction book — top names across the emergent universe."""
    log = EventLog()
    reg = log.latest_score("__MACRO__")
    if reg:
        console.print(f"[bold]Regime[/bold]: {reg.meta.get('tone','?')} "
                      f"(dial {reg.conviction:.0f}, floor Δ{reg.meta.get('floor_delta',0):+.0f})")
    table = Table(title="Conviction book")
    for col in ("ticker", "conviction", "direction", "contributors", "families", "delta"):
        table.add_column(col)
    for s in log.latest_scores(limit):
        table.add_row(s.ticker, f"{s.conviction:.0f}", s.direction,
                      ", ".join(s.contributors[:4]), ", ".join(s.families), f"{s.delta:+.0f}")
    console.print(table)
    log.close()


@app.command()
def tail(limit: int = typer.Option(40, "--limit"),
         type: str | None = typer.Option(None, "--type", help="signal|score|call|grade")) -> None:
    """Recent events — the field viz signal-log, as text."""
    log = EventLog()
    for e in reversed(log.tail(limit, type=type)):
        console.print_json(e.model_dump_json())
    log.close()


@app.command()
def weights(horizon: str = typer.Option("5d", "--horizon")) -> None:
    """Live source weights and hit rates (watching a source decay to zero is the system working)."""
    from nest.engine import weights as w

    log = EventLog()
    live = w.compute_all(log, horizon)
    rates = w._hit_rates(log, horizon)
    table = Table(title=f"Source weights ({horizon})")
    for col in ("source", "family", "prior", "weight", "hits", "n"):
        table.add_column(col)
    seen = sorted(set(list(config.SOURCE_PRIOR) + list(live)))
    for src in seen:
        hits, n = rates.get(src, (0, 0))
        table.add_row(src, config.family_of(src), f"{config.prior_of(src):.2f}",
                      f"{w.source_weight(src, live):.3f}", str(hits), str(n))
    console.print(table)
    log.close()


@app.command()
def calibration(horizon: str = typer.Option("5d", "--horizon")) -> None:
    """Nest calibration by conviction bucket — does 80+ mean 64% or a coin flip?"""
    from nest.tracker import grader

    log = EventLog()
    cal = grader.calibration(log, horizon)
    table = Table(title=f"Calibration ({horizon})")
    for col in ("bucket", "n", "hits", "hit_rate", "avg_ret"):
        table.add_column(col)
    for key, b in cal.buckets.items():
        table.add_row(key, str(b["n"]), str(b["hits"]),
                      f"{b['hit_rate']:.0%}" if b["hit_rate"] is not None else "—",
                      f"{b['avg_ret']:+.1f}%" if b["avg_ret"] is not None else "—")
    console.print(table)
    log.close()


@app.command()
def digest(send: bool = typer.Option(False, "--send", help="Deliver to Discord")) -> None:
    """Build (and optionally deliver) the morning digest."""
    from nest.delivery import digest as dg
    from nest.delivery import discord

    log = EventLog()
    text = dg.build(log)
    console.print(text)
    if send:
        discord.send_digest(text)
    log.close()


@app.command()
def learn(
    action: str = typer.Argument("show", help="propose | show | apply"),
    source: str = typer.Option(None, "--source", help="apply only this source (else all pending)"),
) -> None:
    """The human-gated learning loop. `propose` re-runs the backtest and writes prior
    proposals; `show` prints pending proposals + watch list; `apply` approves them into
    prior_overrides.json (takes effect next cycle, no redeploy)."""
    from nest.learn import proposer

    if action == "propose":
        from nest.ingest.uw_client import UWClient
        uw = UWClient()
        try:
            rec = proposer.propose(uw)
        finally:
            uw.close()
    elif action == "apply":
        applied = proposer.apply([source] if source else None)
        if not applied:
            console.print("[yellow]nothing to apply[/yellow]")
            return
        for a in applied:
            console.print(f"[green]applied[/green] {a['source']}: "
                          f"{a['current_prior']:.2f} → {a['suggested_prior']:.2f}")
        return
    else:  # show
        rec = proposer.pending()

    console.print(f"[bold]Learning proposals[/bold] — {rec.get('status','none')} "
                  f"({rec.get('window','')}) {rec.get('ts','')}")
    props = rec.get("proposals", [])
    if props:
        table = Table("source", "signal", "current", "suggested", "Δ", "20d IC", "t", "OOS", "L-S%")
        for p in props:
            table.add_row(p["source"], p["signal"], f"{p['current_prior']:.2f}",
                          f"{p['suggested_prior']:.2f}", f"{p['delta']:+.2f}",
                          f"{p['mean_ic']:+.3f}", f"{p['t_stat']:+.2f}", p["oos"],
                          str(p["ls_spread"]))
        console.print(table)
        console.print("[dim]run `nest learn apply` (or --source X) to approve[/dim]")
    else:
        console.print("[dim]no actionable proposals[/dim]")
    for w in rec.get("watch", []):
        console.print(f"[yellow]watch[/yellow] {w['source']}: {w['rationale']} — {w['note']}")


@app.command()
def kill() -> None:
    """Activate the kill switch — blocks every Call until `nest unkill`."""
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    config.KILL_FILE.touch()
    console.print("[red]KILL SWITCH ACTIVE[/red] — all Calls blocked")


@app.command()
def unkill() -> None:
    config.KILL_FILE.unlink(missing_ok=True)
    console.print("[green]kill switch cleared[/green]")


if __name__ == "__main__":
    app()
