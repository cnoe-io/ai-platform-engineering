"""Configurable middleware registry and builder for dynamic agents.

Maps string type keys from agent config to langchain middleware classes.
The registry defines default parameters, whether each middleware is
enabled by default, and whether multiple instances are allowed.

``build_middleware`` processes an ordered list of ``MiddlewareEntry``
objects, validates singleton constraints, merges params over defaults,
and instantiates the middleware stack.

Special-case middleware (``pii``, ``llm_tool_selector``, ``model_fallback``,
``context_editing``, ``summarization``, ``human_in_the_loop``, ``shell_tool``,
``filesystem_search``) require model instantiation or non-trivial
construction and are handled with explicit builder functions.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from botocore.config import Config as BotocoreConfig
from cnoe_agent_utils import LLMFactory
from langchain.agents.middleware.context_editing import (
    ClearToolUsesEdit,
    ContextEditingMiddleware,
)
from langchain.agents.middleware.file_search import FilesystemFileSearchMiddleware
from langchain.agents.middleware.human_in_the_loop import HumanInTheLoopMiddleware
from langchain.agents.middleware.model_call_limit import ModelCallLimitMiddleware
from langchain.agents.middleware.model_fallback import ModelFallbackMiddleware
from langchain.agents.middleware.model_retry import ModelRetryMiddleware
from langchain.agents.middleware.pii import PIIMiddleware
from langchain.agents.middleware.shell_tool import ShellToolMiddleware
from langchain.agents.middleware.summarization import SummarizationMiddleware
from langchain.agents.middleware.tool_call_limit import ToolCallLimitMiddleware
from langchain.agents.middleware.tool_retry import ToolRetryMiddleware
from langchain.agents.middleware.tool_selection import LLMToolSelectorMiddleware

if TYPE_CHECKING:
    from collections.abc import Callable

    from langchain.agents.middleware import AgentMiddleware

    from dynamic_agents.models import FeaturesConfig, MiddlewareEntry

from dynamic_agents.metrics import MetricsAgentMiddleware, TimedMiddlewareWrapper

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class MiddlewareSpec:
    """Specification for a registered middleware type."""

    cls: type
    default_params: dict[str, Any]
    enabled_by_default: bool
    allow_multiple: bool
    label: str
    description: str
    model_params: bool = False
    param_schema: dict[str, str] = field(default_factory=dict)
    # Values: "number", "boolean", "string", or "opt1|opt2|..." for selects


# Order defines the default stack order when features is None.
# model_retry and tool_retry first (retries wrap everything),
# limits next (cap runaway usage),
# then optional add-ons.
MIDDLEWARE_REGISTRY: dict[str, MiddlewareSpec] = {
    "model_retry": MiddlewareSpec(
        cls=ModelRetryMiddleware,
        default_params={"max_retries": 5, "backoff_factor": 2.0, "on_failure": "continue"},
        enabled_by_default=True,
        allow_multiple=False,
        label="Model Retry",
        description="Retries failed LLM calls with exponential backoff",
        param_schema={
            "max_retries": "number",
            "backoff_factor": "number",
            "on_failure": "continue|return_message|raise|error|end",
        },
    ),
    "tool_retry": MiddlewareSpec(
        cls=ToolRetryMiddleware,
        default_params={"max_retries": 3, "backoff_factor": 2.0, "initial_delay": 2.0, "on_failure": "return_message"},
        enabled_by_default=True,
        allow_multiple=False,
        label="Tool Retry",
        description="Retries failed tool calls with exponential backoff",
        param_schema={
            "max_retries": "number",
            "backoff_factor": "number",
            "initial_delay": "number",
            "on_failure": "continue|return_message|raise|error|end",
        },
    ),
    "model_call_limit": MiddlewareSpec(
        cls=ModelCallLimitMiddleware,
        default_params={"run_limit": 200, "exit_behavior": "end"},
        enabled_by_default=True,
        allow_multiple=False,
        label="Model Call Limit",
        description="Caps total LLM calls per run to prevent runaway loops",
        param_schema={
            "run_limit": "number",
            "exit_behavior": "end|error|continue",
        },
    ),
    "tool_call_limit": MiddlewareSpec(
        cls=ToolCallLimitMiddleware,
        default_params={"run_limit": 500, "exit_behavior": "continue"},
        enabled_by_default=False,
        allow_multiple=True,
        label="Tool Call Limit",
        description="Caps total tool invocations per run",
        param_schema={
            "run_limit": "number",
            "exit_behavior": "end|error|continue",
        },
    ),
    "context_editing": MiddlewareSpec(
        cls=ContextEditingMiddleware,
        default_params={"trigger": 100_000, "keep": 3},
        enabled_by_default=False,
        allow_multiple=False,
        label="Context Editing",
        description="Clears older tool outputs when approaching token limits",
        param_schema={
            "trigger": "number",
            "keep": "number",
        },
    ),
    "pii": MiddlewareSpec(
        cls=PIIMiddleware,
        default_params={"pii_type": "email", "strategy": "redact"},
        enabled_by_default=False,
        allow_multiple=True,
        label="PII Detection",
        description="Detects and handles Personally Identifiable Information",
        param_schema={
            "pii_type": "email|credit_card|ip|mac_address|url",
            "strategy": "redact|mask|hash|block",
        },
    ),
    "llm_tool_selector": MiddlewareSpec(
        cls=LLMToolSelectorMiddleware,
        default_params={"max_tools": 10},
        enabled_by_default=False,
        allow_multiple=False,
        label="LLM Tool Selector",
        description="Uses an LLM to select relevant tools before calling main model",
        model_params=True,
        param_schema={
            "max_tools": "number",
        },
    ),
    "model_fallback": MiddlewareSpec(
        cls=ModelFallbackMiddleware,
        default_params={},
        enabled_by_default=False,
        allow_multiple=False,
        label="Model Fallback",
        description="Falls back to an alternative model when primary fails",
        model_params=True,
    ),
    "summarization": MiddlewareSpec(
        cls=SummarizationMiddleware,
        default_params={"trigger_tokens": 4000, "trigger_messages": 50, "keep_messages": 20},
        enabled_by_default=False,
        allow_multiple=False,
        label="Conversation Summarization",
        description="Summarizes conversation history when token or message limits are approached",
        model_params=True,
        param_schema={
            "trigger_tokens": "number",
            "trigger_messages": "number",
            "keep_messages": "number",
        },
    ),
    "human_in_the_loop": MiddlewareSpec(
        cls=HumanInTheLoopMiddleware,
        default_params={"tool_names": "", "description_prefix": "Tool execution requires approval"},
        enabled_by_default=False,
        allow_multiple=False,
        label="Human-in-the-Loop",
        description="Pauses agent execution for human approval before sensitive tool calls",
        param_schema={
            "tool_names": "string",
            "description_prefix": "string",
        },
    ),
    "shell_tool": MiddlewareSpec(
        cls=ShellToolMiddleware,
        default_params={"workspace_root": "", "tool_name": "shell"},
        enabled_by_default=False,
        allow_multiple=False,
        label="Shell Tool",
        description="Provides the agent with a persistent shell for executing bash commands",
        param_schema={
            "workspace_root": "string",
            "tool_name": "string",
        },
    ),
    "filesystem_search": MiddlewareSpec(
        cls=FilesystemFileSearchMiddleware,
        default_params={"root_path": "", "use_ripgrep": True, "max_file_size_mb": 10},
        enabled_by_default=False,
        allow_multiple=False,
        label="Filesystem File Search",
        description="Provides glob and grep search tools over a configured filesystem path",
        param_schema={
            "root_path": "string",
            "use_ripgrep": "boolean",
            "max_file_size_mb": "number",
        },
    ),
}


# ---------------------------------------------------------------------------
# Special-case constructors
# ---------------------------------------------------------------------------


def _build_context_editing(params: dict[str, Any]) -> ContextEditingMiddleware:
    """Build ContextEditingMiddleware from flat params.

    Translates the simplified flat config (``trigger``, ``keep``) into the
    nested ``ClearToolUsesEdit`` structure that the middleware expects.
    """
    return ContextEditingMiddleware(
        edits=[
            ClearToolUsesEdit(
                trigger=params.get("trigger", 100_000),
                keep=params.get("keep", 3),
            ),
        ],
    )


def _build_pii(params: dict[str, Any]) -> PIIMiddleware:
    """Build PIIMiddleware from params.

    Each instance handles a single PII type.  Multiple PII types require
    multiple entries in the middleware list.
    """
    return PIIMiddleware(
        pii_type=params.get("pii_type", "email"),
        strategy=params.get("strategy", "redact"),
    )


def _instantiate_model(
    model_id: str,
    model_provider: str,
) -> Any:
    """Instantiate an LLM via LLMFactory for middleware that need a model.

    Args:
        model_id: LLM model identifier.
        model_provider: LLM provider string.

    Returns:
        Initialized BaseChatModel instance.
    """
    boto_config = BotocoreConfig(read_timeout=300, connect_timeout=60)
    return LLMFactory(provider=model_provider).get_llm(
        model=model_id,
        config=boto_config,
    )


def _build_llm_tool_selector(params: dict[str, Any]) -> LLMToolSelectorMiddleware:
    """Build LLMToolSelectorMiddleware from params.

    Requires ``model_id`` and ``model_provider`` in params to instantiate
    the selector LLM.  Falls back to no model (uses agent's own model)
    if not provided.
    """
    kwargs: dict[str, Any] = {"max_tools": params.get("max_tools", 10)}

    model_id = params.get("model_id")
    model_provider = params.get("model_provider")
    if model_id and model_provider:
        kwargs["model"] = _instantiate_model(model_id, model_provider)

    return LLMToolSelectorMiddleware(**kwargs)


def _build_model_fallback(params: dict[str, Any]) -> ModelFallbackMiddleware | None:
    """Build ModelFallbackMiddleware from params.

    Requires ``model_id`` and ``model_provider`` to specify the fallback
    model.  Returns None if no model is configured (middleware is skipped).
    """
    model_id = params.get("model_id")
    model_provider = params.get("model_provider")
    if not model_id or not model_provider:
        logger.warning("model_fallback enabled but no model_id/model_provider configured, skipping")
        return None

    fallback_model = _instantiate_model(model_id, model_provider)
    return ModelFallbackMiddleware(fallback_model)


def _build_summarization(params: dict[str, Any]) -> SummarizationMiddleware | None:
    """Build SummarizationMiddleware from flat params.

    Requires ``model_id`` and ``model_provider`` to instantiate the summarizer LLM.
    Returns None when no model is configured (middleware is skipped).
    """
    model_id = params.get("model_id")
    model_provider = params.get("model_provider")
    if not model_id or not model_provider:
        logger.warning("summarization enabled but no model_id/model_provider configured, skipping")
        return None

    model = _instantiate_model(model_id, model_provider)
    trigger_tokens = int(params.get("trigger_tokens", 4000))
    trigger_messages = int(params.get("trigger_messages", 50))
    keep_messages = int(params.get("keep_messages", 20))
    return SummarizationMiddleware(
        model=model,
        trigger=[("tokens", trigger_tokens), ("messages", trigger_messages)],
        keep=("messages", keep_messages),
    )


def _build_human_in_the_loop(params: dict[str, Any]) -> HumanInTheLoopMiddleware | None:
    """Build HumanInTheLoopMiddleware from flat params.

    Splits the comma-separated ``tool_names`` string into the ``interrupt_on`` dict.
    Returns None when ``tool_names`` is empty (nothing to interrupt on).
    """
    raw = params.get("tool_names", "")
    names = [n.strip() for n in raw.split(",") if n.strip()]
    if not names:
        logger.warning("human_in_the_loop enabled but no tool_names configured, skipping")
        return None
    interrupt_on = {name: True for name in names}
    description_prefix = params.get("description_prefix", "Tool execution requires approval")
    return HumanInTheLoopMiddleware(
        interrupt_on=interrupt_on,
        description_prefix=description_prefix,
    )


def _build_shell_tool(params: dict[str, Any]) -> ShellToolMiddleware:
    """Build ShellToolMiddleware from flat params.

    When ``workspace_root`` is empty, passes None so a temp directory is created per-session.
    """
    workspace_root = params.get("workspace_root") or None
    tool_name = params.get("tool_name", "shell")
    return ShellToolMiddleware(workspace_root=workspace_root, tool_name=tool_name)


def _build_filesystem_search(params: dict[str, Any]) -> FilesystemFileSearchMiddleware | None:
    """Build FilesystemFileSearchMiddleware from flat params.

    Returns None when ``root_path`` is empty (middleware cannot function without a root).
    """
    root_path = params.get("root_path", "")
    if not root_path:
        logger.warning("filesystem_search enabled but no root_path configured, skipping")
        return None
    use_ripgrep = bool(params.get("use_ripgrep", True))
    max_file_size_mb = int(params.get("max_file_size_mb", 10))
    return FilesystemFileSearchMiddleware(
        root_path=root_path,
        use_ripgrep=use_ripgrep,
        max_file_size_mb=max_file_size_mb,
    )


# Keys that need special construction instead of simple cls(**params)
_SPECIAL_BUILDERS: dict[str, Callable[..., Any]] = {
    "context_editing": _build_context_editing,
    "pii": _build_pii,
    "llm_tool_selector": _build_llm_tool_selector,
    "model_fallback": _build_model_fallback,
    "summarization": _build_summarization,
    "human_in_the_loop": _build_human_in_the_loop,
    "shell_tool": _build_shell_tool,
    "filesystem_search": _build_filesystem_search,
}


# ---------------------------------------------------------------------------
# Default stack
# ---------------------------------------------------------------------------


def get_default_middleware_entries() -> list[dict[str, Any]]:
    """Return the default middleware list for agents with no features config.

    Returns a list of dicts matching the ``MiddlewareEntry`` schema so it
    can be used both at runtime and serialized to the UI/API.
    """
    return [
        {"type": key, "enabled": True, "params": dict(spec.default_params)}
        for key, spec in MIDDLEWARE_REGISTRY.items()
        if spec.enabled_by_default
    ]


def get_middleware_definitions() -> list[dict[str, Any]]:
    """Return the middleware registry as a list of dicts for the API.

    Excludes the ``cls`` field (not serializable). The UI uses this to
    render the middleware picker without hardcoding definitions.
    """
    return [
        {
            "key": key,
            "label": spec.label,
            "description": spec.description,
            "enabled_by_default": spec.enabled_by_default,
            "allow_multiple": spec.allow_multiple,
            "default_params": spec.default_params,
            "model_params": spec.model_params,
            "param_schema": spec.param_schema,
        }
        for key, spec in MIDDLEWARE_REGISTRY.items()
    ]


# ---------------------------------------------------------------------------
# Builder
# ---------------------------------------------------------------------------


def build_middleware(
    features: FeaturesConfig | None,
    session_id: str | None = None,
    agent_name: str = "unknown",
    model_id: str = "unknown",
) -> list[AgentMiddleware]:
    """Build the middleware stack from an agent's features config.

    When ``features`` is None (agent has no features config in MongoDB),
    all default-enabled middleware are applied with default params.

    When ``features.middleware`` is an explicit list, entries are processed
    in order.  Disabled entries are skipped.  Singleton middleware types
    that appear more than once log a warning and only the first is used.

    Each middleware is wrapped with ``TimedMiddlewareWrapper`` for
    per-middleware Prometheus timing, and a ``MetricsAgentMiddleware``
    is appended at the end to record total LLM/tool call duration.

    Args:
        features: Agent features config, or None for all defaults.
        session_id: Optional conversation ID for log context.
        agent_name: Agent name for metric labels.
        model_id: Model identifier for metric labels.

    Returns:
        Ordered list of middleware instances.
    """
    conv = session_id or "-"
    if features is None or not features.middleware:
        # No explicit config — apply all default-enabled middleware
        entries: list[MiddlewareEntry] = []
        # Import here to avoid circular import at module level
        from dynamic_agents.models import MiddlewareEntry as ME

        for key, spec in MIDDLEWARE_REGISTRY.items():
            if spec.enabled_by_default:
                entries.append(ME(type=key, enabled=True, params=dict(spec.default_params)))
    else:
        entries = features.middleware

    result: list[AgentMiddleware] = []
    seen_singletons: set[str] = set()

    for entry in entries:
        if not entry.enabled:
            continue

        spec = MIDDLEWARE_REGISTRY.get(entry.type)
        if spec is None:
            logger.warning("conv=%s Unknown middleware type '%s', skipping", conv, entry.type)
            continue

        # Enforce singleton constraint
        if not spec.allow_multiple:
            if entry.type in seen_singletons:
                logger.warning(
                    "conv=%s Middleware '%s' does not allow multiple instances, skipping duplicate",
                    conv,
                    entry.type,
                )
                continue
            seen_singletons.add(entry.type)

        # Merge user params over defaults
        params = {**spec.default_params, **entry.params}

        # Special-case construction for middleware with non-trivial init
        builder = _SPECIAL_BUILDERS.get(entry.type)
        if builder is not None:
            instance = builder(params)
            if instance is None:
                continue
        else:
            instance = spec.cls(**params)

        result.append(instance)
        logger.debug("conv=%s Middleware '%s' added with params: %s", conv, entry.type, params)

    # Wrap each middleware with timing instrumentation
    result = [TimedMiddlewareWrapper(mw, agent_name=agent_name) for mw in result]

    # Append MetricsAgentMiddleware at the end to capture total LLM/tool duration
    result.append(MetricsAgentMiddleware(agent_name=agent_name, model_id=model_id))

    logger.info(
        "conv=%s Built middleware stack: %s",
        conv,
        [type(m).__name__ for m in result],
    )
    return result
