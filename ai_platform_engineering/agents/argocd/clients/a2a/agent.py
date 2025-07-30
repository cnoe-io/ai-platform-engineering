# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

from langgraph.prebuilt import create_react_agent
from cnoe_agent_utils import LLMFactory

from ai_platform_engineering.agents.argocd.agentcard import (
    ARGOCD_AGENT_DESCRIPTION,
    argocd_agent_card,
    argocd_agent_skill,
)
from ai_platform_engineering.utils.a2a.a2a_remote_agent_connect import (
    A2ARemoteAgentConnectTool,
)

model = LLMFactory().get_llm()

# initialize the flavor profile tool with the farm agent card
argocd_a2a_remote_agent = A2ARemoteAgentConnectTool(
    name="argocd_tools_agent",
    description=ARGOCD_AGENT_DESCRIPTION,
    remote_agent_card=argocd_agent_card,
    skill_id=argocd_agent_skill.id,
)
