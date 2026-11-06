"""Phase 0 — upstream repository census.

Clones the pinned upstream (if not already present), then emits an exhaustive manifest of every tracked file:
path, git blob sha, size, readable/encrypted, member, governing license file (nearest ancestor), GitHub link at the
pinned commit, and a coarse kind tag. No interpretation of content happens here.

    python -m gammalab.census                 # writes reports/manifest.json + reports/manifest.csv
"""
from __future__ import annotations

import csv
import json
import os
import subprocess
import sys
from dataclasses import asdict, dataclass

UPSTREAM = "https://github.com/chriskrajewski/Skylit.API.Community.Collab.git"
PINNED_SHA = "d435683365450f2108e7fdf4b63f8d3437d730cc"
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CLONE_DIR = os.path.join(ROOT, "..", ".cache", "upstream", f"collab-{PINNED_SHA[:8]}")
REPORTS = os.path.join(ROOT, "reports")
GITCRYPT_MAGIC = b"\x00GITCRYPT"

NOTE_EXT = {".md", ".txt", ".pdf", ".docx", ".json", ".yaml", ".yml"}
CODE_EXT = {".py", ".js", ".mjs", ".ts", ".tsx", ".jsx", ".rs", ".sh", ".tf"}


@dataclass(frozen=True)
class FileEntry:
    path: str
    blob_sha: str
    size: int
    status: str            # "readable" | "encrypted"
    member: str            # members/<name> or "(hub)"
    license_file: str      # nearest ancestor LICENSE path, or "" when none
    license_head: str      # first line of that license
    kind: str              # note | code | data | other
    url: str


def run(cmd: list[str], cwd: str | None = None) -> str:
    return subprocess.run(cmd, cwd=cwd, check=True, capture_output=True, text=True).stdout


def ensure_clone() -> str:
    if not os.path.isdir(os.path.join(CLONE_DIR, ".git")):
        os.makedirs(os.path.dirname(CLONE_DIR), exist_ok=True)
        run(["git", "clone", "--quiet", UPSTREAM, CLONE_DIR])
    run(["git", "checkout", "--quiet", PINNED_SHA], cwd=CLONE_DIR)
    head = run(["git", "rev-parse", "HEAD"], cwd=CLONE_DIR).strip()
    if head != PINNED_SHA:
        raise RuntimeError(f"clone HEAD {head} != pinned {PINNED_SHA}")
    return CLONE_DIR


def kind_of(path: str) -> str:
    ext = os.path.splitext(path)[1].lower()
    if ext in NOTE_EXT:
        return "note"
    if ext in CODE_EXT:
        return "code"
    if ext in {".csv", ".jsonl", ".parquet", ".zip"}:
        return "data"
    return "other"


def member_of(path: str) -> str:
    parts = path.split("/")
    return "/".join(parts[:2]) if parts[0] == "members" and len(parts) > 1 else "(hub)"


def nearest_license(path: str, licenses: dict[str, str]) -> tuple[str, str]:
    d = os.path.dirname(path)
    while True:
        cand = (d + "/LICENSE") if d else "LICENSE"
        if cand in licenses:
            # the root LICENSE (CC0) explicitly covers hub materials only, not member projects
            if cand == "LICENSE" and path.startswith("members/"):
                return "", "no project LICENSE (root CC0 covers hub materials only)"
            return cand, licenses[cand]
        if not d:
            return "", ""
        d = os.path.dirname(d)


def build() -> list[FileEntry]:
    clone = ensure_clone()
    listing = run(["git", "ls-files", "-s"], cwd=clone).splitlines()   # "<mode> <sha> <stage>\t<path>"
    files = []
    for line in listing:
        meta, path = line.split("\t", 1)
        files.append((path, meta.split()[1]))
    licenses = {}
    for path, _ in files:
        if os.path.basename(path) == "LICENSE":
            with open(os.path.join(clone, path), "rb") as fh:
                head = fh.read(200)
            licenses[path] = "" if head.startswith(GITCRYPT_MAGIC) else head.decode("utf-8", "replace").splitlines()[0].strip()
    out = []
    for path, sha in files:
        full = os.path.join(clone, path)
        size = os.path.getsize(full) if os.path.exists(full) else -1
        with open(full, "rb") as fh:
            status = "encrypted" if fh.read(len(GITCRYPT_MAGIC)) == GITCRYPT_MAGIC else "readable"
        lic, lic_head = nearest_license(path, licenses)
        out.append(FileEntry(path, sha, size, status, member_of(path), lic, lic_head, kind_of(path),
                             f"https://github.com/chriskrajewski/Skylit.API.Community.Collab/blob/{PINNED_SHA}/{path}"))
    return out


def main() -> int:
    entries = build()
    os.makedirs(REPORTS, exist_ok=True)
    summary = {
        "upstream": UPSTREAM, "pinned_sha": PINNED_SHA, "files": len(entries),
        "encrypted": sum(e.status == "encrypted" for e in entries),
        "by_member": {}, "by_kind": {},
    }
    for e in entries:
        m = summary["by_member"].setdefault(e.member, {"files": 0, "encrypted": 0, "notes": 0, "code": 0, "licenses": {}})
        m["files"] += 1; m["encrypted"] += e.status == "encrypted"; m["notes"] += e.kind == "note"; m["code"] += e.kind == "code"
        key = f"{e.license_file or '(none)'}: {e.license_head or 'no license'}"
        m["licenses"][key] = m["licenses"].get(key, 0) + 1
        summary["by_kind"][e.kind] = summary["by_kind"].get(e.kind, 0) + 1
    with open(os.path.join(REPORTS, "manifest.json"), "w") as fh:
        json.dump({"summary": summary, "files": [asdict(e) for e in entries]}, fh, indent=1)
    with open(os.path.join(REPORTS, "manifest.csv"), "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(asdict(entries[0]).keys())); w.writeheader(); w.writerows(asdict(e) for e in entries)
    json.dump(summary, sys.stdout, indent=1); print()
    return 0


if __name__ == "__main__":
    from .runlog import Run
    with Run("census", params={"pinned_sha": PINNED_SHA}) as run:
        rc = main()
        run.output(os.path.join(REPORTS, "manifest.json")); run.output(os.path.join(REPORTS, "manifest.csv"))
    raise SystemExit(rc)
