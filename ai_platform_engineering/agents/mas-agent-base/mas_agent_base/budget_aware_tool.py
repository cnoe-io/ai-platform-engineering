"""Budget-aware tool wrapper for token management."""

import inspect
import logging
from typing import Any

from .token_budget import TokenBudgetExceeded, TokenBudgetManager, ToolCallLimitExceeded

logger = logging.getLogger(__name__)


class BudgetAwareTool:
    """Wraps a tool with token budget checking.

    This wrapper intercepts tool calls to check token budgets before execution
    and track consumption after execution, enabling graceful degradation when
    limits are reached.
    """

    def __init__(self, tool: Any, token_budget: TokenBudgetManager):
        """Initialize budget-aware tool wrapper.

        Args:
            tool: The original tool instance to wrap
            token_budget: Token budget manager for tracking consumption
        """
        self.tool = tool
        self.token_budget = token_budget
        self.name = tool.name
        self.description = tool.description if hasattr(tool, "description") else ""

        # Store original function for execution
        self._original_func = tool.func if hasattr(tool, "func") else tool._run

    async def __call__(self, *args, **kwargs) -> Any:
        """Execute the tool with budget checking.

        Args:
            *args: Positional arguments for the tool
            **kwargs: Keyword arguments for the tool

        Returns:
            Tool execution result or graceful degradation message
        """
        # Check budget before tool call
        try:
            self.token_budget.check_before_tool_call(tool_name=self.name, params=kwargs)
        except (TokenBudgetExceeded, ToolCallLimitExceeded) as e:
            logger.warning(f"Token budget exceeded for {self.name}: {e}")
            return self.token_budget.get_partial_results_message()

        # Execute tool (handle both sync and async)
        if inspect.iscoroutinefunction(self._original_func):
            result = await self._original_func(*args, **kwargs)
        else:
            result = self._original_func(*args, **kwargs)

        # Track result for potential partial return
        self.token_budget.add_result(self.name, result)

        # Update consumed tokens
        self.token_budget.update_consumption(result)

        return result

    def __getattr__(self, name: str) -> Any:
        """Proxy attribute access to the wrapped tool."""
        return getattr(self.tool, name)
