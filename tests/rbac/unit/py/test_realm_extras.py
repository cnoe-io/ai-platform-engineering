"""Spec 102 T028 — unit tests for `realm_extras` loader.

Covers:
  - file present + valid              → returns rule dict
  - file present + malformed JSON     → returns None for any resource
  - file present + missing 'version'  → returns None
  - file missing                      → returns None for any resource
  - unknown resource                  → returns None even when file is valid
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from ai_platform_engineering.utils.auth import realm_extras


@pytest.fixture(autouse=True)
def _reset_cache(monkeypatch: pytest.MonkeyPatch) -> None:
    """Drop cached extras between scenarios + clear the env var."""
    realm_extras.reset_cache_for_tests()
    monkeypatch.delenv("RBAC_FALLBACK_CONFIG_PATH", raising=False)


def _write(path: Path, body: dict | str) -> None:
    text = body if isinstance(body, str) else json.dumps(body)
    path.write_text(text, encoding="utf-8")


def test_returns_rule_for_known_resource(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    extras = tmp_path / "realm-config-extras.json"
    _write(
        extras,
        {
            "version": 1,
            "pdp_unavailable_fallback": {
                "admin_ui": {"mode": "realm_role", "role": "admin"},
            },
        },
    )
    monkeypatch.setenv("RBAC_FALLBACK_CONFIG_PATH", str(extras))

    rule = realm_extras.get_fallback_rule("admin_ui")
    assert rule == {"mode": "realm_role", "role": "admin"}


def test_returns_none_for_unknown_resource(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    extras = tmp_path / "realm-config-extras.json"
    _write(extras, {"version": 1, "pdp_unavailable_fallback": {"admin_ui": {"mode": "deny_all"}}})
    monkeypatch.setenv("RBAC_FALLBACK_CONFIG_PATH", str(extras))

    assert realm_extras.get_fallback_rule("rag") is None


def test_returns_none_when_file_missing(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("RBAC_FALLBACK_CONFIG_PATH", str(tmp_path / "does-not-exist.json"))
    assert realm_extras.get_fallback_rule("admin_ui") is None


def test_returns_none_for_malformed_json(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    extras = tmp_path / "realm-config-extras.json"
    _write(extras, "{not valid json")
    monkeypatch.setenv("RBAC_FALLBACK_CONFIG_PATH", str(extras))

    assert realm_extras.get_fallback_rule("admin_ui") is None


def test_returns_none_when_version_missing(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    extras = tmp_path / "realm-config-extras.json"
    _write(
        extras,
        {"pdp_unavailable_fallback": {"admin_ui": {"mode": "realm_role", "role": "admin"}}},
    )
    monkeypatch.setenv("RBAC_FALLBACK_CONFIG_PATH", str(extras))

    assert realm_extras.get_fallback_rule("admin_ui") is None
