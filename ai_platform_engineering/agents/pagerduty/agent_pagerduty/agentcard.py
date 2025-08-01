# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

import os
from dotenv import load_dotenv

from a2a.types import (
  AgentCapabilities,
  AgentCard,
  AgentSkill
)

load_dotenv()

# ==================================================
# AGENT SPECIFIC CONFIGURATION
# Modify these values for your specific agent
# ==================================================
AGENT_NAME = 'Pagerduty'
AGENT_DESCRIPTION = 'An AI agent that provides capabilities to perform PagerDuty operations.'

agent_skill = AgentSkill(
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

# ==================================================
# SHARED CONFIGURATION - DO NOT MODIFY
# This section is reusable across all agents
# ==================================================
SUPPORTED_CONTENT_TYPES = ['text', 'text/plain']

capabilities = AgentCapabilities(streaming=True, pushNotifications=True)

if os.getenv('A2A_TRANSPORT', 'p2p').lower() == 'slim':
  AGENT_URL = os.getenv('SLIM_ENDPOINT', 'http://slim-dataplane:46357')
else:
  AGENT_HOST = os.getenv(f"{AGENT_NAME.upper()}_AGENT_HOST", "localhost")
  AGENT_PORT = os.getenv(f"{AGENT_NAME.upper()}_AGENT_PORT", "8000")
  AGENT_URL = f'http://{AGENT_HOST}:{AGENT_PORT}'

def create_agent_card(agent_url):
  print("===================================")
  print(f"       {AGENT_NAME.upper()} AGENT CONFIG      ")
  print("===================================")
  print(f"AGENT_URL: {agent_url}")
  print("===================================")

  return AgentCard(
    name=AGENT_NAME,
    id=f'{AGENT_NAME.lower()}-tools-agent',
    description=AGENT_DESCRIPTION,
    url=agent_url,
    version='0.1.0',
    defaultInputModes=SUPPORTED_CONTENT_TYPES,
    defaultOutputModes=SUPPORTED_CONTENT_TYPES,
    capabilities=capabilities,
    skills=[agent_skill],
    # Using the security field instead of the non-existent AgentAuthentication class
    security=[{"public": []}],
  )
