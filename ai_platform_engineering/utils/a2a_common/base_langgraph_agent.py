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

# Reduce verbosity of third-party libraries
# Set this early before any imports use these loggers
for log_name in ["httpx", "mcp.server.streamable_http", "mcp.server.streamable_http_manager",
                  "mcp.client", "mcp.client.streamable_http", "sse_starlette.sse"]:
    logging.getLogger(log_name).setLevel(logging.WARNING)
    logging.getLogger(log_name).propagate = False

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
        # Store tool metadata for debugging and reference
        self.tools_info = {}

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

    def get_mcp_config(self, server_path: str) -> Dict[str, Any]:
        """
        Return the MCP server configuration for stdio mode.

        Override this method if your agent uses stdio mode (local MCP server).
        Not required if agent only uses HTTP mode (via get_mcp_http_config).

        Args:
            server_path: Path to the MCP server script

        Returns:
            Dictionary with MCP configuration for MultiServerMCPClient
        """
        raise NotImplementedError(
            f"{self.get_agent_name()} agent must implement get_mcp_config() for stdio mode, "
            "or use HTTP mode with get_mcp_http_config()"
        )

    def get_mcp_http_config(self) -> Dict[str, Any] | None:
        """
        Return custom HTTP MCP configuration (optional).

        Override this method to provide custom HTTP endpoint and headers.
        If this returns a dictionary, it will be used instead of the default
        HTTP configuration (localhost:3000).

        Returns:
            Dictionary with HTTP MCP configuration, or None to use defaults:
            {
                "url": "https://your-mcp-endpoint.com/mcp",
                "headers": {
                    "Authorization": "Bearer <token>",
                    ...
                }
            }
        """
        return None

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

        # Display initialization banner
        logger.debug("=" * 50)
        logger.debug(f"🔧 INITIALIZING {agent_name.upper()} AGENT")
        logger.debug("=" * 50)
        logger.debug(f"📡 Launching MCP server at: {server_path}")

        # Get MCP mode from environment
        mcp_mode = os.getenv("MCP_MODE", "stdio").lower()
        client = None

        if mcp_mode == "http" or mcp_mode == "streamable_http":
            logging.info(f"{agent_name}: Using HTTP transport for MCP client")

            # Check if agent provides custom HTTP configuration
            custom_http_config = self.get_mcp_http_config()

            if custom_http_config:
                # Use custom HTTP configuration (e.g., GitHub Copilot API)
                logging.info(f"Using custom HTTP MCP configuration for {agent_name}")
                client = MultiServerMCPClient({
                    agent_name: {
                        "transport": "streamable_http",
                        **custom_http_config  # Spread custom config (url, headers, etc.)
                    }
                })
            else:
                # Use default HTTP configuration (localhost)
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

        # Display detailed tool information for debugging
        logger.debug('*' * 50)
        logger.debug(f"🔧 AVAILABLE {agent_name.upper()} TOOLS AND PARAMETERS")
        logger.debug('*' * 80)
        for tool in tools:
            logger.debug(f"📋 Tool: {tool.name}")
            logger.debug(f"📝 Description: {tool.description.strip()}")

            # Store tool info for later reference
            self.tools_info[tool.name] = {
                'description': tool.description.strip(),
                'parameters': tool.args_schema.get('properties', {}),
                'required': tool.args_schema.get('required', [])
            }

            params = tool.args_schema.get('properties', {})
            required_params = tool.args_schema.get('required', [])

            if params:
                logger.debug("📥 Parameters:")
                for param, meta in params.items():
                    param_type = meta.get('type', 'unknown')
                    param_title = meta.get('title', param)
                    param_description = meta.get('description', 'No description available')
                    default = meta.get('default', None)
                    is_required = param in required_params

                    # Determine requirement status
                    req_status = "🔴 REQUIRED" if is_required else "🟡 OPTIONAL"

                    logger.debug(f"   • {param} ({param_type}) - {req_status}")
                    logger.debug(f"     Title: {param_title}")
                    logger.debug(f"     Description: {param_description}")

                    if default is not None:
                        logger.debug(f"     Default: {default}")

                    # Show examples if available
                    if 'examples' in meta:
                        examples = meta['examples']
                        if examples:
                            logger.debug(f"     Examples: {examples}")

                    # Show enum values if available
                    if 'enum' in meta:
                        enum_values = meta['enum']
                        logger.debug(f"     Allowed values: {enum_values}")

                    logger.debug("")
            else:
                logger.debug("📥 Parameters: None")
            logger.debug("-" * 60)
        logger.debug('*'*80)

        # Create the react agent graph
        logger.debug(f"🔧 Creating {agent_name} agent graph with {len(tools)} tools...")

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

        logger.info(f"✅ {agent_name} agent initialized with {len(tools)} tools")

        if ai_content:
            logger.debug("=" * 50)
            logger.debug(f"Agent {agent_name.upper()} Capabilities:")
            logger.debug(ai_content)
            logger.debug("=" * 50)
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

        # Track which messages we've already processed to avoid duplicates
        # stream_mode='values' returns the full message list at each step,
        # so we need to track the index to only process new messages
        seen_tool_calls = set()
        processed_message_count = 0

        # Stream using 'values' mode to get full state at each step
        # This returns dicts with 'messages' key containing the message list
        async for state in self.graph.astream(inputs, config, stream_mode='values'):
            # Extract messages from the state
            if not isinstance(state, dict) or 'messages' not in state:
                continue

            messages = state.get('messages', [])
            if not messages:
                continue

            # Only process new messages we haven't seen yet
            new_messages = messages[processed_message_count:]
            if not new_messages:
                continue

            # Update the count of processed messages
            processed_message_count = len(messages)

            # Process each new message
            for message in new_messages:
                logger.info(f"📨 Received message type: {type(message).__name__}")
                if hasattr(message, 'content'):
                    logger.info(f"📝 Content: {str(message.content)[:200]}")
                debug_print(f"Streamed message: {message}", banner=False)

                # Skip HumanMessage - we don't want to echo the user's query back
                if isinstance(message, HumanMessage):
                    continue

                if (
                    isinstance(message, AIMessage)
                    and getattr(message, "tool_calls", None)
                    and len(message.tool_calls) > 0
                ):
                    # Agent is calling tools - provide detailed information
                    for tool_call in message.tool_calls:
                        tool_id = tool_call.get("id", "")
                        tool_name = tool_call.get("name", "unknown")
                        tool_args = tool_call.get("args", {})

                        # Avoid duplicate tool call messages
                        if tool_id and tool_id in seen_tool_calls:
                            continue
                        if tool_id:
                            seen_tool_calls.add(tool_id)

                        # Yield detailed tool call message
                        yield {
                            'is_task_complete': False,
                            'require_user_input': False,
                            'content': f"🔧 Calling tool: **{tool_name}**",
                        }

                elif isinstance(message, ToolMessage):
                    # Agent is processing tool results - show tool name and success/failure
                    tool_name = getattr(message, "name", "unknown")
                    tool_content = getattr(message, "content", "")

                    # Check if tool execution was successful
                    is_error = False
                    if hasattr(message, "status"):
                        is_error = getattr(message, "status", "") == "error"
                    elif "error" in str(tool_content).lower()[:100]:
                        is_error = True

                    icon = "❌" if is_error else "✅"
                    status = "failed" if is_error else "completed"

                    # Yield detailed tool result message
                    yield {
                        'is_task_complete': False,
                        'require_user_input': False,
                        'content': f"{icon} Tool **{tool_name}** {status}",
                    }

                else:
                    # Regular message content (reasoning, thinking, or final response)
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

        # Yield task completion marker
        yield {
            'is_task_complete': True,
            'require_user_input': False,
            'content': '',
        }



