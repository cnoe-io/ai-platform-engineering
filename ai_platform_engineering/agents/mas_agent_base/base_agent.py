"""Base agent with common LangGraph setup and token budget management."""

import logging
import os
from typing import Any, AsyncIterable, Dict, List, Optional

from cnoe_agent_utils import LLMFactory
from cnoe_agent_utils.tracing import TracingManager
from langchain_core.messages import AIMessage, ToolMessage
from langchain_core.runnables.config import RunnableConfig
from langchain_mcp_adapters.client import MultiServerMCPClient
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.prebuilt import create_react_agent

from .budget_aware_tool import BudgetAwareTool
from .mcp_config import MCPConfig
from .response_format import ResponseFormat
from .token_budget import TokenBudgetExceeded, TokenBudgetManager, ToolCallLimitExceeded

logger = logging.getLogger(__name__)


class BaseAgent:
    """Base agent with common LangGraph setup and token budget management."""

    RESPONSE_FORMAT_INSTRUCTION = (
        "Select status as completed if the request is complete. "
        "Select status as input_required if the input is a question to the user. "
        "Set response status to error if the input indicates an error."
    )

    SUPPORTED_CONTENT_TYPES = ["text/plain", "application/json"]

    def __init__(
        self,
        agent_name: str,
        system_instruction: str,
        mcp_config: MCPConfig,
        enable_token_budget: bool = True,
        enable_prompt_caching: bool = True,
        max_tokens: Optional[int] = None,
        max_tool_calls: Optional[int] = None,
    ):
        """Initialize BaseAgent with LangGraph setup and optional features.

        Args:
            agent_name: Name for logging and identification
            system_instruction: Agent-specific system prompt
            mcp_config: MCP server configuration
            enable_token_budget: Enable token budget management (default: True)
            enable_prompt_caching: Enable prompt caching if model supports it (default: True).
                Controlled by AWS_BEDROCK_ENABLE_PROMPT_CACHE environment variable.
                When enabled with a supporting model (e.g., AWS Bedrock Claude):
                - Provides ~90% cost reduction on cached system prompts
                - Cache TTL: 5 minutes (refreshes on each use)
                - First request pays full token cost, subsequent requests pay only cache read cost
                Set to False for models without caching support or to disable globally.
            max_tokens: Maximum tokens allowed (default: from env or 20000)
            max_tool_calls: Maximum tool calls allowed (default: from env or 8)
        """
        self.agent_name = agent_name
        self.system_instruction = system_instruction
        self.mcp_config = mcp_config
        self.model = LLMFactory().get_llm()
        self.tracing = TracingManager()
        self.graph = None
        self._initialized = False

        # MCP client and session (kept alive for tool execution)
        self.mcp_client = None
        self._mcp_session_context = None

        # Instance-level memory (not global shared state)
        self.memory = InMemorySaver()

        # Token budget management (optional but recommended)
        self.enable_token_budget = enable_token_budget
        if enable_token_budget:
            self.token_budget = TokenBudgetManager(
                agent_name=agent_name,
                max_tokens=max_tokens,
                max_tool_calls=max_tool_calls,
            )
        else:
            self.token_budget = None

        # Prompt caching support (for AWS Bedrock and other providers)
        cache_enabled_env = os.getenv("AWS_BEDROCK_ENABLE_PROMPT_CACHE", "true").lower() == "true"
        self.enable_prompt_caching = enable_prompt_caching and cache_enabled_env

        if self.enable_prompt_caching and hasattr(self.model, "create_cache_point"):
            self.cache_point = self.model.create_cache_point()
            logger.info(f"✅ Prompt caching enabled for {agent_name}")
        else:
            self.cache_point = None
            if self.enable_prompt_caching and not hasattr(self.model, "create_cache_point"):
                logger.warning(f"Prompt caching requested for {agent_name} but model does not support it")

        logger.info(
            f"Initialized {agent_name} agent (token_budget={enable_token_budget}, caching={self.cache_point is not None})"
        )

    async def _create_mcp_client(self) -> MultiServerMCPClient:
        """Create and return the MCP client. Override for custom logic."""
        client_config = self.mcp_config.get_client_config()
        return MultiServerMCPClient(client_config)

    async def _get_tools(self, client: MultiServerMCPClient) -> List[Any]:
        """Fetch tools from the MCP client. Override for custom tool loading."""
        from langchain_mcp_adapters.tools import load_mcp_tools

        # Create and store the session context (keep it alive for tool execution)
        self._mcp_session_context = client.session(self.mcp_config.server_name)
        session = await self._mcp_session_context.__aenter__()

        # Load tools from the active session
        tools = await load_mcp_tools(session)

        logger.info(f"Loaded {len(tools)} tools from MCP server")

        # Wrap tools with token budget checking if enabled
        if self.enable_token_budget:
            tools = self._wrap_tools_with_budget(tools)

        return tools

    def _wrap_tools_with_budget(self, tools: List[Any]) -> List[Any]:
        """Wrap tools to check token budget before execution.

        Uses BudgetAwareTool class to wrap each tool, eliminating nested closures
        and improving testability and debuggability.

        Note: This method returns the original tool instances with their execution
        methods replaced. The tools remain compatible with LangGraph's expectations
        while adding budget checking behavior.
        """
        wrapped_tools = []

        for tool_instance in tools:
            # Create wrapper with explicit state management
            budget_tool = BudgetAwareTool(tool=tool_instance, token_budget=self.token_budget)

            # Replace the tool's execution function
            # Note: We intentionally modify the tool instance here because:
            # 1. These tools are freshly loaded from MCP (not shared across agents)
            # 2. LangGraph expects tool instances with specific attributes
            # 3. Creating new instances would lose tool metadata/schema
            if hasattr(tool_instance, "func"):
                tool_instance.func = budget_tool
            else:
                tool_instance._run = budget_tool

            wrapped_tools.append(tool_instance)

        logger.info(f"Wrapped {len(wrapped_tools)} tools with token budget checks")
        return wrapped_tools

    async def _create_graph(self, tools: List[Any]):
        """Create the LangGraph agent. Override for custom graph setup."""
        # Use cache-aware system prompt if caching is enabled
        if self.cache_point:
            from langchain_core.messages import SystemMessage

            system_prompt = SystemMessage(content=[{"text": self.system_instruction}, self.cache_point])
            logger.info(f"🔄 Using cached system prompt for {self.agent_name}")
        else:
            system_prompt = self.system_instruction

        self.graph = create_react_agent(
            self.model,
            tools,
            checkpointer=self.memory,  # Use instance-level memory
            prompt=system_prompt,
            response_format=(self.RESPONSE_FORMAT_INSTRUCTION, ResponseFormat),
        )
        logger.info(f"Created ReAct agent graph with {len(tools)} tools")

    async def _run_initialization_query(self):
        """Run initial query to warm up the agent."""
        config = RunnableConfig(configurable={"thread_id": "init"})
        await self.graph.ainvoke({"messages": [("user", "Summarize what you can do?")]}, config=config)
        logger.info("Agent warmed up with initialization query")

    async def initialize(self):
        """Common initialization logic using hook methods."""
        if self._initialized:
            logger.debug(f"{self.agent_name} already initialized")
            return

        logger.info(f"Initializing {self.agent_name} agent...")

        try:
            self.mcp_client = await self._create_mcp_client()
            tools = await self._get_tools(self.mcp_client)
            await self._create_graph(tools)
            await self._run_initialization_query()
            self._initialized = True
            logger.info(f"{self.agent_name} agent initialized successfully")
        except Exception as e:
            logger.error(f"Failed to initialize {self.agent_name}: {e}")
            raise

    async def aclose(self):
        """Clean up resources, including the MCP session.

        This method should be called when the agent is no longer needed
        to properly release resources (MCP sessions, subprocesses, etc.).

        Example:
            async with agent:
                await agent.stream(query, context_id)
            # Or explicitly:
            try:
                await agent.stream(query, context_id)
            finally:
                await agent.aclose()
        """
        if self._mcp_session_context:
            logger.info(f"Closing MCP session for {self.agent_name}")
            try:
                await self._mcp_session_context.__aexit__(None, None, None)
            except Exception as e:
                logger.warning(f"Error closing MCP session for {self.agent_name}: {e}")
            finally:
                self._mcp_session_context = None

        if self.mcp_client:
            self.mcp_client = None

        self._initialized = False
        logger.info(f"Agent {self.agent_name} resources have been closed")

    async def __aenter__(self):
        """Async context manager entry."""
        await self.initialize()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit."""
        await self.aclose()
        return False

    async def stream(
        self, query: str, context_id: str, trace_id: Optional[str] = None
    ) -> AsyncIterable[Dict[str, Any]]:
        """Stream agent responses.

        Implements graceful degradation when token budget is exceeded.

        Note: Subclasses can add @trace_agent_stream(agent_name) decorator if needed.
        """
        await self.initialize()

        # Reset token budget for new query if enabled
        if self.enable_token_budget:
            self.token_budget.reset()
            logger.debug(f"Reset token budget for new query (context_id={context_id})")

        inputs = {"messages": [("user", query)]}
        config = self.tracing.create_config(context_id)

        try:
            # Use astream with values mode (matches production agents)
            async for item in self.graph.astream(inputs, config, stream_mode="values"):
                message = item["messages"][-1]

                # Provide feedback during tool execution
                if isinstance(message, AIMessage) and message.tool_calls and len(message.tool_calls) > 0:
                    tool_names = [tc.get("name", "tool") for tc in message.tool_calls]
                    yield {
                        "is_task_complete": False,
                        "require_user_input": False,
                        "content": f"Using {', '.join(tool_names)}...",
                    }
                elif isinstance(message, ToolMessage):
                    yield {
                        "is_task_complete": False,
                        "require_user_input": False,
                        "content": "Processing results...",
                    }

        except (TokenBudgetExceeded, ToolCallLimitExceeded) as e:
            # Graceful degradation: return partial results
            logger.warning(f"Token budget limit reached: {e}")
            partial_response = self.token_budget.format_partial_response(str(e))
            yield {"is_task_complete": True, "require_user_input": False, "content": partial_response}
            return

        # Yield final response
        yield self.get_agent_response(config)

    def get_agent_response(self, config: RunnableConfig) -> Dict[str, Any]:
        """Extract final agent response from graph state."""
        current_state = self.graph.get_state(config)
        structured_response = current_state.values.get("structured_response")

        if structured_response and isinstance(structured_response, ResponseFormat):
            if structured_response.status in {"input_required", "error"}:
                return {
                    "is_task_complete": False,
                    "require_user_input": True,
                    "content": structured_response.message,
                }
            if structured_response.status == "completed":
                return {
                    "is_task_complete": True,
                    "require_user_input": False,
                    "content": structured_response.message,
                }

        # Log malformed response for debugging
        logger.warning(
            f"Agent response was malformed or missing for {self.agent_name}. "
            f"State values: {current_state.values.keys()}. "
            "Falling back to default response."
        )

        return {
            "is_task_complete": False,
            "require_user_input": True,
            "content": "Unable to process request at this time.",
        }
