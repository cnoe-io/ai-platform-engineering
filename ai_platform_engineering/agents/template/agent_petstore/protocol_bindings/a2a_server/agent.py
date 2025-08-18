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
    """Response format for the Petstore agent."""
    status: Literal['input_required', 'completed', 'error'] = 'input_required'
    message: str

class PetStoreAgent:
    """Petstore Agent."""

    SYSTEM_INSTRUCTION = """You are a helpful assistant that can interact with the Petstore API.\nYou can use the Petstore API to manage and query information about pets, store orders, and users.\nYou can perform actions like adding, updating, or deleting pets, placing orders, and managing user accounts."""

    RESPONSE_FORMAT_INSTRUCTION = """Select status as completed if the request is complete.\nSelect status as input_required if the input is a question to the user.\nSet response status to error if the input indicates an error."""

    def __init__(self):
        logger.info("Initializing PetStoreAgent")
        # Setup the agent and load MCP tools
        self.model = LLMFactory().get_llm()
        self.graph = None
        logger.debug("Agent initialized with model")

    async def initialize(self):
        """Initialize the agent with MCP tools."""
        logger.info("Starting agent initialization")
        if self.graph is not None:
            logger.debug("Graph already initialized, skipping")
            return

        server_path = "./agent_petstore/protocol_bindings/mcp_server/mcp_petstore/server.py"
        print(f"Launching MCP server at: {server_path}")

        mcp_api_key = os.getenv("MCP_API_KEY", "special-key")
        mcp_api_url = os.getenv("MCP_API_URL", "https://petstore.swagger.io/v2")

        client = MultiServerMCPClient(
            {
                "petstore": {
                    "command": "uv",
                    "args": ["run", server_path],
                    "env": {
                        "MCP_API_KEY": mcp_api_key,
                        "MCP_API_URL": mcp_api_url
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
                    'content': 'Looking up Petstore information...',
                }
            elif isinstance(message, ToolMessage):
                logger.debug(f"Processing tool message: {message}")
                yield {
                    'is_task_complete': False,
                    'require_user_input': False,
                    'content': 'Processing Petstore data...',
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