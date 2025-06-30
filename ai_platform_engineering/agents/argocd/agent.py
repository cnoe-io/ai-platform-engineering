# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

from langgraph.prebuilt import create_react_agent
from cnoe_agent_utils import LLMFactory

from ai_platform_engineering.agents.argocd.a2a_agentcards import (
    ARGOCD_AGENT_DESCRIPTION,
    argocd_agent_card,
    argocd_agent_skill,
)
from ai_platform_engineering.utils.a2a.a2a_remote_agent_connect import (
    A2ARemoteAgentConnectTool,
)
from ai_platform_engineering.mas.platform_engineer.prompts import get_agent_system_prompt

model = LLMFactory().get_llm()

# initialize the flavor profile tool with the farm agent card
argocd_a2a_remote_agent = A2ARemoteAgentConnectTool(
    name="argocd_tools_agent",
    description=ARGOCD_AGENT_DESCRIPTION,
    remote_agent_card=argocd_agent_card,
    skill_id=argocd_agent_skill.id,
)

argocd_system_prompt = get_agent_system_prompt("argocd")

argocd_agent = create_react_agent(
    model=model,
    tools=[argocd_a2a_remote_agent],
    name="argocd_agent",
    prompt=argocd_system_prompt,
)
