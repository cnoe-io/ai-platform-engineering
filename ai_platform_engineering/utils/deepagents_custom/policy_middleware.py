# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""Policy-based tool call authorization using Clingo/Clorm ASP solver.

This middleware evaluates tool calls against a declarative ASP policy file,
allowing fine-grained control over which tools can be executed by which agents.

The policy file (policy.lp) uses Answer Set Programming to define authorization
rules. The policy:
- Allows read-only GitHub MCP tools for all agents
- Allows create_repository and create_pull_request only in self-service mode
- Blocks write operations by default
- Allows all tools for non-GitHub agents (Jira, Webex, etc.)

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
        from langchain.agents.middleware import AgentMiddleware, AgentState
        from langgraph.prebuilt.tool_node import ToolCallRequest
    except ImportError:
        from deepagents.middleware import AgentMiddleware, AgentState
        ToolCallRequest = Any

try:
    from clorm import Predicate, ConstantStr, FactBase
    from clorm.clingo import Control
    CLORM_AVAILABLE = True
except ImportError:
    CLORM_AVAILABLE = False
    Predicate = object
    ConstantStr = str

# Import self-service mode helper function
try:
    from ai_platform_engineering.agents.github.agent_github.tools import is_self_service_mode
except ImportError:
    # Fallback if the import fails
    def is_self_service_mode() -> bool:
        return False

logger = logging.getLogger(__name__)


# Clorm predicates matching policy.lp
if CLORM_AVAILABLE:
    class ToolCallFact(Predicate):
        """Represents a tool call fact: tool_call(ToolName, AgentName)."""
        class Meta:
            name = "tool_call"
        tool_name: ConstantStr
        agent_name: ConstantStr

    class AgentTypeFact(Predicate):
        """Represents an agent type fact: agent_type(AgentName, Type)."""
        class Meta:
            name = "agent_type"
        agent_name: ConstantStr
        agent_type: ConstantStr  # "deep_agent" or "subagent"

    class SelfServiceModeFact(Predicate):
        """Represents self-service mode fact: self_service_mode."""
        class Meta:
            name = "self_service_mode"
        # No fields - this is a nullary predicate (0-arity fact)

    class AllowFact(Predicate):
        """Represents an allow fact: allow(ToolName, AgentName)."""
        class Meta:
            name = "allow"
        tool_name: ConstantStr
        agent_name: ConstantStr
else:
    # Stub classes when clorm is not available
    ToolCallFact = None
    AgentTypeFact = None
    SelfServiceModeFact = None
    AllowFact = None


