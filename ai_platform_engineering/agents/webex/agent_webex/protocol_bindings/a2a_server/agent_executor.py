# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Webex AgentExecutor using base class."""

from agent_webex.protocol_bindings.a2a_server.agent import WebexAgent  # type: ignore[import-untyped]
from ai_platform_engineering.utils.a2a_common.base_langgraph_agent_executor import BaseLangGraphAgentExecutor


class WebexAgentExecutor(BaseLangGraphAgentExecutor):
    """Webex AgentExecutor using base class."""

    def __init__(self):
        super().__init__(WebexAgent())
