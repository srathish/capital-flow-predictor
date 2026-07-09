"""Safety guard for the research runner. Enforced IN CODE, not by convention.

Guarantees (any violation raises before I/O happens):
  - all writes land under research/ (never src/, scripts/, config, env)
  - the process makes no git/deploy/restart/network side effects: this module
    refuses to import or shell out to them, and run.py imports nothing that does
  - data is opened read-only

This is the physical backstop behind the runner's "research-only" contract.
"""
import os

# research/ root = parent of this file's directory (research/runner/ -> research/)
RESEARCH_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
GEX_ROOT = os.path.abspath(os.path.join(RESEARCH_ROOT, '..'))

# Paths the runner must NEVER write to (live system surface).
FORBIDDEN_WRITE_ROOTS = [
    os.path.join(GEX_ROOT, 'src'),
    os.path.join(GEX_ROOT, 'scripts'),
    os.path.join(GEX_ROOT, 'scanner'),
    os.path.join(GEX_ROOT, 'package.json'),
    os.path.join(GEX_ROOT, 'node_modules'),
]


class SafetyViolation(RuntimeError):
    pass


def assert_under_research(path):
    """Raise unless `path` resolves to somewhere under research/."""
    resolved = os.path.abspath(path)
    if os.path.commonpath([resolved, RESEARCH_ROOT]) != RESEARCH_ROOT:
        raise SafetyViolation(
            f"REFUSED write outside research/: {resolved}\n"
            f"The research runner may only write under {RESEARCH_ROOT}")
    for forbidden in FORBIDDEN_WRITE_ROOTS:
        if os.path.commonpath([resolved, forbidden]) == forbidden:
            raise SafetyViolation(f"REFUSED write to live-system path: {resolved}")
    return resolved


def safe_write(relpath, content, append=False):
    """Write only under research/. `relpath` is relative to research/."""
    target = assert_under_research(os.path.join(RESEARCH_ROOT, relpath))
    os.makedirs(os.path.dirname(target), exist_ok=True)
    with open(target, 'a' if append else 'w') as f:
        f.write(content)
    return target


def read_only_open(path):
    """Open a data file in read-only mode (mode 'rb'/'r' only)."""
    return open(os.path.abspath(path), 'r')


SAFETY_BANNER = """\
╔══════════════════════════════════════════════════════════════════════╗
║  RESEARCH RUNNER — research-only, safe by design                     ║
║  • writes ONLY under research/   • no git / deploy / restart          ║
║  • no live-code / strategy / feature-flag changes                    ║
║  • no auto-commit   • recommendations require explicit user approval  ║
╚══════════════════════════════════════════════════════════════════════╝"""
