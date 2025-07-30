# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

from ai_platform_engineering.agents.backstage.a2a_agent_client.agentcard import (
    BACKSTAGE_AGENT_DESCRIPTION,
    backstage_agent_card,
    backstage_agent_skill,
)
from ai_platform_engineering.utils.a2a.a2a_remote_agent_connect import (
    A2ARemoteAgentConnectTool,
)

backstage_a2a_remote_agent = A2ARemoteAgentConnectTool(
    name="backstage_tools_agent",
    description=BACKSTAGE_AGENT_DESCRIPTION,
    remote_agent_card=backstage_agent_card,
    skill_id=backstage_agent_skill.id,
)
