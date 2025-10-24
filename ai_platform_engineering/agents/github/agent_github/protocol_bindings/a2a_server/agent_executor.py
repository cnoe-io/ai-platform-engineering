# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""
GitHub Agent Executor using BaseLangGraphAgentExecutor.

This provides consistent streaming behavior with other refactored agents
(ArgoCD, Komodor, etc.) and eliminates duplicate messages.
"""

from agent_github.protocol_bindings.a2a_server.agent import GitHubAgent  # type: ignore[import-untyped]
from ai_platform_engineering.utils.a2a_common.base_langgraph_agent_executor import BaseLangGraphAgentExecutor


class GitHubAgentExecutor(BaseLangGraphAgentExecutor):
    """GitHub AgentExecutor using base class for consistent streaming."""

    def __init__(self):
        super().__init__(GitHubAgent())

