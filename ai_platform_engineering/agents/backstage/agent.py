# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

from langgraph.prebuilt import create_react_agent
from cnoe_agent_utils import LLMFactory

from ai_platform_engineering.agents.backstage.a2a_agentcards import (
    BACKSTAGE_AGENT_DESCRIPTION,
    backstage_agent_card,
    backstage_agent_skill,
)
from ai_platform_engineering.utils.a2a.a2a_remote_agent_connect import (
    A2ARemoteAgentConnectTool,
)

model = LLMFactory().get_llm()

backstage_a2a_remote_agent = A2ARemoteAgentConnectTool(
    name="backstage_tools_agent",
    description=BACKSTAGE_AGENT_DESCRIPTION,
    remote_agent_card=backstage_agent_card,
    skill_id=backstage_agent_skill.id,
)

backstage_agent = create_react_agent(
    model=model,
    tools=[backstage_a2a_remote_agent],
    name="backstage_agent",
) 