"""One-time seed of skylit_credentials from a local .env file.

After the gexester → monorepo migration, gex reads cookies from Postgres
(table: skylit_credentials, row id=1). Running `cfp-jobs skylit-bootstrap`
once after the migration is what turns "I had working cookies in
~/gexester vexster/.env" into "the Railway-hosted gex service has them."

After this, regular re-auths use `cfp-jobs skylit-watch` + the /gex UI
button — bootstrap is only for the migration day.

The actual upload goes through the existing /v1/skylit/credentials endpoint
(not a direct Postgres connection) so the operator never has to know the
production DB connection string.
"""

from __future__ import annotations

import logging
import re
from pathlib import Path

import httpx

log = logging.getLogger(__name__)


def _parse_env_file(path: Path) -> dict[str, str]:
    """Read a .env file and return its keys as a dict. Handles the format
    `KEY=value` with optional surrounding quotes. Comments and blanks ignored.

    Deliberately simple — we don't need python-dotenv's full grammar here;
    we only care about three keys (CLERK_*).
    """
    if not path.exists():
        raise FileNotFoundError(f"{path} does not exist")
    out: dict[str, str] = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        m = re.match(r"^([A-Z_][A-Z0-9_]*)=(.*)$", line)
        if not m:
            continue
        key, val = m.group(1), m.group(2)
        # Strip a single layer of surrounding quotes.
        if len(val) >= 2 and val[0] == val[-1] and val[0] in ("'", '"'):
            val = val[1:-1]
        out[key] = val
    return out


def bootstrap_from_env(
    *,
    env_file: Path,
    api_url: str,
    api_key: str,
) -> dict:
    """Read CLERK_* from env_file, POST to /v1/skylit/credentials. Returns
    the server response dict. Raises on any error so the caller (CLI command)
    can surface it with a non-zero exit code."""
    env = _parse_env_file(env_file)
    cookie = env.get("CLERK_CLIENT_COOKIE")
    sid = env.get("CLERK_SESSION_ID")
    uat = env.get("CLERK_CLIENT_UAT", "")
    if not cookie:
        raise RuntimeError(f"CLERK_CLIENT_COOKIE not found in {env_file}")
    if not sid:
        raise RuntimeError(f"CLERK_SESSION_ID not found in {env_file}")

    payload = {
        "client_cookie": cookie,
        "client_uat": uat,
        "session_id": sid,
        "source": "bootstrap",
    }
    log.info(
        "skylit-bootstrap: POST %s/v1/skylit/credentials (session %s..., cookie len %d)",
        api_url.rstrip("/"), sid[:24], len(cookie),
    )
    resp = httpx.post(
        f"{api_url.rstrip('/')}/v1/skylit/credentials",
        json=payload,
        headers={"X-API-Key": api_key},
        timeout=15.0,
    )
    resp.raise_for_status()
    return resp.json()
