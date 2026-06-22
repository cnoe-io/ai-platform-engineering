# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""AWS AgentExecutor implementation using the LangGraph backend."""

import logging

logger = logging.getLogger(__name__)


class AWSAgentExecutor:
    """AWS AgentExecutor backed by the LangGraph AWS agent."""

    def __new__(cls):
        """Create the LangGraph executor for the AWS agent."""
        # assisted-by Codex Codex-sonnet-4-6
        logger.info("Using LangGraph-based AWS agent implementation")
        from ai_platform_engineering.utils.a2a_common.base_langgraph_agent_executor import BaseLangGraphAgentExecutor
        from agent_aws.agent_langgraph import AWSAgentLangGraph

        executor = object.__new__(BaseLangGraphAgentExecutor)
        BaseLangGraphAgentExecutor.__init__(executor, AWSAgentLangGraph())
        logger.info("AWS Agent Executor initialized (using LangGraph backend)")
        return executor
