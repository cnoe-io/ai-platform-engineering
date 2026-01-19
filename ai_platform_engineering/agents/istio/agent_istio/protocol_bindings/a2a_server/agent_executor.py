# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

from agent_istio.protocol_bindings.a2a_server.agent import IstioAgent
from ai_platform_engineering.utils.a2a_common.base_langgraph_agent_executor import BaseLangGraphAgentExecutor


class IstioAgentExecutor(BaseLangGraphAgentExecutor):
    """Istio AgentExecutor using base class."""

    def __init__(self):
        super().__init__(IstioAgent())
