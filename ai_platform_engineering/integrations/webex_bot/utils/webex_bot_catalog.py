"""Parse the deployment-managed Webex bot catalog."""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from typing import Mapping

_BOT_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
_TOKEN_ENV_RE = re.compile(r"^[A-Z_][A-Z0-9_]*$")
LEGACY_TOKEN_ENV = "WEBEX_INTEGRATION_BOT_ACCESS_TOKEN"


@dataclass(frozen=True)
class WebexBotConfig:
    id: str
    name: str
    token_env: str
    default: bool = False


def configured_webex_bots(
    env: Mapping[str, str] | None = None,
) -> list[WebexBotConfig]:
    source = os.environ if env is None else env
    raw = source.get("WEBEX_INTEGRATION_BOTS_JSON", "").strip()
    if not raw:
        return [
            WebexBotConfig(
                "default",
                "Webex bot",
                LEGACY_TOKEN_ENV,
                True,
            )
        ]

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError("WEBEX_INTEGRATION_BOTS_JSON must be valid JSON") from exc
    if not isinstance(payload, list) or not payload:
        raise ValueError("WEBEX_INTEGRATION_BOTS_JSON must be a non-empty JSON array")

    bots: list[WebexBotConfig] = []
    seen_ids: set[str] = set()
    default_count = 0
    for index, candidate in enumerate(payload):
        if not isinstance(candidate, dict):
            raise ValueError(f"WEBEX_INTEGRATION_BOTS_JSON[{index}] must be an object")
        if "token" in candidate or "accessToken" in candidate:
            raise ValueError("Webex bot tokens must be supplied through tokenEnv")
        bot_id = str(candidate.get("id") or "").strip()
        name = str(candidate.get("name") or "").strip()
        token_env = str(candidate.get("tokenEnv") or "").strip()
        is_default = candidate.get("default", False)
        if not _BOT_ID_RE.fullmatch(bot_id):
            raise ValueError(f"WEBEX_INTEGRATION_BOTS_JSON[{index}].id is invalid")
        if not name:
            raise ValueError(f"WEBEX_INTEGRATION_BOTS_JSON[{index}].name is required")
        if not _TOKEN_ENV_RE.fullmatch(token_env):
            raise ValueError(f"WEBEX_INTEGRATION_BOTS_JSON[{index}].tokenEnv is invalid")
        if not isinstance(is_default, bool):
            raise ValueError(f"WEBEX_INTEGRATION_BOTS_JSON[{index}].default must be a boolean")
        if bot_id in seen_ids:
            raise ValueError(f"Duplicate Webex bot id: {bot_id}")
        seen_ids.add(bot_id)
        default_count += int(is_default)
        bots.append(WebexBotConfig(bot_id, name, token_env, is_default))

    if default_count > 1:
        raise ValueError("WEBEX_INTEGRATION_BOTS_JSON may contain only one default bot")
    return bots


def default_webex_bot_id(env: Mapping[str, str] | None = None) -> str | None:
    bots = configured_webex_bots(env)
    explicit = next((bot.id for bot in bots if bot.default), None)
    if explicit:
        return explicit
    legacy = [bot.id for bot in bots if bot.token_env == LEGACY_TOKEN_ENV]
    if len(legacy) == 1:
        return legacy[0]
    if len(bots) == 1:
        return bots[0].id
    return None
