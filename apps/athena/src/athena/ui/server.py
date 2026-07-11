"""Athena Console — local dashboard over the brain vault + athena journal.

Binds 127.0.0.1 only. Reads local SQLite/markdown; runs cycles on demand.
"""

from __future__ import annotations

import json
import threading
from pathlib import Path

from brain import config as brain_config
from brain import frontmatter
from brain import index as brain_index
from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel

from athena import config as athena_config
from athena import orchestrator
from athena.journal import store
from athena.risk import gatekeeper

app = FastAPI(title="Athena Console")

STATIC = Path(__file__).with_name("static")

# one cycle at a time; the console is single-user
_cycle_lock = threading.Lock()
_cycle_state: dict = {"running": False, "ticker": None}


@app.get("/", response_class=HTMLResponse)
def home() -> str:
    return (STATIC / "index.html").read_text(encoding="utf-8")


@app.get("/api/status")
def status() -> dict:
    conn = brain_index.connect()
    docs = conn.execute(
        "SELECT trust_tier, COUNT(*) AS n FROM documents WHERE status='vault' GROUP BY trust_tier"
    ).fetchall()
    inbox = conn.execute("SELECT COUNT(*) AS n FROM documents WHERE status='inbox'").fetchone()
    gaps = conn.execute("SELECT COUNT(*) AS n FROM gaps WHERE resolved=0").fetchone()
    conn.close()
    return {
        "vault_by_tier": {f"T{r['trust_tier']}": r["n"] for r in docs},
        "vault_total": sum(r["n"] for r in docs),
        "inbox": inbox["n"],
        "open_gaps": gaps["n"],
        "kill_switch": athena_config.KILL_FILE.exists(),
        "alerts_today": store.alerts_today(),
        "watchlist": athena_config.watchlist(),
        "market_open": orchestrator.market_open_now(),
        "cycle": _cycle_state,
    }


@app.get("/api/search")
def search(q: str, limit: int = 10) -> list[dict]:
    return [h.as_dict() for h in brain_index.search(q, limit=limit)]


@app.get("/api/doc")
def doc(path: str) -> dict:
    p = Path(path).resolve()
    allowed = (brain_config.VAULT_DIR.resolve(), brain_config.INBOX_DIR.resolve())
    if not any(p.is_relative_to(base) for base in allowed):
        raise HTTPException(403, "path outside vault")
    if not p.exists():
        raise HTTPException(404, "no such doc")
    meta, body = frontmatter.parse(p.read_text(encoding="utf-8"))
    return {"meta": meta, "body": body}


@app.get("/api/gaps")
def gaps() -> list[dict]:
    return [dict(r) for r in brain_index.open_gaps()]


@app.get("/api/inbox")
def inbox() -> list[dict]:
    items = []
    if brain_config.INBOX_DIR.exists():
        for p in sorted(brain_config.INBOX_DIR.glob("*.md")):
            meta, _ = frontmatter.parse(p.read_text(encoding="utf-8"))
            items.append({
                "hash8": p.stem.rsplit("--", 1)[-1],
                "title": meta.get("title", p.stem),
                "tier": meta.get("trust_tier"),
                "summary": meta.get("summary", ""),
                "source_url": meta.get("source_url", ""),
                "path": str(p),
            })
    return items


class ReviewAction(BaseModel):
    hash8: str
    category: str | None = None


@app.post("/api/review/promote")
def promote(action: ReviewAction) -> dict:
    from brain import pipeline

    if not action.category:
        raise HTTPException(400, "category required")
    path = pipeline.promote(action.hash8, action.category)
    return {"promoted": str(path)}


@app.post("/api/review/reject")
def reject(action: ReviewAction) -> dict:
    from brain import pipeline

    pipeline.reject(action.hash8)
    return {"rejected": action.hash8}


@app.get("/api/journal")
def journal(limit: int = 30) -> list[dict]:
    rows = []
    for r in store.recent(limit):
        row = dict(r)
        row["gate_reasons"] = json.loads(row.get("gate_reasons") or "[]")
        rows.append(row)
    return rows


@app.get("/api/journal/{cycle_id}")
def journal_detail(cycle_id: int) -> dict:
    conn = store.connect()
    r = conn.execute("SELECT * FROM cycles WHERE id = ?", (cycle_id,)).fetchone()
    conn.close()
    if not r:
        raise HTTPException(404, "no such cycle")
    row = dict(r)
    row["features"] = json.loads(row.pop("features_json") or "{}")
    row["thesis"] = json.loads(row.pop("thesis_json") or "null")
    row["gate_reasons"] = json.loads(row.get("gate_reasons") or "[]")
    return row


@app.get("/api/report")
def report() -> dict:
    return store.daily_report()


class CycleRequest(BaseModel):
    ticker: str
    llm: bool = False


@app.post("/api/cycle")
def run_cycle(req: CycleRequest) -> JSONResponse:
    """Universe is locked to the validated watchlist (SPXW/SPY/QQQ) until the
    paper record justifies expansion — the user's standing 0DTE scope rule."""
    ticker = req.ticker.strip().upper()
    if ticker == "SPX":
        ticker = "SPXW"  # the 0DTE chain lives on the weekly root
    if ticker not in athena_config.watchlist():
        raise HTTPException(400, f"{ticker} outside validated universe {athena_config.watchlist()}")
    if not req.llm:
        return JSONResponse(orchestrator.run_cycle(ticker, no_llm=True))
    # full cycle is synchronous — the console waits for its trade
    if not _cycle_lock.acquire(blocking=False):
        raise HTTPException(409, "a cycle is already running")
    try:
        _cycle_state.update(running=True, ticker=ticker)
        result = orchestrator.run_cycle(ticker)
    finally:
        _cycle_state.update(running=False, ticker=None)
        _cycle_lock.release()
    return JSONResponse(result)


class KillRequest(BaseModel):
    active: bool


@app.post("/api/kill")
def kill(req: KillRequest) -> dict:
    gatekeeper.kill(req.active)
    return {"kill_switch": athena_config.KILL_FILE.exists()}


def serve(port: int = 8321) -> None:
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")
