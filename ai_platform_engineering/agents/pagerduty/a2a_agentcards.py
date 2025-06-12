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
        "Create a new incident in PagerDuty.",
        "List all active alerts in PagerDuty.",
        "What is the current on-call schedule?"])

pagerduty_agent_card = AgentCard(
    name='PagerDuty Tools Agent',
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
