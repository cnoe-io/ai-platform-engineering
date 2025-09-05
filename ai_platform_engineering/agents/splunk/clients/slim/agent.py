# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

import os

from ai_platform_engineering.agents.splunk.agent_splunk.agentcard import (
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

# initialize the splunk agent tool with the agent card
a2a_remote_agent = AgntcySlimRemoteAgentConnectTool(
    name="splunk_tools_agent",
    description=agent_card.description,
    endpoint=SLIM_ENDPOINT,
    remote_agent_card=agent_card,
) 