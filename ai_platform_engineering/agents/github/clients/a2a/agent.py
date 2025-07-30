# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

from ai_platform_engineering.agents.github.agentcard import (
    github_agent_card, 
    GITHUB_AGENT_DESCRIPTION,
    github_agent_skill,
)
from ai_platform_engineering.utils.a2a.a2a_remote_agent_connect import (
    A2ARemoteAgentConnectTool,
)

# initialize the github A2A agent with the agent card
github_a2a_remote_agent = A2ARemoteAgentConnectTool(
    name="github_tools_agent",
    description=GITHUB_AGENT_DESCRIPTION,
    remote_agent_card=github_agent_card,
    skill_id=github_agent_skill.id,
)
