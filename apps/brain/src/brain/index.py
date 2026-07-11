"""SQLite FTS5 index over the vault, trust-tier-ordered search, and gap log.

Disk (vault/ + inbox/ markdown) is the source of truth; the DB is a
regenerable cache. Weak searches are recorded in `gaps` so the learn/sweep
loop can grow the corpus toward what the user actually asks.
"""

from __future__ import annotations

import re
import sqlite3
from dataclasses import dataclass
from pathlib import Path

from brain import config, frontmatter, vault

_SCHEMA = """
CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY,
    path TEXT UNIQUE NOT NULL,
    url TEXT,
    url_sha1 TEXT UNIQUE,
    domain TEXT,
    title TEXT,
    trust_tier INTEGER,
    category TEXT,
    topics TEXT,
    summary TEXT,
    simhash TEXT,
    status TEXT,
    fetched_at TEXT
);
CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(
    title, body, topics, summary, tokenize='porter unicode61'
);
CREATE TABLE IF NOT EXISTS gaps (
    id INTEGER PRIMARY KEY,
    query TEXT NOT NULL,
    asked_at TEXT NOT NULL,
    result_count INTEGER NOT NULL,
    best_tier INTEGER,
    resolved INTEGER NOT NULL DEFAULT 0
);
"""

_TOKEN_RE = re.compile(r"[A-Za-z0-9]+")
_STOPWORDS = {
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "do", "does", "did",
    "what", "when", "where", "which", "who", "how", "why", "for", "and", "or", "not",
    "of", "to", "in", "on", "at", "by", "it", "its", "this", "that", "with", "as",
    "can", "could", "should", "would", "will", "my", "me", "i", "we", "our", "you",
    "your", "mean", "means", "about", "if", "than", "then", "there",
}  # fmt: skip


@dataclass
class Hit:
    title: str
    path: str
    trust_tier: int
    category: str
    summary: str
    url: str
    relevance: float

    def as_dict(self) -> dict:
        d = self.__dict__.copy()
        d["tier_label"] = config.TIER_LABELS.get(self.trust_tier, f"T{self.trust_tier}")
        return d


def connect(db_path: Path | None = None) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path or config.INDEX_DB)
    conn.row_factory = sqlite3.Row
    try:
        conn.executescript(_SCHEMA)
    except sqlite3.OperationalError as exc:  # pragma: no cover
        raise RuntimeError(
            "SQLite FTS5 is unavailable in this Python build. Install a Python with "
            "FTS5-enabled sqlite (the python.org / uv-managed builds have it)."
        ) from exc
    return conn


def upsert(conn: sqlite3.Connection, path: Path) -> None:
    """Index one document file (insert or replace)."""
    meta, body = frontmatter.parse(path.read_text(encoding="utf-8"))
    if not meta.get("url_sha1"):
        return  # not a brain document
    row = conn.execute("SELECT id FROM documents WHERE url_sha1 = ?", (meta["url_sha1"],)).fetchone()
    if row:
        conn.execute("DELETE FROM docs_fts WHERE rowid = ?", (row["id"],))
        conn.execute("DELETE FROM documents WHERE id = ?", (row["id"],))
    topics = meta.get("topics") or []
    cur = conn.execute(
        """INSERT INTO documents
           (path, url, url_sha1, domain, title, trust_tier, category, topics,
            summary, simhash, status, fetched_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            str(path),
            meta.get("source_url", ""),
            meta["url_sha1"],
            meta.get("source_domain", ""),
            meta.get("title", path.stem),
            int(meta.get("trust_tier", config.DEFAULT_TIER)),
            meta.get("category", ""),
            " ".join(topics),
            meta.get("summary", ""),
            str(meta.get("simhash", "")),
            meta.get("status", "vault"),
            meta.get("fetched_at", ""),
        ),
    )
    conn.execute(
        "INSERT INTO docs_fts (rowid, title, body, topics, summary) VALUES (?, ?, ?, ?, ?)",
        (cur.lastrowid, meta.get("title", path.stem), body, " ".join(topics), meta.get("summary", "")),
    )


def reindex(rebuild: bool = False, db_path: Path | None = None) -> int:
    conn = connect(db_path)
    with conn:
        if rebuild:
            conn.execute("DELETE FROM documents")
            conn.execute("DELETE FROM docs_fts")
        count = 0
        for path in vault.all_docs():
            upsert(conn, path)
            count += 1
    conn.close()
    return count


def fts_query(question: str) -> str:
    """Turn a natural-language question into an OR'd FTS5 term query."""
    tokens = [t.lower() for t in _TOKEN_RE.findall(question)]
    terms = [t for t in tokens if t not in _STOPWORDS and len(t) > 1]
    if not terms:
        terms = tokens or [question.strip()]
    return " OR ".join(f'"{t}"' for t in dict.fromkeys(terms))


def search(
    question: str,
    tier: int | None = None,
    limit: int = 8,
    include_inbox: bool = False,
    log_gap: bool = True,
    db_path: Path | None = None,
) -> list[Hit]:
    conn = connect(db_path)
    where = "" if include_inbox else "AND d.status = 'vault'"
    tier_clause = "AND d.trust_tier <= ?" if tier is not None else ""
    params: list = [fts_query(question)]
    if tier is not None:
        params.append(tier)
    params.append(limit)
    rows = conn.execute(
        f"""SELECT d.title, d.path, d.trust_tier, d.category, d.summary, d.url,
                   bm25(docs_fts) AS relevance
            FROM docs_fts JOIN documents d ON d.id = docs_fts.rowid
            WHERE docs_fts MATCH ? {where} {tier_clause}
            ORDER BY d.trust_tier ASC, relevance ASC
            LIMIT ?""",
        params,
    ).fetchall()
    hits = [
        Hit(r["title"], r["path"], r["trust_tier"], r["category"], r["summary"], r["url"],
            round(r["relevance"], 3))
        for r in rows
    ]
    if log_gap and len(hits) < config.GAP_RESULT_THRESHOLD:
        with conn:
            conn.execute(
                "INSERT INTO gaps (query, asked_at, result_count, best_tier) VALUES (?, ?, ?, ?)",
                (question, frontmatter.now_iso(), len(hits),
                 hits[0].trust_tier if hits else None),
            )
    conn.close()
    return hits


def open_gaps(db_path: Path | None = None) -> list[sqlite3.Row]:
    conn = connect(db_path)
    rows = conn.execute(
        "SELECT id, query, asked_at, result_count FROM gaps WHERE resolved = 0 ORDER BY id DESC"
    ).fetchall()
    conn.close()
    return rows


def resolve_gap(gap_id: int, db_path: Path | None = None) -> None:
    conn = connect(db_path)
    with conn:
        conn.execute("UPDATE gaps SET resolved = 1 WHERE id = ?", (gap_id,))
    conn.close()


def known_simhashes(db_path: Path | None = None) -> dict[str, int]:
    """url_sha1 -> simhash for near-dup checks at ingest time."""
    conn = connect(db_path)
    rows = conn.execute("SELECT url_sha1, simhash FROM documents").fetchall()
    conn.close()
    out: dict[str, int] = {}
    for r in rows:
        try:
            out[r["url_sha1"]] = int(r["simhash"])
        except (TypeError, ValueError):
            continue
    return out
