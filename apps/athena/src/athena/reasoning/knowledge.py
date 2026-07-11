"""Bridge to the brain vault. Same venv (uv workspace), so we import directly —
no subprocess. T1 (the user's validated findings) always leads the context.
"""

from __future__ import annotations

from pathlib import Path

from brain import index as brain_index

MAX_DOC_CHARS = 6000


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
    return "\n\n".join(blocks[: limit * 2])
