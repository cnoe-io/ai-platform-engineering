from __future__ import annotations

import json

import pytest

from ai_platform_engineering.integrations.webex_bot.utils.webex_bot_catalog import (
    configured_webex_bot,
    configured_webex_bots,
)


def _env(bots: list[dict[str, object]]) -> dict[str, str]:
    return {"WEBEX_INTEGRATION_BOTS_JSON": json.dumps(bots)}


def _bot(bot_id: str, token_env: str) -> dict[str, object]:
    return {
        "id": bot_id,
        "name": bot_id.title(),
        "tokenEnv": token_env,
        "spaces": {"accessMode": "allowlist"},
        "directMessages": {"accessMode": "allowlist"},
    }


def test_catalog_requires_explicit_entries() -> None:
    assert configured_webex_bots({}) == []


def test_catalog_preserves_explicit_bot_identity() -> None:
    bots = configured_webex_bots(
        _env(
            [
                _bot("primary", "PRIMARY_TOKEN"),
                _bot("secondary", "SECONDARY_TOKEN"),
            ]
        )
    )

    assert [(bot.id, bot.name, bot.token_env) for bot in bots] == [
        ("primary", "Primary", "PRIMARY_TOKEN"),
        ("secondary", "Secondary", "SECONDARY_TOKEN"),
    ]


def test_catalog_parses_independent_per_bot_policies_and_defaults() -> None:
    automatic = {
        **_bot("automatic", "AUTOMATIC_TOKEN"),
        "spaces": {
            "accessMode": "all_spaces",
            "defaultTeamSlug": "platform",
            "defaultAgentId": "agent-space",
        },
        "directMessages": {
            "accessMode": "all_users",
            "defaultAgentId": "agent-dm",
        },
    }
    bot = configured_webex_bot("automatic", _env([automatic]))

    assert bot is not None
    assert bot.spaces_access_mode == "all_spaces"
    assert bot.direct_messages_access_mode == "all_users"
    assert bot.spaces.default_team_slug == "platform"
    assert bot.spaces.default_agent_id == "agent-space"
    assert bot.direct_messages.default_agent_id == "agent-dm"


def test_automatic_mode_requires_complete_defaults() -> None:
    candidate = {
        **_bot("automatic", "AUTOMATIC_TOKEN"),
        "spaces": {"accessMode": "all_spaces"},
    }

    with pytest.raises(ValueError, match="spaces.defaultTeamSlug and spaces.defaultAgentId"):
        configured_webex_bots(_env([candidate]))


def test_all_users_requires_only_a_dm_default_agent() -> None:
    candidate = {
        **_bot("automatic", "AUTOMATIC_TOKEN"),
        "directMessages": {
            "accessMode": "all_users",
            "defaultAgentId": "agent-dm",
        },
    }

    bot = configured_webex_bots(_env([candidate]))[0]

    assert bot.spaces.default_team_slug is None
    assert bot.direct_messages.default_agent_id == "agent-dm"


def test_allowlist_modes_do_not_require_defaults() -> None:
    bot = configured_webex_bots(_env([_bot("restricted", "RESTRICTED_TOKEN")]))[0]

    assert bot.spaces.default_team_slug is None
    assert bot.spaces.default_agent_id is None
    assert bot.direct_messages.default_agent_id is None


def test_public_catalog_does_not_expose_token_environment_name() -> None:
    env = _env([_bot("primary", "PRIMARY_TOKEN")]) | {"PRIMARY_TOKEN": "secret"}
    bot = configured_webex_bots(env)[0]

    public = bot.public_dict(env)

    assert public["available"] is True
    assert "token" not in json.dumps(public).lower()
