"""History census: every path that ever existed on any branch of the pinned clone, beyond the pinned HEAD tree.

The HEAD manifest (census.py) misses material that was deleted or lives only on other branches (e.g. alantiix's
skylit-futures-strategy-engine and its encrypted .agents/.kiro folders). This lists each historical blob with its path,
whether it is git-crypt encrypted, and whether the path is present at the pinned HEAD. Writes reports/history_manifest.json.

    python -m gammalab.census_history
"""
from __future__ import annotations

import json
import subprocess
from collections import Counter
from pathlib import Path

from .census import CLONE_DIR, GITCRYPT_MAGIC, PINNED_SHA, REPORTS, ensure_clone
from .runlog import Run


def git(*a, input=None) -> bytes:
    return subprocess.run(["git", "-C", str(CLONE_DIR), *a], input=input, capture_output=True, check=True).stdout


def main():
    ensure_clone()
    with Run("census_history", params={"pinned_sha": PINNED_SHA}) as run:
        git("fetch", "--quiet", "origin")
        branches = git("for-each-ref", "--format=%(refname:short) %(objectname)", "refs/remotes/origin").decode().split("\n")
        head_paths = set(git("ls-tree", "-r", "--name-only", PINNED_SHA).decode().splitlines())
        objs = [l.split(" ", 1) for l in git("rev-list", "--all", "--objects").decode().splitlines() if " " in l]
        blobs = {}
        batch = git("cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)",
                    input="\n".join(o for o, _ in objs).encode()).decode().splitlines()
        types = {l.split()[0]: (l.split()[1], int(l.split()[2])) for l in batch}
        for sha, path in objs:
            if types.get(sha, ("",))[0] == "blob":
                blobs.setdefault(path, set()).add(sha)
        enc_shas = set()
        for sha in {s for v in blobs.values() for s in v}:
            if types[sha][1] >= len(GITCRYPT_MAGIC):
                head = subprocess.run(["git", "-C", str(CLONE_DIR), "cat-file", "blob", sha], capture_output=True).stdout[:10]
                if head.startswith(GITCRYPT_MAGIC):
                    enc_shas.add(sha)
        rows = [{"path": p, "versions": len(s), "encrypted_versions": len(s & enc_shas), "at_pinned_head": p in head_paths}
                for p, s in sorted(blobs.items())]
        gone = [r for r in rows if not r["at_pinned_head"]]
        summary = {
            "pinned_sha": PINNED_SHA, "remote_branches": [b for b in branches if b],
            "paths_ever": len(rows), "paths_at_head": len(head_paths), "paths_not_at_head": len(gone),
            "paths_with_encrypted_versions": sum(r["encrypted_versions"] > 0 for r in rows),
            "encrypted_not_at_head_by_top_dir": Counter("/".join(r["path"].split("/")[:4]) for r in gone if r["encrypted_versions"]),
            "not_at_head_by_top_dir": Counter("/".join(r["path"].split("/")[:3]) for r in gone),
        }
        out = Path(REPORTS) / "history_manifest.json"
        out.write_text(json.dumps({"summary": summary, "paths": rows}, indent=1, default=dict))
        run.output(out)
    print(json.dumps(summary, indent=1, default=dict))


if __name__ == "__main__":
    main()
