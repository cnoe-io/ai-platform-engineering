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
from pydantic import BaseModel, Field

from .budget_aware_tool import BudgetAwareTool
from .token_budget import TokenBudgetExceeded, TokenBudgetManager, ToolCallLimitExceeded

logger = logging.getLogger(__name__)


class ResponseFormat(BaseModel):
    """Structured response format for agents."""

    status: str = Field(description="Response status: 'completed', 'input_required', or 'error'")
    message: str = Field(description="The response message to the user")


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
        mcp_server_config: Dict[str, Dict],
        mcp_server_name: str,
        enable_token_budget: bool = True,
        max_tokens: Optional[int] = None,
        max_tool_calls: Optional[int] = None,
    ):
        self.agent_name = agent_name
        self.system_instruction = system_instruction
        self.mcp_server_config = mcp_server_config
        self.mcp_server_name = mcp_server_name
        self.model = LLMFactory().get_llm()
        self.tracing = TracingManager()
        self.graph = None
        self._initialized = False
        self.mcp_client = None
        self._mcp_session_context = None
        self.memory = InMemorySaver()

        self.enable_token_budget = enable_token_budget
        if enable_token_budget:
            self.token_budget = TokenBudgetManager(
                agent_name=agent_name,
                max_tokens=max_tokens,
                max_tool_calls=max_tool_calls,
            )
        else:
            self.token_budget = None

        logger.info(f"Initialized {agent_name} agent (token_budget={enable_token_budget})")

    async def _get_tools(self, client: MultiServerMCPClient) -> List[Any]:
        """Fetch tools from the MCP client. Override for custom tool loading."""
        from langchain_mcp_adapters.tools import load_mcp_tools

        self._mcp_session_context = client.session(self.mcp_server_name)
        session = await self._mcp_session_context.__aenter__()
        tools = await load_mcp_tools(session)
        logger.info(f"Loaded {len(tools)} tools from MCP server")

        if self.enable_token_budget:
            tools = self._wrap_tools_with_budget(tools)

        return tools

    def _wrap_tools_with_budget(self, tools: List[Any]) -> List[Any]:
        """Wrap tools with token budget checking."""
        for tool_instance in tools:
            budget_tool = BudgetAwareTool(tool=tool_instance, token_budget=self.token_budget)
            if hasattr(tool_instance, "func"):
                tool_instance.func = budget_tool
            else:
                tool_instance._run = budget_tool
        return tools

    async def _create_graph(self, tools: List[Any]):
        """Create the LangGraph agent. Override for custom graph setup."""
        self.graph = create_react_agent(
            self.model,
            tools,
            checkpointer=self.memory,
            prompt=self.system_instruction,
            response_format=(self.RESPONSE_FORMAT_INSTRUCTION, ResponseFormat),
        )
        logger.info(f"Created ReAct agent graph with {len(tools)} tools")

    async def initialize(self):
        """Initialize the agent: create MCP client, load tools, build graph."""
        if self._initialized:
            return

        logger.info(f"Initializing {self.agent_name} agent...")
        self.mcp_client = MultiServerMCPClient(self.mcp_server_config)
        tools = await self._get_tools(self.mcp_client)
        await self._create_graph(tools)

        # Warm up
        config = RunnableConfig(configurable={"thread_id": "init"})
        await self.graph.ainvoke({"messages": [("user", "Summarize what you can do?")]}, config=config)

        self._initialized = True
        logger.info(f"{self.agent_name} agent initialized successfully")

    async def aclose(self):
        """Clean up MCP session resources."""
        if self._mcp_session_context:
            try:
                await self._mcp_session_context.__aexit__(None, None, None)
            except Exception as e:
                logger.warning(f"Error closing MCP session for {self.agent_name}: {e}")
            finally:
                self._mcp_session_context = None
        self.mcp_client = None
        self._initialized = False

    async def __aenter__(self):
        await self.initialize()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.aclose()
        return False

    async def stream(
        self, query: str, context_id: str, trace_id: Optional[str] = None
    ) -> AsyncIterable[Dict[str, Any]]:
        """Stream agent responses with graceful token budget degradation."""
        await self.initialize()

        if self.enable_token_budget:
            self.token_budget.reset()

        inputs = {"messages": [("user", query)]}
        config = self.tracing.create_config(context_id)

        try:
            async for item in self.graph.astream(inputs, config, stream_mode="values"):
                message = item["messages"][-1]

                if isinstance(message, AIMessage) and message.tool_calls:
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
            logger.warning(f"Token budget limit reached: {e}")
            yield {
                "is_task_complete": True,
                "require_user_input": False,
                "content": self.token_budget.format_partial_response(str(e)),
            }
            return

        yield self._get_final_response(config)

    def _get_final_response(self, config: RunnableConfig) -> Dict[str, Any]:
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

        logger.warning(f"Malformed agent response for {self.agent_name}")
        return {
            "is_task_complete": False,
            "require_user_input": True,
            "content": "Unable to process request at this time.",
        }
