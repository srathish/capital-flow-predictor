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
-- King pin-zone observations (pooled schema agreed with Bellwether, MSG 15).
-- Entry fields land at cycle time; *_zone_frac are filled by an end-of-day pass
-- (fraction of the final window spent within ±0.4% of the strike).
CREATE TABLE IF NOT EXISTS king_zone_obs (
    id INTEGER PRIMARY KEY,
    cycle_id INTEGER REFERENCES cycles(id),
    source TEXT NOT NULL DEFAULT 'athena-live',
    ts TEXT NOT NULL,
    ticker TEXT NOT NULL,
    king_strike REAL,
    king_share REAL,
    king_sign TEXT,
    dist_at_entry_pct REAL,
    regime TEXT,                 -- raw 5-mode regime at observation time
    regime_label TEXT,           -- chop | trend (wall-vs-escalator split key);
                                 -- EOD pass may overwrite with the full-day label
    final_window_zone_frac REAL,
    dead_strike_zone_frac REAL
);
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


# wall-vs-escalator split key: pin-like regimes are "chop"; motion regimes "trend"
_REGIME_LABEL = {"pinned": "chop", "squeeze": "chop",
                 "trend": "trend", "breakout": "trend", "defensive": "trend"}


def record_king_obs(cycle_id: int, features: dict, db_path: Path | None = None) -> None:
    """Log a King pin-zone observation at cycle time (zone fracs filled at EOD)."""
    if not features.get("king_strike"):
        return
    regime = features.get("regime", "")
    conn = connect(db_path)
    with conn:
        conn.execute(
            """INSERT INTO king_zone_obs
               (cycle_id, ts, ticker, king_strike, king_share, king_sign,
                dist_at_entry_pct, regime, regime_label)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                cycle_id,
                datetime.now(UTC).isoformat(timespec="seconds"),
                features.get("ticker", ""),
                features.get("king_strike"),
                features.get("king_share"),
                features.get("king_sign"),
                features.get("dist_at_entry_pct"),
                regime,
                _REGIME_LABEL.get(regime),
            ),
        )
    conn.close()


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
