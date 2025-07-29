# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

import asyncio
import logging
from typing import Dict, Any, AsyncIterator

from agent_aws.agent import AWSEKSAgent as BaseAWSEKSAgent

logger = logging.getLogger(__name__)


class AWSEKSAgent:
    """A2A wrapper for AWS EKS Agent that provides HTTP API access."""

    def __init__(self):
        """Initialize the A2A AWS EKS Agent."""
        self._agent = None

    async def _get_agent(self) -> BaseAWSEKSAgent:
        """Get or create the agent instance."""
        if self._agent is None:
            self._agent = BaseAWSEKSAgent()
        return self._agent

    async def stream(self, query: str, context_id: str = None) -> AsyncIterator[Dict[str, Any]]:
        """Stream response from the agent."""
        agent = await self._get_agent()
        
        # Run the synchronous agent in an executor to avoid blocking
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(None, agent.run_sync, query)
        
        # For now, we'll implement basic streaming by chunking the response
        # The underlying agent doesn't support native streaming yet
        words = response.split()
        chunk_size = 10  # words per chunk
        
        for i in range(0, len(words), chunk_size):
            chunk = " ".join(words[i:i+chunk_size])
            if i + chunk_size < len(words):
                chunk += " "
            
            # Send intermediate chunks
            yield {
                'content': chunk,
                'is_task_complete': False,
                'context_id': context_id
            }
            
            # Small delay to simulate streaming
            await asyncio.sleep(0.1)
        
        # Send final completion event
        yield {
            'content': response,
            'is_task_complete': True,
            'context_id': context_id
        }

    def run_sync(self, query: str) -> str:
        """Run the agent synchronously."""
        if self._agent is None:
            self._agent = BaseAWSEKSAgent()
        result = self._agent.chat(query)
        return result.get("answer", "No response generated")
