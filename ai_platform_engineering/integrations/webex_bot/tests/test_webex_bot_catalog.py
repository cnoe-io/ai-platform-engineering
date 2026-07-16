from __future__ import annotations

import json

import pytest

from ai_platform_engineering.integrations.webex_bot.utils.webex_bot_catalog import (
    configured_webex_bots,
)


def _env(bots: list[dict[str, object]]) -> dict[str, str]:
    return {"WEBEX_INTEGRATION_BOTS_JSON": json.dumps(bots)}


def test_catalog_requires_explicit_entries() -> None:
    assert configured_webex_bots({}) == []


def test_catalog_preserves_explicit_bot_identity() -> None:
    bots = configured_webex_bots(
        _env(
            [
                {"id": "primary", "name": "Primary", "tokenEnv": "PRIMARY_TOKEN"},
                {"id": "secondary", "name": "Secondary", "tokenEnv": "SECONDARY_TOKEN"},
            ]
        )
    )

    assert [(bot.id, bot.name, bot.token_env) for bot in bots] == [
        ("primary", "Primary", "PRIMARY_TOKEN"),
        ("secondary", "Secondary", "SECONDARY_TOKEN"),
    ]


def test_catalog_rejects_default_bot_markers() -> None:
    with pytest.raises(ValueError, match="defaults are not supported"):
        configured_webex_bots(
            _env(
                [
                    {
                        "id": "primary",
                        "name": "Primary",
                        "tokenEnv": "PRIMARY_TOKEN",
                        "default": True,
                    }
                ]
            )
        )
