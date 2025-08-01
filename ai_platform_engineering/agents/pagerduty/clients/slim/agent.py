# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

import os

from ai_platform_engineering.agents.pagerduty.agent_pagerduty.agentcard import agent_card
from ai_platform_engineering.utils.agntcy.agntcy_remote_agent_connect import (
    AgntcySlimRemoteAgentConnectTool,
)

SLIM_ENDPOINT = os.getenv("SLIM_ENDPOINT", "http://slim-dataplane:46357")

# initialize the flavor profile tool with the farm agent card
pagerduty_a2a_remote_agent = AgntcySlimRemoteAgentConnectTool(
    name="pagerduty_tools_agent",
    description=agent_card.description,
    endpoint=SLIM_ENDPOINT,
    remote_agent_card=agent_card,
)
