# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

from langgraph.prebuilt import create_react_agent
from cnoe_agent_utils import LLMFactory

from ai_platform_engineering.agents.komodor.a2a_agent_client.agentcard import (
    KOMODOR_AGENT_DESCRIPTION,
    komodor_agent_card,
    komodor_agent_skill,
)
from ai_platform_engineering.utils.a2a.a2a_remote_agent_connect import (
    A2ARemoteAgentConnectTool,
)
from ai_platform_engineering.multi_agents.platform_engineer.prompts import get_agent_system_prompt

model = LLMFactory().get_llm()

# initialize the flavor profile tool with the farm agent card
komodor_a2a_remote_agent = A2ARemoteAgentConnectTool(
    name="komodor_tools_agent",
    description=KOMODOR_AGENT_DESCRIPTION,
    remote_agent_card=komodor_agent_card,
    skill_id=komodor_agent_skill.id,
)

komodor_system_prompt = get_agent_system_prompt("komodor")

komodor_agent = create_react_agent(
    model=model,
    tools=[komodor_a2a_remote_agent],
    name="komodor_agent",
    prompt=komodor_system_prompt,
)
