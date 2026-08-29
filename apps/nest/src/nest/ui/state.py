"""State builder — turns the event log into the single JSON payload the field viz renders.
Used by both the live server (/api/state) and any baked static snapshot. Read-only.
"""

from __future__ import annotations

import json
from collections import Counter
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


# --- pipeline view (medallion DAG) ------------------------------------------

# medallion stage → the Nest's actual architecture
_STAGES = [
    ("sources", "SOURCES"),
    ("bronze", "BRONZE · raw signals"),
    ("silver", "SILVER · conviction"),
    ("gold", "GOLD · gate + synthesis"),
    ("marts", "MARTS · outputs"),
]


def build_pipeline(log: EventLog, now: datetime | None = None) -> dict:
    now = now or datetime.now(UTC)
    pstate = {"wave": 0, "cycles": []}
    ppath = config.DATA_DIR / "pipeline.json"
    if ppath.exists():
        try:
            pstate = json.loads(ppath.read_text())
        except (ValueError, OSError):
            pass
    cycles = pstate.get("cycles", [])
    last = cycles[-1] if cycles else {}
    counts = last.get("source_counts", {})
    err_srcs = {e["source"] for e in last.get("errors", [])}
    live_w = wmod.compute_all(log, "5d")
    rates = wmod._hit_rates(log, "5d")

    # SOURCES stage — every wired source + any dynamic discord callers seen
    wired = list(config.SOURCE_PRIOR) + [s for s in counts if s.startswith("discord:")]
    src_nodes = []
    for src in sorted(set(wired)):
        if src in ("edgar_8k", "edgar_s1"):  # placeholders folded into edgar_offering
            continue
        rate = int(counts.get(src, 0))
        status = "degraded" if src in err_srcs else "ok" if rate > 0 else "idle"
        hits, n = rates.get(src, (0, 0))
        src_nodes.append({
            "id": src, "label": src.replace("uw_", "").replace("_", " "),
            "family": config.family_of(src), "rate": rate, "status": status,
            "weight": round(wmod.source_weight(src, live_w), 2),
            "hit_rate": round(hits / n, 2) if n else None, "n": n,
        })

    # BRONZE — one node per family (aggregated signal rate)
    fam_rate: Counter = Counter()
    fam_status: dict[str, bool] = {}
    for s in src_nodes:
        fam_rate[s["family"]] += s["rate"]
        fam_status[s["family"]] = fam_status.get(s["family"], False) or s["status"] == "ok"
    bronze = [{"id": f"bronze:{f}", "label": f, "family": f, "rate": fam_rate.get(f, 0),
               "status": "ok" if fam_status.get(f) else "idle"}
              for f in config.FAMILIES]

    book = log.latest_scores(500)
    scored = int(last.get("scored", len(book)))
    gated = int(last.get("gated", 0))
    calls_today = log.calls_today(now.date().isoformat())
    total_grades = len(log.grades())
    reg = log.latest_score(macro.MACRO_TICKER)
    regime_tone = (reg.meta or {}).get("tone", "neutral") if reg else "neutral"

    silver = [
        {"id": "accumulate", "label": "accumulate", "family": "levels",
         "rate": scored, "status": "ok" if scored else "idle",
         "detail": f"{scored} tickers scored · Layer-1 decay"},
        {"id": "gate", "label": "convergence gate", "family": "flow",
         "rate": gated, "status": "ok" if scored else "idle",
         "detail": f"{gated} passed · need 3 signals / 2 families"},
    ]
    gold = [
        {"id": "synthesis", "label": "synthesis", "family": "catalyst",
         "rate": len(last.get("calls", [])), "status": "ok" if scored else "idle",
         "detail": "Haiku (gated + rate-limited)"},
        {"id": "calls", "label": "calls", "family": "social",
         "rate": calls_today, "status": "ok" if calls_today else "idle",
         "detail": f"{calls_today}/{config.MAX_CALLS_PER_DAY} today"},
    ]
    marts = [
        {"id": "book", "label": "conviction book", "family": "chart",
         "rate": len(book), "status": "ok" if book else "idle",
         "detail": f"{len(book)} names"},
        {"id": "alerts", "label": "alert feed", "family": "fundamental",
         "rate": calls_today, "status": "ok" if calls_today else "idle", "detail": "Discord"},
        {"id": "calibration", "label": "calibration", "family": "positioning",
         "rate": total_grades, "status": "ok" if total_grades else "idle",
         "detail": f"{total_grades} grades"},
        {"id": "regime", "label": f"regime · {regime_tone}", "family": "macro",
         "rate": 1, "status": "ok", "detail": (reg.meta or {}).get("note", "")[:80] if reg else ""},
    ]

    # orchestrator log — from recent cycles (throughput, self-recovery, calls) + grades
    logs = []
    for c in cycles[-16:]:
        logs.append({"ts": c["ts"], "level": "info",
                     "msg": f"wave #{c['wave']} · {c.get('feed_signals', 0)} feed + "
                            f"{c.get('enriched', 0)} enrich rows · scored {c.get('scored', 0)} · "
                            f"gated {c.get('gated', 0)} · floor {c.get('floor', 70):.0f}"})
        for e in c.get("errors", []):
            logs.append({"ts": c["ts"], "level": "warn",
                         "msg": f"{e['source']} degraded — {e['msg'][:60]} · isolated, "
                                f"cycle continued"})
        for tk in c.get("calls", []):
            logs.append({"ts": c["ts"], "level": "good", "msg": f"CALL fired — {tk}"})
    for g in log.grades()[-6:]:
        logs.append({"ts": g.ts, "level": "info" if g.hit else "warn",
                     "msg": f"backfill grade {g.ticker} {g.horizon} — "
                            f"{'HIT' if g.hit else 'miss'} {g.return_pct:+.1f}%"})
    logs.sort(key=lambda x: x["ts"], reverse=True)

    healthy = sum(1 for s in src_nodes if s["status"] == "ok")
    last_ts = last.get("ts")
    age = None
    if last_ts:
        try:
            age = int((now - datetime.fromisoformat(last_ts)).total_seconds())
        except ValueError:
            age = None
    return {
        "now": now.isoformat(timespec="seconds"),
        "wave": pstate.get("wave", 0),
        "last_cycle_ts": last_ts,
        "age_seconds": age,
        "throughput": int(last.get("feed_signals", 0)) + int(last.get("enriched", 0)),
        "nodes_healthy": healthy, "nodes_total": len(src_nodes),
        "stages": [{"key": k, "label": lbl} for k, lbl in _STAGES],
        "sources": src_nodes, "bronze": bronze, "silver": silver, "gold": gold, "marts": marts,
        "log": logs[:40],
        "regime_tone": regime_tone,
        "floor": last.get("floor", config.CONVICTION_FLOOR),
    }
