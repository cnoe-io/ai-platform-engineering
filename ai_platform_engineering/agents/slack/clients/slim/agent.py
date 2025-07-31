# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

import os

from ai_platform_engineering.agents.slack.agentcard import (
    slack_agent_card,
    SLACK_AGENT_DESCRIPTION,
)
from ai_platform_engineering.utils.agntcy.agntcy_remote_agent_connect import (
    AgntcySlimRemoteAgentConnectTool,
)

SLIM_ENDPOINT = os.getenv("SLIM_ENDPOINT", "http://slim-dataplane:46357")

# initialize the flavor profile tool with the farm agent card
slack_a2a_remote_agent = AgntcySlimRemoteAgentConnectTool(
    name="slack_tools_agent",
    description=SLACK_AGENT_DESCRIPTION,
    endpoint=SLIM_ENDPOINT,
    remote_agent_card=slack_agent_card,
)
