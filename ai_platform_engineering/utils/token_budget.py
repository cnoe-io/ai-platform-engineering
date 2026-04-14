"""Token budget management with graceful degradation."""

import logging
import os
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


class TokenBudgetExceeded(Exception):
    """Raised when token budget is exceeded."""

    pass


class ToolCallLimitExceeded(Exception):
    """Raised when tool call limit is exceeded."""

    pass


# Default per-tool token estimates
DEFAULT_TOOL_ESTIMATES: Dict[str, int] = {
    "list": 2000,
    "search": 2000,
    "get_entities": 2000,
    "get_entity": 800,
    "create": 500,
    "update": 500,
    "delete": 300,
    "default": 500,
}


class TokenBudgetManager:
    """Token budget manager with graceful degradation.

    Tracks estimated token consumption across tool calls and raises
    when limits are exceeded, allowing the agent to return partial results.
    """

    _ESTIMATE_ADJUSTMENT_FACTOR = 0.8

    def __init__(
        self,
        agent_name: str,
        max_tokens: Optional[int] = None,
        max_tool_calls: Optional[int] = None,
        tool_estimates: Optional[Dict[str, int]] = None,
    ):
        self.agent_name = agent_name
        self.MAX_TOKENS = max_tokens or int(os.getenv("AGENT_MAX_TOKENS", "20000"))
        self.MAX_TOOL_CALLS = max_tool_calls or int(os.getenv("AGENT_MAX_TOOL_CALLS", "8"))
        self.tool_estimates = {**DEFAULT_TOOL_ESTIMATES, **(tool_estimates or {})}
        self.consumed_tokens = 0
        self.tool_call_count = 0
        self.collected_results: List[Dict[str, Any]] = []

    def reset(self):
        """Reset budget for a new query."""
        self.consumed_tokens = 0
        self.tool_call_count = 0
        self.collected_results = []

    def estimate_tokens(self, text: str) -> int:
        """Estimate token count (~4 chars per token)."""
        return max(1, len(str(text)) // 4) if text else 0

    def check_before_tool_call(self, tool_name: str, params: Dict[str, Any]) -> bool:
        """Check if tool call is allowed within budget. Raises on exceeded."""
        self.tool_call_count += 1

        if self.tool_call_count > self.MAX_TOOL_CALLS:
            raise ToolCallLimitExceeded(
                f"Reached limit of {self.MAX_TOOL_CALLS} tool calls. "
                f"Collected {len(self.collected_results)} partial results."
            )

        # Estimate tokens for this call
        base_overhead = 500
        param_tokens = self.estimate_tokens(str(params))

        tool_name_lower = tool_name.lower()
        response_est = self.tool_estimates.get(tool_name_lower, self.tool_estimates["default"])
        for keyword, estimate in self.tool_estimates.items():
            if keyword != "default" and tool_name_lower.startswith(keyword):
                response_est = estimate
                break

        estimated = base_overhead + param_tokens + response_est

        if self.consumed_tokens + estimated > self.MAX_TOKENS:
            raise TokenBudgetExceeded(
                f"Token budget exceeded ({self.consumed_tokens + estimated} > {self.MAX_TOKENS}). "
                f"Collected {len(self.collected_results)} partial results."
            )

        self.consumed_tokens += estimated
        return True

    def add_result(self, tool_name: str, result: Any):
        """Track tool result for potential partial return."""
        self.collected_results.append({"tool": tool_name, "result": result})

    def update_consumption(self, result: Any):
        """Adjust consumed tokens based on actual result size."""
        actual_tokens = self.estimate_tokens(str(result))
        self.consumed_tokens = int((self.consumed_tokens * self._ESTIMATE_ADJUSTMENT_FACTOR) + actual_tokens)

    def get_partial_results_message(self) -> str:
        """Generate message for graceful degradation."""
        return (
            f"Token budget limit reached. "
            f"Returning {len(self.collected_results)} results collected so far. "
            f"Please refine your query to be more specific."
        )

    def format_partial_response(self, error_message: str) -> str:
        """Format partial results into a user-friendly response."""
        if not self.collected_results:
            return (
                f"{error_message}\n\n"
                "No results were collected before reaching the limit. "
                "Please try a more specific query."
            )

        lines = [f"{error_message}\n", f"**Partial Results ({len(self.collected_results)} items):**\n"]
        for idx, item in enumerate(self.collected_results[:10], 1):
            result_str = str(item["result"])
            if len(result_str) > 500:
                result_str = result_str[:500] + "..."
            lines.append(f"{idx}. Tool: `{item['tool']}`\n   Result: {result_str}\n")

        if len(self.collected_results) > 10:
            lines.append(f"... and {len(self.collected_results) - 10} more results.\n")

        return "\n".join(lines)
