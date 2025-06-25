# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

from langgraph.prebuilt import create_react_agent
from cnoe_agent_utils import LLMFactory

from ai_platform_engineering.agents.slack.a2a_agentcards import (
    SLACK_AGENT_DESCRIPTION,
    slack_agent_card,
    slack_agent_skill,
)
from ai_platform_engineering.utils.a2a.a2a_remote_agent_connect import (
    A2ARemoteAgentConnectTool,
)
from ai_platform_engineering.mas.platform_engineer.prompts import get_agent_system_prompt, get_agent_skills_prompt

model = LLMFactory().get_llm()

# initialize the flavor profile tool with the farm agent card
slack_a2a_remote_agent = A2ARemoteAgentConnectTool(
    name="slack_tools_agent",
    description=SLACK_AGENT_DESCRIPTION,
    remote_agent_card=slack_agent_card,
    skill_id=slack_agent_skill.id,
)

slack_system_prompt = get_agent_system_prompt("slack")
slack_skills_prompt = get_agent_skills_prompt("slack")

slack_agent = create_react_agent(
    model=model,
    tools=[slack_a2a_remote_agent],
    name="slack_agent",
    prompt=slack_system_prompt,
)
