# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

from langgraph.prebuilt import create_react_agent
from cnoe_agent_utils import LLMFactory

from ai_platform_engineering.agents.webex.a2a_agent_client.agentcard import (
    WEBEX_AGENT_DESCRIPTION,
    webex_agent_card,
    webex_agent_skill,
)
from ai_platform_engineering.utils.a2a.a2a_remote_agent_connect import (
    A2ARemoteAgentConnectTool,
)
from ai_platform_engineering.multi_agents.platform_engineer.prompts import get_agent_system_prompt

model = LLMFactory().get_llm()

# initialize the flavor profile tool with the farm agent card
webex_a2a_remote_agent = A2ARemoteAgentConnectTool(
    name="webex_tools_agent",
    description=WEBEX_AGENT_DESCRIPTION,
    remote_agent_card=webex_agent_card,
    skill_id=webex_agent_skill.id,
)

webex_system_prompt = get_agent_system_prompt("webex")

webex_agent = create_react_agent(
    model=model,
    tools=[webex_a2a_remote_agent],
    name="webex_agent",
    prompt=webex_system_prompt,
)
