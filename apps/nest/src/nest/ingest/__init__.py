"""Ingestors — one small adapter per source. Each normalizes a raw payload into
Signal events; the log dedupes them. Wire the sources you already pay for first
(UW), then add free ones one at a time and let the tracker prove each deserves weight.
"""
