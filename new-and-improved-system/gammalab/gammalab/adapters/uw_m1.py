"""Adapter: Unusual Whales 1-minute stock bars cached at new-and-improved-system/.cache/uw/m1/<SYM>/<YYYY-MM-DD>.json.

Each row is {t: bar-start epoch seconds, o,h,l,c,v, m: 'pr' premarket | 'r' regular | 'po' postmarket}. A bar becomes
available when it closes: available_at = t + 60 s (plus `lag`, default 0). Only regular-session bars are returned unless
`sessions` says otherwise.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from ..contract.events import PriceBar

M1 = Path(__file__).resolve().parents[3] / ".cache" / "uw" / "m1"


def load_day(symbol: str, day: str, sessions=("r",), lag=timedelta(0), root: Path = M1) -> list[PriceBar]:
    p = root / symbol / f"{day}.json"
    if not p.exists():
        return []
    out = []
    for r in json.loads(p.read_text()):
        if r.get("m") not in sessions:
            continue
        t0 = datetime.fromtimestamp(r["t"], timezone.utc)
        t1 = t0 + timedelta(seconds=60)
        out.append(PriceBar(symbol, "uw", t0, t1, r["o"], r["h"], r["l"], r["c"], r["v"], t1 + lag))
    return out
