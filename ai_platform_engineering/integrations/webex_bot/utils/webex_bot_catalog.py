"""Parse the deployment-managed Webex bot catalog."""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from typing import Literal, Mapping

_BOT_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
_TOKEN_ENV_RE = re.compile(r"^[A-Z_][A-Z0-9_]*$")
_RESOURCE_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$")

WebexSpaceAccessMode = Literal["disabled", "allowlist", "all_spaces"]
WebexDmAccessMode = Literal["disabled", "allowlist", "all_users"]


@dataclass(frozen=True)
class WebexSpacePolicy:
    access_mode: WebexSpaceAccessMode
    default_team_slug: str | None
    default_agent_id: str | None


@dataclass(frozen=True)
class WebexDirectMessagePolicy:
    access_mode: WebexDmAccessMode
    default_agent_id: str | None


@dataclass(frozen=True)
class WebexBotConfig:
    id: str
    name: str
    token_env: str
    spaces: WebexSpacePolicy
    direct_messages: WebexDirectMessagePolicy

    @property
    def spaces_access_mode(self) -> WebexSpaceAccessMode:
        return self.spaces.access_mode

    @property
    def direct_messages_access_mode(self) -> WebexDmAccessMode:
        return self.direct_messages.access_mode

    def public_dict(self, env: Mapping[str, str] | None = None) -> dict[str, object]:
        """Return policy metadata safe to expose through the admin API."""

        source = os.environ if env is None else env
        return {
            "id": self.id,
            "name": self.name,
            "available": bool(source.get(self.token_env, "").strip()),
            "spaces": {
                "accessMode": self.spaces.access_mode,
                "defaultTeamSlug": self.spaces.default_team_slug,
                "defaultAgentId": self.spaces.default_agent_id,
            },
            "directMessages": {
                "accessMode": self.direct_messages.access_mode,
                "defaultAgentId": self.direct_messages.default_agent_id,
            },
        }


def _required_mapping(
    candidate: Mapping[str, object], field: str, index: int
) -> Mapping[str, object]:
    value = candidate.get(field)
    if not isinstance(value, dict):
        raise ValueError(
            f"WEBEX_INTEGRATION_BOTS_JSON[{index}].{field} must be an object"
        )
    return value


def _optional_resource_id(
    candidate: Mapping[str, object], field: str, path: str
) -> str | None:
    raw = candidate.get(field)
    if raw is None:
        return None
    value = str(raw).strip()
    if not value or not _RESOURCE_ID_RE.fullmatch(value):
        raise ValueError(f"{path}.{field} is invalid")
    return value


def _access_mode(
    candidate: Mapping[str, object],
    *,
    field: str,
    allowed: set[str],
    index: int,
) -> str:
    value = str(candidate.get("accessMode") or "").strip()
    if value not in allowed:
        choices = ", ".join(sorted(allowed))
        raise ValueError(
            f"WEBEX_INTEGRATION_BOTS_JSON[{index}].{field}.accessMode "
            f"must be one of: {choices}"
        )
    return value


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

        spaces_candidate = _required_mapping(candidate, "spaces", index)
        spaces_access_mode = _access_mode(
            spaces_candidate,
            field="spaces",
            allowed={"disabled", "allowlist", "all_spaces"},
            index=index,
        )
        spaces_path = f"WEBEX_INTEGRATION_BOTS_JSON[{index}].spaces"
        spaces = WebexSpacePolicy(
            access_mode=spaces_access_mode,  # type: ignore[arg-type]
            default_team_slug=_optional_resource_id(
                spaces_candidate, "defaultTeamSlug", spaces_path
            ),
            default_agent_id=_optional_resource_id(
                spaces_candidate, "defaultAgentId", spaces_path
            ),
        )
        direct_messages_candidate = _required_mapping(
            candidate, "directMessages", index
        )
        direct_messages_access_mode = _access_mode(
            direct_messages_candidate,
            field="directMessages",
            allowed={"disabled", "allowlist", "all_users"},
            index=index,
        )
        direct_messages_path = (
            f"WEBEX_INTEGRATION_BOTS_JSON[{index}].directMessages"
        )
        direct_messages = WebexDirectMessagePolicy(
            access_mode=direct_messages_access_mode,  # type: ignore[arg-type]
            default_agent_id=_optional_resource_id(
                direct_messages_candidate,
                "defaultAgentId",
                direct_messages_path,
            ),
        )
        if spaces_access_mode == "all_spaces" and (
            not spaces.default_team_slug or not spaces.default_agent_id
        ):
            raise ValueError(
                f"WEBEX_INTEGRATION_BOTS_JSON[{index}].spaces.defaultTeamSlug and "
                "spaces.defaultAgentId are required for all_spaces"
            )
        if (
            direct_messages_access_mode == "all_users"
            and not direct_messages.default_agent_id
        ):
            raise ValueError(
                f"WEBEX_INTEGRATION_BOTS_JSON[{index}].directMessages."
                "defaultAgentId is required for all_users"
            )
        seen_ids.add(bot_id)
        bots.append(
            WebexBotConfig(
                id=bot_id,
                name=name,
                token_env=token_env,
                spaces=spaces,
                direct_messages=direct_messages,
            )
        )
    return bots


def configured_webex_bot(
    bot_id: str, env: Mapping[str, str] | None = None
) -> WebexBotConfig | None:
    normalized = bot_id.strip()
    return next(
        (bot for bot in configured_webex_bots(env) if bot.id == normalized),
        None,
    )
