"""Unit tests for skylit_login.write_to_env_file.

The headed-browser capture is interactive and not unit-tested. The .env
rewriter, however, is the part that runs unattended and must be safe.
"""

from __future__ import annotations

from pathlib import Path

from cfp_jobs.skylit_login import write_to_env_file


def test_write_creates_file_when_missing(tmp_path: Path) -> None:
    target = tmp_path / "subdir" / ".env"
    write_to_env_file(
        target,
        {"client_cookie": "ABC", "client_uat": "123", "session_id": "sess_xyz"},
    )
    assert target.exists()
    body = target.read_text()
    assert "CLERK_SESSION_ID=sess_xyz" in body
    assert "CLERK_CLIENT_COOKIE=ABC" in body
    assert "CLERK_CLIENT_UAT=123" in body


def test_write_replaces_only_clerk_keys(tmp_path: Path) -> None:
    target = tmp_path / ".env"
    target.write_text(
        "DISCORD_BRIEF_WEBHOOK_URL=https://hooks/foo\n"
        "CLERK_SESSION_ID=oldsess\n"
        "CLERK_CLIENT_COOKIE=oldcookie\n"
        "CLERK_CLIENT_UAT=olduat\n"
        "TICKERS=SPXW,SPY,QQQ\n"
        "# trailing comment\n"
    )
    write_to_env_file(
        target,
        {"client_cookie": "NEW_CK", "client_uat": "NEW_UAT", "session_id": "sess_new"},
    )
    body = target.read_text()
    assert "DISCORD_BRIEF_WEBHOOK_URL=https://hooks/foo" in body
    assert "TICKERS=SPXW,SPY,QQQ" in body
    assert "# trailing comment" in body
    assert "CLERK_SESSION_ID=sess_new" in body
    assert "CLERK_CLIENT_COOKIE=NEW_CK" in body
    assert "CLERK_CLIENT_UAT=NEW_UAT" in body
    # Old values must be gone
    assert "oldsess" not in body
    assert "oldcookie" not in body
    assert "olduat" not in body


def test_write_appends_when_keys_absent(tmp_path: Path) -> None:
    target = tmp_path / ".env"
    target.write_text("FOO=bar\n")
    write_to_env_file(
        target,
        {"client_cookie": "C", "client_uat": "U", "session_id": "S"},
    )
    body = target.read_text()
    assert "FOO=bar" in body
    assert "CLERK_SESSION_ID=S" in body
    assert "CLERK_CLIENT_COOKIE=C" in body
    assert "CLERK_CLIENT_UAT=U" in body


def test_write_preserves_unrelated_clerk_lookalikes(tmp_path: Path) -> None:
    """A key like CLERK_CUSTOM=... must not be touched."""
    target = tmp_path / ".env"
    target.write_text("CLERK_CUSTOM=keepme\nCLERK_SESSION_ID=old\n")
    write_to_env_file(
        target,
        {"client_cookie": "C", "client_uat": "U", "session_id": "NEW"},
    )
    body = target.read_text()
    assert "CLERK_CUSTOM=keepme" in body
    assert "CLERK_SESSION_ID=NEW" in body
