# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Base agent class providing common A2A functionality with streaming support."""

import logging
import os
from abc import ABC, abstractmethod
from collections.abc import AsyncIterable
from typing import Any, Dict

from langchain_mcp_adapters.client import MultiServerMCPClient
from langchain_core.messages import AIMessage, ToolMessage, HumanMessage
from langchain_core.runnables.config import RunnableConfig
from cnoe_agent_utils import LLMFactory
from cnoe_agent_utils.tracing import TracingManager, trace_agent_stream
from pydantic import BaseModel

from langgraph.checkpoint.memory import MemorySaver
from langgraph.prebuilt import create_react_agent


logger = logging.getLogger(__name__)

def debug_print(message: str, banner: bool = True):
    """Print debug messages if ACP_SERVER_DEBUG is enabled."""
    if os.getenv("ACP_SERVER_DEBUG", "false").lower() == "true":
        if banner:
            print("=" * 80)
        print(f"DEBUG: {message}")
        if banner:
            print("=" * 80)

memory = MemorySaver()


class BaseLangGraphAgent(ABC):
    """
    Abstract base class for LangGraph-based A2A agents with streaming support.

    Provides common functionality for:
    - LLM initialization
    - Tracing setup
    - MCP client configuration
    - Streaming responses
    - Agent execution

    Subclasses must implement:
    - get_agent_name() - Return the agent's name
    - get_system_instruction() - Return the system prompt
    - get_response_format_instruction() - Return response format guidance
    - get_response_format_class() - Return the Pydantic response format model
    - get_mcp_config() - Return MCP server configuration
    - get_tool_working_message() - Return message shown while using tools
    - get_tool_processing_message() - Return message shown while processing tool results
    """

    def __init__(self):
        """Initialize the agent with LLM, tracing, and graph setup."""
        self.model = LLMFactory().get_llm()
        self.tracing = TracingManager()
        self.graph = None

    @abstractmethod
    def get_agent_name(self) -> str:
        """Return the agent's name for logging and tracing."""
        pass

    @abstractmethod
    def get_system_instruction(self) -> str:
        """Return the system instruction/prompt for the agent."""
        pass

    @abstractmethod
    def get_response_format_instruction(self) -> str:
        """Return the instruction for response format."""
        pass

    @abstractmethod
    def get_response_format_class(self) -> type[BaseModel]:
        """Return the Pydantic model class for structured responses."""
        pass

    @abstractmethod
    def get_mcp_config(self, server_path: str) -> Dict[str, Any]:
        """
        Return the MCP server configuration.

        Args:
            server_path: Path to the MCP server script

        Returns:
            Dictionary with MCP configuration for MultiServerMCPClient
        """
        pass

    @abstractmethod
    def get_tool_working_message(self) -> str:
        """Return message to show when agent is calling tools."""
        pass

    @abstractmethod
    def get_tool_processing_message(self) -> str:
        """Return message to show when agent is processing tool results."""
        pass

    async def _setup_mcp_and_graph(self, config: RunnableConfig) -> None:
        """
        Setup MCP client and create the agent graph.

        Args:
            config: Runnable configuration with server_path
        """
        args = config.get("configurable", {})
        server_path = args.get("server_path", f"./mcp/mcp_{self.get_agent_name()}/server.py")
        agent_name = self.get_agent_name()

        print(f"Launching MCP server for {agent_name} at: {server_path}")

        # Get MCP mode from environment
        mcp_mode = os.getenv("MCP_MODE", "stdio").lower()
        client = None

        if mcp_mode == "http" or mcp_mode == "streamable_http":
            logging.info(f"{agent_name}: Using HTTP transport for MCP client")
            mcp_host = os.getenv("MCP_HOST", "localhost")
            mcp_port = os.getenv("MCP_PORT", "3000")
            logging.info(f"Connecting to MCP server at {mcp_host}:{mcp_port}")

            # TBD: Handle user authentication
            user_jwt = "TBD_USER_JWT"

            client = MultiServerMCPClient({
                agent_name: {
                    "transport": "streamable_http",
                    "url": f"http://{mcp_host}:{mcp_port}/mcp/",
                    "headers": {
                        "Authorization": f"Bearer {user_jwt}",
                    },
                }
            })
        else:
            logging.info(f"{agent_name}: Using STDIO transport for MCP client")
            client = MultiServerMCPClient({
                agent_name: self.get_mcp_config(server_path)
            })

        # Get tools from MCP client
        tools = await client.get_tools()

        # Create the react agent graph
        self.graph = create_react_agent(
            self.model,
            tools,
            checkpointer=memory,
            prompt=self.get_system_instruction(),
            response_format=(
                self.get_response_format_instruction(),
                self.get_response_format_class()
            ),
        )

        # Initialize with a capabilities summary
        runnable_config = RunnableConfig(configurable={"thread_id": "test-thread"})
        llm_result = await self.graph.ainvoke(
            {"messages": HumanMessage(content="Summarize what you can do?")},
            config=runnable_config
        )

        # Extract meaningful content from LLM result
        ai_content = None
        for msg in reversed(llm_result.get("messages", [])):
            if hasattr(msg, "type") and msg.type in ("ai", "assistant") and getattr(msg, "content", None):
                ai_content = msg.content
                break
            elif isinstance(msg, dict) and msg.get("type") in ("ai", "assistant") and msg.get("content"):
                ai_content = msg["content"]
                break

        # Fallback: check tool_call_results
        if not ai_content and "tool_call_results" in llm_result:
            ai_content = "\n".join(
                str(r.get("content", r)) for r in llm_result["tool_call_results"]
            )

        if ai_content:
            print(f"{agent_name} initialized successfully")
            debug_print(f"Agent MCP Capabilities: {ai_content}")
        else:
            logger.warning(f"No assistant content found in LLM result for {agent_name}")

    async def _ensure_graph_initialized(self, config: RunnableConfig) -> None:
        """Ensure the graph is initialized before use."""
        if self.graph is None:
            await self._setup_mcp_and_graph(config)

    @trace_agent_stream("base")  # Subclasses should override the agent name
    async def stream(
        self, query: str, sessionId: str, trace_id: str = None
    ) -> AsyncIterable[dict[str, Any]]:
        """
        Stream responses from the agent.

        Args:
            query: User query to process
            sessionId: Session identifier for checkpointing
            trace_id: Optional trace ID for distributed tracing

        Yields:
            Dictionary with:
            - is_task_complete: bool
            - require_user_input: bool
            - content: str
        """
        agent_name = self.get_agent_name()
        debug_print(f"Starting stream for {agent_name} with query: {query}", banner=True)

        inputs: dict[str, Any] = {'messages': [('user', query)]}
        config: RunnableConfig = self.tracing.create_config(sessionId)

        # Ensure graph is initialized
        await self._ensure_graph_initialized(config)

        # Stream messages from the agent
        async for message in self.graph.astream(inputs, config, stream_mode='messages'):
            debug_print(f"Streamed message chunk: {message}", banner=False)

            if (
                isinstance(message, AIMessage)
                and getattr(message, "tool_calls", None)
                and len(message.tool_calls) > 0
            ):
                # Agent is calling tools
                yield {
                    'is_task_complete': False,
                    'require_user_input': False,
                    'content': self.get_tool_working_message(),
                }
            elif isinstance(message, ToolMessage):
                # Agent is processing tool results
                yield {
                    'is_task_complete': False,
                    'require_user_input': False,
                    'content': self.get_tool_processing_message(),
                }
            else:
                # Regular message content
                content_text = None
                if hasattr(message, "content"):
                    content_text = getattr(message, "content", None)
                elif isinstance(message, str):
                    content_text = message

                if content_text:
                    yield {
                        'is_task_complete': False,
                        'require_user_input': False,
                        'content': str(content_text),
                    }

        # Yield final response
        yield self.get_agent_response(config)

    def get_agent_response(self, config: RunnableConfig) -> dict[str, Any]:
        """
        Get the final structured response from the agent.

        Args:
            config: Runnable configuration

        Returns:
            Dictionary with is_task_complete, require_user_input, and content
        """
        debug_print(f"Fetching agent response with config: {config}", banner=False)
        current_state = self.graph.get_state(config)
        debug_print(f"Current state: {current_state}", banner=False)

        structured_response = current_state.values.get('structured_response')
        debug_print(f"Structured response: {structured_response}", banner=False)

        ResponseFormat = self.get_response_format_class()

        if structured_response and isinstance(structured_response, ResponseFormat):
            debug_print("Structured response is valid", banner=False)

            if structured_response.status in {'input_required', 'error'}:
                debug_print("Status is input_required or error", banner=False)
                return {
                    'is_task_complete': False,
                    'require_user_input': True,
                    'content': structured_response.message,
                }

            if structured_response.status == 'completed':
                debug_print("Status is completed", banner=False)
                return {
                    'is_task_complete': True,
                    'require_user_input': False,
                    'content': structured_response.message,
                }

        logger.warning(f"Unable to process request for {self.get_agent_name()}, returning fallback")
        return {
            'is_task_complete': False,
            'require_user_input': True,
            'content': 'We are unable to process your request at the moment. Please try again.',
        }



