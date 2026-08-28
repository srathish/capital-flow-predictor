"""EDGAR source (free, Tier 2) — SEC full-text search for material filings. The search
API returns metadata only (no filing body), so direction comes from the FORM TYPE:
offering/prospectus forms (424B*, S-1, S-3) mean fresh share issuance → dilution → bear.
That's a real, tradeable tell that hits EDGAR minutes before aggregators. Ticker is parsed
from the filer display name when present; filings without a resolvable ticker are skipped.

SEC requires a descriptive User-Agent. Read-only, low-rate.
"""

from __future__ import annotations

import logging
import re

import httpx

from nest.events.schema import Signal

log = logging.getLogger(__name__)

_EFTS = "https://efts.sec.gov/LATEST/search-index"
_UA = {"User-Agent": "ConvictionNest/0.1 (research; saieagle@gmail.com)"}
# "Apple Inc. (AAPL) (CIK 0000320193)" -> AAPL ; ignore the (CIK ...) group
_TICKER_RE = re.compile(r"\(([A-Z]{1,5})\)")
# offering / dilution forms → bear
_OFFERING_FORMS = ["424B5", "424B3", "424B4", "S-1", "S-3"]


def _ticker(display_names: list) -> str | None:
    for name in display_names or []:
        for m in _TICKER_RE.findall(str(name)):
            if m != "CIK":
                return m
    return None


def feed_edgar(limit_per_form: int = 40) -> list[Signal]:
    """Recent offering filings → per-ticker bear (dilution) Signals, deduped by ticker."""
    out: dict[str, dict] = {}
    try:
        with httpx.Client(headers=_UA, timeout=20) as c:
            for form in _OFFERING_FORMS:
                try:
                    r = c.get(_EFTS, params={"q": "", "forms": form})
                    if r.status_code != 200:
                        continue
                    for hit in r.json().get("hits", {}).get("hits", [])[:limit_per_form]:
                        src = hit.get("_source", {})
                        tkr = _ticker(src.get("display_names"))
                        if not tkr:
                            continue
                        a = out.setdefault(tkr, {"forms": set(), "date": ""})
                        a["forms"].add(form)
                        a["date"] = src.get("file_date", a["date"])
                except httpx.HTTPError:
                    continue
    except Exception as e:  # noqa: BLE001 — external source must not kill the cycle
        log.warning("edgar feed failed: %s", e)
        return []
    signals = []
    for tkr, a in out.items():
        signals.append(Signal(
            source="edgar_offering", ticker=tkr, direction="bear",
            strength=0.5, ttl_hours=72,
            meta={"forms": sorted(a["forms"]), "file_date": a["date"]},
        ))
    return signals
