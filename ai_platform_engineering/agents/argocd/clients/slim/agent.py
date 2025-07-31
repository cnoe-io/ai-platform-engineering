# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

from cnoe_agent_utils import LLMFactory
import os

from ai_platform_engineering.agents.argocd.agentcard import (
    ARGOCD_AGENT_DESCRIPTION,
    argocd_agent_card,
)
from ai_platform_engineering.utils.agntcy.agntcy_remote_agent_connect import (
    AgntcySlimRemoteAgentConnectTool,
)

model = LLMFactory().get_llm()

ARGOCD_ENDPOINT = os.getenv("ARGOCD_AGENT_ENDPOINT", f"http://{argocd_agent_card.url}")
SLIM_ENDPOINT = os.getenv("SLIM_ENDPOINT", "http://slim-dataplane:46357")

# initialize the flavor profile tool with the farm agent card
argocd_a2a_remote_agent = AgntcySlimRemoteAgentConnectTool(
    name="argocd_tools_agent",
    description=ARGOCD_AGENT_DESCRIPTION,
    endpoint=SLIM_ENDPOINT,
    remote_agent_card=argocd_agent_card,
)
