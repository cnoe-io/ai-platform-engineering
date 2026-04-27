# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""
Pydantic models for CAIPE Slack Bot configuration.
"""

import os

from loguru import logger
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class GlobalDefaults(BaseModel):
  time_frame: int = 19800
  max_messages: int = 3
  default_agent_id: str | None = None
  dm_agent_id: str | None = None
  victorops_agent_id: str | None = None


class VictorOpsEscalation(BaseModel):
  enabled: bool = False
  team: str = ""


class EmojiEscalation(BaseModel):
  enabled: bool = False
  name: str = "eyes"


class EscalationConfig(BaseModel):
  victorops: VictorOpsEscalation = Field(default_factory=VictorOpsEscalation)
  users: list[str] = Field(default_factory=list)
  emoji: EmojiEscalation = Field(default_factory=EmojiEscalation)
  delete_admins: list[str] = Field(default_factory=list)


class OverthinkConfig(BaseModel):
  enabled: bool = False
  skip_markers: list[str] = Field(default_factory=lambda: ["DEFER", "LOW_CONFIDENCE"])
  custom_prompt: str | None = None
  followup_prompt: str | None = None


class BotsConfig(BaseModel):
  enabled: bool = True
  listen: Literal["message", "mention", "all"] | None = None
  overthink: OverthinkConfig = Field(default_factory=OverthinkConfig)
  bot_list: list[str] | None = None

  @model_validator(mode="after")
  def _require_listen_when_enabled(self):
    if self.enabled and self.listen is None:
      raise ValueError("'listen' is required when enabled is true")
    return self


class UsersConfig(BaseModel):
  enabled: bool = True
  listen: Literal["message", "mention", "all"] | None = None
  overthink: OverthinkConfig = Field(default_factory=OverthinkConfig)
  user_list: list[str] | None = None

  @model_validator(mode="after")
  def _require_listen_when_enabled(self):
    if self.enabled and self.listen is None:
      raise ValueError("'listen' is required when enabled is true")
    return self


class AgentBinding(BaseModel):
  agent_id: str
  bots: BotsConfig | None = None
  users: UsersConfig | None = None
  escalation: EscalationConfig | None = None


class ChannelConfig(BaseModel):
  name: str
  agents: list[AgentBinding] = Field(default_factory=list)


def get_escalation_config(agent_match: AgentBinding) -> EscalationConfig | None:
  if not agent_match.escalation:
    return None
  esc = agent_match.escalation
  has_escalation = esc.victorops.enabled or esc.users or esc.emoji.enabled
  return esc if has_escalation else None


_OLD_FORMAT_KEYS = {"qanda", "ai_alerts", "ai_enabled"}


class Config(BaseModel):
  defaults: GlobalDefaults = Field(default_factory=GlobalDefaults)
  channels: dict[str, ChannelConfig]
  silence_env: bool = False

  @classmethod
  def from_env(cls) -> "Config":
    """Load channel config from a YAML file or inline YAML env var.

    Resolution order:
    1. ``SLACK_INTEGRATION_BOT_CONFIG`` env var — if set, treated as a file
       path (when the path exists) or inline YAML string (backward compat).
    2. Well-known file path ``/etc/caipe/bot-config.yaml`` — used in
       Kubernetes when the Helm ``botConfig`` value is non-empty.
    3. If nothing is found, starts with an empty channel map (the bot runs
       but ignores all channels until config is provided).
    """
    import yaml

    _DEFAULT_BOT_CONFIG_PATH = "/etc/caipe/bot-config.yaml"

    config_source = os.environ.get("SLACK_INTEGRATION_BOT_CONFIG")
    if config_source:
      # Env var set — could be a file path or inline YAML
      if os.path.isfile(config_source):
        logger.info("Loading bot config from file: {}", config_source)
        with open(config_source) as f:
          raw_config = yaml.safe_load(f) or {}
      else:
        logger.info("Loading bot config from inline YAML (SLACK_INTEGRATION_BOT_CONFIG)")
        raw_config = yaml.safe_load(config_source) or {}
    elif os.path.isfile(_DEFAULT_BOT_CONFIG_PATH):
      # Well-known Kubernetes mount path
      logger.info("Loading bot config from {}", _DEFAULT_BOT_CONFIG_PATH)
      with open(_DEFAULT_BOT_CONFIG_PATH) as f:
        raw_config = yaml.safe_load(f) or {}
    else:
      # No config — start empty
      logger.info("No bot config found — starting with no channel configuration")
      raw_config = {}

    # Parse channels — with old-format detection
    channels: dict[str, ChannelConfig] = {}
    for channel_id, channel_data in raw_config.items():
      if isinstance(channel_data, dict):
        old_keys = _OLD_FORMAT_KEYS & channel_data.keys()
        if old_keys:
          raise ValueError(
            f"Channel '{channel_id}' uses pre-0.4.0 config keys {old_keys}. "
            "Migrate to the flat agents list format: "
            "https://github.com/cnoe-io/ai-platform-engineering/blob/main/docs/slack-config-migration.md"
          )
      channels[channel_id] = ChannelConfig(**channel_data)

    silence_env = os.environ.get("SLACK_INTEGRATION_SILENCE_ENV", "false").lower() == "true"

    defaults = GlobalDefaults(
      default_agent_id=os.environ.get("SLACK_INTEGRATION_DEFAULT_AGENT_ID"),
      dm_agent_id=os.environ.get("SLACK_INTEGRATION_DM_AGENT_ID"),
      victorops_agent_id=os.environ.get("SLACK_INTEGRATION_VICTOROPS_AGENT_ID"),
    )

    return cls(channels=channels, defaults=defaults, silence_env=silence_env)
