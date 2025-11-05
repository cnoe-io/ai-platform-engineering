# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Base agent class providing common A2A functionality with streaming support."""

import asyncio
import json
import logging
import os
from abc import ABC, abstractmethod
from collections.abc import AsyncIterable
from typing import Any, Dict

# Make MCP optional - some agents (like RAG) don't use MCP
try:
    from langchain_mcp_adapters.client import MultiServerMCPClient
    MCP_AVAILABLE = True
except ImportError:
    MultiServerMCPClient = None
    MCP_AVAILABLE = False

from langchain_core.messages import AIMessage, AIMessageChunk, ToolMessage, HumanMessage, SystemMessage, RemoveMessage
from langchain_core.runnables.config import RunnableConfig
from cnoe_agent_utils import LLMFactory
from cnoe_agent_utils.tracing import TracingManager, trace_agent_stream
from pydantic import BaseModel
from datetime import datetime
from zoneinfo import ZoneInfo
import tiktoken

from langgraph.checkpoint.memory import MemorySaver
from langgraph.prebuilt import create_react_agent

from .context_config import get_context_limit_for_provider, get_min_messages_to_keep, is_auto_compression_enabled
from .tool_output_manager import get_tool_output_manager


logger = logging.getLogger(__name__)

if not MCP_AVAILABLE:
    logger.warning("langchain_mcp_adapters not available - MCP functionality will be disabled for agents using this base class")

