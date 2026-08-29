"""Morning digest — the one scheduled Sonnet call per day (premarket). Summarizes
overnight signals, the current conviction book, yesterday's grades, and the regime dial.
Falls back to a plain-text roll-up if no LLM is available; it is informational, never an
alert, so it never counts against the Call budget.
"""

from __future__ import annotations

import os
from datetime import UTC, datetime, timedelta

from nest import config
from nest.events.log import EventLog
from nest.tracker import grader


def build(log: EventLog, now: datetime | None = None) -> str:
    now = now or datetime.now(UTC)
    since = (now - timedelta(hours=18)).isoformat()
    overnight = log.signals_since(since)
    scored = log.latest_scores(60)
    longs = [s for s in scored if s.direction == "bull"][:6]
    shorts = [s for s in scored if s.direction == "bear"][:6]
    reg = log.latest_score("__MACRO__")
    cal = grader.calibration(log, "5d")
    lines = [f"**🪶 Nest digest — {now.date().isoformat()}**"]
    lines.append(f"Overnight signals: {len(overnight)}")
    if reg:
        lines.append(f"Regime: **{reg.meta.get('tone','?')}** (dial {reg.conviction:.0f}, "
                     f"floor Δ{reg.meta.get('floor_delta',0):+.0f}) — {reg.meta.get('note','')[:160]}")
    lines.append("\n__Long-short book__")
    lines.append("▲ **LONG**")
    for s in longs:
        lines.append(f"🟢 {s.ticker}: {s.conviction:.0f} ({', '.join(s.families)})")
    lines.append("▼ **SHORT**")
    for s in shorts:
        lines.append(f"🔴 {s.ticker}: {s.conviction:.0f} ({', '.join(s.families)})")

    # live track record — the self-proof loop (market-relative excess vs SPY)
    try:
        from nest.tracker import shadow
        summ = shadow.summary()
        if summ.get("graded_total"):
            lines.append("\n__Live track record (excess vs SPY)__")
            leg = summ.get("by_leg", {})
            for hz in ("5d", "20d"):
                b = leg.get(hz, {})
                lo, sh, sp = b.get("long", {}), b.get("short", {}), b.get("spread")
                if sp is not None:
                    lines.append(f"{hz}: L {lo.get('mean_excess'):+}% · S {sh.get('mean_excess'):+}% "
                                 f"⇒ spread **{sp:+}%** (n {lo.get('n',0)}/{sh.get('n',0)})")
        else:
            lines.append("\n_Track record accruing — first grades within a day, 20d proof ~4 weeks._")
    except Exception:  # noqa: BLE001,S110 — track record is optional, never break the digest
        pass

    lines.append("\n__5d calibration__")
    for key, b in cal.buckets.items():
        if b["hit_rate"] is not None:
            lines.append(f"{key}: {b['hit_rate']:.0%} hit (n={b['n']}, avg {b['avg_ret']:+.1f}%)")
    plain = "\n".join(lines)

    if not config.LLM_ENABLED or not os.environ.get(config.ANTHROPIC_KEY_ENV):
        return plain  # local-first: mechanical digest unless NEST_LLM=on
    try:
        import anthropic

        client = anthropic.Anthropic()
        resp = client.messages.create(
            model=config.DIGEST_MODEL,
            max_tokens=500,
            messages=[{"role": "user", "content":
                       "You are the Nest's morning digest voice. In <=6 sentences, "
                       "synthesize this overnight roll-up into what the operator should "
                       "watch today, factoring the regime dial. Be concrete and skeptical; "
                       "flag anything the calibration says to distrust.\n\n" + plain}],
        )
        text = "".join(b.text for b in resp.content if getattr(b, "type", "") == "text")
        return plain + "\n\n__Read__\n" + text.strip()
    except Exception:  # noqa: BLE001
        return plain
