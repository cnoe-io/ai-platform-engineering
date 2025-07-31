# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

from ai_platform_engineering.agents.slack.agentcard import (
    SLACK_AGENT_DESCRIPTION,
    slack_agent_card,
    slack_agent_skill,
)
from ai_platform_engineering.utils.a2a.a2a_remote_agent_connect import (
    A2ARemoteAgentConnectTool,
)

# initialize the flavor profile tool with the farm agent card
slack_a2a_remote_agent = A2ARemoteAgentConnectTool(
    name="slack_tools_agent",
    description=SLACK_AGENT_DESCRIPTION,
    remote_agent_card=slack_agent_card,
    skill_id=slack_agent_skill.id,
)
