"""Token budget management with graceful degradation."""

import logging
import os
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

# Try to import tiktoken for accurate token counting
try:
    import tiktoken

    # Use cl100k_base encoding (GPT-4, GPT-3.5-turbo)
    _TIKTOKEN_ENCODING = tiktoken.get_encoding("cl100k_base")
except ImportError:
    _TIKTOKEN_ENCODING = None
    logging.getLogger(__name__).warning(
        "tiktoken not installed. Using rough character-based token estimation. "
        "Install tiktoken for accurate token counting: uv add tiktoken"
    )

logger = logging.getLogger(__name__)


class TokenBudgetExceeded(Exception):
    """Raised when token budget is exceeded."""

    pass


class ToolCallLimitExceeded(Exception):
    """Raised when tool call limit is exceeded."""

    pass


@dataclass
class TokenBudgetConfig:
    """Configuration for token budget management."""

    max_tokens: int = 20000
    max_tool_calls: int = 8
    warning_threshold: float = 0.75  # Warn at 75%

    # Tool-specific estimates (tokens)
    tool_estimates: Dict[str, int] = field(
        default_factory=lambda: {
            "list": 2000,
            "search": 2000,
            "get_entities": 2000,
            "get_entity": 800,
            "techdocs_search": 3000,
            "techdocs": 1500,
            "validate": 800,
            "refresh": 300,
            "delete": 300,
            "create": 500,
            "update": 500,
            "default": 500,
        }
    )


