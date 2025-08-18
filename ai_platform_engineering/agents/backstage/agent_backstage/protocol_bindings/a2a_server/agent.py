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
from cnoe_agent_utils.tracing import TracingManager, trace_agent_stream

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
    """Response format for the Backstage agent."""
    status: Literal['input_required', 'completed', 'error'] = 'input_required'
    message: str

class BackstageAgent:
    """Backstage Agent."""

    SYSTEM_INSTRUCTION = """You are a helpful assistant that can interact with Backstage.
    You can use the Backstage API to manage and query information about services, components, APIs, and resources.
    You can perform actions like creating, updating, or deleting catalog entities, managing documentation, and handling plugin configurations."""

    RESPONSE_FORMAT_INSTRUCTION = """Select status as completed if the request is complete.
    Select status as input_required if the input is a question to the user.
    Set response status to error if the input indicates an error."""

    def __init__(self):
        logger.info("Initializing BackstageAgent")
        # Setup the agent and load MCP tools
        self.model = LLMFactory().get_llm()
        self.tracing = TracingManager()
        self.graph = None
        logger.debug("Agent initialized with model")

    async def initialize(self):
        """Initialize the agent with MCP tools."""
        logger.info("Starting agent initialization")
        if self.graph is not None:
            logger.debug("Graph already initialized, skipping")
            return

        server_path = "./mcp/mcp_backstage/server.py"
        print(f"Launching MCP server at: {server_path}")

        backstage_api_token = os.getenv("BACKSTAGE_API_TOKEN")
        if not backstage_api_token:
            logger.error("BACKSTAGE_API_TOKEN not set in environment")
            raise ValueError("BACKSTAGE_API_TOKEN must be set as an environment variable.")

        backstage_url = os.getenv("BACKSTAGE_URL")
        if not backstage_url:
            logger.error("BACKSTAGE_URL not set in environment")
            raise ValueError("BACKSTAGE_URL must be set as an environment variable.")

        client = None
        mcp_mode = os.getenv("MCP_MODE", "stdio").lower()
        if mcp_mode == "http" or mcp_mode == "streamable_http":
          logging.info("Using HTTP transport for MCP client")
          # For HTTP transport, we need to connect to the MCP server
          # This is useful for production or when the MCP server is running separately
          # Ensure MCP_HOST and MCP_PORT are set in the environment
          mcp_host = os.getenv("MCP_HOST", "localhost")
          mcp_port = os.getenv("MCP_PORT", "3000")
          logging.info(f"Connecting to MCP server at {mcp_host}:{mcp_port}")
          # TBD: Handle user authentication
          user_jwt = "TBD_USER_JWT"

          client = MultiServerMCPClient(
            {
              "backstage": {
                "transport": "streamable_http",
                "url": f"http://{mcp_host}:{mcp_port}/mcp/",
                "headers": {
                  "Authorization": f"Bearer {user_jwt}",
                },
              }
            }
          )
        else:
          logging.info("Using STDIO transport for MCP client")
          # For STDIO transport, we can use a simple client without URL
          # This is useful for local development or testing
          client = MultiServerMCPClient(
              {
                  "backstage": {
                      "command": "uv",
                      "args": ["run", server_path],
                      "env": {
                          "BACKSTAGE_API_TOKEN": backstage_api_token,
                          "BACKSTAGE_URL": backstage_url
                      },
                      "transport": "stdio",
                  }
              }
          )

        tools = await client.get_tools()
        # print('*'*80)
        # print("Available Tools and Parameters:")
        # for tool in tools:
        #     print(f"Tool: {tool.name}")
        #     print(f"  Description: {tool.description.strip().splitlines()[0]}")
        #     params = tool.args_schema.get('properties', {})
        #     if params:
        #         print("  Parameters:")
        #         for param, meta in params.items():
        #             param_type = meta.get('type', 'unknown')
        #             param_title = meta.get('title', param)
        #             default = meta.get('default', None)
        #             print(f"    - {param} ({param_type}): {param_title}", end='')
        #             if default is not None:
        #                 print(f" [default: {default}]")
        #             else:
        #                 print()
        #     else:
        #         print("  Parameters: None")
        #     print()
        # print('*'*80)

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

    @trace_agent_stream("backstage")
    async def stream(
        self, query: str, context_id: str | None = None, trace_id: str = None
    ) -> AsyncIterable[dict[str, Any]]:
        """Stream responses for a given query."""
        # Use the context_id as the thread_id, or generate a new one if none provided
        thread_id = context_id or uuid.uuid4().hex
        logger.info(f"Stream started - Query: {query}, Thread ID: {thread_id}, Context ID: {context_id}")
        debug_print(f"Starting stream with query: {query} using thread ID: {thread_id}")

        # Initialize agent if needed
        await self.initialize()

        inputs: dict[str, Any] = {'messages': [('user', query)]}
        config: RunnableConfig = self.tracing.create_config(thread_id)
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
                    'content': 'Looking up Backstage information...',
                }
            elif isinstance(message, ToolMessage):
                logger.debug(f"Processing tool message: {message}")
                yield {
                    'is_task_complete': False,
                    'require_user_input': False,
                    'content': 'Processing Backstage data...',
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
