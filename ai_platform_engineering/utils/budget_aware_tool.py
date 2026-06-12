"""Budget-aware tool wrapper for token management."""

import inspect
import logging
from typing import Any

from .token_budget import TokenBudgetExceeded, TokenBudgetManager, ToolCallLimitExceeded

logger = logging.getLogger(__name__)


class BudgetAwareTool:
    """Wraps an MCP tool with token budget checking before execution."""

    def __init__(self, tool: Any, token_budget: TokenBudgetManager):
        self.tool = tool
        self.token_budget = token_budget
        self.name = tool.name
        self._original_func = tool.func if hasattr(tool, "func") else tool._run

    async def __call__(self, *args, **kwargs) -> Any:
        try:
            self.token_budget.check_before_tool_call(tool_name=self.name, params=kwargs)
        except (TokenBudgetExceeded, ToolCallLimitExceeded) as e:
            logger.warning(f"Token budget exceeded for {self.name}: {e}")
            return self.token_budget.get_partial_results_message()

        if inspect.iscoroutinefunction(self._original_func):
            result = await self._original_func(*args, **kwargs)
        else:
            result = self._original_func(*args, **kwargs)

        self.token_budget.add_result(self.name, result)
        self.token_budget.update_consumption(result)
        return result

    def __getattr__(self, name: str) -> Any:
        return getattr(self.tool, name)
