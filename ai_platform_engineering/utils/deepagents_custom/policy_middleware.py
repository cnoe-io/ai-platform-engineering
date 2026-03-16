# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""Policy-based tool call authorization using Clingo/Clorm ASP solver.

This middleware evaluates tool calls against a declarative ASP policy file,
allowing fine-grained control over which tools can be executed by which agents
**and which user roles**.

The policy file (policy.lp) uses Answer Set Programming to define authorization
rules.  The policy considers:
- Tool name and agent name / type
- Self-service mode (enables repository creation, etc.)
- **User role** (``admin`` or ``user``) — injected from verified JWT identity

Environment Variables:
    POLICY_FILE_PATH: Path to the ASP policy file (default: policy/policy.lp)
    POLICY_ENABLED: Enable/disable policy checking (default: true)
"""

import logging
import os
from pathlib import Path
from typing import Any, Callable, Awaitable

from langchain_core.messages import ToolMessage
from langgraph.types import Command

try:
    from langchain.agents.middleware.types import AgentMiddleware, AgentState
    from langgraph.prebuilt.tool_node import ToolCallRequest
except ImportError:
    try:
        from langchain.agents.middleware import AgentMiddleware, AgentState  # noqa: F401
        from langgraph.prebuilt.tool_node import ToolCallRequest
    except ImportError:
        from deepagents.middleware import AgentMiddleware
        ToolCallRequest = Any

try:
    from clorm import Predicate, ConstantStr, FactBase
    from clorm.clingo import Control
    CLORM_AVAILABLE = True
except ImportError:
    CLORM_AVAILABLE = False
    Predicate = object
    ConstantStr = str

try:
    from ai_platform_engineering.agents.github.agent_github.tools import is_self_service_mode
except ImportError:
    def is_self_service_mode() -> bool:
        return False

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Clorm predicates matching policy.lp
# ---------------------------------------------------------------------------
if CLORM_AVAILABLE:
    class ToolCallFact(Predicate):
        """tool_call(ToolName, AgentName)."""
        class Meta:
            name = "tool_call"
        tool_name: ConstantStr
        agent_name: ConstantStr

    class AgentTypeFact(Predicate):
        """agent_type(AgentName, Type)."""
        class Meta:
            name = "agent_type"
        agent_name: ConstantStr
        agent_type: ConstantStr

    class SelfServiceModeFact(Predicate):
        """self_service_mode (nullary)."""
        class Meta:
            name = "self_service_mode"

    class UserRoleFact(Predicate):
        """user_role(Role) — injected from verified JWT identity."""
        class Meta:
            name = "user_role"
        role: ConstantStr

    class AllowFact(Predicate):
        """allow(ToolName, AgentName)."""
        class Meta:
            name = "allow"
        tool_name: ConstantStr
        agent_name: ConstantStr
else:
    ToolCallFact = None
    AgentTypeFact = None
    SelfServiceModeFact = None
    UserRoleFact = None
    AllowFact = None


class PolicyMiddleware(AgentMiddleware):
    """Middleware that evaluates tool calls against ASP policy.

    Intercepts tool calls and checks them against a declarative policy
    defined in an ASP (Answer Set Programming) file using Clingo/Clorm.
    The policy can incorporate user role (``admin`` / ``user``) to enforce
    role-based tool access control.

    Args:
        policy_path: Path to the ASP policy file.  If None, uses default.
        agent_name: Name of the agent for policy evaluation.
        agent_type: Type of agent (``"deep_agent"`` or ``"subagent"``).
        enabled: Whether policy checking is enabled.  Defaults to
            the ``POLICY_ENABLED`` env var.
    """

    def __init__(
        self,
        policy_path: str = None,
        agent_name: str = "default",
        agent_type: str = "deep_agent",
        enabled: bool = None,
    ):
        super().__init__()
        self.policy_path = policy_path or self._find_policy_file()
        self.agent_name = agent_name
        self.agent_type = agent_type

        if enabled is not None:
            self.enabled = enabled
        else:
            self.enabled = os.getenv("POLICY_ENABLED", "true").lower() in ("true", "1", "yes")

        if not CLORM_AVAILABLE:
            logger.warning(
                "Clorm is not installed. PolicyMiddleware will allow all tool calls. "
                "Install with: pip install clorm"
            )

    def _find_policy_file(self) -> str:
        if env_path := os.getenv("POLICY_FILE_PATH"):
            return env_path
        return str(Path(__file__).parents[3] / "policy" / "policy.lp")

    def _check_self_service_mode(self) -> bool:
        try:
            result = is_self_service_mode()
            logger.debug("[PolicyMiddleware] is_self_service_mode() returned: %s", result)
            return result
        except Exception as e:
            logger.warning("[PolicyMiddleware] is_self_service_mode() exception: %s", e)
            return False

    @staticmethod
    def _extract_user_role(request: Any) -> str | None:
        """Extract the verified user role from the tool-call request's graph state.

        Returns ``None`` when no verified role is present (no JWT was processed).
        """
        state = getattr(request, "state", None)
        if state is not None and isinstance(state, dict):
            return state.get("verified_user_role")
        return None

    def _is_allowed(self, tool_name: str, user_role: str | None = None) -> bool:
        """Evaluate if a tool call is allowed by ASP policy.

        Injects the following facts before solving:
        - ``tool_call(ToolName, AgentName)``
        - ``agent_type(AgentName, Type)``
        - ``self_service_mode`` (conditional)
        - ``user_role(Role)`` — only when *user_role* is not None
        """
        if not CLORM_AVAILABLE:
            return True

        if not self.enabled:
            return True

        if not os.path.exists(self.policy_path):
            logger.warning("Policy file not found: %s, allowing tool call", self.policy_path)
            return True

        try:
            ctrl = Control(unifier=[
                ToolCallFact, AgentTypeFact, SelfServiceModeFact,
                UserRoleFact, AllowFact,
            ])
            ctrl.load(self.policy_path)

            facts_list = [
                ToolCallFact(tool_name=tool_name, agent_name=self.agent_name),
                AgentTypeFact(agent_name=self.agent_name, agent_type=self.agent_type),
            ]

            if user_role is not None:
                facts_list.append(UserRoleFact(role=user_role))

            is_self_service = self._check_self_service_mode()
            if is_self_service:
                facts_list.append(SelfServiceModeFact())
                logger.debug("Policy evaluation with self_service_mode=True for %s", tool_name)

            facts = FactBase(facts_list)
            ctrl.add_facts(facts)
            ctrl.ground([("base", [])])

            solution = None
            def on_model(model):
                nonlocal solution
                solution = model.facts(atoms=True)

            ctrl.solve(on_model=on_model)

            if solution:
                for fact in solution.query(AllowFact).all():
                    if fact.tool_name == tool_name and fact.agent_name == self.agent_name:
                        logger.debug("Policy allowed tool call: %s by %s (role=%s)", tool_name, self.agent_name, user_role)
                        return True

            logger.info(
                "Policy denied tool call: %s by %s (role=%s, self_service=%s)",
                tool_name, self.agent_name, user_role, is_self_service,
            )
            return False

        except Exception as e:
            logger.warning("Policy evaluation failed, defaulting to allow: %s", e)
            return True

    def wrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], ToolMessage | Command],
    ) -> ToolMessage | Command:
        """Sync version — check policy before executing tool."""
        tool_name = request.tool_call.get("name", "")
        tool_call_id = request.tool_call.get("id", "")
        user_role = self._extract_user_role(request)

        if not self._is_allowed(tool_name, user_role=user_role):
            logger.warning("Policy denied tool call: %s by agent %s (role=%s)", tool_name, self.agent_name, user_role)
            return ToolMessage(
                content=f"Tool '{tool_name}' denied by policy. Contact administrator if this is unexpected.",
                tool_call_id=tool_call_id,
            )

        return handler(request)

    async def awrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], Awaitable[ToolMessage | Command]],
    ) -> ToolMessage | Command:
        """Async version — check policy before executing tool."""
        tool_name = request.tool_call.get("name", "")
        tool_call_id = request.tool_call.get("id", "")
        user_role = self._extract_user_role(request)

        if not self._is_allowed(tool_name, user_role=user_role):
            logger.warning("Policy denied tool call: %s by agent %s (role=%s)", tool_name, self.agent_name, user_role)
            return ToolMessage(
                content=f"Tool '{tool_name}' denied by policy. Contact administrator if this is unexpected.",
                tool_call_id=tool_call_id,
            )

        return await handler(request)


__all__ = [
    "PolicyMiddleware",
    "CLORM_AVAILABLE",
]
