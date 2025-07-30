# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

from cnoe_agent_utils import LLMFactory
import os

from ai_platform_engineering.agents.argocd.agntcy_agent_client.agentcard import (
    ARGOCD_AGENT_DESCRIPTION,
    argocd_agent_card,
    argocd_agent_skill,
)
from ai_platform_engineering.utils.agntcy.agntcy_remote_agent_connect import (
    AgntcySlimRemoteAgentConnectTool,
)
from ai_platform_engineering.multi_agents.platform_engineer.prompts import get_agent_system_prompt

model = LLMFactory().get_llm()

ARGOCD_ENDPOINT = os.getenv("ARGOCD_AGENT_ENDPOINT", f"http://{argocd_agent_card.url}")

# initialize the flavor profile tool with the farm agent card
argocd_agntcy_slim_remote_agent = AgntcySlimRemoteAgentConnectTool(
    name="argocd_agntcy_remote_agent",
    description=ARGOCD_AGENT_DESCRIPTION,
    endpoint="http://slim-dataplane:46357",
    remote_agent_card=argocd_agent_card,
)