# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

from langgraph.prebuilt import create_react_agent
from cnoe_agent_utils import LLMFactory

from ai_platform_engineering.agents.confluence.a2a_agent_client.agentcard import (
    CONFLUENCE_AGENT_DESCRIPTION,
    confluence_agent_card,
    confluence_agent_skill,
)
from ai_platform_engineering.utils.a2a.a2a_remote_agent_connect import (
    A2ARemoteAgentConnectTool,
)
from ai_platform_engineering.multi_agents.platform_engineer.prompts import get_agent_system_prompt

model = LLMFactory().get_llm()

# initialize the flavor profile tool with the farm agent card
confluence_a2a_remote_agent = A2ARemoteAgentConnectTool(
    name="confluence_tools_agent",
    description=CONFLUENCE_AGENT_DESCRIPTION,
    remote_agent_card=confluence_agent_card,
    skill_id=confluence_agent_skill.id,
)

jira_system_prompt = get_agent_system_prompt("jira")

confluence_agent = create_react_agent(
    model=model,
    tools=[confluence_a2a_remote_agent],
    name="confluence_agent",
    prompt=jira_system_prompt,
)
