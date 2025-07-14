import os

# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

from a2a.types import (
  AgentCapabilities,
  AgentCard,
  AgentSkill
)

PAGERDUTY_AGENT_HOST = os.getenv("PAGERDUTY_AGENT_HOST", "localhost")
PAGERDUTY_AGENT_PORT = os.getenv("PAGERDUTY_AGENT_PORT", "8000")

print("===================================")
print("       PAGERDUTY AGENT CONFIG      ")
print("===================================")
print(f"PAGERDUTY_AGENT_HOST: {PAGERDUTY_AGENT_HOST}")
print(f"PAGERDUTY_AGENT_PORT: {PAGERDUTY_AGENT_PORT}")
print("===================================")

pagerduty_agent_skill = AgentSkill(
  id="pagerduty_agent_skill",
  name="PagerDuty Agent Skill",
  description="Handles tasks related to PagerDuty incidents, alerts, and on-call schedules.",
  tags=[
    "pagerduty",
    "incident management",
    "alerts",
    "on-call schedules"],
  examples=[
      "Create a new PagerDuty incident with title 'Server Down'.",
      "List all active alerts in the 'Production' service.",
      "Resolve the incident #12345 in PagerDuty.",
      "Add a note to the incident #67890 in PagerDuty.",
      "Get the on-call schedule for the 'Engineering' team."
  ])

pagerduty_agent_card = AgentCard(
  name='Pagerduty',
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
