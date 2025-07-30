# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

from ai_platform_engineering.agents.jira.agentcard import (
    JIRA_AGENT_DESCRIPTION,
    jira_agent_card,
    jira_agent_skill,
)
from ai_platform_engineering.utils.a2a.a2a_remote_agent_connect import (
    A2ARemoteAgentConnectTool,
)

# initialize the flavor profile tool with the farm agent card
jira_a2a_remote_agent = A2ARemoteAgentConnectTool(
    name="jira_tools_agent",
    description=JIRA_AGENT_DESCRIPTION,
    remote_agent_card=jira_agent_card,
    skill_id=jira_agent_skill.id,
)
