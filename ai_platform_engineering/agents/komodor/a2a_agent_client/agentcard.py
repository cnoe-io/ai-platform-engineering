# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
import os
from a2a.types import (
  AgentCapabilities,
  AgentCard,
  AgentSkill
)

KOMODOR_AGENT_HOST = os.getenv("KOMODOR_AGENT_HOST", "localhost")
KOMODOR_AGENT_PORT = os.getenv("KOMODOR_AGENT_PORT", "8000")

print("===================================")
print("       KOMODOR AGENT CONFIG        ")
print("===================================")
print(f"KOMODOR_AGENT_HOST: {KOMODOR_AGENT_HOST}")
print(f"KOMODOR_AGENT_PORT: {KOMODOR_AGENT_PORT}")
print("===================================")

KOMODOR_AGENT_DESCRIPTION = 'An AI agent that provides capabilities to list, manage, and retrieve details of clusters, services and workloads in Komodor.'

komodor_agent_skill = AgentSkill(
  id="komodor_agent_skill",
  name="Komodor Agent Skill",
  description="Provides capabilities to list and manage applications in Komodor.",
  tags=[
    "komodor",
    "list clusters",
    "incident management"],
  examples=[
      "Get my clusters",
      "Get my health risks on cluster jarvis-sandbox",
      "Trigger a RCA for service httpbin in namespace sandbox-adrozdov on cluster jarvis-sandbox",
      "Get the RCA result for the session ID",
  ])

komodor_agent_card = AgentCard(
  name='Komodor',
  id='komodor-tools-agent',
  description=KOMODOR_AGENT_DESCRIPTION,
  url=f'http://{KOMODOR_AGENT_HOST}:{KOMODOR_AGENT_PORT}',
  version='0.1.0',
  defaultInputModes=["text"],
  defaultOutputModes=["text"],
  capabilities=AgentCapabilities(
    streaming=False),
  skills=[komodor_agent_skill],
  supportsAuthenticatedExtendedCard=False,
)
