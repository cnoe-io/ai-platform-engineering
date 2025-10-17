# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

import asyncio
import logging
from typing import Dict, Any, AsyncIterator

from agent_aws.agent import AWSAgent as BaseAWSAgent

logger = logging.getLogger(__name__)


class AWSAgent:
    """A2A wrapper for AWS Agent that provides HTTP API access."""

    def __init__(self):
        """Initialize the A2A AWS Agent."""
        logger.info("Initializing AWS Agent and MCP servers...")
        # Initialize agent eagerly to download MCP packages at startup
        self._agent = BaseAWSAgent()
        logger.info("AWS Agent initialized successfully")

    async def _get_agent(self) -> BaseAWSAgent:
        """Get or create the agent instance."""
        return self._agent

    async def stream(self, query: str, context_id: str = None) -> AsyncIterator[Dict[str, Any]]:
        """Stream response from the agent."""
        agent = await self._get_agent()

        # Run the synchronous agent in an executor to avoid blocking
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(None, agent.run_sync, query)

        # Send final completion event with full response
        # Don't send fake intermediate chunks - just send the complete response
        yield {
            'content': response,
            'is_task_complete': True,
            'context_id': context_id
        }

    def run_sync(self, query: str) -> str:
        """Run the agent synchronously."""
        result = self._agent.chat(query)
        return result.get("answer", "No response generated")
