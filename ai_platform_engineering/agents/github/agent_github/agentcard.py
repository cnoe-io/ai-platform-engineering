# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

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
AGENT_NAME = 'github'
AGENT_DESCRIPTION="An AI agent that interacts with GitHub to manage repositories, pull requests, and workflows."

agent_skill = AgentSkill(
  id="github_agent_skill",
  name="GitHub Agent Skill",
  description="Handles tasks related to GitHub repositories, pull requests, and workflows.",
  tags=[
    "github",
    "repository management",
    "pull requests",
    "workflows"],
  examples=[
      "Create a new GitHub repository named 'my-repo'.",
      "List all open pull requests in the 'frontend' repository.",
      "Merge the pull request #42 in the 'backend' repository.",
      "Close the issue #101 in the 'docs' repository.",
      "Get the latest commit in the 'main' branch of 'my-repo'."
  ])

# ==================================================
# SHARED CONFIGURATION - DO NOT MODIFY
# This section is reusable across all agents
# ==================================================
SUPPORTED_CONTENT_TYPES = ['text', 'text/plain']

capabilities = AgentCapabilities(streaming=True, pushNotifications=True)

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
