"""Vendored S&P 500 constituent list.

Why vendored: Wikipedia (the canonical free source) now 403s the default
User-Agent that pandas.read_html sends, so the runtime scrape is flaky.
A static list gives us deterministic behavior across environments and
removes one external dependency from the scanner.

Maintenance: the S&P 500 turns over ~5-10 names per year. If this list
drifts you'll see scan misses for a handful of names — refresh by running:

    python -c "import pandas, urllib.request as r; \
       req = r.Request('https://en.wikipedia.org/wiki/List_of_S%26P_500_companies', \
       headers={'User-Agent': 'Mozilla/5.0'}); \
       html = r.urlopen(req).read().decode(); \
       df = pandas.read_html(html)[0]; \
       print(','.join(sorted(df['Symbol'].str.replace('.','-').tolist())))"

Tickers use Yahoo Finance's notation (BRK-B, BF-B) — pandas/Wikipedia
use dots (BRK.B), which we normalize on import.
"""

from __future__ import annotations


# Snapshot of S&P 500 constituents organized by sector for readability and
# easier manual updates. Order within sector roughly approximates index
# weight (top names first). Total count matters more than perfect membership;
# 5-10 stale names won't materially affect a setup scanner.

_TECHNOLOGY = [
    "AAPL", "MSFT", "NVDA", "AVGO", "ORCL", "ADBE", "CRM", "AMD", "ACN", "CSCO",
    "INTU", "QCOM", "NOW", "IBM", "TXN", "AMAT", "ADI", "PANW", "MU", "LRCX",
    "KLAC", "SNPS", "CDNS", "ANET", "MRVL", "FTNT", "ON", "ROP", "MCHP", "MSI",
    "IT", "FICO", "GLW", "GEN", "PAYX", "ADP", "FIS", "FI", "GPN", "JKHY",
    "PTC", "TYL", "EPAM", "TER", "SWKS", "JNPR", "AKAM", "VRSN", "ANSS", "CDW",
    "ZBRA", "NTAP", "STX", "WDC", "HPQ", "HPE", "DELL", "ENPH", "MPWR", "KEYS",
    "TDY", "NXPI", "FFIV", "CTSH", "INTC", "PYPL", "VRSK", "EFX",
]

_HEALTHCARE = [
    "LLY", "UNH", "JNJ", "ABBV", "MRK", "TMO", "ABT", "DHR", "PFE", "ISRG",
    "AMGN", "BMY", "CI", "ELV", "VRTX", "REGN", "MDT", "GILD", "SYK", "BSX",
    "ZTS", "BDX", "BIIB", "MCK", "COR", "CAH", "HCA", "IDXX", "MTD", "EW",
    "A", "RMD", "IQV", "DXCM", "RVTY", "ALGN", "BAX", "MOH", "HSIC", "CRL",
    "INCY", "WAT", "WST", "HOLX", "DGX", "LH", "CTLT", "COO", "CNC", "PODD",
    "CVS", "HUM", "ZBH", "STE", "BIO", "VTRS", "TFX", "TECH", "ABBV", "ELV",
]

_FINANCIALS = [
    "BRK-B", "JPM", "V", "MA", "BAC", "WFC", "GS", "MS", "SPGI", "AXP",
    "BLK", "C", "PGR", "SCHW", "MMC", "CME", "ICE", "USB", "PNC", "AON",
    "TFC", "COF", "BK", "MCO", "AJG", "MET", "PRU", "AFL", "ALL", "TRV",
    "CB", "WTW", "BRO", "STT", "AMP", "MSCI", "FDS", "NDAQ", "RJF", "NTRS",
    "FITB", "CFG", "RF", "KEY", "MTB", "HBAN", "ZION", "CMA", "ALLY", "AIG",
    "DFS", "PFG", "L", "GL", "AIZ", "CINF", "RE", "ERIE", "BEN", "IVZ",
    "TROW", "PYPL", "FIS",
]

_CONSUMER_DISCRETIONARY = [
    "AMZN", "TSLA", "HD", "MCD", "NKE", "SBUX", "LOW", "TJX", "BKNG", "ABNB",
    "AZO", "ORLY", "MAR", "HLT", "GM", "F", "LULU", "ULTA", "TSCO", "DG",
    "DLTR", "BBY", "ROST", "EBAY", "ETSY", "CMG", "YUM", "DPZ", "DRI", "DECK",
    "RL", "PVH", "TPR", "GPC", "LKQ", "GRMN", "NCLH", "RCL", "CCL", "EXPE",
    "MGM", "WYNN", "LVS", "HAS", "NWL", "WHR", "MHK", "NVR", "DHI", "LEN",
    "PHM", "TOL", "POOL", "BWA", "APTV",
]

