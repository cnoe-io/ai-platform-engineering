from __future__ import annotations

import json

import pytest

from ai_platform_engineering.integrations.webex_bot.utils.webex_bot_catalog import (
    configured_webex_bots,
    default_webex_bot_id,
)


def _env(bots: list[dict[str, object]]) -> dict[str, str]:
    return {"WEBEX_INTEGRATION_BOTS_JSON": json.dumps(bots)}


def test_explicit_default_is_stable_across_list_order() -> None:
    env = _env([
        {"id": "secondary", "name": "Secondary", "tokenEnv": "SECONDARY_TOKEN"},
        {"id": "primary", "name": "Primary", "tokenEnv": "PRIMARY_TOKEN", "default": True},
    ])
    assert default_webex_bot_id(env) == "primary"


def test_legacy_token_entry_and_single_bot_are_unambiguous() -> None:
    assert default_webex_bot_id(_env([
        {"id": "secondary", "name": "Secondary", "tokenEnv": "SECONDARY_TOKEN"},
        {
            "id": "primary",
            "name": "Primary",
            "tokenEnv": "WEBEX_INTEGRATION_BOT_ACCESS_TOKEN",
        },
    ])) == "primary"
    assert default_webex_bot_id(_env([
        {"id": "only", "name": "Only", "tokenEnv": "ONLY_TOKEN"},
    ])) == "only"


def test_ambiguous_multi_bot_catalog_has_no_default() -> None:
    assert default_webex_bot_id(_env([
        {"id": "primary", "name": "Primary", "tokenEnv": "PRIMARY_TOKEN"},
        {"id": "secondary", "name": "Secondary", "tokenEnv": "SECONDARY_TOKEN"},
    ])) is None


def test_default_must_be_boolean_and_unique() -> None:
    with pytest.raises(ValueError, match="default must be a boolean"):
        configured_webex_bots(_env([
            {"id": "primary", "name": "Primary", "tokenEnv": "PRIMARY_TOKEN", "default": "yes"},
        ]))
    with pytest.raises(ValueError, match="only one default bot"):
        configured_webex_bots(_env([
            {"id": "primary", "name": "Primary", "tokenEnv": "PRIMARY_TOKEN", "default": True},
            {"id": "secondary", "name": "Secondary", "tokenEnv": "SECONDARY_TOKEN", "default": True},
        ]))
