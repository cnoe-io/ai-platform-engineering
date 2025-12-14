# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Base agent class providing common A2A functionality with streaming support."""

import json
import logging
import os
import tempfile
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
from ai_platform_engineering.utils.metrics import MetricsCallbackHandler


logger = logging.getLogger(__name__)

# LangMem utilities for intelligent message summarization
from .langmem_utils import is_langmem_available, summarize_messages, get_langmem_status

if not MCP_AVAILABLE:
    logger.warning("langchain_mcp_adapters not available - MCP functionality will be disabled for agents using this base class")

# Configuration for automatic output chunking
CHUNK_SIZE_THRESHOLD = int(os.getenv("TOOL_OUTPUT_CHUNK_THRESHOLD", "50000"))  # 50KB default
CHUNK_SIZE = int(os.getenv("TOOL_OUTPUT_CHUNK_SIZE", "10000"))  # 10KB chunks

# Reduce verbosity of third-party libraries
# Set this early before any imports use these loggers
for log_name in ["httpx", "mcp.server.streamable_http", "mcp.server.streamable_http_manager",
                  "mcp.client", "mcp.client.streamable_http", "uvicorn.access", "uvicorn.error"]:
    logging.getLogger(log_name).setLevel(logging.WARNING)
    logging.getLogger(log_name).propagate = False

