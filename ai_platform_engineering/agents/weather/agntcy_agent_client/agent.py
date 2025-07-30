# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

from langgraph.prebuilt import create_react_agent
from cnoe_agent_utils import LLMFactory
import os

from ai_platform_engineering.agents.weather.agntcy_agent_client.agentcard import (
    WEATHER_AGENT_DESCRIPTION,
    weather_agent_card,
)
from ai_platform_engineering.utils.agntcy.agntcy_remote_agent_connect import (
    AgntcySlimRemoteAgentConnectTool,
)
from ai_platform_engineering.multi_agents.platform_engineer.prompts import get_agent_system_prompt

model = LLMFactory().get_llm()

WEATHER_ENDPOINT = os.getenv("WEATHER_AGENT_ENDPOINT", f"http://{weather_agent_card.url}")

# initialize the flavor profile tool with the farm agent card
weather_agntcy_remote_agent = AgntcySlimRemoteAgentConnectTool(
    name="weather_agntcy_remote_agent",
    description=WEATHER_AGENT_DESCRIPTION,
    endpoint="http://slim-dataplane:46357",
    remote_agent_card=weather_agent_card,
)

weather_system_prompt = get_agent_system_prompt("weather")

weather_agent = create_react_agent(
    model=model,
    tools=[weather_agntcy_remote_agent],
    name="weather_agent",
    prompt=weather_system_prompt,
)
