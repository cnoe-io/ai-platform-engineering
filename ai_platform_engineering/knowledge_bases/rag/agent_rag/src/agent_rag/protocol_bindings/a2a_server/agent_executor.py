# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

from agent_rag.protocol_bindings.a2a_server.agent import QnAAgent # type: ignore[import-untyped]
from ai_platform_engineering.utils.a2a_common.base_langgraph_agent_executor import BaseLangGraphAgentExecutor


class QnAAgentExecutor(BaseLangGraphAgentExecutor):
    """
    QnA AgentExecutor using base executor for consistent streaming.

    Note: QnAAgent has its own stream() method with astream_events for token-level streaming,
    and BaseLangGraphAgentExecutor handles the A2A protocol correctly.
    """

    def __init__(self):
        agent = QnAAgent()
        super().__init__(agent)
