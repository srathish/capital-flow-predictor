"""Trading knowledge brain CLI.

Usage:
    brain seed                     # ingest the repo's own T1 research into the vault
    brain index [--rebuild]        # (re)build the FTS5 index from vault/ + inbox/
    brain search "<question>"      # trust-tier-ordered full-text search
    brain gaps                     # open knowledge gaps (weak queries) to learn toward
    brain ingest <url>             # fetch + clean + file one page
    brain crawl [--only <source>]  # bulk-crawl the curated sources.yaml registry
    brain learn "<topic>"          # arXiv discovery -> inbox
    brain review --list|--promote|--reject
    brain sweep                    # scheduled feed re-poll -> inbox only
    brain sources                  # show the registry
"""

from __future__ import annotations

import json

from dotenv import load_dotenv

load_dotenv()

import logging  # noqa: E402

import typer  # noqa: E402
from rich.console import Console  # noqa: E402
from rich.table import Table  # noqa: E402

from brain import config as cfg  # noqa: E402
from brain import frontmatter  # noqa: E402
from brain import index as index_mod  # noqa: E402
from brain import seed as seed_mod  # noqa: E402

app = typer.Typer(
    add_completion=False,
    help="Trading knowledge brain — markdown vault + FTS5 index",
)
console = Console()

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


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


@app.command()
def ingest(
    url: str = typer.Argument(..., help="URL to fetch, clean, and file"),
    tier: int | None = typer.Option(None, "--tier", help="Trust tier 1-4 (default: registry/T4)"),
    category: str | None = typer.Option(None, "--category"),
    to: str = typer.Option("vault", "--to", help="vault | inbox"),
) -> None:
    """Fetch one page into the brain (idempotent on canonical URL)."""
    from brain import pipeline

    res = pipeline.ingest_url(url, tier=tier, category=category, to=to)
    color = "green" if res.reason.startswith("ok") else "red"
    console.print(f"[{color}]{res.reason}[/{color}] {res.path or url}")


@app.command()
def crawl(
    only: str | None = typer.Option(None, "--only", help="Single source name from sources.yaml"),
    to: str = typer.Option("vault", "--to"),
) -> None:
    """Bulk-crawl the curated source registry (Phase 2 initial crawl)."""
    from brain import pipeline

    results = pipeline.crawl(only=only, to=to)
    ok = sum(1 for r in results if r.reason.startswith("ok"))
    console.print(f"[green]{ok}/{len(results)} ingested[/green]")
    for r in results:
        if not r.reason.startswith("ok"):
            console.print(f"  [red]{r.reason}[/red] {r.url}")


@app.command()
def learn(
    topic: str = typer.Argument(..., help="Topic to learn about"),
    max_n: int = typer.Option(5, "--max"),
) -> None:
    """Scriptable discovery (arXiv) -> inbox. Pair with /brain learn for web sources."""
    from brain import pipeline

    results = pipeline.learn(topic, max_n=max_n)
    console.print(f"[green]{len(results)} candidates -> inbox[/green]. Run `brain review --list`.")


@app.command()
def review(
    list_items: bool = typer.Option(False, "--list"),
    promote: str | None = typer.Option(None, "--promote", help="hash8 of inbox doc"),
    category: str | None = typer.Option(None, "--category"),
    reject: str | None = typer.Option(None, "--reject", help="hash8 of inbox doc"),
) -> None:
    """Human gate: triage inbox docs into the vault (or out)."""
    from brain import pipeline

    if promote:
        if not category:
            raise typer.BadParameter("--promote requires --category")
        path = pipeline.promote(promote, category)
        console.print(f"[green]promoted[/green] -> {path}")
        return
    if reject:
        pipeline.reject(reject)
        console.print(f"[yellow]rejected[/yellow] {reject}")
        return
    if not cfg.INBOX_DIR.exists() or not any(cfg.INBOX_DIR.glob("*.md")):
        console.print("Inbox is empty.")
        return
    table = Table(title="Inbox (pending review)")
    table.add_column("hash8")
    table.add_column("title")
    table.add_column("tier")
    table.add_column("summary", overflow="fold")
    for p in sorted(cfg.INBOX_DIR.glob("*.md")):
        meta, _ = frontmatter.parse(p.read_text(encoding="utf-8"))
        hash8 = p.stem.rsplit("--", 1)[-1]
        table.add_row(hash8, str(meta.get("title", p.stem))[:60],
                      str(meta.get("trust_tier", "?")), str(meta.get("summary", ""))[:100])
    console.print(table)


@app.command()
def sweep(
    feeds_only: bool = typer.Option(True, "--feeds-only/--all-sources"),
) -> None:
    """Scheduled discovery of new material -> inbox only (never straight to vault)."""
    from brain import pipeline

    results = pipeline.sweep(feeds_only=feeds_only)
    fresh = [r for r in results if r.path is not None]
    console.print(f"[green]{len(fresh)} new inbox items[/green] ({len(results)} checked)")


@app.command()
def sources() -> None:
    """Show the curated source registry."""
    from brain import sources as sources_mod

    table = Table(title="Source registry")
    for col in ("name", "domain", "tier", "category", "fetcher", "discovery", "urls"):
        table.add_column(col)
    for s in sources_mod.load_sources():
        table.add_row(s.name, s.domain, str(s.trust_tier), s.category, s.fetcher,
                      s.discovery, str(len(s.seed_urls)))
    console.print(table)


if __name__ == "__main__":
    app()
