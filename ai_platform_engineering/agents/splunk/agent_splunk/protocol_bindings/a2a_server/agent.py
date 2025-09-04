# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""Splunk Agent implementation using LangGraph and MCP tools."""

import logging
import os
import importlib.util
from pathlib import Path
from typing import Any, AsyncIterable

from pydantic import BaseModel
from langgraph.prebuilt import create_react_agent
from langgraph.checkpoint.memory import MemorySaver
from langchain_mcp_adapters.client import MultiServerMCPClient
from langchain_core.runnables import RunnableConfig

from cnoe_agent_utils import LLMFactory
from cnoe_agent_utils.tracing import TracingManager, trace_agent_stream

logger = logging.getLogger(__name__)

def debug_print(message: str, banner: bool = True):
    if os.getenv("A2A_SERVER_DEBUG", "false").lower() == "true":
        if banner:
            print("=" * 80)
        print(f"DEBUG: {message}")
        if banner:
            print("=" * 80)

class ResponseFormat(BaseModel):
    """Response format for the agent."""
    status: str  # completed, input_required, error
    message: str

class SplunkAgent:
    """Splunk Agent."""

    SYSTEM_INSTRUCTION = """You are a helpful assistant that can interact with Splunk.
    You can use the Splunk API to search logs, manage alerts, get system status, and perform various operations.
    You can search for data, create alerts, manage detectors, and work with teams and incidents."""

    RESPONSE_FORMAT_INSTRUCTION = """Select status as completed if the request is complete.
    Select status as input_required if the input is a question to the user.
    Set response status to error if the input indicates an error."""

    def __init__(self):
        logger.info("Initializing SplunkAgent")
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

        server_path = "./mcp/mcp_splunk/server.py"
        print(f"Launching MCP server at: {server_path}")

        splunk_token = os.getenv("SPLUNK_TOKEN")
        if not splunk_token:
            logger.error("SPLUNK_TOKEN not set in environment")
            raise ValueError("SPLUNK_TOKEN must be set as an environment variable.")

        splunk_api_url = os.getenv("SPLUNK_API_URL")
        if not splunk_api_url:
            logger.error("SPLUNK_API_URL not set in environment")
            raise ValueError("SPLUNK_API_URL must be set as an environment variable.")
        
        client = None
        mcp_mode = os.getenv("MCP_MODE", "stdio").lower()
        if mcp_mode == "http" or mcp_mode == "streamable_http":
            mcp_host = os.getenv("MCP_HOST", "localhost")
            mcp_port = os.getenv("MCP_PORT", "8000")
            logger.info(f"Using HTTP MCP mode: {mcp_host}:{mcp_port}")
            # Use streamable_http as the transport for HTTP-based MCP connections
            transport_mode = "streamable_http" if mcp_mode == "http" else mcp_mode
            logger.info(f"MCP_MODE={mcp_mode}, using transport={transport_mode}")
            # TBD: Handle user authentication
            user_jwt = "TBD_USER_JWT"
            client = MultiServerMCPClient(
                {
                    "splunk": {
                        "transport": transport_mode,
                        "url": f"http://{mcp_host}:{mcp_port}/mcp/",
                        "headers": {
                            "Authorization": f"Bearer {user_jwt}",
                        },
                    }
                }
            )
        else:
            logger.info("Using stdio MCP mode")
            # Locate the generated MCP server module
            spec = importlib.util.find_spec("mcp_splunk.server")
            if not spec or not spec.origin:
                raise ImportError("Cannot find mcp_splunk.server module")
            server_path = str(Path(spec.origin).resolve())
            
            client = MultiServerMCPClient(
                {
                    "splunk": {
                        "command": "uv",
                        "args": ["run", server_path],
                        "env": {
                            "SPLUNK_API_URL": splunk_api_url,
                            "SPLUNK_TOKEN": splunk_token,
                        },
                        "transport": "stdio",
                    }
                }
            )

        try:
            logger.debug("Getting tools from MCP client")
            tools = await client.get_tools()
            logger.info(f"Retrieved {len(tools)} tools from MCP server")
            
            # Create the agent with tools
            memory = MemorySaver()
            self.graph = create_react_agent(
                self.model,
                tools=tools,
                checkpointer=memory,
                prompt=self.SYSTEM_INSTRUCTION,
            )
            logger.info("Agent graph created successfully")
            
        except Exception as e:
            logger.error(f"Failed to initialize agent: {e}")
            raise

    @trace_agent_stream("splunk")
    async def stream(
            self, query: str, context_id: str | None = None, trace_id: str = None
        ) -> AsyncIterable[dict[str, Any]]:
        """Stream responses from the agent."""
        debug_print(f"Streaming query: {query}")
        logger.info(f"Processing query: {query}")
        
        await self.initialize()
        
        config: RunnableConfig = {
            "configurable": {"thread_id": context_id or "default"},
            "metadata": {"trace_id": trace_id} if trace_id else {}
        }
        
        try:
            async for chunk in self.graph.astream(
                {"messages": [("user", query)]}, config, stream_mode="values"
            ):
                debug_print(f"Graph chunk: {chunk}")
                
                messages = chunk.get("messages", [])
                if messages:
                    last_message = messages[-1]
                    if hasattr(last_message, 'content') and last_message.content:
                        yield {
                            "is_task_complete": False,
                            "require_user_input": False,
                            "content": last_message.content,
                        }

        except Exception as e:
            logger.error(f"Error during streaming: {e}")
            yield {
                "is_task_complete": True,
                "require_user_input": False,
                "content": f"Error processing request: {str(e)}",
            }
            return

        yield self.get_agent_response(config)
        
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

        # Fallback: get the last message from the conversation
        messages = current_state.values.get('messages', [])
        if messages:
            last_message = messages[-1]
            if hasattr(last_message, 'content') and last_message.content:
                return {
                    'is_task_complete': True,
                    'require_user_input': False,
                    'content': last_message.content,
                }

        debug_print("Unable to process request, returning fallback response")
        logger.warning("Unable to process request, returning fallback response")
        return {
            'is_task_complete': False,
            'require_user_input': True,
            'content': 'We are unable to process your request at the moment. Please try again.',
        } 