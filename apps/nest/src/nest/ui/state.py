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


# --- picks board (the finder's output) --------------------------------------

def build_picks(log: EventLog, now: datetime | None = None) -> dict:
    """The finder's ranked output — what to actually look at. For the top names by
    conviction, gather the 'why' from their live signals: momentum, sector + theme tailwind,
    catalysts, and which confirmation sources agree/oppose. Picks are LIVE every cycle."""
    from datetime import timedelta
    now = now or datetime.now(UTC)
    since = (now - timedelta(hours=config.GATE_WINDOW_HOURS)).isoformat()
    # group live signals by ticker (one pass)
    by_ticker: dict[str, dict] = {}
    universe = set()
    for s in log.signals_since(since):
        if not s.ticker or s.ticker == macro.MACRO_TICKER:
            continue
        universe.add(s.ticker)
        by_ticker.setdefault(s.ticker, {})[s.source] = s

    reg = log.latest_score(macro.MACRO_TICKER)
    floor = config.CONVICTION_FLOOR + (reg.meta.get("floor_delta", 0.0) if reg else 0.0)

    def pick_row(score) -> dict:
        sigs = by_ticker.get(score.ticker, {})
        mom = sigs.get("uw_chart") or sigs.get("uw_momentum")
        theme = sigs.get("uw_theme")
        earn = sigs.get("uw_earnings")
        fda = sigs.get("uw_fda")
        # confirmation sources present and whether they agree with the pick's direction
        confirms, vetoes = [], []
        for src, s in sigs.items():
            if src in config.DIRECTION_SOURCES:
                continue
            (confirms if s.direction == score.direction else vetoes).append(src.replace("uw_", ""))
        why = []
        if mom:
            mp = mom.meta.get("mom60_pct")
            why.append(f"momentum {mp:+.0f}%" if mp is not None else "momentum")
        if any(s in sigs for s in ("uw_fundamentals", "uw_margins")):
            why.append("quality")
        if theme:
            why.append(f"theme:{theme.meta.get('sector', '?')}")
        if earn:
            why.append(f"earnings {earn.meta.get('days_to_earnings', '?')}d")
        if fda:
            why.append("FDA")
        return {
            "ticker": score.ticker, "conviction": round(score.conviction, 1),
            "direction": score.direction, "delta": round(score.delta, 1),
            "sector": (mom.meta.get("sector") if mom else None)
                      or (theme.meta.get("sector") if theme else None),
            "mom60_pct": (mom.meta.get("mom60_pct") if mom else None),
            "from_52w_high_pct": (mom.meta.get("from_52w_high_pct") if mom else None),
            "range_pos": (mom.meta.get("range_pos") if mom else None),
            "theme_breadth": (theme.meta.get("sector_breadth") if theme else None),
            "families": score.families, "why": why,
            "confirms": confirms[:5], "vetoes": vetoes[:4],
            "gated": score.conviction >= floor,
        }

    scored = log.latest_scores(300)
    bull = [s for s in scored if s.direction == "bull"]
    bear = [s for s in scored if s.direction == "bear"]
    # sector heat (bull cohorts) from theme signals
    sec_heat: dict[str, float] = {}
    for s in by_ticker.values():
        t = s.get("uw_theme")
        if t and t.meta.get("sector"):
            sec_heat[t.meta["sector"]] = t.meta.get("sector_breadth", 0.5)

    return {
        "now": now.isoformat(timespec="seconds"),
        "universe": len(universe),
        "floor": round(floor, 0),
        "regime": (reg.meta.get("tone") if reg else "neutral"),
        "longs": [pick_row(s) for s in bull[:30]],
        "shorts": [pick_row(s) for s in bear[:12]],
        "sectors": sorted(sec_heat.items(), key=lambda kv: -kv[1]),
    }


# --- 3D nexus graph (the orbitable stock galaxy) ----------------------------

