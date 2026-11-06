"""Adapter: Skylit Heatseeker replay archive (~/gex-data-replay-reader/data/gex-replay-YYYY-MM-DD.json).

Provenance: the files were pulled after the fact (metadata.scrapedAt) through Skylit's historical `timestamp` parameter, so
they are vendor-archived snapshots, not our own live capture. Their real-time publication lag is unknown; `lag` is added to
the frame timestamp to get available_at (default 60 s, conservative). The 2026-03-13 scrape (files 2025-12-15 to
2026-03-12) does NOT match today's /v1/historical for the same instants: 1 MATCH in 81 sampled cells
(reports/REPLAY_VS_API.md). The one later-scrape day sampled matched exactly. Label: ARCHIVED_SNAPSHOT, never LIVE_CAPTURE.

Frames whose timestamp is not strictly inside the regular session are dropped (the 09:30 frame carries the prior close
as spot — see reports/DATA_AUDIT.md), as are weekend-dated files. Expirations written as YYYYMMDD are normalized. Near
the close some frames list the next day first (0DTE already rolled off the board); they are kept, and
`expiry.select(..., "front")` refuses them (NoZeroDTE).
"""
from __future__ import annotations

import hashlib
import json
from datetime import date, datetime, timedelta
from pathlib import Path

from ..contract.calendar import session
from ..contract.events import MapSnapshot, Provenance, SignConvention

DATA = Path.home() / "gex-data-replay-reader" / "data"


def norm_expiry(e: str) -> str:
    """Some frames write expirations as YYYYMMDD instead of YYYY-MM-DD; normalize to ISO."""
    return f"{e[:4]}-{e[4:6]}-{e[6:]}" if len(e) == 8 and e.isdigit() else e


def file_hash(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def load_day(path: Path, symbols=("SPXW", "SPY", "QQQ"), lag=timedelta(seconds=60)) -> list[MapSnapshot]:
    raw = json.loads(path.read_text())
    day = date.fromisoformat(raw["metadata"]["date"])
    sess = session(day)
    if sess is None:
        return []
    out = []
    for fr in raw["frames"]:
        ts = datetime.fromisoformat(fr["timestamp"].replace("Z", "+00:00"))
        if not (sess[0] < ts < sess[1]):
            continue
        for sym, t in fr.get("tickers", {}).items():
            if sym not in symbols or not t or not t.get("strikes"):
                continue
            vex = t.get("vannaValues")
            out.append(MapSnapshot(
                source="skylit_replay", symbol=sym, provider_ts=ts, available_at=ts + lag, session_date=day.isoformat(),
                spot=float(t["spotPrice"]), expirations=tuple(norm_expiry(e) for e in t["expirations"]), strikes=tuple(float(k) for k in t["strikes"]),
                gex=tuple(tuple(float(v or 0) for v in row) for row in t["gammaValues"]),
                vex=tuple(tuple(float(v or 0) for v in row) for row in vex) if vex else None,
                convention=SignConvention.SKYLIT_NET, provenance=Provenance.ARCHIVED_SNAPSHOT))
    return out