# Reduce verbosity of third-party libraries
# Set this early before any imports use these loggers
for log_name in ["httpx", "mcp.server.streamable_http", "mcp.server.streamable_http_manager",
                  "mcp.client", "mcp.client.streamable_http", "sse_starlette.sse",
                  "uvicorn.access", "uvicorn.error"]:
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

        # Initialize tokenizer for context management
        try:
            self.tokenizer = tiktoken.encoding_for_model("gpt-4")
        except Exception:
            # Fallback to cl100k_base (used by GPT-4/3.5)
            self.tokenizer = tiktoken.get_encoding("cl100k_base")

        # Get context management configuration from global config
        llm_provider = os.getenv("LLM_PROVIDER", "azure-openai").lower()
        self.max_context_tokens = get_context_limit_for_provider(llm_provider)
        self.min_messages_to_keep = get_min_messages_to_keep()
        self.enable_auto_compression = is_auto_compression_enabled()

        logger.info(
            f"Context management initialized for provider={llm_provider}: "
            f"max_tokens={self.max_context_tokens:,}, "
            f"min_messages={self.min_messages_to_keep}, "
            f"auto_compression={self.enable_auto_compression}"
        )

    @abstractmethod
    def get_agent_name(self) -> str:
        """Return the agent's name for logging and tracing."""
        pass

    @abstractmethod
    def get_system_instruction(self) -> str:
        """Return the system instruction/prompt for the agent."""
        pass

    def _get_system_instruction_with_date(self) -> str:
        """
        Return the system instruction with current date/time injected.

        This method wraps get_system_instruction() and automatically prepends
        the current date and time, so agents always have temporal context.
        """
        # Get current date/time in UTC
        now_utc = datetime.now(ZoneInfo("UTC"))

        # Format date information
        date_context = f"""## Current Date and Time

Today's date: {now_utc.strftime("%A, %B %d, %Y")}
Current time: {now_utc.strftime("%H:%M:%S UTC")}
ISO format: {now_utc.isoformat()}

Use this as the reference point for all date calculations. When users say "today", "tomorrow", "yesterday", or other relative dates, calculate from this date.

"""

        # Combine with agent's system instruction
        return date_context + self.get_system_instruction()

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
        # Check if MCP is available
        if not MCP_AVAILABLE:
            raise RuntimeError(
                f"MCP functionality not available for {self.get_agent_name()} agent. "
                "Please install langchain_mcp_adapters or use an agent that doesn't require MCP."
            )

        args = config.get("configurable", {})
        server_path = args.get("server_path", f"./mcp/mcp_{self.get_agent_name()}/server.py")
        agent_name = self.get_agent_name()

        # Display initialization banner
        logger.info("=" * 50)
        logger.info(f"🔧 INITIALIZING {agent_name.upper()} AGENT")
        logger.info("=" * 50)
        logger.info(f"📡 Launching MCP server at: {server_path}")

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
            mcp_config = self.get_mcp_config(server_path)

            # Check if this is a multi-server config (dict of server configs)
            # vs a single server config (dict with "command", "args", etc.)
            if mcp_config and "command" not in mcp_config:
                # Multi-server configuration (e.g., AWS with multiple MCP servers)
                # The config already has the format: {"server1": {...}, "server2": {...}}
                logging.info(f"{agent_name}: Multi-server MCP configuration detected with {len(mcp_config)} servers")
                client = MultiServerMCPClient(mcp_config)
            else:
                # Single server configuration (e.g., ArgoCD, GitHub)
                # Wrap it with agent name as key
                client = MultiServerMCPClient({
                    agent_name: mcp_config
                })

        # Get tools from MCP client
        tools = await client.get_tools()

        # Wrap tools with output truncation to prevent context overflow
        tools = self._wrap_tools_with_truncation(tools, context_id)

        # Add virtual file management tools
        tools.extend(self._create_virtual_file_tools())

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
        logger.info(f"🔧 Creating {agent_name} agent graph with {len(tools)} tools...")

        self.graph = create_react_agent(
            self.model,
            tools,
            checkpointer=memory,
            prompt=self._get_system_instruction_with_date(),
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
            logger.info("=" * 50)
            logger.info(f"Agent {agent_name.upper()} Capabilities:")
            logger.info(ai_content)
            logger.info("=" * 50)
        else:
            logger.warning(f"No assistant content found in LLM result for {agent_name}")

    def _count_message_tokens(self, message: Any) -> int:
        """
        Count the number of tokens in a message.

        Args:
            message: A LangChain message object

        Returns:
            Approximate token count
        """
        try:
            content = ""
            if hasattr(message, "content"):
                content = str(message.content)
            elif isinstance(message, dict) and "content" in message:
                content = str(message["content"])

            # Add tokens for tool calls if present
            if hasattr(message, "tool_calls") and message.tool_calls:
                for tool_call in message.tool_calls:
                    content += str(tool_call)

            return len(self.tokenizer.encode(content))
        except Exception as e:
            logger.warning(f"Error counting tokens: {e}, returning estimate")
            # Rough estimate: 1 token ≈ 4 characters
            content_len = len(str(getattr(message, "content", "")))
            return content_len // 4

    def _count_total_tokens(self, messages: list) -> int:
        """
        Count total tokens across all messages.

        Args:
            messages: List of messages

        Returns:
            Total token count
        """
        return sum(self._count_message_tokens(msg) for msg in messages)

    def _wrap_tools_with_truncation(self, tools: list, context_id: str) -> list:
        """
        Wrap MCP tools to automatically truncate large outputs.

        This prevents context window overflow by detecting large tool outputs
        and storing them in virtual files while returning summaries.

        Args:
            tools: List of MCP tools from client.get_tools()
            context_id: Context ID for this conversation

        Returns:
            List of wrapped tools with truncation logic
        """
        from langchain_core.tools import Tool
        from functools import wraps

        agent_name = self.get_agent_name()
        tool_output_manager = get_tool_output_manager()
        wrapped_tools = []

        for tool in tools:
            original_func = tool.func if hasattr(tool, 'func') else tool._run

            @wraps(original_func)
            async def wrapped_tool_func(*args, original_tool=tool, original_func=original_func, **kwargs):
                """Wrapped tool function that truncates large outputs."""
                # Call the original tool
                if asyncio.iscoroutinefunction(original_func):
                    result = await original_func(*args, **kwargs)
                else:
                    result = original_func(*args, **kwargs)

                # Process the output (truncate if too large)
                processed = tool_output_manager.process_tool_output(
                    output=result,
                    tool_name=original_tool.name,
                    context_id=context_id,
                    agent_name=agent_name,
                )

                # If truncated, return summary + file_id
                # Otherwise, return original output
                if processed.get("truncated"):
                    return json.dumps(processed, indent=2)
                else:
                    return processed.get("output", result)

            # Create wrapped tool
            wrapped_tool = Tool(
                name=tool.name,
                description=tool.description,
                func=wrapped_tool_func,
                args_schema=tool.args_schema if hasattr(tool, 'args_schema') else None,
            )
            wrapped_tools.append(wrapped_tool)

        logger.info(f"{agent_name}: Wrapped {len(wrapped_tools)} tools with output truncation")
        return wrapped_tools

    def _create_virtual_file_tools(self) -> list:
        """
        Create LangChain tools for virtual file management.

        These tools allow agents to interact with large tool outputs
        stored in virtual memory.

        Returns:
            List of virtual file management tools
        """
        from langchain_core.tools import Tool

        tool_output_manager = get_tool_output_manager()

        tools = [
            Tool(
                name="grep_virtual_file",
                description=(
                    "Search for a pattern in a virtual file (like grep). "
                    "USE THIS FIRST for any search/filter questions! "
                    "Returns matching lines with line numbers. "
                    "Supports regex patterns. "
                    "Args: file_id (str), pattern (str), max_results (int, default 100), "
                    "case_sensitive (bool, default False)"
                ),
                func=lambda file_id, pattern, max_results=100, case_sensitive=False: (
                    tool_output_manager.grep_virtual_file(
                        file_id=file_id,
                        pattern=pattern,
                        max_results=max_results,
                        case_sensitive=case_sensitive,
                    )
                ),
            ),
            Tool(
                name="read_virtual_file",
                description=(
                    "Read a chunk from a virtual file with character-based pagination. "
                    "Use this for sequential browsing when grep won't work. "
                    "Returns content, pagination info, and whether more data exists. "
                    "Args: file_id (str), start_char (int, default 0), max_chars (int, default 10000)"
                ),
                func=lambda file_id, start_char=0, max_chars=10000: (
                    tool_output_manager.read_virtual_file(
                        file_id=file_id,
                        start_char=start_char,
                        max_chars=max_chars,
                    )
                ),
            ),
            Tool(
                name="list_virtual_files",
                description=(
                    "List all virtual files currently in memory. "
                    "Returns dict of {file_id: size_in_chars}. "
                    "Use this to see what large tool outputs are available. "
                    "No arguments required."
                ),
                func=lambda: tool_output_manager.list_virtual_files(),
            ),
        ]

        return tools

    async def _trim_messages_if_needed(self, config: RunnableConfig) -> None:
        """
        Trim old messages from the checkpointer if context is too large.

        Keeps:
        - System messages (always)
        - Recent N messages (configurable via MIN_MESSAGES_TO_KEEP)
        - Removes oldest messages in between

        Args:
            config: Runnable configuration with thread_id
        """
        if not self.enable_auto_compression:
            return

        agent_name = self.get_agent_name()

        try:
            # Get current state from checkpointer
            state = await self.graph.aget_state(config)
            if not state:
                logger.info(f"{agent_name}: No state found in checkpointer, skipping trim")
                return
            if not state.values:
                logger.info(f"{agent_name}: State has no values, skipping trim")
                return
            if "messages" not in state.values:
                logger.info(f"{agent_name}: No messages in state, skipping trim")
                return

            messages = state.values["messages"]
            if not messages:
                logger.info(f"{agent_name}: Messages list is empty, skipping trim")
                return

            # Count current tokens
            logger.info(f"{agent_name}: Found {len(messages)} messages in state, counting tokens...")
            total_tokens = self._count_total_tokens(messages)
            logger.info(f"{agent_name}: Total tokens: {total_tokens:,} (limit: {self.max_context_tokens:,})")

            if total_tokens <= self.max_context_tokens:
                logger.info(f"{agent_name}: ✅ Context size OK ({total_tokens:,} tokens)")
                return

            logger.warning(
                f"{agent_name}: Context too large ({total_tokens} tokens > {self.max_context_tokens}). "
                f"Trimming old messages..."
            )

            # Separate system messages from conversation messages
            system_messages = []
            conversation_messages = []

            for msg in messages:
                if isinstance(msg, SystemMessage) or (
                    isinstance(msg, dict) and msg.get("type") == "system"
                ):
                    system_messages.append(msg)
                else:
                    conversation_messages.append(msg)

            # Keep recent N messages
            messages_to_keep = conversation_messages[-self.min_messages_to_keep:]
            messages_to_remove = conversation_messages[:-self.min_messages_to_keep]

            # Calculate tokens after trimming
            kept_tokens = (
                self._count_total_tokens(system_messages) +
                self._count_total_tokens(messages_to_keep)
            )

            # If still too large, trim more aggressively
            while kept_tokens > self.max_context_tokens and len(messages_to_keep) > 2:
                # Remove the oldest message from kept messages
                removed = messages_to_keep.pop(0)
                messages_to_remove.append(removed)
                kept_tokens = (
                    self._count_total_tokens(system_messages) +
                    self._count_total_tokens(messages_to_keep)
                )

            if not messages_to_remove:
                logger.warning(f"{agent_name}: Cannot trim further without breaking conversation")
                return

            # Create RemoveMessage commands for messages to delete
            remove_commands = []
            for msg in messages_to_remove:
                msg_id = msg.id if hasattr(msg, "id") else msg.get("id")
                if msg_id:
                    remove_commands.append(RemoveMessage(id=msg_id))

            if remove_commands:
                # Update the graph state to remove old messages
                await self.graph.aupdate_state(
                    config,
                    {"messages": remove_commands}
                )

                removed_tokens = self._count_total_tokens(messages_to_remove)
                logger.info(
                    f"{agent_name}: ✂️ Trimmed {len(messages_to_remove)} messages "
                    f"({removed_tokens} tokens). Kept {len(messages_to_keep)} messages "
                    f"({kept_tokens} tokens)"
                )

        except Exception as e:
            logger.error(
                f"{agent_name}: Error trimming messages: {e}",
                exc_info=True,
                extra={"exception_type": type(e).__name__}
            )
            # Don't fail the request if trimming fails - just log and continue
            logger.warning(f"{agent_name}: Continuing without message trimming due to error")

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

        configurable = dict(config.get("configurable", {})) if isinstance(config.get("configurable", {}), dict) else {}
        if sessionId and "thread_id" not in configurable:
            configurable["thread_id"] = sessionId

        config = RunnableConfig(
            callbacks=config.get("callbacks"),
            tags=config.get("tags"),
            metadata=config.get("metadata"),
            configurable=configurable,
        )

        # Ensure graph is initialized
        await self._ensure_graph_initialized(config)

        # Auto-trim old messages to prevent context overflow
        await self._trim_messages_if_needed(config)

        # Track which messages we've already processed to avoid duplicates
        seen_tool_calls = set()

        # Check if token-by-token streaming is enabled (default: false for backward compatibility)
        enable_streaming = os.getenv("ENABLE_STREAMING", "true").lower() == "true"

        if enable_streaming:
            # Token-by-token streaming mode using 'messages' and 'custom' (for writer() events from tools)
            logger.info(f"{agent_name}: Token-by-token streaming ENABLED")
            processed_message_count = 0
            async for item_type, item in self.graph.astream(inputs, config, stream_mode=['messages', 'custom']):
                # Process message stream
                if item_type == 'custom':
                    # Handle custom events from writer() (e.g., sub-agent streaming)
                    logger.info(f"{agent_name}: Received custom event from writer(): {item}")
                    # Yield custom events as-is for the executor to handle
                    yield item
                    continue

                if item_type != 'messages':
                    continue

                message = item[0] if item else None
                if not message:
                    continue

                logger.debug(f"📨 Received message type: {type(message).__name__}")

                # Skip HumanMessage
                if isinstance(message, HumanMessage):
                    continue

                # Handle AIMessageChunk for token-by-token streaming
                if isinstance(message, AIMessageChunk):
                    # Check for tool calls
                    if hasattr(message, "tool_calls") and message.tool_calls:
                        for tool_call in message.tool_calls:
                            tool_name = tool_call.get("name", "")
                            tool_id = tool_call.get("id", "")

                            if not tool_name or not tool_name.strip():
                                continue

                            if tool_id and tool_id in seen_tool_calls:
                                continue
                            if tool_id:
                                seen_tool_calls.add(tool_id)

                            agent_name_formatted = self.get_agent_name().title()
                            tool_name_formatted = tool_name.title()
                            yield {
                                'is_task_complete': False,
                                'require_user_input': False,
                                'tool_call': {
                                    'id': tool_id or tool_name_formatted,
                                    'name': tool_name,
                                },
                                'kind': 'tool_call',
                                'content': f"🔧 {agent_name_formatted}: Calling tool: {tool_name_formatted}\n",
                            }
                        continue

                    # Stream token content
                    if message.content:
                        yield {
                            'is_task_complete': False,
                            'require_user_input': False,
                            'kind': 'text_chunk',
                            'content': str(message.content),
                        }
                    continue

                # Handle ToolMessage
                if isinstance(message, ToolMessage):
                    tool_name = getattr(message, "name", "unknown")
                    tool_content = getattr(message, "content", "")
                    is_error = False
                    if hasattr(message, "status"):
                        is_error = getattr(message, "status", "") == "error"
                    elif "error" in str(tool_content).lower()[:100]:
                        is_error = True

                    icon = "❌" if is_error else "✅"
                    status = "failed" if is_error else "completed"

                    agent_name_formatted = self.get_agent_name().title()
                    tool_name_formatted = tool_name.title()
                    yield {
                        'is_task_complete': False,
                        'require_user_input': False,
                        'tool_result': {
                            'name': tool_name,
                            'status': status,
                            'is_error': is_error,
                        },
                        'kind': 'tool_result',
                        'content': f"{icon} {agent_name_formatted}: Tool {tool_name_formatted} {status}\n",
                    }

                    # Stream intermediate tool output if enabled
                    stream_tool_output = os.getenv("STREAM_TOOL_OUTPUT", "false").lower() == "true"
                    if stream_tool_output and tool_content:
                        # Format tool output for readability
                        tool_output_preview = str(tool_content)

                        # Limit output size to avoid overwhelming the stream
                        max_output_length = int(os.getenv("MAX_TOOL_OUTPUT_LENGTH", "2000"))
                        if len(tool_output_preview) > max_output_length:
                            tool_output_preview = tool_output_preview[:max_output_length] + "...\n[Output truncated]"

                        yield {
                            'is_task_complete': False,
                            'require_user_input': False,
                            'kind': 'tool_output',
                            'content': f"📄 {agent_name_formatted}: Tool output:\n{tool_output_preview}\n\n",
                        }
                    continue

                if isinstance(message, AIMessage):
                    # Surface any tool calls contained on the final AI message as well
                    if getattr(message, "tool_calls", None):
                        for tool_call in message.tool_calls:
                            tool_id = tool_call.get("id", "")
                            tool_name = tool_call.get("name", "unknown")

                            if tool_id and tool_id in seen_tool_calls:
                                continue
                            if tool_id:
                                seen_tool_calls.add(tool_id)

                            agent_name_formatted = self.get_agent_name().title()
                            tool_name_formatted = tool_name.title()
                            yield {
                                'is_task_complete': False,
                                'require_user_input': False,
                                'tool_call': {
                                    'id': tool_id or tool_name_formatted,
                                    'name': tool_name,
                                },
                                'kind': 'tool_call',
                                'content': f"🔧 {agent_name_formatted}: Calling tool: {tool_name_formatted}\n",
                            }

                    content_text = ""
                    if isinstance(message.content, str):
                        content_text = message.content
                    elif isinstance(message.content, list):
                        parts: list[str] = []
                        for part in message.content:
                            if isinstance(part, dict):
                                part_text = part.get("text") or part.get("content")
                                if part_text:
                                    parts.append(part_text)
                            elif hasattr(part, "text"):
                                part_text = getattr(part, "text", "")
                                if part_text:
                                    parts.append(part_text)
                            elif isinstance(part, str):
                                parts.append(part)
                        content_text = "".join(parts)
                    elif message.content is not None:
                        content_text = str(message.content)

                    if content_text:
                        yield {
                            'is_task_complete': False,
                            'require_user_input': False,
                            'kind': 'text_chunk',
                            'content': content_text,
                        }
                    continue

        else:
            # Full message mode using 'values' (current behavior)
            logger.info(f"{agent_name}: Token-by-token streaming DISABLED, using full message mode")
            processed_message_count = 0
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

                            # Avoid duplicate tool call messages
                            if tool_id and tool_id in seen_tool_calls:
                                continue
                            if tool_id:
                                seen_tool_calls.add(tool_id)

                            # Yield detailed tool call message with formatted names
                            agent_name_formatted = self.get_agent_name().title()
                            tool_name_formatted = tool_name.title()
                            yield {
                                'is_task_complete': False,
                                'require_user_input': False,
                                'content': f"🔧 {agent_name_formatted}: Calling tool: {tool_name_formatted}\n",
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

                        # Yield detailed tool result message with formatted names
                        agent_name_formatted = self.get_agent_name().title()
                        tool_name_formatted = tool_name.title()
                        yield {
                            'is_task_complete': False,
                            'require_user_input': False,
                            'content': f"{icon} {agent_name_formatted}: Tool {tool_name_formatted} {status}\n",
                        }

                        # Stream intermediate tool output if enabled
                        stream_tool_output = os.getenv("STREAM_TOOL_OUTPUT", "false").lower() == "true"
                        if stream_tool_output and tool_content:
                            # Format tool output for readability
                            tool_output_preview = str(tool_content)

                            # Limit output size to avoid overwhelming the stream
                            max_output_length = int(os.getenv("MAX_TOOL_OUTPUT_LENGTH", "2000"))
                            if len(tool_output_preview) > max_output_length:
                                tool_output_preview = tool_output_preview[:max_output_length] + "...\n[Output truncated]"

                            yield {
                                'is_task_complete': False,
                                'require_user_input': False,
                                'content': f"📄 {agent_name_formatted}: Tool output:\n{tool_output_preview}\n\n",
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



