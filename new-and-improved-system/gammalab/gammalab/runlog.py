"""Run ledger: every run that produces an output records code SHA, dirty state, data hashes, exact command and output paths.

    with Run("data_audit", inputs=[...]) as run:
        ...
        run.output(path)

writes runs/<utc-stamp>_<name>.json and appends one line to runs/LEDGER.jsonl (append-only; never edited). A result may be
called "verified" only if a ledger line with status "ok" and a clean tree (dirty == false) produced it.
"""
from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUNS = ROOT / "runs"


def _git(*a) -> str:
    return subprocess.run(["git", *a], cwd=ROOT, capture_output=True, text=True).stdout.strip()


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


class Run:
    def __init__(self, name: str, inputs: list[Path] = (), params: dict | None = None):
        self.name, self.inputs, self.params = name, [Path(p) for p in inputs], params or {}
        self.outputs: list[Path] = []

    def output(self, p) -> Path:
        self.outputs.append(Path(p))
        return Path(p)

    def __enter__(self):
        self.started = datetime.now(timezone.utc)
        return self

    def __exit__(self, et, ev, tb):
        rec = {
            "name": self.name,
            "started": self.started.isoformat(),
            "finished": datetime.now(timezone.utc).isoformat(),
            "status": "ok" if et is None else f"error: {et.__name__}: {ev}",
            "code_sha": _git("rev-parse", "HEAD"),
            "dirty": bool(_git("status", "--porcelain", "--", str(ROOT / "gammalab"), str(ROOT / "tests"))),  # code only
            "command": [sys.executable, *sys.argv],
            "params": self.params,
            "inputs": {str(p): sha256(p) for p in self.inputs if p.exists()},
            "outputs": {str(p): sha256(p) for p in self.outputs if p.exists()},
        }
        RUNS.mkdir(exist_ok=True)
        stamp = self.started.strftime("%Y%m%dT%H%M%SZ")
        (RUNS / f"{stamp}_{self.name}.json").write_text(json.dumps(rec, indent=2))
        with open(RUNS / "LEDGER.jsonl", "a") as f:
            f.write(json.dumps(rec) + "\n")
        return False
