# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

import logging
from collections.abc import AsyncIterable
from typing import Any, Literal
import uuid

from langchain_mcp_adapters.client import MultiServerMCPClient
from langchain_core.messages import AIMessage, ToolMessage, HumanMessage
from langchain_core.runnables.config import RunnableConfig
from pydantic import BaseModel

from langgraph.checkpoint.memory import MemorySaver
from langgraph.prebuilt import create_react_agent  # type: ignore

import os


from cnoe_agent_utils import LLMFactory

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

def debug_print(message: str, banner: bool = True):
    if os.getenv("A2A_SERVER_DEBUG", "false").lower() == "true":
        if banner:
            print("=" * 80)
        print(f"DEBUG: {message}")
        if banner:
            print("=" * 80)

memory = MemorySaver()

class ResponseFormat(BaseModel):
    """Response format for the Litellm agent."""
    status: Literal['input_required', 'completed', 'error'] = 'input_required'
    message: str

class LitellmAgent:
    """Litellm Agent."""

    SYSTEM_INSTRUCTION = """You are a helpful assistant that can interact with the Litellm API.\nYou can use the Litellm API to manage and query information about api keys for various LLM models."""

    RESPONSE_FORMAT_INSTRUCTION = """Select status as completed if the request is complete.\nSelect status as input_required if the input is a question to the user.\nSet response status to error if the input indicates an error."""

    def __init__(self):
        logger.info("Initializing LitellmAgent")
        # Setup the agent and load MCP tools
        self.model = LLMFactory().get_llm()
        self.graph = None
        logger.debug("Agent initialized with model")
        self.mcp_mode = os.getenv("MCP_MODE", "stdio").lower()
        self.mcp_host = os.getenv("MCP_HOST", "localhost")
        self.mcp_port = os.getenv("MCP_PORT", "3000")
        
        config = RunnableConfig()
        args = config.get("configurable", {})
        server_path = args.get("server_path", "./mcp/mcp_litellm/server.py")
        print(f"Launching MCP server at: {server_path}")

        # Support both LITELLM_MASTER_KEY and LITELLM_API_KEY for backward compatibility
        self.mcp_api_key = (
            os.getenv("LITELLM_MASTER_KEY")
            or os.getenv("LITELLM_API_KEY")
        )
        if not self.mcp_api_key and self.mcp_mode != "stdio":
            raise ValueError(
                "LITELLM_MASTER_KEY or LITELLM_API_KEY must be set as an environment variable for HTTP transport."
            )

        self.mcp_api_url = os.getenv("LITELLM_MCP_API_URL")
        # Defaults for each transport mode
        if not self.mcp_api_url:
            if self.mcp_mode == "http":
                self.mcp_api_url = f"http://{self.mcp_host}:{self.mcp_port}/mcp/"

    async def initialize(self):
        """Initialize the agent with MCP tools."""
        logger.info("Starting agent initialization")
        if self.graph is not None:
            logger.debug("Graph already initialized, skipping")
            return

        if self.mcp_mode == "http" or self.mcp_mode == "streamable_http":

            logger.info(f"Using HTTP transport for MCP client: {self.mcp_api_url}")

            client = MultiServerMCPClient(
                {
                    "litellm": {
                        "transport": "streamable_http",
                        "url": self.mcp_api_url,
                        "headers": {
                            "Authorization": f"Bearer {self.mcp_api_key}",
                        },
                    }
                }
            )

        else:
            logger.info(f"Using STDIO transport for MCP client: {self.mcp_api_url}")
            server_path = "./agent_litellm/protocol_bindings/mcp_server/mcp_litellm/server.py"
            logger.info(f"Launching MCP server at: {server_path}")

            client = MultiServerMCPClient(
                {
                    "litellm": {
                        "command": "uv",
                        "args": ["run", server_path],
                        "env": {
                            "MCP_API_KEY": self.mcp_api_key,
                            "MCP_API_URL": self.mcp_api_url
                        },
                        "transport": "stdio",
                    }
                }
            )

        tools = await client.get_tools()

        logger.debug("Creating React agent with LangGraph")
        self.graph = create_react_agent(
            self.model,
            tools,
            checkpointer=memory,
            prompt=self.SYSTEM_INSTRUCTION,
            response_format=(self.RESPONSE_FORMAT_INSTRUCTION, ResponseFormat),
        )

        # Initialize with a test message using a temporary thread ID
        config = RunnableConfig(configurable={"thread_id": "132456789"})
        logger.debug(f"Initializing with test message, config: {config}")
        await self.graph.ainvoke({"messages": [HumanMessage(content="Summarize what you can do?")]}, config=config)
        logger.debug("Test message initialization complete")

    async def stream(
        self, query: str, context_id: str | None = None
    ) -> AsyncIterable[dict[str, Any]]:
        """Stream responses for a given query."""
        # Use the context_id as the thread_id, or generate a new one if none provided
        thread_id = context_id or uuid.uuid4().hex
        logger.info(f"Stream started - Query: {query}, Thread ID: {thread_id}, Context ID: {context_id}")
        debug_print(f"Starting stream with query: {query} using thread ID: {thread_id}")

        # Initialize agent if needed
        await self.initialize()

        inputs: dict[str, Any] = {'messages': [('user', query)]}
        config: RunnableConfig = {'configurable': {'thread_id': thread_id}}
        logger.debug(f"Stream config: {config}")

        async for item in self.graph.astream(inputs, config, stream_mode='values'):
            message = item['messages'][-1]
            debug_print(f"Streamed message: {message}")
            logger.debug(f"Processing message: {message}")
            if (
                isinstance(message, AIMessage)
                and message.tool_calls
                and len(message.tool_calls) > 0
            ):
                logger.debug(f"Processing tool calls: {message.tool_calls}")
                yield {
                    'is_task_complete': False,
                    'require_user_input': False,
                    'content': 'Looking up Litellm information...',
                }
            elif isinstance(message, ToolMessage):
                logger.debug(f"Processing tool message: {message}")
                yield {
                    'is_task_complete': False,
                    'require_user_input': False,
                    'content': 'Processing Litellm data...',
                }

        response = self.get_agent_response(config)
        yield response

    def get_agent_response(self, config: RunnableConfig) -> dict[str, Any]:
        """Get the agent's response."""
        debug_print(f"Fetching agent response with config: {config}")
        logger.debug(f"Getting agent response with config: {config}")
        current_state = self.graph.get_state(config)
        debug_print(f"Current state: {current_state}")
        logger.debug(f"Current graph state: {current_state}")

        structured_response = current_state.values.get('structured_response')
        debug_print(f"Structured response: {structured_response}")
        logger.debug(f"Structured response: {structured_response}")
        if structured_response and isinstance(
            structured_response, ResponseFormat
        ):
            debug_print("Structured response is a valid ResponseFormat")
            if structured_response.status in {'input_required', 'error'}:
                debug_print("Status is input_required or error")
                logger.debug(f"Returning {structured_response.status} response")
                return {
                    'is_task_complete': False,
                    'require_user_input': True,
                    'content': structured_response.message,
                }
            if structured_response.status == 'completed':
                debug_print("Status is completed")
                logger.debug("Returning completed response")
                return {
                    'is_task_complete': True,
                    'require_user_input': False,
                    'content': structured_response.message,
                }

        debug_print("Unable to process request, returning fallback response")
        logger.warning("Unable to process request, returning fallback response")
        return {
            'is_task_complete': False,
            'require_user_input': True,
            'content': 'We are unable to process your request at the moment. Please try again.',
        }

    SUPPORTED_CONTENT_TYPES = ['text', 'text/plain']