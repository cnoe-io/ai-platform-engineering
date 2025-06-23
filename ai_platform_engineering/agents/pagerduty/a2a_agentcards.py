# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
import os
from a2a.types import (
    AgentCapabilities,
    AgentCard,
    AgentSkill
)

PAGERDUTY_AGENT_HOST = os.getenv("PAGERDUTY_AGENT_HOST", "localhost")
PAGERDUTY_AGENT_PORT = os.getenv("PAGERDUTY_AGENT_PORT", "8004")

pagerduty_agent_skill = AgentSkill(
    id="pagerduty_agent_skill",
    name="PagerDuty Agent Skill",
    description="Handles tasks related to PagerDuty incidents, alerts, and on-call schedules.",
    tags=[
        "pagerduty",
        "incident management",
        "alerts",
        "on-call"],
    examples=[
      "List PagerDuty services.",
      "List Pagerduty on-call schedules.",
      "Acknowledge the PagerDuty incident with ID",
      "List all on-call schedules for a team like DevOps or SRE team.",
      "Trigger a PagerDuty alert for a given service.",
      "Resolve the PagerDuty incident with ID.",
      "Get details of the PagerDuty incident with ID."
  ])

pagerduty_agent_card = AgentCard(
    name='PagerDuty',
    id='pagerduty-tools-agent',
    description='An AI agent that interacts with PagerDuty to manage incidents, alerts, and on-call schedules.',
    url=f'http://{PAGERDUTY_AGENT_HOST}:{PAGERDUTY_AGENT_PORT}',
    version='0.1.0',
    defaultInputModes=["text"],
    defaultOutputModes=["text"],
    capabilities=AgentCapabilities(
        streaming=False),
    skills=[pagerduty_agent_skill],
    supportsAuthenticatedExtendedCard=False,
)
