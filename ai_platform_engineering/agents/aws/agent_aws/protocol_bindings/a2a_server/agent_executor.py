# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""AWS AgentExecutor implementation supporting both LangGraph and Strands backends."""

import logging
import os

logger = logging.getLogger(__name__)


class AWSAgentExecutor:
    """
    AWS AgentExecutor that supports both LangGraph and Strands implementations.

    The implementation is chosen via the AWS_AGENT_BACKEND environment variable:
    - "langgraph" (default): Use LangGraph-based agent with tool notifications and token streaming
    - "strands": Use Strands-based agent (original implementation)
    """

    def __new__(cls):
        """Create the appropriate executor based on AWS_AGENT_BACKEND environment variable."""
        backend = os.getenv("AWS_AGENT_BACKEND", "langgraph").lower()

        if backend == "strands":
            logger.info("🔧 Using Strands-based AWS agent implementation")
            from ai_platform_engineering.utils.a2a_common.base_strands_agent_executor import BaseStrandsAgentExecutor
            from ...agent_strands import AWSAgent

            executor = object.__new__(BaseStrandsAgentExecutor)
            BaseStrandsAgentExecutor.__init__(executor, AWSAgent())
            logger.info("AWS Agent Executor initialized (using Strands backend)")
            return executor
        elif backend == "langgraph":  # default to langgraph
            logger.info("🔧 Using LangGraph-based AWS agent implementation")
            from ai_platform_engineering.utils.a2a_common.base_langgraph_agent_executor import BaseLangGraphAgentExecutor
            from ...agent_langgraph import AWSAgentLangGraph

            executor = object.__new__(BaseLangGraphAgentExecutor)
            BaseLangGraphAgentExecutor.__init__(executor, AWSAgentLangGraph())
            logger.info("AWS Agent Executor initialized (using LangGraph backend)")
            return executor
        else:
            raise ValueError(f"Invalid AWS agent backend: {backend}")