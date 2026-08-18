from __future__ import annotations

import pytest

from ai_platform_engineering.authz.core.context import (
    ContextError,
    narrow_advisory_context,
    parse_bounded_json,
    project_arguments,
)


def test_duplicate_json_keys_are_rejected_without_echoing_key() -> None:
    with pytest.raises(ContextError) as exc_info:
        parse_bounded_json(b'{"secret-marker":1,"secret-marker":2}', max_bytes=100)
    assert "secret-marker" not in str(exc_info.value)


def test_argument_projection_uses_typed_json_pointers() -> None:
    projected = project_arguments(
        {
            "project": "PRIMARY",
            "metadata": {"path/name": "example", "enabled": True},
            "priority": 2,
            "ignored": ["value"],
        }
    )
    assert projected.strings == {
        "/metadata/path~1name": "example",
        "/project": "PRIMARY",
    }
    assert projected.integers == {"/priority": 2}
    assert projected.booleans == {"/metadata/enabled": True}


def test_advisory_context_cannot_select_trusted_controls() -> None:
    assert narrow_advisory_context(
        {"provider": "cedar", "mode": "AUTHZ", "risk": "high", "trusted_role": "admin"}
    ) == {"risk": "high"}
