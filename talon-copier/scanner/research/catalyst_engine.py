#!/usr/bin/env python3
"""Catalyst + breadth engine (Scrapling).

1. Scrape Finviz screener for the day's MEANINGFUL movers (liquidity-filtered), both directions.
2. Scrape each top mover's recent news headlines (dated, sourced).
3. Sonnet clusters the movers into THEMES, names the catalyst per theme, and reports breadth.
Everything is scraped/verifiable — no inferred catalysts.

  python catalyst_engine.py [N_movers=24]
"""
import os, re, sys, json, time, urllib.request
from pathlib import Path
from urllib.parse import urlparse
from scrapling.fetchers import Fetcher

FILT = 'cap_smallover,sh_price_o5,sh_avgvol_o1000'   # >$300M cap, >$5, >1M avg vol = liquid/meaningful
NMOVERS = int(sys.argv[1]) if len(sys.argv) > 1 else 24


def celltext(td):
    fn = getattr(td, 'get_all_text', None)
    if fn:
        try:
            v = fn(strip=True)
            if v:
                return v.strip()
        except Exception:
            pass
    a = td.css('a')
    return (a[0].text.strip() if a else (td.text or '').strip())


def screener(signal, want=40):
    out = []
    for r in range(1, want + 1, 20):
        url = f'https://finviz.com/screener.ashx?v=111&f={FILT}&s={signal}&r={r}'
        try:
            page = Fetcher.get(url, stealthy_headers=True)
        except Exception as e:
            print(f'  screener {signal} r={r} err: {e}', file=sys.stderr); continue
        for row in page.css('tr[valign="top"]'):
            tds = row.css('td')
            c = [celltext(td) for td in tds]
            if len(c) < 11:
                continue
            a = row.css('a')
            href = a[0].attrib.get('href', '') if a else ''
            mt = re.search(r't=([A-Z.]{1,6})', href)          # ticker cell is "A\nAMLX"; pull from stock?t=AMLX
            tk = mt.group(1) if mt else c[1].split('\n')[-1].strip()
            if not re.match(r'^[A-Z.]{1,6}$', tk):
                continue
            try:
                chg = float(c[9].replace('%', '').replace(',', ''))
            except Exception:
                continue
            out.append({'ticker': tk, 'company': c[2], 'sector': c[3], 'industry': c[4],
                        'mktcap': c[6], 'price': c[8], 'change': chg})
        time.sleep(0.6)
    return out


def news(ticker, n=6):
    try:
        page = Fetcher.get(f'https://finviz.com/quote.ashx?t={ticker}', stealthy_headers=True)
    except Exception:
        return []
    heads = []
    for tr in page.css('#news-table tr'):
        a = tr.css('a.tab-link-news') or tr.css('a')
        if not a:
            continue
        h = (a[0].text or '').strip()
        if not h or 'Loading' in h:
            continue
        dom = urlparse(a[0].attrib.get('href', '')).netloc.replace('www.', '')
        tds = tr.css('td')
        dt = celltext(tds[0]) if tds else ''
        heads.append({'date': dt, 'headline': h, 'source': dom})
        if len(heads) >= n:
            break
    return heads


def load_key():
    for p in [Path(__file__).resolve().parents[3] / '.env']:
        if p.exists():
            for line in p.read_text().splitlines():
                if line.startswith('ANTHROPIC_API_KEY='):
                    return line.split('=', 1)[1].strip().strip('"')
    return os.environ.get('ANTHROPIC_API_KEY')


def sonnet(system, user, max_tokens=9000):
    key = load_key()
    body = json.dumps({'model': 'claude-sonnet-5', 'max_tokens': max_tokens,
                       'system': system, 'messages': [{'role': 'user', 'content': user}]}).encode()
    req = urllib.request.Request('https://api.anthropic.com/v1/messages', data=body,
                                 headers={'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json'})
    with urllib.request.urlopen(req, timeout=120) as r:
        j = json.load(r)
    return ''.join(b.get('text', '') for b in j.get('content', []))


print(f'Scraping Finviz movers (filter: {FILT}) …', file=sys.stderr)
gain = screener('ta_topgainers')
lose = screener('ta_toplosers')
allm = {m['ticker']: m for m in gain + lose}.values()
movers = sorted(allm, key=lambda m: -abs(m['change']))[:NMOVERS]
print(f'  {len(gain)} gainers + {len(lose)} losers → top {len(movers)} by |move|', file=sys.stderr)

print('Scraping news per mover …', file=sys.stderr)
for m in movers:
    m['news'] = news(m['ticker'])
    time.sleep(0.4)
    print(f"  {m['ticker']:6} {m['change']:+6.1f}%  {len(m['news'])} headlines", file=sys.stderr)

out = Path(__file__).parent / 'tracking' / 'catalysts-latest.json'
out.parent.mkdir(exist_ok=True)
out.write_text(json.dumps(list(movers), indent=1))
print(f'→ saved {out}', file=sys.stderr)

# breadth by sector (verifiable count)
from collections import Counter
sec = Counter(m['sector'] for m in movers)
print('\n=== SECTOR BREADTH (top movers) ===')
for s, n in sec.most_common():
    tks = [f"{m['ticker']}{m['change']:+.0f}" for m in movers if m['sector'] == s]
    print(f'  {s:24} {n:2}  {" ".join(tks)}')

# Sonnet: cluster into themes + name the catalyst per theme from the SCRAPED headlines only
blocks = []
for m in movers:
    hl = '; '.join(f"[{h['date']}] {h['headline']} ({h['source']})" for h in m['news'][:5]) or 'no headlines'
    blocks.append(f"{m['ticker']} {m['change']:+.1f}% [{m['sector']}/{m['industry']}]: {hl}")
SYS = ("You are a market-desk analyst. You are given today's biggest movers with their SCRAPED news "
       "headlines. Cluster the movers into THEMES (e.g. memory, AI-infrastructure, biotech). For each "
       "theme: list the tickers+moves, state the SPECIFIC catalyst ONLY IF it appears in the scraped "
       "headlines (quote the headline), and note breadth (how many names). If a mover has no clear "
       "catalyst in its headlines, put it under 'Idiosyncratic / no clear catalyst' — do NOT invent a "
       "reason. Be concise, evidence-only. End with the single biggest theme of the day.")
print('\n=== THEME + CATALYST SYNTHESIS (Sonnet, from scraped headlines) ===\n')
try:
    print(sonnet(SYS, 'Today\'s movers + scraped headlines:\n\n' + '\n'.join(blocks)))
except Exception as e:
    print(f'(synthesis failed: {e}; raw scraped data saved to {out})')
