# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""AIGateway Agent implementation for managing LLM access via LiteLLM."""

import logging
import os
from typing import Literal, AsyncIterable, Any
from pydantic import BaseModel

from ai_platform_engineering.utils.a2a_common.base_langgraph_agent import BaseLangGraphAgent
from cnoe_agent_utils.tracing import trace_agent_stream

logger = logging.getLogger(__name__)


class ResponseFormat(BaseModel):
    """Respond to the user in this format."""

    status: Literal['input_required', 'completed', 'error'] = 'input_required'
    message: str


class AIGatewayAgent(BaseLangGraphAgent):
    """AIGateway Agent for managing LLM access via LiteLLM."""

    SYSTEM_INSTRUCTION = """You are an AI Gateway Management Agent responsible for managing LLM access via LiteLLM.

## Your Capabilities

1. **Create LLM API Keys**: Generate API keys for users to access LLM models
2. **Get User Spend Activity**: Retrieve user's usage and spending data
3. **List Available Models**: Show available LLM providers and models

## Important Rules

1. **User Identification**: Always require a valid corporate email address

2. **Model Selection**: Help users choose the right model for their use case:
   - GPT-4o: Best for complex reasoning, coding, analysis
   - Claude-3-Opus: Best for long-form content, detailed analysis
   - Claude-3-Sonnet: Good balance of speed and capability
   - GPT-3.5-turbo: Fast and cost-effective for simple tasks
   - Embedding models: For vector search and RAG applications

## Response Format

Always provide clear responses including:
- Action taken
- Model/provider information
- Usage instructions (for new keys)
- Spending summary (for activity queries)
"""

    RESPONSE_FORMAT_INSTRUCTION = """When responding, use this format:
- status: "completed" if the operation succeeded, "error" if it failed, "input_required" if more info is needed
- message: A clear description of what happened, including any API keys, usage instructions, or spending data
"""

    def get_agent_name(self) -> str:
        """Return the agent's name."""
        return "aigateway"

    def get_system_instruction(self) -> str:
        """Return the system instruction for the agent."""
        return self.SYSTEM_INSTRUCTION

    def get_response_format_instruction(self) -> str:
        """Return the response format instruction."""
        return self.RESPONSE_FORMAT_INSTRUCTION

    def get_response_format_class(self) -> type[BaseModel]:
        """Return the response format class."""
        return ResponseFormat

    def get_mcp_config(self, server_path: str) -> dict:
        """Return MCP configuration for AIGateway.
        
        Note: AIGateway agent uses direct tools, not MCP. This is a placeholder.
        """
        litellm_api_key = os.getenv("LITELLM_API_KEY")
        if not litellm_api_key:
            raise ValueError("LITELLM_API_KEY must be set as an environment variable.")

        litellm_api_url = os.getenv("LITELLM_API_URL", "")

        return {
            "command": "uv",
            "args": ["run", "--project", os.path.dirname(server_path), server_path],
            "env": {
                "LITELLM_API_KEY": litellm_api_key,
                "LITELLM_API_URL": litellm_api_url,
            },
            "transport": "stdio",
        }

    def get_additional_tools(self) -> list:
        """
        Provide additional custom tools for AIGateway agent.
        
        Returns the AIGateway-specific tools.
        """
        from ai_platform_engineering.agents.aigateway.agent_aigateway.tools import (
            create_llm_api_key,
            get_user_spend_activity,
            list_available_models,
        )
        
        return [
            create_llm_api_key,
            get_user_spend_activity,
            list_available_models,
        ]

    def get_tool_working_message(self) -> str:
        """Return message shown when calling tools."""
        return "🔧 Working on AI Gateway operation..."

    def get_tool_processing_message(self) -> str:
        """Return message shown when processing tool results."""
        return "📋 Processing AI Gateway results..."

    @trace_agent_stream("aigateway")
    async def stream(
        self, query: str, sessionId: str, trace_id: str = None
    ) -> AsyncIterable[dict[str, Any]]:
        """
        Stream responses with aigateway-specific tracing and safety-net error handling.

        Overrides the base stream method to add agent-specific tracing decorator.
        """
        try:
            async for event in super().stream(query, sessionId, trace_id):
                yield event
        except Exception as e:
            logger.error(f"Unexpected AIGateway agent error: {str(e)}", exc_info=True)
            yield {
                'is_task_complete': True,
                'require_user_input': False,
                'kind': 'error',
                'content': f"❌ An unexpected error occurred in AIGateway: {str(e)}\n\nPlease try again or contact support if the issue persists.",
            }
