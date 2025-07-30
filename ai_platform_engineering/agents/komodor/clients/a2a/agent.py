# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

from ai_platform_engineering.agents.komodor.agentcard import (
    KOMODOR_AGENT_DESCRIPTION,
    komodor_agent_card,
    komodor_agent_skill,
)
from ai_platform_engineering.utils.a2a.a2a_remote_agent_connect import (
    A2ARemoteAgentConnectTool,
)

# initialize the flavor profile tool with the farm agent card
komodor_a2a_remote_agent = A2ARemoteAgentConnectTool(
    name="komodor_tools_agent",
    description=KOMODOR_AGENT_DESCRIPTION,
    remote_agent_card=komodor_agent_card,
    skill_id=komodor_agent_skill.id,
)
