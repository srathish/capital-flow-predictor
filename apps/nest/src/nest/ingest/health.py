"""Per-source health sink. Feeds and enrichers report failures here (instead of only
logging), so the pipeline view can show DEGRADED/FAILED nodes and the orchestrator log can
narrate self-recovery. Drained once per cycle by the orchestrator.
"""

from __future__ import annotations

_errors: list[dict] = []


def record_error(source: str, msg: str) -> None:
    _errors.append({"source": source, "msg": str(msg)[:160]})


def drain() -> list[dict]:
    out = list(_errors)
    _errors.clear()
    return out
