# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

from agent_kubernetes.protocol_bindings.a2a_server.agent import KubernetesAgent
from ai_platform_engineering.utils.a2a_common.base_langgraph_agent_executor import BaseLangGraphAgentExecutor


class KubernetesAgentExecutor(BaseLangGraphAgentExecutor):
    """Kubernetes AgentExecutor using base class."""

    def __init__(self):
        super().__init__(KubernetesAgent())
