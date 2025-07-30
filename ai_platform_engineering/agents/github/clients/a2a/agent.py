# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

from langgraph.prebuilt import create_react_agent
from cnoe_agent_utils import LLMFactory

from ai_platform_engineering.agents.github.agentcard import (
    github_agent_card, 
    GITHUB_AGENT_DESCRIPTION,
    github_agent_skill,
)
from ai_platform_engineering.utils.a2a.a2a_remote_agent_connect import (
    A2ARemoteAgentConnectTool,
)
from ai_platform_engineering.multi_agents.platform_engineer.prompts import get_agent_system_prompt

model = LLMFactory().get_llm()

# initialize the github A2A agent with the agent card
github_a2a_remote_agent = A2ARemoteAgentConnectTool(
    name="github_tools_agent",
    description=GITHUB_AGENT_DESCRIPTION,
    remote_agent_card=github_agent_card,
    skill_id=github_agent_skill.id,
)

# Create ReAct Agent for GitHub - used in some multi-agent scenarios
github_system_prompt = get_agent_system_prompt("github")
github_agent = create_react_agent(
    model=model,
    tools=[github_a2a_remote_agent],
    name="github_agent",
    prompt=github_system_prompt,
)
