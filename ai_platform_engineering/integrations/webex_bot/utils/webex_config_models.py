# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""Pydantic models for optional static Webex bot space routing config."""

from __future__ import annotations

from pydantic import BaseModel, Field

from ai_platform_engineering.integrations.slack_bot.utils.config_models import AgentBinding


class SpaceConfig(BaseModel):
    """Static route metadata for one Webex space (admin sync source)."""

    name: str
    agents: list[AgentBinding] = Field(default_factory=list)


class WebexBotConfig(BaseModel):
    """Deployment static Webex space routing config."""

    spaces: dict[str, SpaceConfig] = Field(default_factory=dict)
