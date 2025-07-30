# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

from ai_platform_engineering.agents.pagerduty.agentcard import (
    pagerduty_agent_card,
    PAGERDUTY_AGENT_DESCRIPTION,
    pagerduty_agent_skill,
)
from ai_platform_engineering.utils.a2a.a2a_remote_agent_connect import (
    A2ARemoteAgentConnectTool,
)

# initialize the flavor profile tool with the farm agent card
pagerduty_a2a_remote_agent = A2ARemoteAgentConnectTool(
    name="pagerduty_tools_agent",
    description=PAGERDUTY_AGENT_DESCRIPTION,
    remote_agent_card=pagerduty_agent_card,
    skill_id=pagerduty_agent_skill.id,
)