def build_graph(log: EventLog, now: datetime | None = None) -> dict:
    """Nodes = tracked stocks (size ∝ conviction, grows with confluence), grouped into
    sector clusters (the 'islands'); side data = names whose confluence is rising. As more
    stocks are tracked the cloud grows; as a name gains agreement its node swells."""
    from datetime import timedelta
    now = now or datetime.now(UTC)
    since = (now - timedelta(hours=config.GATE_WINDOW_HOURS)).isoformat()
    sig_by_ticker: dict[str, dict] = {}
    universe = set()
    for s in log.signals_since(since):
        if not s.ticker or s.ticker == macro.MACRO_TICKER:
            continue
        universe.add(s.ticker)
        sig_by_ticker.setdefault(s.ticker, {})[s.source] = s

    def sector_of(t: str) -> str:
        sig = sig_by_ticker.get(t, {})
        for src in ("uw_momentum", "uw_chart", "uw_theme"):
            if src in sig and sig[src].meta.get("sector"):
                return sig[src].meta["sector"]
        return "Other"

    scored = log.latest_scores(400)
    nodes = []
    for s in scored[:200]:                       # cap the cloud for a fluid 3D layout
        nfam = len(s.families)
        nodes.append({
            "id": s.ticker, "conv": round(s.conviction, 1), "dir": s.direction,
            "sector": sector_of(s.ticker), "delta": round(s.delta, 1), "fam": nfam,
        })
    sectors = sorted({n["sector"] for n in nodes})
    rising = sorted([n for n in nodes if n["delta"] > 0], key=lambda n: -n["delta"])[:16]

    # sector breadth (heat) from theme signals
    heat: dict[str, float] = {}
    for sig in sig_by_ticker.values():
        t = sig.get("uw_theme")
        if t and t.meta.get("sector"):
            heat[t.meta["sector"]] = t.meta.get("sector_breadth", 0.5)

    reg = log.latest_score(macro.MACRO_TICKER)
    floor = config.CONVICTION_FLOOR + (reg.meta.get("floor_delta", 0.0) if reg else 0.0)
    return {
        "now": now.isoformat(timespec="seconds"),
        "universe": len(universe), "shown": len(nodes),
        "regime": (reg.meta.get("tone") if reg else "neutral"),
        "floor": round(floor, 0),
        "nodes": nodes, "sectors": sectors, "rising": rising,
        "sector_heat": sorted(heat.items(), key=lambda kv: -kv[1]),
    }


# --- per-stock detail (the drill-down: show EVERY captured field) ------------

_SRC_LABEL = {
    "uw_flow": "options flow", "uw_sweep": "sweeps", "uw_darkpool": "dark pool",
    "uw_netprem": "net premium", "uw_gex": "gamma wall", "uw_vex": "vanna magnet",
    "uw_charm": "charm", "uw_maxpain": "max pain", "uw_oi": "OI change",
    "uw_short": "short squeeze", "uw_insider": "insider", "uw_congress": "congress",
    "uw_analyst": "analysts", "uw_news": "news", "edgar_offering": "SEC offering",
    "uw_chart": "momentum", "uw_momentum": "52w momentum", "uw_breakout": "breakout",
    "uw_volsurge": "vol surge", "uw_fundamentals": "growth", "uw_margins": "margins",
    "uw_fda": "FDA", "uw_earnings": "earnings", "uw_theme": "sector theme",
    "wiki_attention": "wiki attention", "stocktwits": "stocktwits", "reddit_velocity": "reddit",
}


