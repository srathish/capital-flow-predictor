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
    -- node dynamics (handoff precursor, MSG 21): rival = 2nd-largest |gamma| node
    rival_strike REAL,
    rival_share REAL,
    rival_side TEXT,             -- ceiling (above spot) | floor (below)
    rival_sign TEXT,             -- pika | barney
    -- day-level dynamics, filled by the EOD pass over the day's observations
    king_share_open REAL,
    king_share_late REAL,
    rival_share_open REAL,
    rival_share_late REAL,
    handoff_flag INTEGER,        -- king share decayed AND rival grew
    -- Clause 8b (vanna leads): level per cycle; flow = Δ vs prior cycle same ticker/day
    vanna_ab_level REAL,
    vanna_flow_ab REAL,
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
    # rival = 2nd-largest |gamma| node; share scaled off the King's known share
    rival_strike = rival_share = rival_side = rival_sign = None
    tops = features.get("top_gamma_strikes") or []
    king_share = features.get("king_share") or 0.0
    if len(tops) >= 2 and tops[0][1]:
        r_strike, r_gamma = tops[1][0], tops[1][1]
        rival_strike = r_strike
        rival_share = round(king_share * abs(r_gamma) / abs(tops[0][1]), 4)
        rival_side = "ceiling" if r_strike > features.get("spot", 0) else "floor"
        rival_sign = "pika" if r_gamma > 0 else "barney" if r_gamma < 0 else "zero"
    conn = connect(db_path)
    # vanna flow = Δ level vs the previous live observation for this ticker today
    # (db lookup, so it survives one-shot CLI cycles and process restarts)
    level = features.get("vanna_ab_level")
    ts_now = datetime.now(UTC).isoformat(timespec="seconds")
    prev = conn.execute(
        "SELECT vanna_ab_level FROM king_zone_obs WHERE ticker=? AND source='athena-live' "
        "AND ts LIKE ? ORDER BY ts DESC LIMIT 1",
        (features.get("ticker", ""), ts_now[:10] + "%"),
    ).fetchone()
    flow = (
        round(level - prev["vanna_ab_level"], 2)
        if level is not None and prev and prev["vanna_ab_level"] is not None
        else None
    )
    with conn:
        conn.execute(
            """INSERT INTO king_zone_obs
               (cycle_id, ts, ticker, king_strike, king_share, king_sign,
                dist_at_entry_pct, regime, regime_label,
                rival_strike, rival_share, rival_side, rival_sign,
                vanna_ab_level, vanna_flow_ab)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                cycle_id,
                ts_now,
                features.get("ticker", ""),
                features.get("king_strike"),
                king_share,
                features.get("king_sign"),
                features.get("dist_at_entry_pct"),
                regime,
                _REGIME_LABEL.get(regime),
                rival_strike,
                rival_share,
                rival_side,
                rival_sign,
                level,
                flow,
            ),
        )
    conn.close()


def eod_king_pass(trading_day: str, db_path: Path | None = None) -> int:
    """Fill day-level node-dynamics fields from the day's observation series.

    open = first observation of the day, late = last. handoff_flag = King share
    decayed while the rival grew (the operator's handoff precursor). Returns the
    number of (ticker, day) groups stamped. Zone fracs need bars and are filled
    separately.
    """
    conn = connect(db_path)
    day_rows = conn.execute(
        "SELECT id, ticker, king_share, rival_share FROM king_zone_obs "
        "WHERE ts LIKE ? AND source = 'athena-live' ORDER BY ts",
        (trading_day + "%",),
    ).fetchall()
    by_ticker: dict[str, list] = {}
    for r in day_rows:
        by_ticker.setdefault(r["ticker"], []).append(r)
    stamped = 0
    with conn:
        for ticker, rows in by_ticker.items():
            first, last = rows[0], rows[-1]
            handoff = int(
                (last["king_share"] or 0) < (first["king_share"] or 0)
                and (last["rival_share"] or 0) > (first["rival_share"] or 0)
            )
            conn.execute(
                "UPDATE king_zone_obs SET king_share_open=?, king_share_late=?, "
                "rival_share_open=?, rival_share_late=?, handoff_flag=? "
                "WHERE ticker=? AND ts LIKE ? AND source='athena-live'",
                (first["king_share"], last["king_share"], first["rival_share"],
                 last["rival_share"], handoff, ticker, trading_day + "%"),
            )
            stamped += 1
    conn.close()
    return stamped


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
