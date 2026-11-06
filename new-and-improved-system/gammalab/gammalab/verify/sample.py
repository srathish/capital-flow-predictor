"""Fixed sample for the replay-vs-API check (reports/DESIGN_replay_vs_api.md). Writes reports/replay_vs_api_sample.json."""
from __future__ import annotations

import json
import random
from datetime import date, datetime, time, timezone
from pathlib import Path

from ..adapters.skylit_replay import DATA
from ..contract.calendar import ET, session
from ..runlog import ROOT

INSTANTS = (time(10, 30), time(12, 30), time(15, 0))
SAMPLE = ROOT / "reports" / "replay_vs_api_sample.json"


def eligible():
    out = []
    for p in sorted(DATA.glob("gex-replay-*.json")):
        d = date.fromisoformat(p.stem.replace("gex-replay-", ""))
        if session(d) is None or not json.loads(p.read_text())["frames"]:
            continue
        out.append((d.isoformat(), Path(str(p) + ".spxw-backup").exists()))
    return out


def build():
    el = eligible()
    rng = random.Random(20261106)
    days = sorted(rng.sample([d for d, b in el if b], 5) + rng.sample([d for d, b in el if not b], 5))
    backup = {d for d, b in el if b}
    rows = []
    for d in days:
        for t in INSTANTS:
            at_utc = datetime.combine(date.fromisoformat(d), t, ET).astimezone(timezone.utc)
            rows.append({"day": d, "et": t.strftime("%H:%M"), "at": at_utc.strftime("%Y-%m-%dT%H:%M:%SZ"), "has_backup": d in backup})
    return rows


if __name__ == "__main__":
    rows = build()
    SAMPLE.write_text(json.dumps(rows, indent=1))
    print(len(rows), "instants;", sorted({r["day"] for r in rows}))
