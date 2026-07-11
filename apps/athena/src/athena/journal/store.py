"""Decision journal — every cycle persists its feature snapshot, thesis, verdict,
and alert state. If it isn't in the journal, it didn't happen. This is also the
paper track record that gates any future autonomy step.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime
from pathlib import Path

from athena import config

_SCHEMA = """
CREATE TABLE IF NOT EXISTS cycles (
    id INTEGER PRIMARY KEY,
    ts TEXT NOT NULL,
    ticker TEXT NOT NULL,
    features_json TEXT NOT NULL,
    thesis_json TEXT,
    approved INTEGER,
    gate_reasons TEXT,
    alerted INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    -- paper-tracking outcome fields, filled by later review
    outcome_pnl_pct REAL,
    outcome_note TEXT
);
CREATE INDEX IF NOT EXISTS idx_cycles_ts ON cycles (ts);
"""


def connect(db_path: Path | None = None) -> sqlite3.Connection:
    path = db_path or config.JOURNAL_DB
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(_SCHEMA)
    return conn


def record(
    ticker: str,
    features_json: str,
    thesis_json: str | None,
    approved: bool | None,
    gate_reasons: list[str],
    alerted: bool,
    error: str | None = None,
    db_path: Path | None = None,
) -> int:
    conn = connect(db_path)
    with conn:
        cur = conn.execute(
            """INSERT INTO cycles
               (ts, ticker, features_json, thesis_json, approved, gate_reasons, alerted, error)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                datetime.now(UTC).isoformat(timespec="seconds"),
                ticker,
                features_json,
                thesis_json,
                None if approved is None else int(approved),
                json.dumps(gate_reasons),
                int(alerted),
                error,
            ),
        )
        row_id = cur.lastrowid
    conn.close()
    return int(row_id or 0)


def alerts_today(db_path: Path | None = None) -> int:
    conn = connect(db_path)
    today = datetime.now(UTC).date().isoformat()
    row = conn.execute(
        "SELECT COUNT(*) AS n FROM cycles WHERE alerted = 1 AND ts >= ?", (today,)
    ).fetchone()
    conn.close()
    return int(row["n"])


def recent(limit: int = 20, db_path: Path | None = None) -> list[sqlite3.Row]:
    conn = connect(db_path)
    rows = conn.execute(
        "SELECT id, ts, ticker, approved, gate_reasons, alerted, error FROM cycles "
        "ORDER BY id DESC LIMIT ?",
        (limit,),
    ).fetchall()
    conn.close()
    return rows


def daily_report(db_path: Path | None = None) -> dict:
    conn = connect(db_path)
    today = datetime.now(UTC).date().isoformat()
    rows = conn.execute("SELECT * FROM cycles WHERE ts >= ? ORDER BY id", (today,)).fetchall()
    conn.close()
    report = {
        "date": today,
        "cycles": len(rows),
        "alerted": sum(r["alerted"] for r in rows),
        "rejected": sum(1 for r in rows if r["approved"] == 0),
        "errors": sum(1 for r in rows if r["error"]),
        "by_ticker": {},
    }
    for r in rows:
        report["by_ticker"].setdefault(r["ticker"], 0)
        report["by_ticker"][r["ticker"]] += 1
    return report
