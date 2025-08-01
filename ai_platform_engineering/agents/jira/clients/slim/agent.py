# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

import os

from ai_platform_engineering.agents.jira.agent_jira.agentcard import (
    create_agent_card,
    agent_skill,
)
from ai_platform_engineering.utils.agntcy.agntcy_remote_agent_connect import (
    AgntcySlimRemoteAgentConnectTool,
)

SLIM_ENDPOINT = os.getenv("SLIM_ENDPOINT", "http://slim-dataplane:46357")

agent_card = create_agent_card(SLIM_ENDPOINT)
tool_map = {
    agent_card.name: agent_skill.examples
}

# initialize the flavor profile tool with the farm agent card
a2a_remote_agent = AgntcySlimRemoteAgentConnectTool(
    name="jira_tools_agent",
    description=agent_card.description,
    endpoint=SLIM_ENDPOINT,
    remote_agent_card=agent_card,
)
