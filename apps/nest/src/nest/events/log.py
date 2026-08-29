"""Append-only event log — the spine. One SQLite table (WAL) holds every event as
JSON; the engine, tracker, delivery, and viz all derive from queries over it. If it
isn't in the log, it didn't happen.

Storage is SQLite, not TimescaleDB (repo doctrine: local-only, no Postgres). The
schema is deliberately portable — one wide events table keyed by (type, ticker, ts) —
so it can move to a hypertable later without touching callers.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from nest import config
from nest.events.schema import EVENT_MODELS, Call, Grade, Score, Signal

_SCHEMA = """
CREATE TABLE IF NOT EXISTS events (
    id      INTEGER PRIMARY KEY,
    type    TEXT NOT NULL,          -- signal | score | call | grade
    ts      TEXT NOT NULL,          -- ISO8601 UTC, event time
    ticker  TEXT,
    dedupe  TEXT,                   -- signal dedupe hash (NULL for other types)
    payload TEXT NOT NULL           -- full event dict as JSON
);
CREATE INDEX IF NOT EXISTS idx_events_type_ts     ON events (type, ts);
CREATE INDEX IF NOT EXISTS idx_events_ticker_ts   ON events (ticker, ts);
-- Dedupe is a *soft* window guard enforced in append(); we don't UNIQUE it because
-- the same signal legitimately recurs after its TTL bucket rolls over.
CREATE INDEX IF NOT EXISTS idx_events_dedupe      ON events (dedupe);
"""


class EventLog:
    def __init__(self, db_path: Path | None = None):
        self.path = db_path or config.EVENT_DB
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(self.path)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.executescript(_SCHEMA)

    # --- writes --------------------------------------------------------------

    def append(self, event: Signal | Score | Call | Grade) -> int | None:
        """Append one event. For Signals, drops the write (returns None) if an
        identical dedupe hash already landed within the signal's TTL window."""
        dedupe = None
        if isinstance(event, Signal):
            dedupe = event.dedupe_key()
            if self._seen_within_ttl(dedupe, event.ts, event.ttl_hours):
                return None
        payload = event.model_dump_json()
        with self.conn:
            cur = self.conn.execute(
                "INSERT INTO events (type, ts, ticker, dedupe, payload) VALUES (?,?,?,?,?)",
                (event.type, event.ts, getattr(event, "ticker", None), dedupe, payload),
            )
        return int(cur.lastrowid or 0)

    def _seen_within_ttl(self, dedupe: str, ts: str, ttl_hours: float) -> bool:
        # A prior identical signal still inside its TTL window means this is a repost /
        # re-poll of the same evidence — skip it.
        from datetime import datetime, timedelta

        cutoff = (datetime.fromisoformat(ts) - timedelta(hours=ttl_hours)).isoformat()
        row = self.conn.execute(
            "SELECT 1 FROM events WHERE dedupe=? AND ts>=? LIMIT 1", (dedupe, cutoff)
        ).fetchone()
        return row is not None

    # --- reads ---------------------------------------------------------------

    def _hydrate(self, rows: list[sqlite3.Row]) -> list:
        out = []
        for r in rows:
            model = EVENT_MODELS[r["type"]]
            out.append(model.model_validate_json(r["payload"]))
        return out

    def tail(self, limit: int = 50, type: str | None = None) -> list:
        """Most-recent events (for the field viz signal-log and CLI tail)."""
        if type:
            rows = self.conn.execute(
                "SELECT type, payload FROM events WHERE type=? ORDER BY id DESC LIMIT ?",
                (type, limit),
            ).fetchall()
        else:
            rows = self.conn.execute(
                "SELECT type, payload FROM events ORDER BY id DESC LIMIT ?", (limit,)
            ).fetchall()
        return self._hydrate(rows)

    def signals_since(self, since_iso: str, ticker: str | None = None) -> list[Signal]:
        q = "SELECT type, payload FROM events WHERE type='signal' AND ts>=?"
        args: list = [since_iso]
        if ticker:
            q += " AND ticker=?"
            args.append(ticker)
        q += " ORDER BY ts"
        rows = self.conn.execute(q, args).fetchall()
        return self._hydrate(rows)

    def calls(self, since_iso: str | None = None, ticker: str | None = None) -> list[Call]:
        q = "SELECT type, payload FROM events WHERE type='call'"
        args: list = []
        if since_iso:
            q += " AND ts>=?"
            args.append(since_iso)
        if ticker:
            q += " AND ticker=?"
            args.append(ticker)
        q += " ORDER BY ts"
        return self._hydrate(self.conn.execute(q, args).fetchall())

    def grades(self, since_iso: str | None = None) -> list[Grade]:
        q = "SELECT type, payload FROM events WHERE type='grade'"
        args: list = []
        if since_iso:
            q += " AND ts>=?"
            args.append(since_iso)
        q += " ORDER BY ts"
        return self._hydrate(self.conn.execute(q, args).fetchall())

    def latest_scores(self, limit: int = 25, exclude: tuple[str, ...] = ("__MACRO__",)) -> list[Score]:
        """Latest Score per ticker across the whole emergent universe, top conviction first."""
        rows = self.conn.execute(
            "SELECT e.type, e.payload FROM events e "
            "JOIN (SELECT ticker, MAX(id) mid FROM events WHERE type='score' GROUP BY ticker) g "
            "ON e.id = g.mid ORDER BY e.id DESC"
        ).fetchall()
        scores = [s for s in self._hydrate(rows) if s.ticker not in exclude]
        scores.sort(key=lambda s: s.conviction, reverse=True)
        return scores[:limit]

    def score_history(self, ticker: str, limit: int = 48) -> list[Score]:
        """Conviction over time for one ticker (oldest→newest) — for the drawer sparkline."""
        rows = self.conn.execute(
            "SELECT type, payload FROM events WHERE type='score' AND ticker=? "
            "ORDER BY id DESC LIMIT ?", (ticker, limit),
        ).fetchall()
        return list(reversed(self._hydrate(rows)))

    def latest_score(self, ticker: str) -> Score | None:
        row = self.conn.execute(
            "SELECT type, payload FROM events WHERE type='score' AND ticker=? "
            "ORDER BY id DESC LIMIT 1",
            (ticker,),
        ).fetchone()
        return self._hydrate([row])[0] if row else None

    def calls_today(self, day_iso: str) -> int:
        row = self.conn.execute(
            "SELECT COUNT(*) AS n FROM events WHERE type='call' AND ts>=?", (day_iso,)
        ).fetchone()
        return int(row["n"])

    def last_call(self, ticker: str) -> Call | None:
        return (self.calls(ticker=ticker) or [None])[-1]

    def graded_call_ts(self, horizon: str) -> set[str]:
        """call_ts values already graded at this horizon — so the grader is idempotent."""
        rows = self.conn.execute(
            "SELECT payload FROM events WHERE type='grade'"
        ).fetchall()
        out = set()
        for r in rows:
            g = json.loads(r["payload"])
            if g.get("horizon") == horizon and not g.get("source"):
                out.add(g["call_ts"])
        return out

    def close(self) -> None:
        self.conn.close()
