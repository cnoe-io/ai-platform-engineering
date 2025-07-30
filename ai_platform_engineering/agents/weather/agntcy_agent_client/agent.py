# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

import os

from ai_platform_engineering.agents.weather.agntcy_agent_client.agentcard import (
    WEATHER_AGENT_DESCRIPTION,
    weather_agent_card,
)
from ai_platform_engineering.utils.agntcy.agntcy_remote_agent_connect import (
    AgntcySlimRemoteAgentConnectTool,
)

SLIM_ENDPOINT = os.getenv("SLIM_ENDPOINT", "http://slim-dataplane:46357")

# initialize the flavor profile tool with the farm agent card
weather_agntcy_remote_agent = AgntcySlimRemoteAgentConnectTool(
    name="weather_agntcy_remote_agent",
    description=WEATHER_AGENT_DESCRIPTION,
    endpoint=SLIM_ENDPOINT,
    remote_agent_card=weather_agent_card,
)
