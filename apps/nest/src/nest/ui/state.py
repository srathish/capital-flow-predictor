"""State builder — turns the event log into the single JSON payload the field viz renders.
Used by both the live server (/api/state) and any baked static snapshot. Read-only.
"""

from __future__ import annotations

from datetime import UTC, datetime

from nest import config
from nest.engine import macro
from nest.engine import weights as wmod
from nest.events.log import EventLog
from nest.tracker import grader


def build_state(log: EventLog, now: datetime | None = None) -> dict:
    now = now or datetime.now(UTC)
    day_iso = now.date().isoformat()

    # regime dial (latest __MACRO__ score)
    reg_score = log.latest_score(macro.MACRO_TICKER)
    regime = None
    floor = config.CONVICTION_FLOOR
    if reg_score:
        m = reg_score.meta or {}
        regime = {"tone": m.get("tone", "neutral"), "score": reg_score.conviction,
                  "floor_delta": m.get("floor_delta", 0.0), "note": m.get("note", ""),
                  "imminent_event": m.get("imminent_event")}
        floor = max(60.0, min(88.0, config.CONVICTION_FLOOR + float(m.get("floor_delta", 0.0))))

    book = [{
        "ticker": s.ticker, "conviction": round(s.conviction, 1), "direction": s.direction,
        "families": s.families, "contributors": s.contributors[:6], "delta": round(s.delta, 1),
    } for s in log.latest_scores(40)]

    # pull a full-cycle-sized window so the header's source/family counts reflect ALL
    # sources (feeds write before the ~500 enrichment signals, so a last-80 tail would
    # only ever show enrichment). The signal-log panel shows the freshest slice.
    recent = log.tail(700, type="signal")
    active_sources = sorted({s.source for s in recent})
    active_families = sorted({config.family_of(s.source) for s in recent})
    signals = []
    for s in recent[:120]:
        signals.append({
            "ts": s.ts, "source": s.source, "family": config.family_of(s.source),
            "ticker": s.ticker, "direction": s.direction, "strength": round(s.strength, 2),
            "note": str(s.meta.get("latest") or s.meta.get("note") or "")[:120],
        })

    live_w = wmod.compute_all(log, "5d")
    rates = wmod._hit_rates(log, "5d")
    weights = []
    for src in sorted(set(list(config.SOURCE_PRIOR) + list(live_w))):
        hits, n = rates.get(src, (0, 0))
        weights.append({"source": src, "family": config.family_of(src),
                        "weight": round(wmod.source_weight(src, live_w), 3),
                        "prior": config.prior_of(src), "hits": hits, "n": n})
    weights.sort(key=lambda w: w["weight"], reverse=True)

    cal = grader.calibration(log, "5d")
    calibration = {k: v for k, v in cal.buckets.items()}

    calls = [{
        "ts": c.ts, "ticker": c.ticker, "conviction": round(c.conviction, 1),
        "direction": c.direction, "thesis": c.thesis, "ref_price": c.ref_price,
        "entry_zone": c.entry_zone, "invalidation": c.invalidation,
        "calibration_note": c.calibration_note,
    } for c in reversed(log.calls()[-15:])]

    return {
        "now": now.isoformat(timespec="seconds"),
        "header": {
            "watched": len(book), "sources": len(active_sources),
            "families": active_families,
            "floor": round(floor, 0), "alerts_today": log.calls_today(day_iso),
            "max_alerts": config.MAX_CALLS_PER_DAY,
        },
        "active_sources": active_sources,
        "regime": regime,
        "book": book,
        "signals": signals,
        "weights": weights,
        "calibration": calibration,
        "calls": calls,
    }
