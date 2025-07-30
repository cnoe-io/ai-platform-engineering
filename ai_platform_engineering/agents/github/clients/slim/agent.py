# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

from langgraph.prebuilt import create_react_agent
from cnoe_agent_utils import LLMFactory
import os

from ai_platform_engineering.agents.github.agentcard import (
    github_agent_card, )
from ai_platform_engineering.utils.agntcy.agntcy_remote_agent_connect import (
    AgntcySlimRemoteAgentConnectTool,
)
from ai_platform_engineering.multi_agents.platform_engineer.prompts import get_agent_system_prompt

model = LLMFactory().get_llm()

# initialize the flavor profile tool with the farm agent card
github_a2a_remote_agent = AgntcySlimRemoteAgentConnectTool(
    name="github_tools_agent",
    description="Handles tasks related to GitHub repositories, pull requests, and workflows.",
    endpoint=os.getenv("SLIM_ENDPOINT", "http://slim-dataplane:46357"),
    remote_agent_card=github_agent_card,
)