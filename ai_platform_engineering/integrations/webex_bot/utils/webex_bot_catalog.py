"""Parse the deployment-managed Webex bot catalog."""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from typing import Mapping

_BOT_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
_TOKEN_ENV_RE = re.compile(r"^[A-Z_][A-Z0-9_]*$")


@dataclass(frozen=True)
class WebexBotConfig:
    id: str
    name: str
    token_env: str


def configured_webex_bots(
    env: Mapping[str, str] | None = None,
) -> list[WebexBotConfig]:
    source = os.environ if env is None else env
    raw = source.get("WEBEX_INTEGRATION_BOTS_JSON", "").strip()
    if not raw:
        return []

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError("WEBEX_INTEGRATION_BOTS_JSON must be valid JSON") from exc
    if not isinstance(payload, list) or not payload:
        raise ValueError("WEBEX_INTEGRATION_BOTS_JSON must be a non-empty JSON array")

    bots: list[WebexBotConfig] = []
    seen_ids: set[str] = set()
    for index, candidate in enumerate(payload):
        if not isinstance(candidate, dict):
            raise ValueError(f"WEBEX_INTEGRATION_BOTS_JSON[{index}] must be an object")
        if "token" in candidate or "accessToken" in candidate:
            raise ValueError("Webex bot tokens must be supplied through tokenEnv")
        bot_id = str(candidate.get("id") or "").strip()
        name = str(candidate.get("name") or "").strip()
        token_env = str(candidate.get("tokenEnv") or "").strip()
        if not _BOT_ID_RE.fullmatch(bot_id):
            raise ValueError(f"WEBEX_INTEGRATION_BOTS_JSON[{index}].id is invalid")
        if not name:
            raise ValueError(f"WEBEX_INTEGRATION_BOTS_JSON[{index}].name is required")
        if not _TOKEN_ENV_RE.fullmatch(token_env):
            raise ValueError(f"WEBEX_INTEGRATION_BOTS_JSON[{index}].tokenEnv is invalid")
        if bot_id in seen_ids:
            raise ValueError(f"Duplicate Webex bot id: {bot_id}")
        seen_ids.add(bot_id)
        bots.append(WebexBotConfig(bot_id, name, token_env))
    return bots
