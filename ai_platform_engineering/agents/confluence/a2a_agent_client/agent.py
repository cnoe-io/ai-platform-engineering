# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

from ai_platform_engineering.agents.confluence.a2a_agent_client.agentcard import (
    CONFLUENCE_AGENT_DESCRIPTION,
    confluence_agent_card,
    confluence_agent_skill,
)
from ai_platform_engineering.utils.a2a.a2a_remote_agent_connect import (
    A2ARemoteAgentConnectTool,
)

# initialize the flavor profile tool with the farm agent card
confluence_a2a_remote_agent = A2ARemoteAgentConnectTool(
    name="confluence_tools_agent",
    description=CONFLUENCE_AGENT_DESCRIPTION,
    remote_agent_card=confluence_agent_card,
    skill_id=confluence_agent_skill.id,
)
