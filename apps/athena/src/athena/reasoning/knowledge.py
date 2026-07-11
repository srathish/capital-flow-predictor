"""Bridge to the brain vault. Same venv (uv workspace), so we import directly —
no subprocess. T1 (the user's validated findings) always leads the context.
"""

from __future__ import annotations

from pathlib import Path

from brain import config as brain_config
from brain import index as brain_index

MAX_DOC_CHARS = 6000

# The doctrine spine: always the FIRST knowledge block in every thesis prompt.
# Seeded from apps/gex/research/exit-study/TRADING_DOCTRINE_v2.md; cite by clause.
SPINE_GLOB = "trading-doctrine-v2*.md"


def spine_block() -> str | None:
    """Doctrine v2 + the SYNTHESIS ledger (graduation states) — always first."""
    my_findings = brain_config.VAULT_DIR / "my-findings"
    if not my_findings.exists():
        return None
    blocks = []
    doctrine = sorted(my_findings.glob(SPINE_GLOB))
    if doctrine:
        body = doctrine[0].read_text(encoding="utf-8")[:MAX_DOC_CHARS * 2]
        blocks.append(
            f'<doc tier="T1" title="TRADING DOCTRINE v2 — THE SPINE (cite by clause)">\n{body}\n</doc>'
        )
    synthesis = sorted(my_findings.glob("synthesis-command-center*.md"))
    if synthesis:
        body = synthesis[0].read_text(encoding="utf-8")[:MAX_DOC_CHARS]
        blocks.append(
            f'<doc tier="T1" title="SYNTHESIS LEDGER — graduation states (leans are NOT confirmed)">\n{body}\n</doc>'
        )
    return "\n\n".join(blocks) if blocks else None


def context_for(query_terms: list[str], limit: int = 6) -> str:
    """Tier-ordered knowledge context block for the thesis prompt."""
    seen: set[str] = set()
    blocks: list[str] = []
    for terms in query_terms:
        for hit in brain_index.search(terms, limit=limit, log_gap=True):
            if hit.path in seen:
                continue
            seen.add(hit.path)
            body = Path(hit.path).read_text(encoding="utf-8")[:MAX_DOC_CHARS]
            blocks.append(
                f"<doc tier=\"T{hit.trust_tier}\" title=\"{hit.title}\" source=\"{hit.url}\">\n"
                f"{body}\n</doc>"
            )
    # T1 first — blocks arrive tier-ordered per query; a stable sort by tier tag keeps it strict
    blocks.sort(key=lambda b: b.split('tier="T', 1)[1][0])
    spine = spine_block()
    # the spine never counts against the retrieval budget and is never displaced
    kept = [b for b in blocks[: limit * 2] if "TRADING DOCTRINE v2" not in b.split("\n", 1)[0]]
    return "\n\n".join(([spine] if spine else []) + kept)
