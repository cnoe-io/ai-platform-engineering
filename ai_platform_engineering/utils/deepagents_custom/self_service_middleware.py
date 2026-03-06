"""Middleware to inject available self-service workflows into the system prompt.

Instead of requiring the LLM to call a ``list_self_service_workflows`` tool
before invoking a workflow, this middleware queries MongoDB (with YAML
fallback) on every model call and appends the current workflow list
directly into the system prompt.  The result is cached via the existing
``load_task_config`` TTL cache, so there is no extra DB round-trip on
successive calls within the same cache window.
"""

import logging

try:
    from langchain.agents.middleware.types import AgentMiddleware, AgentState, ModelRequest
except ImportError:
    try:
        from langchain.agents.middleware import AgentMiddleware, AgentState, ModelRequest
    except ImportError:
        from deepagents.middleware import AgentMiddleware, AgentState, ModelRequest

logger = logging.getLogger(__name__)


class SelfServiceWorkflowMiddleware(AgentMiddleware):
    """Dynamically injects available self-service workflow names into the system prompt."""

    def _build_workflow_prompt_section(self) -> str:
        """Query MongoDB/YAML for workflow names and build a prompt section."""
        try:
            from ai_platform_engineering.multi_agents.platform_engineer.deep_agent_single import (
                load_task_config,
            )

            config = load_task_config()
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

    def modify_model_request(
        self, request: ModelRequest, agent_state: AgentState
    ) -> ModelRequest:
        section = self._build_workflow_prompt_section()
        if section and hasattr(request, "system_prompt") and request.system_prompt:
            request.system_prompt = request.system_prompt + section
        return request