def build_ticker(log: EventLog, ticker: str, now: datetime | None = None) -> dict:
    """Everything the Nest knows about one stock — for the click-to-open detail drawer.
    Organizes its live signals into readable sections (momentum, quality, catalyst, LEVELS
    for entry/target/stop, confirmation, positioning, news, social) with the actual numbers."""
    from datetime import timedelta
    now = now or datetime.now(UTC)
    ticker = ticker.upper()
    since = (now - timedelta(hours=config.GATE_WINDOW_HOURS)).isoformat()
    sig = {s.source: s for s in log.signals_since(since, ticker=ticker)}
    score = log.latest_score(ticker)

    def m(src, key, default=None):
        return sig[src].meta.get(key, default) if src in sig else default

    momentum = sig.get("uw_chart")
    mom_rows = []
    if momentum:
        mom_rows = [
            ("3-month", f"{m('uw_chart','mom60_pct')}%"),
            ("6-month", f"{m('uw_chart','mom120_pct')}%"),
            ("vol-adjusted", str(m("uw_chart", "voladj_mom"))),
            ("vs 52w high", f"{m('uw_chart','from_52w_high_pct')}%"),
        ]
    if "uw_momentum" in sig:
        mom_rows.append(("52w range position", f"{int((m('uw_momentum','range_pos') or 0)*100)}%"))
    if "uw_volsurge" in sig:
        mom_rows.append(("rel. volume", f"{m('uw_volsurge','rel_vol')}x  (today {m('uw_volsurge','day_pct')}%)"))

    qual_rows = []
    if "uw_fundamentals" in sig:
        qual_rows.append(("revenue growth", f"{m('uw_fundamentals','rev_growth_qoq_pct')}% QoQ"))
    if "uw_margins" in sig:
        qual_rows.append(("net margin", f"{m('uw_margins','net_margin_pct')}%  ({m('uw_margins','yoy_delta_pp'):+}pp YoY)"))

    cat_rows = []
    if "uw_earnings" in sig:
        cat_rows.append(("earnings in", f"{m('uw_earnings','days_to_earnings')} sessions ({m('uw_earnings','announce') or '?'})"))
    if "uw_fda" in sig:
        cat_rows.append(("FDA", str(m("uw_fda", "event"))))
    if "uw_theme" in sig:
        cat_rows.append(("sector theme", f"{m('uw_theme','sector')} · breadth {m('uw_theme','sector_breadth')}"))

    # LEVELS — the map: entry/target/stop from GEX/VEX/max-pain (captured from UW)
    lvl_rows = []
    spot = m("uw_gex", "spot") or m("uw_vex", "spot")
    if spot:
        lvl_rows.append(("spot", f"${spot}"))
    if "uw_gex" in sig:
        sgn = "support" if m("uw_gex", "gamma_sign") == "pos" and (m("uw_gex", "wall_strike") or 0) <= (spot or 0) else "wall"
        lvl_rows.append(("gamma wall", f"${m('uw_gex','wall_strike')}  ({sgn}, {m('uw_gex','dist_pct')}% away)"))
    if "uw_vex" in sig:
        lvl_rows.append(("vanna magnet", f"${m('uw_vex','magnet')}"))
    if "uw_maxpain" in sig:
        lvl_rows.append(("max pain", f"${m('uw_maxpain','max_pain')}  (gap {m('uw_maxpain','gap_pct')}%)"))

    def sec(*srcs):
        rows = []
        for s in srcs:
            if s in sig:
                sg = sig[s]
                bits = " · ".join(f"{k} {v}" for k, v in list(sg.meta.items())[:3]
                                  if k not in ("sector",))
                rows.append((_SRC_LABEL.get(s, s), f"{sg.direction} · {bits}"))
        return rows

    d = score.direction if score else "bull"
    confirms = [s.replace("uw_", "") for s in sig
                if s not in config.DIRECTION_SOURCES and sig[s].direction == d]
    vetoes = [s.replace("uw_", "") for s in sig
              if s not in config.DIRECTION_SOURCES and sig[s].direction != d]

    return {
        "ticker": ticker,
        "conviction": round(score.conviction, 1) if score else 0,
        "direction": d,
        "sector": m("uw_momentum", "sector") or m("uw_theme", "sector"),
        "families": score.families if score else [],
        "delta": round(score.delta, 1) if score else 0,
        "gated": bool(score and score.conviction >= config.CONVICTION_FLOOR),
        "sections": [
            {"title": "Momentum (the finder)", "tone": "chart", "rows": mom_rows},
            {"title": "Quality", "tone": "fundamental", "rows": qual_rows},
            {"title": "Catalyst", "tone": "catalyst", "rows": cat_rows},
            {"title": "Levels — entry / target / stop", "tone": "levels", "rows": lvl_rows},
            {"title": "Flow (confirmation)", "tone": "flow",
             "rows": sec("uw_flow", "uw_sweep", "uw_darkpool", "uw_netprem")},
            {"title": "Positioning", "tone": "positioning",
             "rows": sec("uw_insider", "uw_short", "uw_oi", "uw_congress")},
            {"title": "News / filings", "tone": "filings",
             "rows": sec("uw_news", "uw_analyst", "edgar_offering")},
            {"title": "Social", "tone": "social",
             "rows": sec("wiki_attention", "stocktwits", "reddit_velocity")},
        ],
        "confirms": confirms, "vetoes": vetoes,
        "n_signals": len(sig),
    }


# --- unified console (everything on one screen) ------------------------------

def build_console(log: EventLog, now: datetime | None = None) -> dict:
    """One payload for the single-screen dashboard: the galaxy + picks + rising confluence
    + sector heat + signal log + source health + regime — so nothing lives on a separate tab."""
    now = now or datetime.now(UTC)
    g = build_graph(log, now)
    p = build_picks(log, now)
    # recent signal log (freshest slice)
    signals = []
    for s in log.tail(60, type="signal"):
        signals.append({"source": s.source.replace("uw_", ""), "family": config.family_of(s.source),
                        "ticker": s.ticker, "dir": s.direction, "str": round(s.strength, 2),
                        "ts": s.ts[11:19]})
    # source health (which sources are emitting + their tracked weight)
    live_w = wmod.compute_all(log, "5d")
    counts = Counter(s.source for s in log.tail(700, type="signal"))
    health = []
    for src in sorted(config.SOURCE_PRIOR, key=lambda s: -counts.get(s, 0)):
        health.append({"source": src.replace("uw_", ""), "family": config.family_of(src),
                       "rate": counts.get(src, 0), "weight": round(wmod.source_weight(src, live_w), 2),
                       "dir": src in config.DIRECTION_SOURCES})
    cal = grader.calibration(log, "5d")
    return {
        "now": now.isoformat(timespec="seconds"),
        "universe": g["universe"], "shown": g["shown"], "regime": g["regime"], "floor": g["floor"],
        "nodes": g["nodes"], "sectors": g["sectors"], "sector_heat": g["sector_heat"],
        "rising": g["rising"],
        "longs": p["longs"][:24], "shorts": p["shorts"][:8],
        "signals": signals, "health": health,
        "calibration": {k: v for k, v in cal.buckets.items()},
        "alerts": sum(1 for x in p["longs"] if x.get("gated")),
    }
