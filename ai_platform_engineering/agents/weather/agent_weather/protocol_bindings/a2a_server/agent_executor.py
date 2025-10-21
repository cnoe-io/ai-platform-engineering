# Copyright 2025 Cisco
# SPDX-License-Identifier: Apache-2.0

"""Weather AgentExecutor using base class."""

from agent_weather.protocol_bindings.a2a_server.agent import WeatherAgent # type: ignore[import-untyped]
from ai_platform_engineering.utils.a2a_common.base_langgraph_agent_executor import BaseLangGraphAgentExecutor


class WeatherAgentExecutor(BaseLangGraphAgentExecutor):
    """Weather AgentExecutor using base class."""

    def __init__(self):
        super().__init__(WeatherAgent())
