# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
import os
from a2a.types import (
  AgentCapabilities,
  AgentCard,
  AgentSkill
)

TEMPLATE_AGENT_HOST = os.getenv("TEMPLATE_AGENT_HOST", "localhost")
TEMPLATE_AGENT_PORT = os.getenv("TEMPLATE_AGENT_PORT", "8000")
print("===================================")
print("       TEMPLATE AGENT CONFIG       ")
print("===================================")
print(f"TEMPLATE_AGENT_HOST: {TEMPLATE_AGENT_HOST}")
print(f"TEMPLATE_AGENT_PORT: {TEMPLATE_AGENT_PORT}")
print("===================================")
TEMPLATE_AGENT_DESCRIPTION = (
  "A template AI agent for demonstration and extension. "
  "This agent can be customized to integrate with various platforms and provide a range of capabilities."
)

template_agent_skill = AgentSkill(
  id="template_agent_skill",
  name="Template Skill",
  description="Provides template capabilities for demonstration and extension.",
  tags=[
    "template",
    "demo"],
  examples=[
      "Demonstrate a template action.",
      "List all available template features.",
      "Create a new template resource.",
      "Archive a template item.",
      "Post a notification using the template agent."
  ])

template_agent_card = AgentCard(
  name='Template',
  id='template-tools-agent',
  description=TEMPLATE_AGENT_DESCRIPTION,
  url=f'http://{TEMPLATE_AGENT_HOST}:{TEMPLATE_AGENT_PORT}',
  version='0.1.0',
  defaultInputModes=["text"],
  defaultOutputModes=["text"],
  capabilities=AgentCapabilities(
    streaming=False),
  skills=[template_agent_skill],
  supportsAuthenticatedExtendedCard=False,
) 