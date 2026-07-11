"""Curated source registry, loaded from sources.yaml."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlparse

import yaml

from brain import config


@dataclass
class Source:
    name: str
    domain: str
    trust_tier: int
    category: str
    fetcher: str = "plain"  # plain | stealth | dynamic
    rate_s: float = config.DEFAULT_RATE_SECONDS
    discovery: str = "seed"  # seed (crawl once) | feed (re-poll on sweep)
    seed_urls: list[str] = field(default_factory=list)
    topics: list[str] = field(default_factory=list)


def _registry_path() -> Path:
    return Path(__file__).with_name("sources.yaml")


def load_sources() -> list[Source]:
    raw = yaml.safe_load(_registry_path().read_text(encoding="utf-8")) or []
    return [Source(**entry) for entry in raw]


def source_for_url(url: str) -> Source | None:
    """Match a URL to its registered source by domain suffix."""
    host = urlparse(url).netloc.lower()
    for src in load_sources():
        if host == src.domain or host.endswith("." + src.domain):
            return src
    return None
