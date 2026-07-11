"""Trading knowledge brain CLI.

Usage:
    brain seed                     # ingest the repo's own T1 research into the vault
    brain index [--rebuild]        # (re)build the FTS5 index from vault/ + inbox/
    brain search "<question>"      # trust-tier-ordered full-text search
    brain gaps                     # open knowledge gaps (weak queries) to learn toward
"""

from __future__ import annotations

import json

from dotenv import load_dotenv

load_dotenv()

import typer  # noqa: E402
from rich.console import Console  # noqa: E402
from rich.table import Table  # noqa: E402

from brain import config as cfg  # noqa: E402
from brain import index as index_mod  # noqa: E402
from brain import seed as seed_mod  # noqa: E402

app = typer.Typer(
    add_completion=False,
    help="Trading knowledge brain — markdown vault + FTS5 index",
)
console = Console()


@app.command()
def seed() -> None:
    """Ingest the repo's own validated research (T1) into vault/my-findings."""
    written = seed_mod.run()
    console.print(f"[green]Seeded {len(written)} T1 docs[/green] into {cfg.VAULT_DIR / 'my-findings'}")
    count = index_mod.reindex()
    console.print(f"[green]Indexed {count} documents[/green]")


@app.command()
def index(rebuild: bool = typer.Option(False, "--rebuild", help="Drop and repopulate")) -> None:
    """(Re)build the FTS5 index from vault/ + inbox/ markdown."""
    count = index_mod.reindex(rebuild=rebuild)
    console.print(f"[green]Indexed {count} documents[/green] -> {cfg.INDEX_DB}")


@app.command()
def search(
    question: str = typer.Argument(..., help="Natural-language question or FTS terms"),
    tier: int | None = typer.Option(None, "--tier", help="Only tiers <= N"),
    limit: int = typer.Option(8, "--limit"),
    include_inbox: bool = typer.Option(False, "--include-inbox"),
    as_json: bool = typer.Option(False, "--json", help="JSON output (for the skill)"),
) -> None:
    """Search the brain. Results ordered by trust tier, then relevance."""
    hits = index_mod.search(question, tier=tier, limit=limit, include_inbox=include_inbox)
    if as_json:
        print(json.dumps([h.as_dict() for h in hits], indent=2))
        return
    if not hits:
        console.print("[yellow]No hits — logged as a knowledge gap. Try `/brain learn`.[/yellow]")
        return
    table = Table(title=f"brain: {question}")
    table.add_column("tier")
    table.add_column("title")
    table.add_column("category")
    table.add_column("path", overflow="fold")
    for h in hits:
        table.add_row(cfg.TIER_LABELS.get(h.trust_tier, str(h.trust_tier)), h.title, h.category, h.path)
    console.print(table)


@app.command()
def gaps(
    resolve: int | None = typer.Option(None, "--resolve", help="Mark gap id resolved"),
    as_json: bool = typer.Option(False, "--json"),
) -> None:
    """Knowledge gaps: questions the brain answered weakly. Learning targets."""
    if resolve is not None:
        index_mod.resolve_gap(resolve)
        console.print(f"[green]Gap {resolve} resolved[/green]")
        return
    rows = index_mod.open_gaps()
    if as_json:
        print(json.dumps([dict(r) for r in rows], indent=2))
        return
    if not rows:
        console.print("No open gaps — the brain has answered everything it's been asked.")
        return
    table = Table(title="Open knowledge gaps")
    table.add_column("id")
    table.add_column("query")
    table.add_column("asked")
    table.add_column("hits")
    for r in rows:
        table.add_row(str(r["id"]), r["query"], r["asked_at"], str(r["result_count"]))
    console.print(table)


if __name__ == "__main__":
    app()