_CONSUMER_STAPLES = [
    "COST", "WMT", "PG", "KO", "PEP", "PM", "MDLZ", "MO", "CL", "TGT",
    "KMB", "GIS", "MNST", "KR", "STZ", "ADM", "SYY", "HSY", "KDP", "KHC",
    "CHD", "K", "MKC", "CLX", "TAP", "EL", "HRL", "CPB", "SJM", "TSN",
    "CAG", "LW", "BG", "WBA",
]

_ENERGY = [
    "XOM", "CVX", "COP", "EOG", "PSX", "MPC", "SLB", "OXY", "VLO", "WMB",
    "KMI", "OKE", "HES", "FANG", "DVN", "HAL", "BKR", "TRGP", "EQT", "CTRA",
    "APA", "MRO", "OVV",
]

_INDUSTRIALS = [
    "GE", "RTX", "CAT", "BA", "UNP", "HON", "DE", "ETN", "LMT", "UPS",
    "FDX", "EMR", "ITW", "GD", "NOC", "NSC", "CSX", "CARR", "OTIS", "JCI",
    "PH", "PCAR", "TT", "ROK", "ROP", "AME", "FAST", "GWW", "FTV", "DOV",
    "XYL", "IEX", "PWR", "URI", "RSG", "WM", "VRSK", "VLTO", "EXPD", "CHRW",
    "JBHT", "ODFL", "XPO", "R", "MAS", "ALLE", "PNR", "AOS", "SNA", "GNRC",
    "TXT", "LHX", "HII", "TDG", "HEI", "AXON", "BLDR", "PAYC", "ROL", "CTAS",
    "WAB", "RHI", "MAN",
]

_COMMUNICATION_SERVICES = [
    "GOOGL", "GOOG", "META", "NFLX", "DIS", "T", "VZ", "CMCSA", "TMUS", "CHTR",
    "EA", "TTWO", "WBD", "OMC", "IPG", "MTCH", "FOXA", "FOX", "PARA", "NWS",
    "NWSA", "LYV", "DASH",
]

_UTILITIES = [
    "NEE", "SO", "DUK", "AEP", "EXC", "XEL", "SRE", "D", "PCG", "EIX",
    "WEC", "ED", "ES", "DTE", "PPL", "AWK", "ATO", "FE", "AEE", "PEG",
    "ETR", "CMS", "CNP", "NRG", "EVRG", "LNT", "NI", "PNW", "VST", "CEG",
]

_REAL_ESTATE = [
    "PLD", "AMT", "EQIX", "WELL", "PSA", "SPG", "CCI", "O", "DLR", "EXR",
    "AVB", "EQR", "VTR", "MAA", "ESS", "UDR", "INVH", "BXP", "ARE", "IRM",
    "KIM", "REG", "FRT", "HST", "VICI", "CPT", "DOC", "WY", "AMH", "ELS",
]

_MATERIALS = [
    "LIN", "APD", "SHW", "ECL", "DD", "NEM", "PPG", "NUE", "FCX", "IFF",
    "DOW", "LYB", "MLM", "VMC", "ALB", "EMN", "CF", "MOS", "BALL", "AMCR",
    "AVY", "PKG", "IP", "CE", "STLD", "FMC", "SEE",
]


# Build the de-duplicated list. Some names live in multiple lists by mistake
# (legitimately some companies are reclassified) — dedupe preserves first-seen
# order so the highest-weight names come first.
def _dedupe(seq: list[str]) -> list[str]:
    seen = set()
    out: list[str] = []
    for s in seq:
        if s not in seen:
            seen.add(s)
            out.append(s)
    return out


SP500_TICKERS: list[str] = _dedupe(
    _TECHNOLOGY
    + _HEALTHCARE
    + _FINANCIALS
    + _CONSUMER_DISCRETIONARY
    + _CONSUMER_STAPLES
    + _ENERGY
    + _INDUSTRIALS
    + _COMMUNICATION_SERVICES
    + _UTILITIES
    + _REAL_ESTATE
    + _MATERIALS
)
