# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

import os

from ai_platform_engineering.agents.pagerduty.agentcard import (
    pagerduty_agent_card,
	PAGERDUTY_AGENT_DESCRIPTION,
)
from ai_platform_engineering.utils.agntcy.agntcy_remote_agent_connect import (
    AgntcySlimRemoteAgentConnectTool,
)

SLIM_ENDPOINT = os.getenv("SLIM_ENDPOINT", "http://slim-dataplane:46357")

# initialize the flavor profile tool with the farm agent card
pagerduty_a2a_remote_agent = AgntcySlimRemoteAgentConnectTool(
    name="pagerduty_tools_agent",
    description=PAGERDUTY_AGENT_DESCRIPTION,
    endpoint=SLIM_ENDPOINT,
    remote_agent_card=pagerduty_agent_card,
)
