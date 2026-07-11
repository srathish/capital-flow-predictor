"""YAML frontmatter build/parse and vault file naming."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import yaml
from slugify import slugify

FRONTMATTER_DELIM = "---"

# Fields every vault/inbox document carries. Order is the write order.
FIELDS = [
    "title",
    "source_url",
    "source_domain",
    "fetched_at",
    "trust_tier",
    "category",
    "topics",
    "summary",
    "url_sha1",
    "simhash",
    "status",  # vault | inbox
    "ingested_by",  # seed | ingest | learn | sweep
]


def build(meta: dict[str, Any], body: str) -> str:
    """Render a document: YAML frontmatter + markdown body."""
    ordered = {k: meta[k] for k in FIELDS if k in meta}
    ordered.update({k: v for k, v in meta.items() if k not in ordered})
    fm = yaml.safe_dump(ordered, sort_keys=False, allow_unicode=True, width=1000).strip()
    return f"{FRONTMATTER_DELIM}\n{fm}\n{FRONTMATTER_DELIM}\n\n{body.strip()}\n"


def parse(text: str) -> tuple[dict[str, Any], str]:
    """Split a document into (meta, body). Tolerates missing frontmatter.

    The closing delimiter must be a line consisting solely of `---` — a bare
    `str.split` would cut inside YAML values that contain markdown table rules.
    """
    lines = text.splitlines()
    if not lines or lines[0].strip() != FRONTMATTER_DELIM:
        return {}, text
    for i in range(1, len(lines)):
        if lines[i].strip() == FRONTMATTER_DELIM:
            meta = yaml.safe_load("\n".join(lines[1:i])) or {}
            if not isinstance(meta, dict):
                return {}, text
            return meta, "\n".join(lines[i + 1 :]).lstrip("\n")
    return {}, text


def filename_for(title: str, url_sha1: str) -> str:
    """`<slug>--<hash8>.md` — slug for humans, hash ties the file to its dedupe key."""
    slug = slugify(title, max_length=80) or "untitled"
    return f"{slug}--{url_sha1[:8]}.md"


def now_iso() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def summarize(body: str, max_chars: int = 300) -> str:
    """First substantive paragraph, truncated. No LLM at pipeline level."""
    for block in body.split("\n\n"):
        text = " ".join(
            line.strip() for line in block.splitlines() if not line.lstrip().startswith("#")
        ).strip()
        # Skip headings-only blocks, tables, and separator noise
        if len(text) > 60 and not text.startswith(("|", "```", "---", "===")):
            return text[:max_chars].rsplit(" ", 1)[0] + ("…" if len(text) > max_chars else "")
    return body.strip()[:max_chars]
