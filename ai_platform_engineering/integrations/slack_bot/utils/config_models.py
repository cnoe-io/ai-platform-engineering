# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""
Pydantic models for CAIPE Slack Bot configuration.
"""

import os

from loguru import logger
from pydantic import BaseModel, Field, model_validator
from typing import Dict, Any, Optional, List


class GlobalDefaults(BaseModel):
  """Global defaults that apply to all channels"""

  time_frame: int = 19800
  max_messages: int = 3
  default_agent_id: Optional[str] = None
  dm_agent_id: Optional[str] = None

  jira_server: str = Field(default_factory=lambda: os.environ.get("JIRA_BASE_URL", ""))

  # AI alerts prompt — stays here because it's a per-message template
  # with per-event variables (bot_username, alert_text, etc.), not a system prompt
  default_ai_alerts_prompt: str = Field(
    default_factory=lambda: os.environ.get(
      "SLACK_INTEGRATION_PROMPT_AI_ALERTS",
      """You are an automated incident management and feedback tracking system that creates Jira tickets for alerts and user feedback.

Your task: Analyze this alert/feedback and determine the appropriate action (create ticket, resolve ticket, or no action).

JIRA CONFIGURATION (use these exact fields when creating the ticket):
Project: {jira_project}
{jira_config_str}

CREATE A TICKET IF:
- System failure, error, or degradation
- Pipeline/build failure needing investigation
- Security alert or compliance issue
- Production incident or outage
- Requires human action or investigation
- Alert color is red (ff0000, danger), yellow (ff9900, warning), or similar error colors
- **USER FEEDBACK with issues or improvement requests**
- Feedback that mentions problems, errors, confusion, or missing content
- When in doubt about severity, CREATE THE TICKET

DO NOT CREATE A TICKET IF:
- Informational notification (oncall changes, deployments, status updates)
- Routine automated message
- Test/development environment alert (unless critical)
- **Positive feedback only** (thumbs up, high ratings like 5/5 with no issues mentioned)

ALERT DETAILS:
Bot: {bot_username}
Channel ID: {channel_id}
Text: {alert_text}
Timestamp: {timestamp}
Blocks: {alert_blocks}
Attachments: {alert_attachments}

INSTRUCTIONS:
1. **Analysis**: Explain your reasoning - why does/doesn't this alert warrant a ticket?
2. **Duplicate Check**: Search for existing tickets with the same core pattern
3. **Action**: State what you did (created ticket X, updated ticket Y, or no action needed)""",
    )
  )


class VictorOpsEscalation(BaseModel):
  """VictorOps on-call escalation configuration"""

  enabled: bool = False
  team: str = ""


class EmojiEscalation(BaseModel):
  """Emoji reaction escalation configuration"""

  enabled: bool = False
  name: str = "eyes"


class EscalationConfig(BaseModel):
  """Escalation workflows triggered by the 'Get help' button"""

  victorops: VictorOpsEscalation = Field(default_factory=VictorOpsEscalation)
  users: List[str] = Field(default_factory=list)
  emoji: EmojiEscalation = Field(default_factory=EmojiEscalation)
  delete_admins: List[str] = Field(default_factory=list)


def get_escalation_config(channel_config: "ChannelConfig") -> Optional["EscalationConfig"]:
  """Extract escalation config from a ChannelConfig.

  Returns None if no escalation config exists OR if no escalation actions are enabled.
  """
  if not channel_config.other or not channel_config.other.escalation:
    return None
  esc = EscalationConfig(
    **channel_config.other.escalation,
    delete_admins=channel_config.other.delete_admins,
  )
  # Only return config if at least one escalation action is enabled
  has_escalation = esc.victorops.enabled or esc.users or esc.emoji.enabled
  return esc if has_escalation else None


class IncludeBotsConfig(BaseModel):
  """Configuration for including bot messages"""

  enabled: bool = False
  bot_list: Optional[List[str]] = None


class QandaConfig(BaseModel):
  """Q&A mode configuration"""

  enabled: bool = False
  overthink: bool = False
  include_bots: IncludeBotsConfig = Field(default_factory=IncludeBotsConfig)


class AIAlertsConfig(BaseModel):
  """AI alerts configuration"""

  enabled: bool = False
  custom_prompt: Optional[str] = None


class JiraConfig(BaseModel):
  """Jira ticket creation configuration"""

  project_key: str
  issue_type: str = "Bug"
  additional_fields: Dict[str, Any] = Field(default_factory=dict)


class OtherConfig(BaseModel):
  """Other channel configuration (Jira, escalation, delete_admins)"""

  jira: Optional[JiraConfig] = None
  escalation: Optional[Dict[str, Any]] = None
  delete_admins: List[str] = Field(default_factory=list)


class ChannelConfig(BaseModel):
  """Configuration for a single Slack channel"""

  name: str
  ai_enabled: bool = False
  agent_id: Optional[str] = None
  qanda: QandaConfig = Field(default_factory=QandaConfig)
  ai_alerts: AIAlertsConfig = Field(default_factory=AIAlertsConfig)
  other: OtherConfig = Field(default_factory=OtherConfig)

  @model_validator(mode="after")
  def validate_bot_config(self):
    """Ensure ai_alerts and qanda.include_bots are not both enabled"""
    if self.ai_alerts.enabled and (self.qanda.enabled and self.qanda.include_bots.enabled):
      raise ValueError("Cannot enable both ai_alerts and qanda.include_bots for the same channel. ai_alerts processes bot messages (alerts) to take action, while qanda.include_bots also processes bot messages for Q&A style responses. Choose one based on your use case.")
    return self

  @model_validator(mode="after")
  def warn_missing_agent_id(self):
    """Log warning when ai_enabled but no agent_id configured."""
    if self.ai_enabled and not self.agent_id:
      logger.warning(f"Channel '{self.name}' has ai_enabled=True but no agent_id set. Will fall back to defaults.default_agent_id.")
    return self


class Config(BaseModel):
  """Top-level configuration"""

  defaults: GlobalDefaults = Field(default_factory=GlobalDefaults)
  channels: Dict[str, ChannelConfig]
  silence_env: bool = False

  @classmethod
  def from_env(cls) -> "Config":
    """Load config from CAIPE_BOT_CONFIG environment variable (YAML format or file path)"""
    import yaml

    config_str = os.environ.get("SLACK_INTEGRATION_BOT_CONFIG", os.environ.get("CAIPE_BOT_CONFIG"))
    if not config_str:
      raise ValueError("SLACK_INTEGRATION_BOT_CONFIG (or CAIPE_BOT_CONFIG) environment variable not set")
    if os.path.isfile(config_str):
      with open(config_str) as f:
        raw_config = yaml.safe_load(f)
    else:
      raw_config = yaml.safe_load(config_str)

    # Parse channels
    channels = {}
    for channel_id, channel_data in raw_config.items():
      channels[channel_id] = ChannelConfig(**channel_data)

    silence_env = os.environ.get("SLACK_INTEGRATION_SILENCE_ENV", "false").lower() == "true"

    defaults = GlobalDefaults(
      default_agent_id=os.environ.get("SLACK_INTEGRATION_DEFAULT_AGENT_ID"),
      dm_agent_id=os.environ.get("SLACK_INTEGRATION_DM_AGENT_ID"),
    )

    return cls(channels=channels, defaults=defaults, silence_env=silence_env)
