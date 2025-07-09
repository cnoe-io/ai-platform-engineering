# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

import logging
from .agent import RAGAgent

# Configure logging
logger = logging.getLogger(__name__)

class RAGAgentExecutor:
    """
    Executes user queries using the RAGAgent.
    """
    def __init__(self, agent: RAGAgent):
        self.agent = agent
        logger.info("Initialized RAGAgentExecutor")

    async def execute(self, query: str, context_id: str = None) -> str:
        """
        Execute a user query and return the answer.
        """
        logger.info(f"Executing query: {query}")
        try:
            result = self.agent.answer_question(query)
            logger.info(f"Got result: {result}")
            return result
        except Exception as e:
            logger.error(f"Error executing query: {str(e)}", exc_info=True)
            raise 