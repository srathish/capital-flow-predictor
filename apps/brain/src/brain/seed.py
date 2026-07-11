"""Seed the vault with the repo's own validated research (trust tier 1).

Whole-file copies with frontmatter stamps; source_url uses a repo:// scheme so
provenance survives even though these never came from the web.
"""

from __future__ import annotations

import re
from pathlib import Path

from brain import config, dedupe, frontmatter, vault

# Governance/process docs — not trading knowledge.
EXCLUDE_NAMES = {"CHARTER.md", "BACKLOG.md"}

# Extra topic tags keyed by research subdir.
DIR_TOPICS = {
    "gexvex-structure": ["gex", "vex", "structure", "spxw"],
    "vix": ["vix", "volatility"],
    "darkpool": ["dark-pool", "flow"],
    "uw": ["unusual-whales", "flow", "0dte"],
    "campaign": ["campaign", "plays"],
    "runner": ["hypothesis", "backtest"],
    "exit-study": ["exits", "0dte"],
    "wall-escalator": ["walls", "pin", "0dte"],
}

BASE_TOPICS = ["own-research", "gex", "0dte"]

_H1_RE = re.compile(r"^#\s+(.+)$", re.MULTILINE)


def _title_for(path: Path, body: str) -> str:
    m = _H1_RE.search(body)
    if m:
        return m.group(1).strip()
    return path.stem.replace("_", " ").replace("-", " ").strip().title()


def _topics_for(rel: Path) -> list[str]:
    topics = list(BASE_TOPICS)
    for part in rel.parts:
        topics.extend(t for t in DIR_TOPICS.get(part, []) if t not in topics)
    return topics


# Mesh coordination docs that are T1 knowledge despite living outside research/
# (SYNTHESIS.md is the collective-brain ledger — graduation states for every finding).
EXTRA_T1_PATHS = [
    Path("apps/gex/.coordination/SYNTHESIS.md"),
]


def seed_paths() -> list[Path]:
    docs_dir = config.REPO_ROOT / "apps" / "gex" / "docs"
    research_dir = config.REPO_ROOT / "apps" / "gex" / "research"
    paths = sorted(docs_dir.glob("*.md"))
    paths += sorted(
        p for p in research_dir.rglob("*.md")
        if p.name not in EXCLUDE_NAMES and "node_modules" not in p.parts
    )
    paths += [config.REPO_ROOT / rel for rel in EXTRA_T1_PATHS if (config.REPO_ROOT / rel).exists()]
    return paths


def run() -> list[Path]:
    """Ingest every seed doc into vault/my-findings. Idempotent."""
    written: list[Path] = []
    for src in seed_paths():
        body = src.read_text(encoding="utf-8")
        if not body.strip():
            continue
        rel = src.relative_to(config.REPO_ROOT)
        source_url = f"repo://{rel.as_posix()}"
        title = _title_for(src, body)
        meta = {
            "title": title,
            "source_url": source_url,
            "source_domain": "bellwether-repo",
            "fetched_at": frontmatter.now_iso(),
            "trust_tier": config.TIER_OWN_FINDINGS,
            "category": "my-findings",
            "topics": _topics_for(rel),
            "summary": frontmatter.summarize(body),
            "url_sha1": dedupe.url_sha1(source_url),
            "simhash": str(dedupe.simhash64(body)),
            "ingested_by": "seed",
        }
        written.append(vault.write_doc(meta, body, status="vault"))
    return written