# Suppress noisy A2A SDK warnings (queue closed, artifact append issues)
for log_name in ["sse_starlette.sse", "a2a.server.events.event_queue", "a2a.utils.helpers"]:
    logging.getLogger(log_name).setLevel(logging.ERROR)
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

    def get_additional_tools(self) -> list:
        """
        Hook for subclasses to provide additional custom tools beyond MCP tools.

        Override this method to add CLI-based tools (e.g., gh CLI, aws CLI)
        or other non-MCP tools to the agent.

        Returns:
            List of BaseTool instances, or empty list if no additional tools
        """
        return []

    def _chunk_large_output(self, output: Any, tool_name: str) -> Any:
        """
        Generic post-hook to chunk large tool outputs.

        Writes large output to temp file, reads first chunk as preview,
        and returns a summary with file path.

        Args:
            output: Tool output (any type)
            tool_name: Name of the tool

        Returns:
            Either the original output (if small) or a chunked summary (if large)
        """
        # Convert output to string
        if isinstance(output, (dict, list)):
            output_str = json.dumps(output, indent=2)
        else:
            output_str = str(output)

        # Check if output exceeds threshold
        if len(output_str) < CHUNK_SIZE_THRESHOLD:
            return output

        # Large output - write to temp file
        agent_name = self.get_agent_name()
        logger.warning(
            f"{agent_name}: Tool '{tool_name}' returned large output "
            f"({len(output_str):,} chars). Writing to temp file for chunked access."
        )

        # Write to temp file
        temp_file = tempfile.NamedTemporaryFile(
            mode='w', delete=False, suffix='.json',
            prefix=f'{agent_name}_{tool_name}_'
        )
        temp_file.write(output_str)
        temp_file.close()

        # Read first chunk as preview
        with open(temp_file.name, 'r') as f:
            preview = f.read(CHUNK_SIZE)

        # Count items if it's structured data
        item_count = None
        if isinstance(output, list):
            item_count = len(output)
        elif isinstance(output, dict):
            if 'items' in output and isinstance(output.get('items'), list):
                item_count = len(output['items'])
            elif 'data' in output and isinstance(output.get('data'), list):
                item_count = len(output['data'])

        # Return summary
        summary = {
            "chunked": True,
            "note": f"⚠️  Tool '{tool_name}' output is large ({len(output_str):,} chars)",
            "char_count": len(output_str),
            "item_count": item_count,
            "preview": preview + ("..." if len(output_str) > CHUNK_SIZE else ""),
            "file_path": temp_file.name,
            "chunk_size": CHUNK_SIZE,
            "instructions": (
                f"Large output saved to {temp_file.name}. "
                f"Preview shows first {CHUNK_SIZE:,} chars. "
                "Use standard file tools to read more if needed."
            )
        }

        return json.dumps(summary, indent=2)

    def _parse_tool_error(self, error: Exception, tool_name: str) -> str:
        """
        Parse tool errors for user-friendly messages.

        Subclasses can override this to provide service-specific error messages
        (e.g., GitHub 404 → "Repository not found", Jira 401 → "Invalid credentials").

        Args:
            error: The exception that was raised
            tool_name: Name of the tool that failed

        Returns:
            User-friendly error message
        """
        # Handle TaskGroup/ExceptionGroup errors by extracting underlying exceptions
        underlying_error = error
        if hasattr(error, 'exceptions') and error.exceptions:
            # ExceptionGroup (Python 3.11+) or TaskGroup error
            underlying_error = error.exceptions[0]
            logger.debug(f"Extracted underlying error from TaskGroup: {type(underlying_error).__name__}")
        
        error_str = str(underlying_error)
        error_type = type(underlying_error).__name__
        
        # Common error patterns that apply to all agents
        if "timeout" in error_str.lower() or "timed out" in error_str.lower():
            return f"Request timed out for {tool_name}. Please try again."
        elif "connection" in error_str.lower() and ("refused" in error_str.lower() or "failed" in error_str.lower()):
            return f"Connection failed for {tool_name}. The service may be unavailable."
        elif "rate limit" in error_str.lower() or "429" in error_str:
            return f"Rate limit exceeded for {tool_name}. Please wait before trying again."
        elif "unhandled errors in a TaskGroup" in error_str:
            return f"Request failed for {tool_name}. The service may be temporarily unavailable."
        elif error_type in ("ConnectionError", "ConnectionRefusedError", "ConnectionResetError"):
            return f"Connection error for {tool_name}. Please check if the service is running."
        else:
            return f"Error executing {tool_name}: {error_str}"

    def _truncate_tool_output(self, output: Any, tool_name: str, max_size: int = 10000) -> tuple[Any, bool]:
        """
        Truncate large tool outputs to prevent context overflow.

        Handles both simple strings and tuple outputs (content, artifact) format.

        Args:
            output: Tool output to truncate (string or tuple)
            tool_name: Name of the tool
            max_size: Maximum size in characters (default 10KB)

        Returns:
            Tuple of (truncated_output, was_truncated)
        """
        # Handle tuple outputs from response_format='content_and_artifact'
        if isinstance(output, tuple) and len(output) == 2:
            content, artifact = output
            content_str = str(content) if not isinstance(content, str) else content

            if len(content_str) <= max_size:
                return output, False

            # Truncate content only, preserve artifact
            truncated = content_str[:max_size]
            remaining = len(content_str) - max_size
            truncation_notice = f"\n\n... (truncated {remaining} characters to prevent context overflow)"

            logger.warning(f"{self.get_agent_name()}: Truncated {tool_name} output from {len(content_str)} to {max_size} chars")
            return (truncated + truncation_notice, artifact), True

        # Handle simple string/other outputs
        output_str = str(output) if not isinstance(output, str) else output

        if len(output_str) <= max_size:
            return output, False

        # Truncate with notice
        truncated = output_str[:max_size]
        remaining = len(output_str) - max_size
        truncation_notice = f"\n\n... (truncated {remaining} characters to prevent context overflow)"

        logger.warning(f"{self.get_agent_name()}: Truncated {tool_name} output from {len(output_str)} to {max_size} chars")
        return truncated + truncation_notice, True

    def _wrap_mcp_tools(self, tools: list, context_id: str) -> list:
        """
        Wrap MCP tools with error handling to prevent exceptions from closing A2A streams.

        All tools are wrapped with try/catch blocks that:
        - Catch any exceptions during tool execution
        - Call _parse_tool_error() for agent-specific error messages
        - Return proper tuple format for response_format='content_and_artifact'
        - Log warnings for debugging
        - Truncate large outputs to prevent context overflow

        This prevents tool failures from crashing agents and closing A2A event streams.
        Subclasses can override _parse_tool_error() for service-specific error parsing.

        Args:
            tools: List of tools from MCP client
            context_id: Context ID for this session

        Returns:
            List of wrapped tools with error handling
        """
        from functools import wraps

        # Get max tool output size from environment (default 10KB for smaller context models)
        max_tool_output = int(os.getenv("MAX_TOOL_OUTPUT_SIZE", "10000"))

        wrapped_tools = []

        for tool in tools:
            # Store original methods
            original_run = tool._run if hasattr(tool, '_run') else None
            original_arun = tool._arun if hasattr(tool, '_arun') else None

            # Create error-handled sync version
            if original_run:
                @wraps(original_run)
                def safe_run(*args, _orig=original_run, _tool_name=tool.name, _max_size=max_tool_output, **kwargs):
                    try:
                        result = _orig(*args, **kwargs)
                        # Truncate large outputs to prevent context overflow
                        result, was_truncated = self._truncate_tool_output(result, _tool_name, _max_size)
                        return result
                    except Exception as e:
                        user_msg = self._parse_tool_error(e, _tool_name)
                        logger.warning(f"{self.get_agent_name()} MCP tool error: {user_msg}")
                        # Return tuple format for response_format='content_and_artifact'
                        return (user_msg, {"error": str(e), "tool": _tool_name})

                tool._run = safe_run

            # Create error-handled async version
            if original_arun:
                @wraps(original_arun)
                async def safe_arun(*args, _orig=original_arun, _tool_name=tool.name, _max_size=max_tool_output, **kwargs):
                    try:
                        result = await _orig(*args, **kwargs)
                        # Truncate large outputs to prevent context overflow
                        result, was_truncated = self._truncate_tool_output(result, _tool_name, _max_size)
                        return result
                    except Exception as e:
                        user_msg = self._parse_tool_error(e, _tool_name)
                        logger.warning(f"{self.get_agent_name()} MCP tool error: {user_msg}")
                        # Return tuple format for response_format='content_and_artifact'
                        return (user_msg, {"error": str(e), "tool": _tool_name})

                tool._arun = safe_arun

            wrapped_tools.append(tool)

        logger.info(f"Wrapped {len(wrapped_tools)} {self.get_agent_name()} MCP tools with error handling")
        return wrapped_tools

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

        # Allow subclasses to wrap tools (e.g., for error handling)
        tools = self._wrap_mcp_tools(tools, args.get("thread_id", "default"))

        # Allow subclasses to add custom local tools (e.g., gh CLI, aws CLI)
        additional_tools = self.get_additional_tools()
        if additional_tools:
            tools.extend(additional_tools)
            logger.info(f"{agent_name}: Added {len(additional_tools)} custom tools")

        # Display detailed tool information for debugging
        logger.debug('*' * 50)
        logger.debug(f"🔧 AVAILABLE {agent_name.upper()} TOOLS AND PARAMETERS")
        logger.debug('*' * 80)
        for tool in tools:
            logger.debug(f"📋 Tool: {tool.name}")
            logger.debug(f"📝 Description: {tool.description.strip()}")

            # Handle tools with no args_schema
            args_schema = tool.args_schema if tool.args_schema is not None else {}

            # Convert Pydantic model to dict schema if needed
            if hasattr(args_schema, 'model_json_schema'):
                args_schema = args_schema.model_json_schema()
            elif not isinstance(args_schema, dict):
                args_schema = {}

            # Store tool info for later reference
            self.tools_info[tool.name] = {
                'description': tool.description.strip(),
                'parameters': args_schema.get('properties', {}),
                'required': args_schema.get('required', [])
            }

            params = args_schema.get('properties', {})
            required_params = args_schema.get('required', [])

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

        # Agent initialization complete
        logger.info(f"✅ {agent_name} agent initialized with {len(tools)} tools")

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

    async def _preflight_context_check(self, config: RunnableConfig, query: str) -> None:
        """
        Pre-flight check: Estimate context usage BEFORE calling LLM.

        Proactively trims messages if we're approaching the context limit,
        preventing 'Input is too long' errors.

        Args:
            config: Runnable configuration
            query: Current query to be sent
        """
        agent_name = self.get_agent_name()

        try:
            # Get current state
            state = await self.graph.aget_state(config)
            if not state or not state.values:
                return  # No history yet

            messages = state.values.get("messages", [])
            if not messages:
                return

            # Estimate tokens for: system prompt + history + new query + tool schemas
            system_prompt_tokens = self._count_message_tokens(SystemMessage(content=self._get_system_instruction_with_date()))
            history_tokens = self._count_total_tokens(messages)
            query_tokens = len(self.tokenizer.encode(query))

            # Estimate tool schema overhead (~500 tokens per tool for 40 tools = 20K)
            tool_count = len(self.tools_info) if hasattr(self, 'tools_info') else 40
            tool_schema_tokens = tool_count * 500

            total_estimated = system_prompt_tokens + history_tokens + query_tokens + tool_schema_tokens

            # Use 80% of max as threshold to be safe (leave room for response)
            threshold = int(self.max_context_tokens * 0.8)

            if total_estimated > threshold:
                logger.warning(
                    f"{agent_name}: Pre-flight check detected potential overflow: "
                    f"{total_estimated:,} tokens (threshold: {threshold:,}). "
                    f"System: {system_prompt_tokens:,}, History: {history_tokens:,}, "
                    f"Query: {query_tokens:,}, Tools: {tool_schema_tokens:,}"
                )

                # Use LangMem to summarize instead of delete (preserves context)
                target_tokens = int(self.max_context_tokens * 0.5)
                langmem_succeeded = False

                # Try LangMem summarization first
                state_messages = state.values.get("messages", [])
                messages_to_summarize = state_messages[:-self.min_messages_to_keep]
                messages_to_keep = state_messages[-self.min_messages_to_keep:]

                if messages_to_summarize:
                    result = await summarize_messages(
                        messages=messages_to_summarize,
                        model=self.model,
                        agent_name=agent_name,
                    )

                    if result.success and result.summary_message:
                        # Remove old messages and add summary
                        remove_commands = []
                        for msg in messages_to_summarize:
                            msg_id = msg.id if hasattr(msg, "id") else msg.get("id")
                            if msg_id:
                                remove_commands.append(RemoveMessage(id=msg_id))

                        if remove_commands:
                            await self.graph.aupdate_state(config, {"messages": remove_commands})
                            await self.graph.aupdate_state(config, {"messages": [result.summary_message]})

                            new_tokens = (
                                system_prompt_tokens +
                                self._count_message_tokens(result.summary_message) +
                                self._count_total_tokens(messages_to_keep) +
                                query_tokens + tool_schema_tokens
                            )
                            logger.info(
                                f"{agent_name}: Context compressed. New estimate: {new_tokens:,} tokens. "
                                f"LangMem used: {result.used_langmem}"
                            )
                            langmem_succeeded = True

                # Fallback: Simple deletion if summarization failed
                if not langmem_succeeded:
                    messages_to_remove_count = 0

                    # Remove oldest messages until we're under target
                    while history_tokens > target_tokens and len(messages) > self.min_messages_to_keep:
                        oldest = messages.pop(0)
                        messages_to_remove_count += 1
                        history_tokens = self._count_total_tokens(messages)

                    if messages_to_remove_count > 0:
                        # Create RemoveMessage commands
                        remove_commands = []
                        state_messages = state.values.get("messages", [])
                        for i in range(min(messages_to_remove_count, len(state_messages))):
                            msg = state_messages[i]
                            msg_id = msg.id if hasattr(msg, "id") else msg.get("id")
                            if msg_id:
                                remove_commands.append(RemoveMessage(id=msg_id))

                        if remove_commands:
                            await self.graph.aupdate_state(config, {"messages": remove_commands})
                            logger.info(
                                f"{agent_name}: ✂️ Pre-flight trimmed {messages_to_remove_count} messages "
                                f"(simple deletion). New estimate: {system_prompt_tokens + history_tokens + query_tokens + tool_schema_tokens:,} tokens"
                            )
            else:
                logger.debug(f"{agent_name}: Pre-flight check passed: {total_estimated:,} / {self.max_context_tokens:,} tokens")

        except Exception as e:
            logger.error(f"{agent_name}: Pre-flight check error: {e}", exc_info=True)
            # Don't fail the request - just log and continue

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

        # Auto-inject current date into every query for all agents
        # This eliminates need for agents to call get_current_date() tool
        current_date = datetime.now().strftime("%Y-%m-%d")
        current_datetime = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        enhanced_query = f"{query}\n\n[Current date: {current_date}, Current date/time: {current_datetime}]"

        debug_print(f"Starting stream for {agent_name} with query: {enhanced_query}", banner=True)

        inputs: dict[str, Any] = {'messages': [('user', enhanced_query)]}
        config: RunnableConfig = self.tracing.create_config(sessionId)

        configurable = dict(config.get("configurable", {})) if isinstance(config.get("configurable", {}), dict) else {}
        if sessionId and "thread_id" not in configurable:
            configurable["thread_id"] = sessionId

        # Set recursion limit for agents that need to process many items
        # Default LangGraph limit is 25, increase to 100 for "all" queries
        if "recursion_limit" not in configurable:
            configurable["recursion_limit"] = 100

        # Add metrics callback handler to track MCP tool calls
        callbacks = list(config.get("callbacks") or [])
        callbacks.append(MetricsCallbackHandler(agent_name=agent_name))

        config = RunnableConfig(
            callbacks=callbacks,
            tags=config.get("tags"),
            metadata=config.get("metadata"),
            configurable=configurable,
        )

        # Ensure graph is initialized
        await self._ensure_graph_initialized(config)

        # Pre-flight check: Estimate context usage BEFORE calling LLM
        await self._preflight_context_check(config, enhanced_query)

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
                        # Normalize content to string (AWS Bedrock returns list, OpenAI returns string)
                        content = message.content
                        if isinstance(content, list):
                            # If content is a list (AWS Bedrock), extract text from content blocks
                            logger.debug(f"🔄 BEDROCK FORMAT FIX (streaming): Converting list content to text. Raw: {str(content)[:100]}...")
                            text_parts = []
                            for item in content:
                                if isinstance(item, dict):
                                    # Extract text from Bedrock content block: {"type": "text", "text": "..."}
                                    text_parts.append(item.get('text', ''))
                                elif isinstance(item, str):
                                    text_parts.append(item)
                                else:
                                    text_parts.append(str(item))
                            content = ''.join(text_parts)
                            logger.debug(f"🔄 BEDROCK FORMAT FIX (streaming): Normalized to: {content[:100]}...")
                        elif not isinstance(content, str):
                            logger.debug(f"🔄 Content normalization: Converting {type(content).__name__} to string")
                            content = str(content) if content else ''

                        if content:  # Only yield if there's actual content after normalization
                            yield {
                                'is_task_complete': False,
                                'require_user_input': False,
                                'kind': 'text_chunk',
                                'content': content,
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
                            # Normalize content to string (AWS Bedrock returns list, OpenAI returns string)
                            if isinstance(content_text, list):
                                # If content is a list (AWS Bedrock), extract text from content blocks
                                logger.debug(f"🔄 BEDROCK FORMAT FIX (full-msg): Converting list content to text. Raw: {str(content_text)[:100]}...")
                                text_parts = []
                                for item in content_text:
                                    if isinstance(item, dict):
                                        # Extract text from Bedrock content block: {"type": "text", "text": "..."}
                                        text_parts.append(item.get('text', ''))
                                    elif isinstance(item, str):
                                        text_parts.append(item)
                                    else:
                                        text_parts.append(str(item))
                                content_text = ''.join(text_parts)
                                logger.debug(f"🔄 BEDROCK FORMAT FIX (full-msg): Normalized to: {content_text[:100]}...")
                            elif not isinstance(content_text, str):
                                logger.debug(f"🔄 Content normalization (full-msg): Converting {type(content_text).__name__} to string")
                                content_text = str(content_text) if content_text else ''

                            if content_text:  # Only yield if there's actual content after normalization
                                yield {
                                    'is_task_complete': False,
                                    'require_user_input': False,
                                    'content': content_text,
                                }

        # Yield task completion marker
        yield {
            'is_task_complete': True,
            'require_user_input': False,
            'content': '',
        }



