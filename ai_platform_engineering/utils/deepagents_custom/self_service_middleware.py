"""Middleware to inject available self-service workflows into the system prompt.

Instead of requiring the LLM to call a ``list_self_service_workflows`` tool
before invoking a workflow, this middleware queries MongoDB (with YAML
fallback) on every model call and appends the current workflow list
directly into the system prompt.  The result is cached via the existing
``load_task_config`` TTL cache, so there is no extra DB round-trip on
successive calls within the same cache window.

Workflows are scoped per-user: system/global workflows are always shown,
while custom workflows are only visible to the user who created them.

Uses ``before_model`` to capture user_email from state and
``wrap_model_call`` to modify the system prompt, since the deepagents
framework does not call ``modify_model_request``.
"""

import logging
from typing import Any, Awaitable, Callable, Optional

try:
    from langchain.agents.middleware.types import (
        AgentMiddleware,
        ModelCallResult,
        ModelRequest,
        ModelResponse,
    )
except ImportError:
    try:
        from langchain.agents.middleware import (
            AgentMiddleware,
            ModelCallResult,
            ModelRequest,
            ModelResponse,
        )
    except ImportError:
        from deepagents.middleware import AgentMiddleware
        ModelRequest = Any
        ModelResponse = Any
        ModelCallResult = Any

logger = logging.getLogger(__name__)


class SelfServiceWorkflowMiddleware(AgentMiddleware):
    """Dynamically injects available self-service workflow names into the system prompt.

    Hooks used:
      * ``before_model`` — captures ``user_email`` from graph state.
      * ``wrap_model_call`` / ``awrap_model_call`` — appends the workflow
        list to ``request.system_prompt`` before the LLM is invoked.
    """

    def __init__(self) -> None:
        self._user_email: Optional[str] = None

    def _build_workflow_prompt_section(self, user_email: Optional[str] = None) -> str:
        """Query MongoDB/YAML for workflow names visible to *user_email*."""
        try:
            from ai_platform_engineering.multi_agents.platform_engineer.deep_agent_single import (
                load_task_config,
            )

            config = load_task_config(user_email=user_email)
            if not config:
                return ""

            names = list(config.keys())
            if not names:
                return ""

            lines = [f"- {name}" for name in names]
            return (
                "\n\n## Currently Available Self-Service Workflows\n\n"
                f"There are **{len(names)}** workflows available:\n"
                + "\n".join(lines)
                + "\n\nWhen a user's request matches one of these, call "
                "`invoke_self_service_task(task_name=\"<exact name>\")` immediately. "
                "Do NOT call `list_self_service_workflows` first."
            )
        except Exception as exc:
            logger.warning(f"SelfServiceWorkflowMiddleware: failed to load workflows: {exc}")
            return ""

    # -- before_model: extract user_email from state --------------------------

    def before_model(self, state: Any, runtime: Any = None) -> None:
        if isinstance(state, dict):
            self._user_email = state.get("user_email")
        elif hasattr(state, "user_email"):
            self._user_email = getattr(state, "user_email", None)
        return None

    async def abefore_model(self, state: Any, runtime: Any = None) -> None:
        return self.before_model(state, runtime)

    # -- wrap_model_call: inject workflows into system prompt -----------------

    def _inject_workflows(self, request: ModelRequest) -> None:
        section = self._build_workflow_prompt_section(user_email=self._user_email)
        if section and hasattr(request, "system_prompt") and request.system_prompt:
            request.system_prompt = request.system_prompt + section

    def wrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], ModelResponse],
    ) -> ModelCallResult:
        self._inject_workflows(request)
        return handler(request)

    async def awrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], Awaitable[ModelResponse]],
    ) -> ModelCallResult:
        self._inject_workflows(request)
        return await handler(request)
