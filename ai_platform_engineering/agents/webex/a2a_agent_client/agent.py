# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

from ai_platform_engineering.agents.webex.a2a_agent_client.agentcard import (
    WEBEX_AGENT_DESCRIPTION,
    webex_agent_card,
    webex_agent_skill,
)
from ai_platform_engineering.utils.a2a.a2a_remote_agent_connect import (
    A2ARemoteAgentConnectTool,
)

# initialize the flavor profile tool with the farm agent card
webex_a2a_remote_agent = A2ARemoteAgentConnectTool(
    name="webex_tools_agent",
    description=WEBEX_AGENT_DESCRIPTION,
    remote_agent_card=webex_agent_card,
    skill_id=webex_agent_skill.id,
)