class PolicyMiddleware(AgentMiddleware):
    """Middleware that evaluates tool calls against ASP policy.
    
    This middleware intercepts tool calls and checks them against a declarative
    policy defined in an ASP (Answer Set Programming) file using Clingo/Clorm.
    
    By default, the policy allows all tool calls from deep agents and subagents.
    The policy can be customized by editing policy/policy.lp.
    
    Args:
        policy_path: Path to the ASP policy file. If None, uses default location.
        agent_name: Name of the agent for policy evaluation.
        agent_type: Type of agent ("deep_agent" or "subagent").
        enabled: Whether policy checking is enabled. Defaults to POLICY_ENABLED env var.
    
    Example:
        >>> middleware = PolicyMiddleware(
        ...     agent_name="github",
        ...     agent_type="subagent"
        ... )
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
        self.agent_type = agent_type  # "deep_agent" or "subagent"
        
        # Check if enabled via parameter or environment variable
        if enabled is not None:
            self.enabled = enabled
        else:
            self.enabled = os.getenv("POLICY_ENABLED", "true").lower() in ("true", "1", "yes")
        
        # Warn if clorm is not available
        if not CLORM_AVAILABLE:
            logger.warning(
                "Clorm is not installed. PolicyMiddleware will allow all tool calls. "
                "Install with: pip install clorm"
            )
    
    def _find_policy_file(self) -> str:
        """Find policy.lp file.
        
        Checks in order:
        1. POLICY_FILE_PATH environment variable
        2. Default location: {repo_root}/policy/policy.lp
        
        Returns:
            Path to the policy file
        """
        # Check environment variable first
        if env_path := os.getenv("POLICY_FILE_PATH"):
            return env_path
        
        # Default location relative to this file
        # This file is at: ai_platform_engineering/utils/deepagents_custom/policy_middleware.py
        # Policy is at: policy/policy.lp
        return str(Path(__file__).parents[3] / "policy" / "policy.lp")
    
    def _check_self_service_mode(self) -> bool:
        """Check if we're running in self-service mode.
        
        Self-service mode is set by DeterministicTaskMiddleware when executing
        workflows from task_config.yaml via invoke_self_service_task.
        
        Returns:
            True if self-service mode is active
        """
        try:
            result = is_self_service_mode()
            logger.debug(f"[PolicyMiddleware] is_self_service_mode() returned: {result}")
            return result
        except Exception as e:
            logger.warning(f"[PolicyMiddleware] is_self_service_mode() exception: {e}")
            return False

    def _is_allowed(self, tool_name: str) -> bool:
        """Evaluate if tool call is allowed by ASP policy.
        
        Loads the policy file, adds facts about the current tool call,
        and solves to check if allowed(tool_name, agent_name) is derived.
        
        The policy considers:
        - Tool name and agent name
        - Agent type (deep_agent or subagent)
        - Self-service mode (enables create_repository, create_pull_request)
        
        Args:
            tool_name: Name of the tool being called
            
        Returns:
            True if the tool call is allowed, False otherwise
        """
        if not CLORM_AVAILABLE:
            # If clorm is not available, allow all by default
            return True
        
        if not self.enabled:
            # If policy checking is disabled, allow all
            return True
        
        # Check if policy file exists
        if not os.path.exists(self.policy_path):
            logger.warning(f"Policy file not found: {self.policy_path}, allowing tool call")
            return True
        
        try:
            # Create Clingo control with unifiers for our predicates
            ctrl = Control(unifier=[ToolCallFact, AgentTypeFact, SelfServiceModeFact, AllowFact])
            ctrl.load(self.policy_path)
            
            # Build facts list
            facts_list = [
                ToolCallFact(tool_name=tool_name, agent_name=self.agent_name),
                AgentTypeFact(agent_name=self.agent_name, agent_type=self.agent_type),
            ]
            
            # Add self_service_mode fact if active
            is_self_service = self._check_self_service_mode()
            if is_self_service:
                facts_list.append(SelfServiceModeFact())
                logger.debug(f"Policy evaluation with self_service_mode=True for {tool_name}")
            
            facts = FactBase(facts_list)
            ctrl.add_facts(facts)
            ctrl.ground([("base", [])])
            
            # Solve and check for allowed/2 predicate
            solution = None
            def on_model(model):
                nonlocal solution
                solution = model.facts(atoms=True)
            
            ctrl.solve(on_model=on_model)
            
            if solution:
                # Check if allow(tool_name, agent_name) is in the solution
                for fact in solution.query(AllowFact).all():
                    if fact.tool_name == tool_name and fact.agent_name == self.agent_name:
                        logger.debug(f"Policy allowed tool call: {tool_name} by {self.agent_name}")
                        return True
            
            logger.info(f"Policy denied tool call: {tool_name} by {self.agent_name} (self_service={is_self_service})")
            return False
            
        except Exception as e:
            logger.warning(f"Policy evaluation failed, defaulting to allow: {e}")
            # On error, default to allow to avoid breaking functionality
            return True
    
    def wrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], ToolMessage | Command],
    ) -> ToolMessage | Command:
        """Sync version - check policy before executing tool.
        
        Args:
            request: The tool call request containing tool name and arguments
            handler: The next handler in the middleware chain
            
        Returns:
            ToolMessage with denial if policy blocks, otherwise handler result
        """
        tool_name = request.tool_call.get("name", "")
        tool_call_id = request.tool_call.get("id", "")
        
        if not self._is_allowed(tool_name):
            logger.warning(f"Policy denied tool call: {tool_name} by agent {self.agent_name}")
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
        """Async version - check policy before executing tool.
        
        Args:
            request: The tool call request containing tool name and arguments
            handler: The next async handler in the middleware chain
            
        Returns:
            ToolMessage with denial if policy blocks, otherwise handler result
        """
        tool_name = request.tool_call.get("name", "")
        tool_call_id = request.tool_call.get("id", "")
        
        if not self._is_allowed(tool_name):
            logger.warning(f"Policy denied tool call: {tool_name} by agent {self.agent_name}")
            return ToolMessage(
                content=f"Tool '{tool_name}' denied by policy. Contact administrator if this is unexpected.",
                tool_call_id=tool_call_id,
            )
        
        return await handler(request)


__all__ = [
    "PolicyMiddleware",
    "CLORM_AVAILABLE",
]