class TokenBudgetManager:
    """Universal token budget manager with graceful degradation."""

    # Adjustment factor for refining token consumption estimates
    # We retain a portion of the initial estimate to account for tool call overhead
    # that isn't captured by the result size alone
    _ESTIMATE_ADJUSTMENT_FACTOR = 0.8

    def __init__(
        self,
        agent_name: str,
        max_tokens: Optional[int] = None,
        max_tool_calls: Optional[int] = None,
        config: Optional[TokenBudgetConfig] = None,
        tool_estimates: Optional[Dict[str, int]] = None,
    ):
        """Initialize token budget manager.

        Args:
            agent_name: Name of the agent
            max_tokens: Override max tokens (env: AGENT_MAX_TOKENS)
            max_tool_calls: Override max tool calls (env: AGENT_MAX_TOOL_CALLS)
            config: Custom configuration
            tool_estimates: Custom tool token estimates to override defaults.
                Example: {"list": 3000, "search": 2500, "my_custom_tool": 1000}
                Allows per-agent customization of token estimates for specific tools.
        """
        self.agent_name = agent_name

        # Load configuration
        if config is None:
            config = TokenBudgetConfig()

        # Allow overriding tool estimates
        if tool_estimates:
            config.tool_estimates.update(tool_estimates)

        self.config = config
        self.MAX_TOKENS = max_tokens or int(os.getenv("AGENT_MAX_TOKENS", str(config.max_tokens)))
        self.MAX_TOOL_CALLS = max_tool_calls or int(os.getenv("AGENT_MAX_TOOL_CALLS", str(config.max_tool_calls)))

        # State
        self.consumed_tokens = 0
        self.tool_call_count = 0
        self.collected_results: List[Dict[str, Any]] = []

        logger.info(
            f"Initialized token budget for {agent_name}: "
            f"max_tokens={self.MAX_TOKENS}, max_tool_calls={self.MAX_TOOL_CALLS}, "
            f"tiktoken={'enabled' if _TIKTOKEN_ENCODING else 'disabled'}"
        )

    def reset(self):
        """Reset budget for new query."""
        self.consumed_tokens = 0
        self.tool_call_count = 0
        self.collected_results = []

    def estimate_tokens(self, text: str) -> int:
        """Estimate token count using tiktoken if available, otherwise use heuristic.

        Args:
            text: Text to estimate tokens for

        Returns:
            Estimated token count
        """
        if not text:
            return 0

        # Use tiktoken if available for accurate counting
        if _TIKTOKEN_ENCODING:
            try:
                return len(_TIKTOKEN_ENCODING.encode(str(text)))
            except Exception as e:
                logger.warning(f"tiktoken encoding failed, falling back to heuristic: {e}")

        # Fallback to rough estimation (~4 chars per token)
        return max(1, len(str(text)) // 4)

    def estimate_tool_tokens(self, tool_name: str, params: Dict[str, Any]) -> int:
        """Estimate tokens for a tool call."""
        base_overhead = 500
        param_tokens = self.estimate_tokens(str(params))

        # Find matching tool estimate with improved precision
        tool_name_lower = tool_name.lower()

        # Try exact match first (most precise)
        estimated_response = self.config.tool_estimates.get(tool_name_lower)

        # Fallback to prefix matching if no exact match
        if estimated_response is None:
            estimated_response = self.config.tool_estimates["default"]
            for keyword, estimate in self.config.tool_estimates.items():
                if keyword != "default" and tool_name_lower.startswith(keyword):
                    estimated_response = estimate
                    break

        # Adjust for limit parameter
        if "limit" in params:
            limit = params.get("limit", 50)
            estimated_response = min(estimated_response * (limit / 20), 10000)

        total = base_overhead + param_tokens + estimated_response

        logger.debug(
            f"Token estimate for {tool_name}: {total} "
            f"(overhead={base_overhead}, params={param_tokens}, response={estimated_response})"
        )

        return total

    def check_before_tool_call(self, tool_name: str, params: Dict[str, Any]) -> bool:
        """Check if tool call is allowed within budget.

        Raises:
            ToolCallLimitExceeded: If tool call limit exceeded
            TokenBudgetExceeded: If token budget would be exceeded
        """
        self.tool_call_count += 1

        if self.tool_call_count > self.MAX_TOOL_CALLS:
            message = (
                f"Reached limit of {self.MAX_TOOL_CALLS} tool calls. "
                f"Collected {len(self.collected_results)} partial results."
            )
            logger.warning(message)
            raise ToolCallLimitExceeded(message)

        estimated = self.estimate_tool_tokens(tool_name, params)

        if self.consumed_tokens + estimated > self.MAX_TOKENS:
            message = (
                f"Token budget exceeded ({self.consumed_tokens + estimated} > {self.MAX_TOKENS}). "
                f"Collected {len(self.collected_results)} partial results."
            )
            logger.warning(message)
            raise TokenBudgetExceeded(message)

        self.consumed_tokens += estimated
        return True

    def add_result(self, tool_name: str, result: Any):
        """Track tool result for potential partial return."""
        self.collected_results.append(
            {
                "tool": tool_name,
                "result": result,
                "tokens_used": self.consumed_tokens,
            }
        )

    def update_consumption(self, result: Any):
        """Update actual token consumption based on result.

        Adjusts the running total by blending the initial estimate with the actual
        result size. We retain a portion of the estimate to account for tool call
        overhead (function name, parameters, formatting) that isn't captured by
        the result size alone.
        """
        actual_tokens = self.estimate_tokens(str(result))
        # Blend estimate with actual: retain overhead estimate, add actual result tokens
        self.consumed_tokens = int((self.consumed_tokens * self._ESTIMATE_ADJUSTMENT_FACTOR) + actual_tokens)

    def get_status(self) -> Dict[str, Any]:
        """Get current budget status."""
        percentage = (self.consumed_tokens / self.MAX_TOKENS) * 100
        return {
            "consumed": self.consumed_tokens,
            "max": self.MAX_TOKENS,
            "percentage": round(percentage, 1),
            "warning": percentage >= (self.config.warning_threshold * 100),
            "tool_calls": self.tool_call_count,
            "max_tool_calls": self.MAX_TOOL_CALLS,
        }

    def get_partial_results_message(self) -> str:
        """Generate message for graceful degradation."""
        return (
            f"⚠️ Token budget limit reached. "
            f"Returning {len(self.collected_results)} results collected so far. "
            f"Please refine your query to be more specific."
        )

    def format_partial_response(self, error_message: str) -> str:
        """Format partial results into user-friendly response."""
        if not self.collected_results:
            return (
                f"⚠️ {error_message}\n\n"
                "No results were collected before reaching the limit. "
                "Please try a more specific query with filters or limits."
            )

        response = f"⚠️ {error_message}\n\n"
        response += f"**Partial Results ({len(self.collected_results)} items):**\n\n"

        for idx, item in enumerate(self.collected_results[:10], 1):  # Show max 10
            response += f"{idx}. Tool: `{item['tool']}`\n"
            # Truncate large results
            result_str = str(item["result"])
            if len(result_str) > 500:
                result_str = result_str[:500] + "..."
            response += f"   Result: {result_str}\n\n"

        if len(self.collected_results) > 10:
            response += f"... and {len(self.collected_results) - 10} more results.\n\n"

        response += (
            "💡 **Suggestion:** Try refining your query with:\n"
            "- More specific filters (e.g., owner, namespace, tags)\n"
            "- Smaller limit parameters\n"
            "- Breaking the request into multiple smaller queries"
        )

        return response
