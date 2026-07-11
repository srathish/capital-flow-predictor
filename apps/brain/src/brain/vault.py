"""Vault placement: category routing and document writes."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from brain import config, frontmatter


def route(category: str, status: str = "vault") -> Path:
    """Directory a document belongs in. Inbox is flat — category applies on promote."""
    if status == "inbox":
        return config.INBOX_DIR
    if category not in config.CATEGORIES:
        raise ValueError(f"unknown category {category!r}; one of {config.CATEGORIES}")
    return config.VAULT_DIR / category


def write_doc(meta: dict[str, Any], body: str, status: str = "vault") -> Path:
    """Write (or overwrite — idempotent on url_sha1) a document. Returns its path."""
    meta = {**meta, "status": status}
    target_dir = route(meta["category"], status)
    target_dir.mkdir(parents=True, exist_ok=True)
    path = target_dir / frontmatter.filename_for(meta["title"], meta["url_sha1"])
    path.write_text(frontmatter.build(meta, body), encoding="utf-8")
    return path


def find_by_sha(url_sha1: str) -> Path | None:
    """Locate an existing document by its hash suffix (vault + inbox)."""
    suffix = f"--{url_sha1[:8]}.md"
    for base in (config.VAULT_DIR, config.INBOX_DIR):
        if base.exists():
            for p in base.rglob(f"*{suffix}"):
                return p
    return None


def all_docs() -> list[Path]:
    docs: list[Path] = []
    for base in (config.VAULT_DIR, config.INBOX_DIR):
        if base.exists():
            docs.extend(sorted(base.rglob("*.md")))
    return docs
