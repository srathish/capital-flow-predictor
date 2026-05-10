"""Cross-check uw_insider_transactions against SEC EDGAR Form 4 filings.

EDGAR is the authoritative source — every Form 4 our Unusual Whales feed
reports must also exist as a real filing on sec.gov. This script pulls both
sides and reports matches, DB-only, and EDGAR-only rows so we can catch
either silent UW gaps or fabricated/stale data.
"""

from __future__ import annotations

import logging
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import date, datetime, timedelta

import psycopg
import urllib.request

from cfp_jobs.db import to_psycopg_url

log = logging.getLogger(__name__)

EDGAR_FORM4_FEED = (
    "https://www.sec.gov/cgi-bin/browse-edgar"
    "?action=getcompany&CIK={ticker}&type=4&dateb=&owner=include&count=100&output=atom"
)
# SEC requires a descriptive User-Agent or it returns 403.
_UA = "capital-flow-predictor verify-insiders (saieagle@gmail.com)"


@dataclass(frozen=True)
class FilingRef:
    filing_date: date
    accession: str
    href: str


def fetch_edgar_form4(ticker: str, since: date) -> list[FilingRef]:
    url = EDGAR_FORM4_FEED.format(ticker=ticker.upper())
    req = urllib.request.Request(url, headers={"User-Agent": _UA, "Accept": "application/atom+xml"})
    with urllib.request.urlopen(req, timeout=20) as resp:  # noqa: S310 — sec.gov is fixed host
        body = resp.read()
    # Atom namespace.
    ns = {"a": "http://www.w3.org/2005/Atom"}
    root = ET.fromstring(body)
    out: list[FilingRef] = []
    for entry in root.findall("a:entry", ns):
        updated = entry.findtext("a:updated", default="", namespaces=ns)
        try:
            fdate = datetime.fromisoformat(updated.replace("Z", "+00:00")).date()
        except ValueError:
            continue
        if fdate < since:
            continue
        link_el = entry.find("a:link", ns)
        href = link_el.attrib.get("href", "") if link_el is not None else ""
        accession = entry.findtext("a:id", default="", namespaces=ns)
        out.append(FilingRef(filing_date=fdate, accession=accession, href=href))
    return out


def fetch_db_insiders(database_url: str, ticker: str, since: date) -> list[tuple[date, str, str]]:
    """Returns (transaction_date, transaction_code, owner_name) tuples."""
    sql = """
        SELECT transaction_date, transaction_code, COALESCE(owner_name, '?')
        FROM uw_insider_transactions
        WHERE ticker = %s
          AND transaction_date >= %s
        ORDER BY transaction_date
    """
    with psycopg.connect(to_psycopg_url(database_url)) as conn, conn.cursor() as cur:
        cur.execute(sql, (ticker.upper(), since))
        return [(r[0], r[1], r[2]) for r in cur.fetchall()]


def verify(database_url: str, ticker: str, days: int = 180) -> dict:
    since = date.today() - timedelta(days=days)
    db_rows = fetch_db_insiders(database_url, ticker, since)
    edgar_rows = fetch_edgar_form4(ticker, since)

    db_dates = {r[0] for r in db_rows}
    edgar_dates = {r.filing_date for r in edgar_rows}

    matched_dates = db_dates & edgar_dates
    db_only_dates = db_dates - edgar_dates  # in our DB, not on EDGAR (suspicious)
    edgar_only_dates = edgar_dates - db_dates  # filed on EDGAR, missing from our feed

    return {
        "ticker": ticker.upper(),
        "since": since.isoformat(),
        "db_count": len(db_rows),
        "edgar_count": len(edgar_rows),
        "matched_dates": sorted(d.isoformat() for d in matched_dates),
        "db_only_dates": sorted(d.isoformat() for d in db_only_dates),
        "edgar_only_dates": sorted(d.isoformat() for d in edgar_only_dates),
        "edgar_sample_urls": [r.href for r in edgar_rows[:5]],
    }
