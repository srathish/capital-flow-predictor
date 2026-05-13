"""Dump the FastAPI OpenAPI schema to docs/openapi.json + a thin Markdown wrapper.

Run:  uv run python scripts/export_openapi.py

Why: the FE and external integrators want a stable schema reference without
spinning up the app. Run after every route change; CI can diff the file.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


def _project_root() -> Path:
    here = Path(__file__).resolve()
    return here.parent.parent


def main() -> int:
    root = _project_root()
    sys.path.insert(0, str(root / "apps" / "api" / "src"))
    from cfp_api.main import app

    schema = app.openapi()
    out = root / "docs" / "openapi.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(schema, indent=2, sort_keys=True) + "\n")

    # Companion human-readable table-of-contents.
    md = root / "docs" / "API.md"
    lines = [
        "# Bellwether API\n",
        "Auto-generated from FastAPI OpenAPI. Regenerate via `python scripts/export_openapi.py`.\n",
        "",
        "## Authentication\n",
        "All `/v1/*` endpoints require an API key when `API_KEYS` env is set. Send via either:",
        "",
        "    Authorization: Bearer <key>",
        "    X-API-Key: <key>",
        "",
        "When `API_KEYS` is empty, auth is disabled (local dev only).",
        "",
        "## Rate limits\n",
        "Per identity (api key or IP):",
        "- Default: `RATE_LIMIT_DEFAULT_PER_MIN` (default 120) per minute",
        "- Expensive runs (`/v1/agents/*/run`, `/v1/agents/*/chat`): `RATE_LIMIT_RUN_PER_HOUR` (default 30) per hour",
        "",
        "Rejections return `429 Too Many Requests` with a `Retry-After` header.",
        "",
        "## Endpoints\n",
    ]
    for path, methods in sorted(schema.get("paths", {}).items()):
        lines.append(f"### `{path}`")
        for method, spec in methods.items():
            if method.lower() not in {"get", "post", "put", "delete", "patch"}:
                continue
            summary = spec.get("summary") or spec.get("description", "").splitlines()[0] if spec.get("description") else ""
            lines.append(f"- **{method.upper()}** — {summary}")
        lines.append("")
    md.write_text("\n".join(lines))
    print(f"wrote {out.relative_to(root)} and {md.relative_to(root)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
