# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
Platform Engineer Deep Agent using the deepagents library.

This agent orchestrates self-service workflows defined in task_config.yaml
using specialized subagents for GitHub, AWS, ArgoCD, AIGateway, Backstage, Jira, and Webex.

Note: MyID operations (group management, GitHub org invitations) are handled through
GitHub workflows triggered via the GitHub subagent, not a dedicated MyID subagent.
"""

import logging
import uuid
import os
import threading
import asyncio
import time
import yaml
import httpx
from pathlib import Path
from typing import Optional, Dict, Any, List, Annotated, Union
import operator

from langchain_core.messages import AIMessage, ToolMessage
from langchain_core.language_models import LanguageModelLike
from langchain_core.tools import tool, StructuredTool, InjectedToolCallId
from langgraph.graph.state import CompiledStateGraph
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command
from cnoe_agent_utils import LLMFactory
from langchain_mcp_adapters.client import MultiServerMCPClient
from pydantic import BaseModel, Field
from langchain.tools.tool_node import InjectedState

from ai_platform_engineering.utils.auth.jwt_context import get_jwt_user_context
from ai_platform_engineering.utils.subagent_prompts import load_subagent_prompt_config

# Upstream deepagents package (pip-installed)
from deepagents import create_deep_agent

# Custom middleware and utilities from our package
from ai_platform_engineering.utils.deepagents_custom.middleware import (
    DeterministicTaskMiddleware,
)
from ai_platform_engineering.utils.deepagents_custom.file_arg_middleware import (
    CallToolWithFileArgMiddleware,
)
from ai_platform_engineering.utils.deepagents_custom.policy_middleware import (
    PolicyMiddleware,
)
from ai_platform_engineering.utils.deepagents_custom.self_service_middleware import (
    SelfServiceWorkflowMiddleware,
)
from langchain.agents.middleware.model_retry import ModelRetryMiddleware
from ai_platform_engineering.utils.deepagents_custom.tools import (
    tool_result_to_file,
    wait,
)
from ai_platform_engineering.utils.deepagents_custom.tool_error_handling import (
    wrap_tools_with_error_handling,
)

# Skills middleware: upstream SkillsMiddleware + custom catalog layer
from deepagents.middleware.skills import SkillsMiddleware
from deepagents.backends.state import StateBackend
from ai_platform_engineering.skills_middleware import (
    get_merged_skills,
    build_skills_files,
)
from ai_platform_engineering.utils.agent_tools.terraform_fmt_tool import terraform_fmt
from ai_platform_engineering.utils.deepagents_custom.state import DeepAgentState

# Agent classes are imported lazily inside their create_*_subagent_def functions
# to avoid requiring agent PYTHONPATH at import time (test compatibility).

# Prompt configuration utilities
from ai_platform_engineering.utils.prompt_config import (
    load_platform_config,
    generate_platform_system_prompt,
)
from ai_platform_engineering.multi_agents.platform_engineer.rag_prompts import get_rag_instructions

from ai_platform_engineering.multi_agents.tools import (
    curl,
    get_current_date,
    jq,
    yq,
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Remote A2A agent tool
from ai_platform_engineering.utils.a2a_common.a2a_remote_agent_connect import A2ARemoteAgentConnectTool
from ai_platform_engineering.multi_agents.platform_engineer.rag_tools import FetchDocumentCapWrapper, SearchCapWrapper
from ai_platform_engineering.multi_agents.platform_engineer.response_format import PlatformEngineerResponse

# Configuration
ENABLE_RAG = os.getenv("ENABLE_RAG", "false").lower() in ("true", "1", "yes")
RAG_SERVER_URL = os.getenv("RAG_SERVER_URL", "http://localhost:9446").strip("/")
RAG_CONNECTIVITY_RETRIES = 5
MAX_FETCH_DOCUMENT_CALLS = int(os.getenv("FETCH_DOCUMENT_MAX_CALLS", "10"))
MAX_SEARCH_CALLS = int(os.getenv("SEARCH_MAX_CALLS", "5"))
RAG_CONNECTIVITY_WAIT_SECONDS = 10

# Structured Response Configuration
# When enabled, LLM uses ResponseFormat tool for final answers instead of [FINAL ANSWER] marker.
# This produces more polished output: the LLM makes a final structured call with clean markdown
# in the 'content' field, and narration messages ("I'll search...") stream naturally before tools.
USE_STRUCTURED_RESPONSE = os.getenv("USE_STRUCTURED_RESPONSE", "true").lower() == "true"

# Middleware toggles — disable to reduce latency by skipping write_todos / self-service overhead.
# ENABLE_MIDDLEWARE=false disables ALL optional middleware (master switch).
# Individual toggles override when ENABLE_MIDDLEWARE is true (or unset).
ENABLE_MIDDLEWARE = os.getenv("ENABLE_MIDDLEWARE", "true").lower() == "true"
ENABLE_DETERMINISTIC_MIDDLEWARE = ENABLE_MIDDLEWARE and os.getenv("ENABLE_DETERMINISTIC_MIDDLEWARE", "true").lower() == "true"
ENABLE_SELF_SERVICE_MIDDLEWARE = ENABLE_MIDDLEWARE and os.getenv("ENABLE_SELF_SERVICE_MIDDLEWARE", "true").lower() == "true"
ENABLE_POLICY_MIDDLEWARE = ENABLE_MIDDLEWARE and os.getenv("ENABLE_POLICY_MIDDLEWARE", "true").lower() == "true"
ENABLE_SKILLS_MIDDLEWARE = ENABLE_MIDDLEWARE and os.getenv("ENABLE_SKILLS_MIDDLEWARE", "true").lower() == "true"
ENABLE_FILE_ARG_MIDDLEWARE = ENABLE_MIDDLEWARE and os.getenv("ENABLE_FILE_ARG_MIDDLEWARE", "true").lower() == "true"

ENABLE_USER_INFO_TOOL = os.getenv("ENABLE_USER_INFO_TOOL", "false").lower() in ("true", "1", "yes")
FORWARD_JWT_TO_MCP = os.getenv("FORWARD_JWT_TO_MCP", "false").lower() in ("true", "1", "yes")


def _build_llm_from_prefixed_env(env_prefix: str) -> Optional[LanguageModelLike]:
    """Create an LLM via LLMFactory using prefixed environment variables.

    Looks for ``<env_prefix>LLM_PROVIDER`` (e.g. ``SUBAGENT_GITHUB_LLM_PROVIDER``).
    When found, collects every ``<env_prefix>*`` env var, strips the prefix to
    produce the standard env var names that LLMFactory expects, temporarily
    overrides the process environment, and delegates to LLMFactory.

    This mirrors the ``.env`` pattern used in multi-node containers so that
    every provider LLMFactory supports (OpenAI, Azure, Bedrock, Anthropic,
    Google Gemini, Vertex AI) works identically in single-node (all-in-one) per-agent
    overrides.

    Returns None when ``<env_prefix>LLM_PROVIDER`` is not set.
    """
    provider = os.getenv(f"{env_prefix}LLM_PROVIDER")
    if not provider:
        has_prefixed_vars = any(k.startswith(env_prefix) for k in os.environ if k != f"{env_prefix}LLM_PROVIDER")
        if not has_prefixed_vars:
            return None
        provider = os.getenv("LLM_PROVIDER")
        if not provider:
            return None
        logger.info(
            f"{env_prefix}LLM_PROVIDER not set, defaulting to global LLM_PROVIDER={provider}"
        )

    overrides: Dict[str, str] = {}
    for key, value in os.environ.items():
        if key.startswith(env_prefix):
            standard_key = key[len(env_prefix):]
            overrides[standard_key] = value

    logger.info(
        f"LLM override via LLMFactory: {env_prefix}LLM_PROVIDER={provider}, "
        f"overriding {len(overrides)} env var(s)"
    )

    saved: Dict[str, Optional[str]] = {}
    try:
        for key, value in overrides.items():
            saved[key] = os.environ.get(key)
            os.environ[key] = value
        return LLMFactory(provider).get_llm()
    finally:
        for key, old_value in saved.items():
            if old_value is not None:
                os.environ[key] = old_value
            elif key in os.environ:
                del os.environ[key]


def _get_subagent_model(name: str) -> Optional[Union[str, LanguageModelLike]]:
    """Resolve a per-subagent LLM model override from environment variables.

    Resolution order:

    1. ``SUBAGENT_<NAME>_LLM_PROVIDER`` — full LLMFactory override using
       ``SUBAGENT_<NAME>_*`` env vars (same ``.env`` format as multi-node,
       supports every provider).
    2. ``SUBAGENT_<NAME>_MODEL`` — lightweight ``provider:model-name`` string
       for langchain's init_chat_model (e.g. ``"openai:gpt-4o-mini"``).
       Uses global credentials.
    3. Neither — returns None (fall back to parent agent's model).
    """
    env_prefix = f"SUBAGENT_{name.upper()}_"

    llm = _build_llm_from_prefixed_env(env_prefix)
    if llm is not None:
        return llm

    model = os.getenv(f"{env_prefix}MODEL")
    if model:
        logger.info(f"Per-subagent model override: {env_prefix}MODEL={model}")
        return model

    return None

# Remote A2A agents (run as separate containers, communicate via A2A protocol)

# Legacy toggle (backward compat): treat as DISTRIBUTED_AGENTS=all when true.
DISTRIBUTED_MODE = os.getenv("DISTRIBUTED_MODE", "false").lower() in ("true", "1", "yes")

_ALL_SENTINEL = "__all__"


def _get_distributed_agents() -> set:
    """Parse DISTRIBUTED_AGENTS env var into a set of agent names.

    Returns {_ALL_SENTINEL} when every agent should be distributed,
    a set of specific names for selective distribution,
    or an empty set when all agents should run in-process.

    Resolution: DISTRIBUTED_AGENTS takes precedence over DISTRIBUTED_MODE.
    """
    raw = os.getenv("DISTRIBUTED_AGENTS", "").strip()
    if not raw:
        if DISTRIBUTED_MODE:
            return {_ALL_SENTINEL}
        return set()
    tokens = {t.strip().lower() for t in raw.split(",") if t.strip()}
    if "all" in tokens:
        return {_ALL_SENTINEL}
    return tokens


def _agent_is_distributed(name: str, distributed_set: set) -> bool:
    """Check if a specific agent should run in distributed (remote A2A) mode."""
    return name in distributed_set or _ALL_SENTINEL in distributed_set


def _is_agent_enabled(name: str) -> bool:
    """Check if an agent is enabled via ENABLE_<NAME> env var (defaults to true)."""
    return os.getenv(f"ENABLE_{name.upper()}", "true").lower() in ("true", "1", "yes")


def replace(old, new):
    """Replacement reducer for state updates."""
    return new


class ParentState(DeepAgentState):
    """State schema for the platform engineer deep agent."""
    inputs: Annotated[list[dict], replace]
    results: Annotated[list[dict], operator.add]


# =============================================================================
# CAIPE Structured Response Models (for Human-in-the-Loop forms)
# =============================================================================

class InputField(BaseModel):
    """Model for input field requirements extracted from tool responses."""
    field_name: str = Field(description="The name of the field that should be provided.")
    field_description: str = Field(description="A description of what this field represents.")
    field_values: Optional[List[str]] = Field(default=None, description="Possible values for the field, if any.")
    default_value: Optional[str] = Field(default=None, description="Pre-populated default value for the field.")
    required: bool = Field(default=False, description="Whether this field is required (mandatory).")
    value: Optional[str] = Field(default=None, description="The user-provided value for this field.")


class Metadata(BaseModel):
    """Model for response metadata."""
    input_fields: Optional[List[InputField]] = Field(default=None, description="List of input fields required from the user, if any.")


class CAIPEAgentResponse(BaseModel):
    """Structured response format for CAIPE (Cisco AI Platform Engineering) user input collection."""
    response: str = Field(default="", description="A friendly summary of what information the user needs to provide and why. This is shown in the chat as a text message alongside the form.")
    metadata: Metadata = Field(description="Metadata containing input fields. When requesting input, populate field_name/field_description/required. When returning values, populate the value field.")


def create_caipe_agent_response_tool():
    """Create a tool from CAIPEAgentResponse schema for structured user input collection."""

    def caipe_agent_response(metadata: Metadata, response: str = "") -> str:
        """Request user input when needed. Returns status based on input fields.

        This tool triggers a Human-in-the-Loop interrupt to collect user input via a form.
        """
        input_fields = metadata.input_fields or []

        # Constraint: Must provide input_fields
        if not input_fields:
            return "ERROR: No input_fields provided. You must specify input_fields with field_name, field_description, and required properties."

        # Separate fields by required status
        required_fields = [f for f in input_fields if f.required]
        optional_fields = [f for f in input_fields if not f.required]

        # Check which required fields have values
        required_with_values = [f for f in required_fields if f.value is not None]
        required_missing = [f for f in required_fields if f.value is None]
        optional_with_values = [f for f in optional_fields if f.value is not None]

        # Constraint: If no values at all, waiting for user input
        all_with_values = required_with_values + optional_with_values
        if not all_with_values:
            return "Waiting for user input"

        # Constraint: If required fields are missing, return error explaining what's needed
        if required_missing:
            missing_names = [f.field_name for f in required_missing]
            return f"ERROR: Missing required fields: {', '.join(missing_names)}. Keep calling this tool until all required fields are provided."

        # All required fields provided — user has submitted the form
        result = "USER_FORM_SUBMITTED\n"
        for f in required_with_values + optional_with_values:
            result += f"  {f.field_name}={f.value}\n"

        return result.strip()

    return StructuredTool.from_function(
        func=caipe_agent_response,
        name="CAIPEAgentResponse",
        description="Request user input when needed. Use this to collect structured input from users via forms.",
        args_schema=CAIPEAgentResponse,
    )


# =============================================================================
# Task Config Loading
# =============================================================================

def get_task_config_filename() -> str:
    """Get the task config filename path.

    Uses TASK_CONFIG_PATH env var if set (for Helm/K8s ConfigMap mounts),
    otherwise falls back to task_config.yaml in the repo root.
    """
    env_path = os.getenv("TASK_CONFIG_PATH")
    if env_path:
        return env_path
    current_dir = Path(__file__).parent
    repo_root = current_dir.parent.parent.parent
    return str(repo_root / "task_config.yaml")


def _substitute_env_vars(content: str) -> str:
    """Substitute ${VAR_NAME} patterns with environment variable values.

    Args:
        content: String content with ${VAR_NAME} patterns

    Returns:
        Content with environment variables substituted
    """
    import re

    def replace_env_var(match):
        var_name = match.group(1)
        value = os.getenv(var_name, "")
        if not value:
            logger.warning(f"Environment variable {var_name} not set, using empty string")
        return value

    # Match ${VAR_NAME} pattern
    pattern = r'\$\{([A-Za-z_][A-Za-z0-9_]*)\}'
    return re.sub(pattern, replace_env_var, content)


def _load_task_config_from_yaml() -> dict:
    """Load task configuration from task_config.yaml file (fallback).

    Supports environment variable substitution using ${VAR_NAME} syntax.
    """
    config_path = get_task_config_filename()
    try:
        with open(config_path, 'r') as f:
            content = f.read()

        content = _substitute_env_vars(content)

        config = yaml.safe_load(content)
        logger.info(f"Loaded {len(config)} tasks from {config_path}")
        return config or {}
    except Exception as e:
        logger.error(f"Failed to load task config from YAML: {e}")
        return {}


def _substitute_env_vars_in_configs(configs: dict) -> dict:
    """Apply env var substitution to llm_prompt fields in task configs.

    System workflows seeded from task_config.yaml into MongoDB retain
    ``${VAR_NAME}`` placeholders.  This resolves them at load time using
    the supervisor's environment, matching the YAML-loaded behaviour.
    """
    for task_def in configs.values():
        tasks = task_def.get("tasks")
        if not tasks:
            continue
        for task in tasks:
            prompt = task.get("llm_prompt")
            if prompt and "${" in prompt:
                task["llm_prompt"] = _substitute_env_vars(prompt)
    return configs


def load_task_config(user_email: Optional[str] = None) -> dict:
    """Load task configs from MongoDB (primary), YAML file (fallback).

    When MONGODB_URI is configured, reads from the ``task_configs`` MongoDB
    collection via a shared pymongo client with an in-memory TTL cache.
    Falls back to reading ``task_config.yaml`` from disk when MongoDB is
    unavailable or the collection is empty.

    When *user_email* is provided, only configs visible to that user are
    returned (system/global configs + configs owned by the user).  When
    ``None``, only system/global configs are returned from MongoDB.

    Environment variable substitution (``${VAR_NAME}``) is applied to both
    YAML-sourced and MongoDB-sourced configs so that system workflows seeded
    with ``${JARVIS_WORKFLOWS_REPO}`` etc. resolve at runtime.
    """
    mongodb_uri = os.getenv("MONGODB_URI")
    if mongodb_uri:
        try:
            from ai_platform_engineering.utils.mongodb_client import (
                get_task_configs_for_user,
            )

            configs = get_task_configs_for_user(user_email)
            if configs:
                return _substitute_env_vars_in_configs(configs)
        except Exception as e:
            logger.warning(f"MongoDB unavailable, falling back to YAML: {e}")

    return _load_task_config_from_yaml()


def get_available_task_names(user_email: Optional[str] = None) -> List[str]:
    """Get list of available task names from config."""
    config = load_task_config(user_email=user_email)
    return list(config.keys())


# =============================================================================
# Invoke Self-Service Task Tool
# =============================================================================

@tool
def list_self_service_workflows(
    state: Annotated[dict, InjectedState],
) -> str:
    """List all available self-service workflows that can be invoked.

    Returns the current set of workflow names from the task configuration
    database. Call this tool to discover which workflows are available
    before invoking one with ``invoke_self_service_task``.
    """
    user_email = state.get("user_email") if isinstance(state, dict) else None
    config = load_task_config(user_email=user_email)
    if not config:
        return "No self-service workflows are currently configured."

    names = list(config.keys())
    lines = [f"- {name}" for name in names]
    return (
        f"Available self-service workflows ({len(names)}):\n"
        + "\n".join(lines)
        + "\n\nUse invoke_self_service_task(task_name=\"<name>\") to start one."
    )


def create_invoke_self_service_task_tool():
    """Create the invoke_self_service_task tool for deterministic workflow execution.

    This tool sets up state for task_config.yaml workflows:
    1. Populates state.tasks and state.todos
    2. Sets task_execution_pending=True flag
    3. Returns a simple ToolMessage

    The DeterministicTaskMiddleware.before_model hook then:
    1. Detects the pending flag
    2. Injects AIMessage(task) and jumps to tools
    3. SHORT-CIRCUITS the model call so it never sees incomplete tool pairs
    """

    @tool
    def invoke_self_service_task(
        task_name: str,
        state: Annotated[dict, InjectedState],
        tool_call_id: Annotated[str, InjectedToolCallId],
    ) -> Command:
        """
        Invoke a self-service workflow task defined in task_config.yaml.

        This tool starts a multi-step workflow where each step is delegated to
        a specialized subagent. The workflow executes DETERMINISTICALLY via
        the DeterministicTaskMiddleware - no LLM involvement in task sequencing.

        Flow:
        1. CAIPE subagent collects user input via HITL form
        2. Subsequent subagents execute operations (GitHub, AWS, etc.)
        3. Notification is sent upon completion

        Args:
            task_name: Name of the task (e.g., "Create GitHub Repo")

        Returns:
            Command that sets up state for deterministic execution.
        """
        user_email = state.get("user_email") if isinstance(state, dict) else None
        config = load_task_config(user_email=user_email)

        if task_name not in config:
            available = ", ".join(config.keys())
            return ToolMessage(
                content=f"Task '{task_name}' not found. Available tasks: {available}",
                tool_call_id=tool_call_id,
            )

        task_def = config[task_name]
        tasks = task_def.get("tasks", [])

        if not tasks:
            return ToolMessage(
                content=f"Task '{task_name}' has no steps defined.",
                tool_call_id=tool_call_id,
            )

        # Add task IDs for tracking
        for i, task in enumerate(tasks):
            task["id"] = i

        # Create todos from tasks (all pending initially)
        # Include [SubagentName] prefix so the UI can render agent stickers
        todos = []
        for task in tasks:
            subagent_name = task.get("subagent", "Agent").title()
            display = task.get("display_text") or f"Step {task['id'] + 1}"
            todos.append({
                "id": task["id"],
                "content": f"[{subagent_name}] {display}",
                "status": "pending",
            })

        logger.info(f"Invoking self-service task: {task_name} with {len(tasks)} steps")

        # Build step list for display
        step_list = "\n".join([f"{i+1}. {t.get('display_text', 'Step')}" for i, t in enumerate(tasks)])

        # Determine if this is a system workflow or custom with tool restrictions
        is_system = task_def.get("is_system", True)
        allowed_tools = task_def.get("allowed_tools") if not is_system else None

        update_dict: dict = {
            "tasks": tasks,
            "todos": todos,
            "task_execution_pending": True,
            "messages": [
                ToolMessage(
                    content=f"Starting workflow: {task_name}\n\nThe following {len(tasks)} steps will be executed:\n{step_list}",
                    tool_call_id=tool_call_id,
                ),
            ],
        }

        if allowed_tools:
            update_dict["task_allowed_tools"] = allowed_tools

        return Command(update=update_dict)

    return invoke_self_service_task


def create_get_workflow_definition_tool():
    """Create a tool that returns the full definition of a self-service workflow.

    This lets the LLM inspect the steps, prompts, and subagent assignments for
    any configured workflow before (or instead of) invoking it.
    """

    @tool
    def get_workflow_definition(
        task_name: str,
        state: Annotated[dict, InjectedState],
    ) -> str:
        """Return the full definition of a self-service workflow (task config).

        Shows all steps including display text, the LLM prompt template
        (with environment variables already substituted), and which subagent
        runs each step.  Useful for understanding what a workflow does before
        invoking it, or for answering user questions about available workflows.

        Args:
            task_name: Exact name of the workflow (e.g. "Create GitHub Repo").
        """
        user_email = state.get("user_email") if isinstance(state, dict) else None
        config = load_task_config(user_email=user_email)

        if not config:
            return "No workflows are currently configured."

        if task_name not in config:
            available = ", ".join(config.keys())
            return f"Workflow '{task_name}' not found. Available workflows: {available}"

        task_def = config[task_name]
        tasks = task_def.get("tasks", [])

        if not tasks:
            return f"Workflow '{task_name}' exists but has no steps defined."

        lines = [f"## Workflow: {task_name}", f"Steps: {len(tasks)}"]

        visibility = task_def.get("visibility", "global")
        owner = task_def.get("owner_id", "system")
        is_system = task_def.get("is_system", True)
        lines.append(f"Type: {'system' if is_system else 'custom'} | Visibility: {visibility} | Owner: {owner}")

        allowed_tools = task_def.get("allowed_tools")
        if allowed_tools:
            lines.append(f"Allowed tools: {allowed_tools}")

        lines.append("")

        for i, step in enumerate(tasks):
            display = step.get("display_text", f"Step {i + 1}")
            subagent = step.get("subagent", "general-purpose")
            prompt = step.get("llm_prompt", "(no prompt)")

            lines.append(f"### Step {i + 1}: {display}")
            lines.append(f"Subagent: `{subagent}`")
            lines.append(f"Prompt:\n```\n{prompt.strip()}\n```")
            lines.append("")

        return "\n".join(lines)

    return get_workflow_definition


def create_supervisor_user_info_tool():
    """Create a user_info tool that reads user context from graph state.

    The tool is added once at graph build time but returns per-request data
    because the user fields (email, name, groups) are populated in the
    graph state dict on every invocation.
    """

    @tool
    def user_info(
        state: Annotated[dict, InjectedState],
    ) -> dict:
        """Get information about the current user.

        Use this tool when you need to personalize responses, check user identity,
        or access user group memberships for authorization decisions.

        Returns:
            Dictionary with user information:
            - email: User's email address
            - name: User's display name (may be null)
            - groups: List of group names the user belongs to
        """
        return {
            "email": state.get("user_email", "unknown"),
            "name": state.get("user_name"),
            "groups": state.get("user_groups", []),
        }

    return user_info


# =============================================================================
# Subagent Creation Functions - Using SubAgent dict format
# =============================================================================
# All subagents are created as SubAgent dicts (not CompiledSubAgent runnables).
# This allows SubAgentMiddleware to build them with shared StateBackend for
# filesystem state sharing. The pattern:
# 1. Load MCP tools from agent._load_mcp_tools()
# 2. Get system prompt from agent._get_system_instruction_with_date()
# 3. Return SubAgent dict with {name, description, system_prompt, tools}
# 4. SubAgentMiddleware adds FilesystemMiddleware with shared StateBackend

def create_user_input_subagent_def() -> dict:
    """Create the user input collection subagent definition.

    The subagent collects user input via forms and writes results to filesystem
    for downstream agents to consume.

    Using SubAgent dict format allows SubAgentMiddleware to build it with
    shared StateBackend for filesystem state sharing between all subagents.
    """
    config = load_subagent_prompt_config("user_input")
    system_prompt = config.raw_config.get("system_prompt") or config.get_system_instruction()
    response_tool = create_caipe_agent_response_tool()

    # Include utility tools for filesystem operations
    tools = [
        response_tool,
        tool_result_to_file,  # Save tool output to filesystem
        wait,  # Async sleep for waiting scenarios
    ]

    subagent_def = {
        "name": "user_input",
        "description": "Collects user input via forms, writes to filesystem for downstream agents",
        "system_prompt": system_prompt,
        "tools": tools,
        "interrupt_on": {"CAIPEAgentResponse": True},
        "middleware": [
            ModelRetryMiddleware(max_retries=5, on_failure="continue", backoff_factor=2.0),
            PolicyMiddleware(agent_name="user_input", agent_type="subagent"),
        ],
    }

    model_override = _get_subagent_model("user_input")
    if model_override:
        subagent_def["model"] = model_override

    return subagent_def


async def create_subagent_def(agent_instance, name: str, description: str, prompt_config: dict = None) -> dict:
    """Create a SubAgent dict for use with create_deep_agent.

    Using SubAgent dict format (instead of CompiledSubAgent) allows SubAgentMiddleware
    to build the subagent with shared StateBackend for filesystem state sharing.

    System prompts always use the agent's built-in get_system_instruction(),
    matching multi-node (standalone) mode. The prompt_config.agent_prompts
    entries are routing hints for the supervisor, not subagent system prompts.

    Per-subagent model overrides are resolved from SUBAGENT_<NAME>_MODEL env vars.
    The value should be a provider:model-name string (e.g. "openai:gpt-4o-mini")
    supported by langchain's init_chat_model. When not set, the subagent inherits
    the parent agent's model.

    Args:
        agent_instance: The agent instance with get_mcp_tools() and SYSTEM_INSTRUCTION
        name: Subagent name for routing
        description: Description for LLM routing decisions
        prompt_config: Optional prompt configuration dict (used for model overrides only)

    Returns:
        SubAgent dict with name, description, system_prompt, tools, middleware,
        and optionally model
    """
    # Load MCP tools – pass include_fallback=False so _load_mcp_tools returns
    # an empty list on failure instead of silently substituting gh_cli_execute.
    # In single-node (all-in-one) mode, subagents MUST use MCP tools only — no CLI fallbacks.
    tools = await agent_instance._load_mcp_tools({}, include_fallback=False)

    if tools:
        logger.info(f"{name}: {len(tools)} MCP tools loaded")
    else:
        logger.warning(f"{name}: MCP tools unavailable — subagent will have no domain tools (MCP-only mode)")

    # Add utility tools available to all subagents
    # - tool_result_to_file: Save tool output to filesystem for downstream agents
    # - wait: Async sleep for polling/waiting scenarios
    # Note: FilesystemMiddleware provides read_file, write_file, etc. separately
    tools.extend([tool_result_to_file, wait])

    # Always use the agent's built-in system prompt — it matches what the agent
    # uses in multi-node (standalone) mode and contains rich operational details
    # (tool usage SOPs, account lists, URL patterns, etc.).
    # prompt_config.agent_prompts entries are routing hints for the supervisor,
    # not subagent system prompts.
    system_prompt = agent_instance._get_system_instruction_with_date()
    logger.info(f"📝 Using built-in system_prompt for {name} subagent")

    subagent_def = {
        "name": name,
        "description": description,
        "system_prompt": system_prompt,
        "tools": tools,
        "middleware": [
            ModelRetryMiddleware(max_retries=5, on_failure="continue", backoff_factor=2.0),
            PolicyMiddleware(agent_name=name, agent_type="subagent"),
        ],
    }

    model_override = _get_subagent_model(name)
    if model_override:
        subagent_def["model"] = model_override

    logger.info(
        f"📦 Created SubAgent def for {name} with {len(tools)} tools"
        f"{f', model={model_override}' if model_override else ''}"
    )

    return subagent_def


async def create_github_subagent_def(prompt_config: dict = None) -> dict:
    """Create GitHub subagent definition with MCP server and gh CLI fallback.

    Supports two MCP transport modes (set via GITHUB_MCP_MODE):

    - **http**: Connects to a separate GitHub MCP HTTP pod. The Go server
      uses per-request Bearer auth so the supervisor sends the token
      (App installation token or PAT) in each request header.
    - **stdio** (default): Launches the local Go MCP server via ``go run``.
      Tool loading calls get_mcp_config() directly because the base class
      STDIO path auto-derives a Python server_path that doesn't exist
      (GitHub MCP is a Go project at mcp/mcp_github/, not Python).

    The gh CLI tool is always added alongside MCP tools. policy.lp controls
    which tools are allowed:
    - readonly MCP tools (get_file_contents, etc.) are always allowed
    - write MCP tools (push_files, create_branch, etc.) require self_service_mode
    - gh_cli_execute is allowed in both modes (policy marks it readonly + self_service)
    """
    from ai_platform_engineering.utils.mcp_config import resolve_mcp_mode, is_http_mode
    from ai_platform_engineering.agents.github.agent_github.protocol_bindings.a2a_server.agent import GitHubAgent

    agent = GitHubAgent()
    name = "github"

    mcp_mode = resolve_mcp_mode(name)
    mcp_tools = []

    if is_http_mode(mcp_mode):
        try:
            mcp_tools = await agent._load_mcp_tools(include_fallback=False)
            mcp_tools = wrap_tools_with_error_handling(mcp_tools, agent_name=name)
            logger.info(f"{name}: {len(mcp_tools)} MCP tools loaded via HTTP")
        except Exception as e:
            logger.warning(f"{name}: Failed to load MCP tools via HTTP: {e}", exc_info=True)
    else:
        try:
            mcp_config = agent.get_mcp_config()
            client = MultiServerMCPClient({name: mcp_config})
            try:
                mcp_tools = await client.get_tools()
            except ExceptionGroup:
                mcp_tools = await agent._load_mcp_tools_with_cleanup_handling(client, name)
            mcp_tools = agent._filter_mcp_tools(mcp_tools)
            mcp_tools = wrap_tools_with_error_handling(mcp_tools, agent_name=name)
            logger.info(f"{name}: {len(mcp_tools)} MCP tools loaded via local go run")
        except (ValueError, FileNotFoundError) as e:
            logger.warning(f"{name}: Cannot start local MCP server: {e}")
        except Exception as e:
            logger.warning(f"{name}: Failed to load MCP tools from local server: {e}", exc_info=True)

    tools = list(mcp_tools)

    # gh CLI as fallback for when MCP is unavailable or for simple operations
    gh_tool = agent.get_additional_tools()
    if gh_tool:
        tools.extend(gh_tool)
        logger.info(f"{name}: Added gh CLI fallback tool")

    tools.extend([tool_result_to_file, wait, terraform_fmt])

    # Always use the agent's built-in system prompt (matches multi-node mode)
    system_prompt = agent._get_system_instruction_with_date()
    logger.info(f"📝 Using built-in system_prompt for {name} subagent")

    subagent_def = {
        "name": name,
        "description": "GitHub: repository operations, workflows, PRs",
        "system_prompt": system_prompt,
        "tools": tools,
        "middleware": [
            ModelRetryMiddleware(max_retries=5, on_failure="continue", backoff_factor=2.0),
            PolicyMiddleware(agent_name=name, agent_type="subagent"),
        ],
    }

    model_override = _get_subagent_model(name)
    if model_override:
        subagent_def["model"] = model_override

    logger.info(
        f"📦 Created SubAgent def for {name} with {len(tools)} tools "
        f"({len(mcp_tools)} MCP + {len(gh_tool)} CLI)"
        f"{f', model={model_override}' if model_override else ''}"
    )
    return subagent_def


async def create_aigateway_subagent_def(prompt_config: dict = None) -> dict:
    """Create AIGateway subagent definition with built-in tools (no MCP server)."""
    from ai_platform_engineering.agents.aigateway.agent_aigateway.protocol_bindings.a2a_server.agent import AIGatewayAgent
    agent = AIGatewayAgent()
    subagent_def = await create_subagent_def(agent, "aigateway", "AIGateway: LLM API keys, usage tracking", prompt_config)
    subagent_def["tools"] = agent.get_additional_tools() + subagent_def["tools"]
    return subagent_def


async def create_backstage_subagent_def(prompt_config: dict = None) -> dict:
    """Create Backstage subagent definition with shared filesystem."""
    from ai_platform_engineering.agents.backstage.agent_backstage.protocol_bindings.a2a_server.agent import BackstageAgent
    agent = BackstageAgent()
    return await create_subagent_def(agent, "backstage", "Backstage: catalog queries, component management", prompt_config)


async def create_jira_subagent_def(prompt_config: dict = None) -> dict:
    """Create Jira subagent definition with shared filesystem."""
    from ai_platform_engineering.agents.jira.agent_jira.protocol_bindings.a2a_server.agent import JiraAgent
    agent = JiraAgent()
    return await create_subagent_def(agent, "jira", "Jira: ticket management, issue tracking", prompt_config)


async def create_webex_subagent_def(prompt_config: dict = None) -> dict:
    """Create Webex subagent definition with shared filesystem."""
    from ai_platform_engineering.agents.webex.agent_webex.protocol_bindings.a2a_server.agent import WebexAgent
    agent = WebexAgent()
    return await create_subagent_def(agent, "webex", "Webex: messaging, notifications", prompt_config)


async def create_argocd_subagent_def(prompt_config: dict = None) -> dict:
    """Create ArgoCD subagent definition with shared filesystem."""
    from ai_platform_engineering.agents.argocd.agent_argocd.protocol_bindings.a2a_server.agent import ArgoCDAgent
    agent = ArgoCDAgent()
    return await create_subagent_def(agent, "argocd", "ArgoCD: application deployment, sync management", prompt_config)


async def create_aws_subagent_def(prompt_config: dict = None) -> dict:
    """Create AWS subagent definition with MCP tools and AWS CLI/kubectl tools.

    Unlike most subagents that only use MCP tools, AWS also needs the CLI tools
    because the standalone AWS agent (multi-node) uses aws_cli_execute and
    eks_kubectl_execute as its primary tools. In single-node (all-in-one) mode, MCP tools
    alone may not cover all operations — the CLI tools fill the gap.
    """
    from ai_platform_engineering.agents.aws.agent_aws.agent_langgraph import AWSAgentLangGraph
    from ai_platform_engineering.agents.aws.agent_aws.tools import get_aws_cli_tool, get_eks_kubectl_tool

    agent = AWSAgentLangGraph()
    name = "aws"

    # Load MCP tools via standard path (HTTP to mcp-aws sidecar or STDIO)
    mcp_tools = await agent._load_mcp_tools({}, include_fallback=False)
    if mcp_tools:
        logger.info(f"{name}: {len(mcp_tools)} MCP tools loaded")
    else:
        logger.warning(f"{name}: MCP tools unavailable — will rely on CLI tools only")

    tools = list(mcp_tools)

    # Add AWS CLI tool (reads USE_AWS_CLI_AS_TOOL env var, default true)
    aws_cli_tool = get_aws_cli_tool()
    if aws_cli_tool:
        tools.append(aws_cli_tool)
        logger.info(f"{name}: Added AWS CLI tool (aws_cli_execute)")

    # Add EKS kubectl tool for Kubernetes resource inspection
    try:
        eks_kubectl_tool = get_eks_kubectl_tool()
        if eks_kubectl_tool:
            tools.append(eks_kubectl_tool)
            logger.info(f"{name}: Added EKS kubectl tool (eks_kubectl_execute)")
    except Exception as e:
        logger.warning(f"{name}: Failed to load EKS kubectl tool: {e}")

    tools.extend([tool_result_to_file, wait])

    if not any(t for t in tools if t not in (tool_result_to_file, wait)):
        logger.error(f"{name}: No domain tools available — check MCP config and USE_AWS_CLI_AS_TOOL")

    # Always use the agent's built-in system prompt — it contains dynamically
    # generated account details, profile names, and tool usage patterns from
    # get_system_instruction(). The prompt_config.agent_prompts.aws entry is a
    # routing hint for the supervisor, not an actual subagent system prompt.
    system_prompt = agent._get_system_instruction_with_date()
    logger.info(f"📝 Using built-in system_prompt for {name} subagent (has account/profile details)")

    cli_count = sum(1 for t in tools if t not in (tool_result_to_file, wait) and t not in mcp_tools)
    subagent_def = {
        "name": name,
        "description": "AWS: EC2, EKS, S3 resource management",
        "system_prompt": system_prompt,
        "tools": tools,
        "middleware": [
            ModelRetryMiddleware(max_retries=5, on_failure="continue", backoff_factor=2.0),
            PolicyMiddleware(agent_name=name, agent_type="subagent"),
        ],
    }

    model_override = _get_subagent_model(name)
    if model_override:
        subagent_def["model"] = model_override

    logger.info(
        f"📦 Created SubAgent def for {name} with {len(tools)} tools "
        f"({len(mcp_tools)} MCP + {cli_count} CLI)"
        f"{f', model={model_override}' if model_override else ''}"
    )
    return subagent_def


async def create_pagerduty_subagent_def(prompt_config: dict = None) -> dict:
    """Create PagerDuty subagent definition with shared filesystem."""
    from ai_platform_engineering.agents.pagerduty.agent_pagerduty.protocol_bindings.a2a_server.agent import PagerDutyAgent
    agent = PagerDutyAgent()
    return await create_subagent_def(agent, "pagerduty", "PagerDuty: on-call schedules, incident management", prompt_config)


async def create_slack_subagent_def(prompt_config: dict = None) -> dict:
    """Create Slack subagent definition with shared filesystem."""
    from ai_platform_engineering.agents.slack.agent_slack.protocol_bindings.a2a_server.agent import SlackAgent
    agent = SlackAgent()
    return await create_subagent_def(agent, "slack", "Slack: messaging, channel management", prompt_config)


async def create_splunk_subagent_def(prompt_config: dict = None) -> dict:
    """Create Splunk subagent definition with shared filesystem."""
    from ai_platform_engineering.agents.splunk.agent_splunk.protocol_bindings.a2a_server.agent import SplunkAgent
    agent = SplunkAgent()
    return await create_subagent_def(agent, "splunk", "Splunk: log analysis, alerting", prompt_config)


async def create_komodor_subagent_def(prompt_config: dict = None) -> dict:
    """Create Komodor subagent definition with shared filesystem."""
    from ai_platform_engineering.agents.komodor.agent_komodor.protocol_bindings.a2a_server.agent import KomodorAgent
    agent = KomodorAgent()
    return await create_subagent_def(agent, "komodor", "Komodor: Kubernetes monitoring, troubleshooting", prompt_config)


async def create_confluence_subagent_def(prompt_config: dict = None) -> dict:
    """Create Confluence subagent definition with shared filesystem."""
    from ai_platform_engineering.agents.confluence.agent_confluence.protocol_bindings.a2a_server.agent import ConfluenceAgent
    agent = ConfluenceAgent()
    return await create_subagent_def(agent, "confluence", "Confluence: wiki documentation", prompt_config)


async def create_gitlab_remote_subagent_def(prompt_config: dict = None) -> dict:
    """Create GitLab subagent that delegates to the remote A2A gitlab agent container.

    NOTE: This is a stub subagent definition at the moment and needs building out.
    The remote A2A GitLab agent must be running and reachable for this to function.
    """
    agent_url = _infer_remote_agent_url("gitlab")
    logger.info(f"Creating remote gitlab subagent pointing to {agent_url}")

    a2a_tool = A2ARemoteAgentConnectTool(
        name="gitlab_a2a",
        remote_agent_card=agent_url,
        skill_id="",
        description="Interact with GitLab: projects, issues, merge requests, CI/CD pipelines, repository files, and branches",
    )

    system_prompt = "You are a GitLab assistant. Use the gitlab_a2a tool to interact with GitLab resources."
    if prompt_config:
        agent_cfg = prompt_config.get("agents", {}).get("gitlab", {})
        if agent_cfg.get("system_prompt"):
            system_prompt = agent_cfg["system_prompt"]

    return {
        "name": "gitlab",
        "description": "GitLab: projects, issues, merge requests, CI/CD pipelines, repository operations",
        "system_prompt": system_prompt,
        "tools": [a2a_tool],
    }



# =============================================================================
# Remote A2A Subagents
# =============================================================================

def _infer_remote_agent_url(name: str) -> str:
    """Infer the URL for a remote A2A agent from environment variables."""
    url = os.getenv(f"{name.upper()}_AGENT_URL")
    if url:
        return url
    host = os.getenv(f"{name.upper()}_AGENT_HOST", "localhost")
    port = os.getenv(f"{name.upper()}_AGENT_PORT", "8000")
    return f"http://{host}:{port}"


def _create_remote_a2a_subagent_def(name: str, agent_prompts: dict = None) -> dict:
    """Create a remote A2A subagent def (same pattern as weather/gitlab).

    Wraps the remote agent in an A2ARemoteAgentConnectTool. The tool itself
    fetches the agent card on first use, so no startup connectivity check needed.
    """
    agent_url = _infer_remote_agent_url(name)
    prompts = (agent_prompts or {}).get(name, {})
    system_prompt = prompts.get("system_prompt", f"You are a {name} assistant. Use the {name}_a2a tool to interact with {name}.")
    description = prompts.get("description", f"{name}: operations and management")

    a2a_tool = A2ARemoteAgentConnectTool(
        name=f"{name}_a2a",
        remote_agent_card=agent_url,
        skill_id="",
        description=f"Interact with {name} via remote A2A agent",
    )

    return {
        "name": name,
        "description": description,
        "system_prompt": system_prompt,
        "tools": [a2a_tool],
    }


async def create_weather_remote_subagent_def(prompt_config: dict = None) -> dict:
    """Create Weather subagent that delegates to a remote A2A weather agent."""
    agent_url = _infer_remote_agent_url("weather")
    logger.info(f"Creating remote weather subagent pointing to {agent_url}")

    a2a_tool = A2ARemoteAgentConnectTool(
        name="weather_a2a",
        remote_agent_card=agent_url,
        skill_id="",
        description="Query weather conditions and forecasts via the remote weather agent",
    )

    system_prompt = "You are a weather assistant. Use the weather_a2a tool to answer weather questions."
    if prompt_config:
        agent_cfg = prompt_config.get("agents", {}).get("weather", {})
        if agent_cfg.get("system_prompt"):
            system_prompt = agent_cfg["system_prompt"]

    return {
        "name": "weather",
        "description": "Weather: current conditions, forecasts, and alerts",
        "system_prompt": system_prompt,
        "tools": [a2a_tool],
    }


# Registry of in-process subagents for single-node (all-in-one) mode.
# Each entry maps agent name to its creation function.
# Agents are loaded only when ENABLE_<NAME> env var is "true" (default).
SINGLE_NODE_AGENTS = [
    ("github", create_github_subagent_def),
    ("gitlab", create_gitlab_remote_subagent_def),
    ("aigateway", create_aigateway_subagent_def),
    ("backstage", create_backstage_subagent_def),
    ("jira", create_jira_subagent_def),
    ("webex", create_webex_subagent_def),
    ("argocd", create_argocd_subagent_def),
    ("aws", create_aws_subagent_def),
    ("pagerduty", create_pagerduty_subagent_def),
    ("slack", create_slack_subagent_def),
    ("splunk", create_splunk_subagent_def),
    ("komodor", create_komodor_subagent_def),
    ("confluence", create_confluence_subagent_def),
    ("weather", create_weather_remote_subagent_def),
]


# =============================================================================
# Platform Engineer MAS
# =============================================================================

class PlatformEngineerDeepAgent:
    """
    Platform Engineer Multi-Agent System using deepagents.

    Orchestrates self-service workflows using specialized subagents.

    Note: Use `await ensure_initialized()` before first use to load MCP tools.
    """

    def __init__(self):
        self._graph_lock = threading.RLock()
        self._graph = None
        self._graph_generation = 0
        self._skills_loaded_count: int = 0
        self._skills_merged_at: Optional[str] = None
        self._last_built_catalog_generation: int = 0
        self._initialized = False
        self._subagent_tools: Dict[str, List[str]] = {}
        self._distributed_agents = _get_distributed_agents()
        self.distributed_mode = bool(self._distributed_agents)

        # RAG-related instance variables
        self.rag_enabled = ENABLE_RAG
        self.rag_config: Optional[Dict[str, Any]] = None
        self.rag_config_timestamp: Optional[float] = None
        self.rag_mcp_client: Optional[MultiServerMCPClient] = None
        self.rag_tools: List[Any] = []

        # In distributed mode, use platform_registry for remote A2A agent discovery
        self._platform_registry = None
        if self.distributed_mode:
            from ai_platform_engineering.multi_agents.platform_engineer import platform_registry
            self._platform_registry = platform_registry
            platform_registry.enable_dynamic_monitoring(on_change_callback=self._on_agents_changed)
            logger.info(f"PlatformEngineerDeepAgent created in DISTRIBUTED mode with {len(platform_registry.agents)} remote agents")
        else:
            logger.info("PlatformEngineerDeepAgent created in SINGLE-NODE (all-in-one) mode (not yet initialized)")

        if self.rag_enabled:
            logger.info(f"✅📚 RAG is ENABLED - will attempt to connect to {RAG_SERVER_URL}")
        else:
            logger.info("❌📚 RAG is DISABLED")

    async def ensure_initialized(self) -> None:
        """
        Ensure the agent is initialized with MCP tools loaded.

        This should be called before first use. It's safe to call multiple times.
        """
        if self._initialized:
            return

        await self._build_graph_async()
        self._initialized = True
        logger.info(f"PlatformEngineerDeepAgent initialized (generation {self._graph_generation})")

    def get_graph(self) -> CompiledStateGraph:
        """Returns the current compiled LangGraph instance."""
        if not self._initialized:
            raise RuntimeError("Agent not initialized. Call 'await ensure_initialized()' first.")
        with self._graph_lock:
            return self._graph

    async def _rebuild_graph_async(self) -> bool:
        """Rebuild the graph asynchronously."""
        try:
            with self._graph_lock:
                old_generation = self._graph_generation
                await self._build_graph_async()
                logger.info(f"Graph rebuilt (generation {old_generation} → {self._graph_generation})")
                return True
        except Exception as e:
            logger.error(f"Failed to rebuild graph: {e}")
            return False

    def get_status(self) -> dict:
        """Get current status for monitoring/debugging."""
        with self._graph_lock:
            status = {
                "graph_generation": self._graph_generation,
                "distributed_mode": self.distributed_mode,
                "rag_enabled": self.rag_enabled,
                "rag_connected": self.rag_config is not None,
            }
            if self.rag_config_timestamp:
                status["rag_config_age_seconds"] = time.time() - self.rag_config_timestamp
            if self._platform_registry:
                status["registry_status"] = self._platform_registry.get_registry_status()
            return status

    def get_skills_status(self) -> dict:
        """Skills load metadata for the /internal/supervisor/skills-status endpoint (FR-016)."""
        from ai_platform_engineering.skills_middleware.catalog import get_catalog_cache_generation

        current_gen = get_catalog_cache_generation()
        if self._last_built_catalog_generation == current_gen:
            sync_status = "synced"
        else:
            sync_status = "stale"

        return {
            "graph_generation": self._graph_generation,
            "skills_loaded_count": self._skills_loaded_count,
            "skills_merged_at": self._skills_merged_at,
            "catalog_cache_generation": current_gen,
            "last_built_catalog_generation": self._last_built_catalog_generation,
            "sync_status": sync_status,
        }

    def _on_agents_changed(self):
        """Callback triggered when agent registry detects changes (distributed mode)."""
        logger.info("Agent registry change detected, rebuilding graph...")
        asyncio.ensure_future(self._rebuild_graph_async())

    def force_refresh_agents(self) -> bool:
        """Force immediate refresh of agent connectivity and rebuild if needed (distributed mode)."""
        if self._platform_registry:
            logger.info("Force refresh requested")
            return self._platform_registry.force_refresh()
        return False

    def get_rag_tool_names(self) -> set[str]:
        """Get the set of RAG tool names loaded from the MCP server."""
        if not self.rag_tools:
            return set()
        return {t.name for t in self.rag_tools}

    def get_subagent_tools(self) -> Dict[str, List[str]]:
        """Return tool names per subagent, captured at graph build time."""
        with self._graph_lock:
            return dict(self._subagent_tools)

    async def _load_rag_tools(self) -> List[Any]:
        """Load RAG MCP tools from the server."""
        if not self.rag_enabled or self.rag_config is None:
            return []

        try:
            if self.rag_mcp_client is None:
                logger.info(f"Initializing RAG MCP client for {RAG_SERVER_URL}/mcp")
                rag_config: Dict[str, Any] = {
                    "url": f"{RAG_SERVER_URL}/mcp",
                    "transport": "streamable_http",
                }
                if FORWARD_JWT_TO_MCP:
                    user_jwt_ctx = get_jwt_user_context()
                    user_jwt = user_jwt_ctx.token if user_jwt_ctx else ""
                    if user_jwt:
                        rag_config["headers"] = {"Authorization": f"Bearer {user_jwt}"}
                        logger.info("Forwarding user JWT to RAG MCP server")
                self.rag_mcp_client = MultiServerMCPClient({
                    "rag": rag_config,
                })

            tools = await self.rag_mcp_client.get_tools()
            logger.info(f"✅ Loaded {len(tools)} RAG tools: {[t.name for t in tools]}")
            return tools
        except Exception as e:
            logger.error(f"Error loading RAG tools: {e}")
            return []


    async def _create_subagent_defs(self, prompt_config) -> List[dict]:
        """Create subagent defs for all enabled agents.

        Each agent is independently routed to remote A2A or in-process MCP
        based on the DISTRIBUTED_AGENTS env var.
        """
        subagent_defs = [create_user_input_subagent_def()]

        enabled_agents = [(name, fn) for name, fn in SINGLE_NODE_AGENTS if _is_agent_enabled(name)]
        disabled_agents = [name for name, fn in SINGLE_NODE_AGENTS if not _is_agent_enabled(name)]
        if disabled_agents:
            logger.info(f"⏭️ Disabled agents (via ENABLE_* env vars): {disabled_agents}")
        logger.info(f"✅ Enabled agents: {[name for name, _ in enabled_agents]}")

        agent_prompts = prompt_config.get("agent_prompts", {})
        local_agents: list[tuple[str, Any]] = []
        remote_count = 0

        for name, fn in enabled_agents:
            if _agent_is_distributed(name, self._distributed_agents):
                try:
                    remote_def = _create_remote_a2a_subagent_def(name, agent_prompts)
                    subagent_defs.append(remote_def)
                    remote_count += 1
                    logger.info(f"📡 {name} → remote A2A subagent")
                except Exception as e:
                    logger.warning(f"Failed to create remote subagent '{name}': {e}")
            else:
                local_agents.append((name, fn))
                logger.info(f"🏠 {name} → in-process MCP tools")

        # Load local MCP tools in parallel
        if local_agents:
            results = await asyncio.gather(
                *[fn(prompt_config) for _, fn in local_agents],
                return_exceptions=True,
            )
            for i, result in enumerate(results):
                if isinstance(result, Exception):
                    logger.warning(f"Failed to create subagent '{local_agents[i][0]}': {result}")
                else:
                    subagent_defs.append(result)

        # Pick up extra registry agents not in SINGLE_NODE_AGENTS (e.g. weather, gitlab)
        if self._platform_registry:
            known_names = {n for n, _ in SINGLE_NODE_AGENTS}
            for agent_key in self._platform_registry.agents:
                if agent_key.lower() not in known_names:
                    try:
                        remote_def = _create_remote_a2a_subagent_def(agent_key.lower(), agent_prompts)
                        subagent_defs.append(remote_def)
                        remote_count += 1
                        logger.info(f"📡 {agent_key} → extra registry agent (remote)")
                    except Exception as e:
                        logger.warning(f"Failed to create remote subagent '{agent_key}': {e}")

        logger.info(
            f"✅ {len(subagent_defs) - 1} subagents initialized "
            f"({remote_count} remote, {len(local_agents)} local)"
        )

        return subagent_defs

    def _build_graph(self) -> None:
        """Sync wrapper for _build_graph_async (backwards-compatible entry point)."""
        asyncio.run(self._build_graph_async())

    def _rebuild_graph(self) -> bool:
        """Sync wrapper for _rebuild_graph_async (called by skills refresh endpoint)."""
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None

        if loop and loop.is_running():
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as pool:
                future = pool.submit(asyncio.run, self._rebuild_graph_async())
                return future.result(timeout=120)
        else:
            return asyncio.run(self._rebuild_graph_async())

    async def _build_graph_async(self) -> None:
        """Build the deep agent graph with subagents (async to load MCP tools)."""
        logger.info(f"Building deep agent (generation {self._graph_generation + 1})...")

        # Resolve the supervisor model.
        # 1. SUPERVISOR_LLM_PROVIDER + SUPERVISOR_* env vars → full
        #    LLMFactory override (same .env format as multi-node).
        # 2. SUPERVISOR_MODEL only → provider:model-name string
        #    (e.g. "openai:gpt-4o"), global credentials used.
        # 3. Neither → LLMFactory with global LLM_PROVIDER / OPENAI_*
        #    env vars (backward compatible).
        supervisor_llm = _build_llm_from_prefixed_env("SUPERVISOR_")
        if supervisor_llm is not None:
            base_model = supervisor_llm
        elif os.getenv("SUPERVISOR_MODEL"):
            base_model = os.getenv("SUPERVISOR_MODEL")
            logger.info(f"Supervisor model override: SUPERVISOR_MODEL={base_model}")
        else:
            base_model = LLMFactory().get_llm()

        # Load task configuration
        task_config = load_task_config()

        # Load prompt configuration from prompt_config.yaml
        prompt_config = load_platform_config()

        # Build system prompt dynamically from subagent definitions
        # We'll populate agent descriptions after creating subagents (below)
        # For now, store a reference to update later
        self._prompt_config = prompt_config
        self._task_config = task_config

        # Utility tools
        utility_tools = [
            curl,
            get_current_date,
            jq,
            yq,
            # Filesystem utility tool for tool output capture
            tool_result_to_file,
            # Wait tool for polling and async operations
            wait,
        ]

        # Self-service task tools
        invoke_task_tool = create_invoke_self_service_task_tool()
        get_workflow_def_tool = create_get_workflow_definition_tool()

        # All supervisor tools
        all_tools = utility_tools + [invoke_task_tool, get_workflow_def_tool]

        if ENABLE_USER_INFO_TOOL:
            all_tools.append(create_supervisor_user_info_tool())
            logger.info("✅ user_info tool enabled (ENABLE_USER_INFO_TOOL=true)")

        # RAG connectivity check and tool loading
        if self.rag_enabled and self.rag_config is None:
            logger.info("Performing RAG connectivity check...")
            try:
                logger.info(f"Checking RAG server connectivity at {RAG_SERVER_URL}...")

                for attempt in range(1, RAG_CONNECTIVITY_RETRIES + 1):
                    try:
                        async with httpx.AsyncClient() as client:
                            response = await client.get(f"{RAG_SERVER_URL}/healthz", timeout=5.0)
                            if response.status_code == 200:
                                logger.info(f"✅ RAG server connected successfully on attempt {attempt}")

                                # Fetch initial config
                                data = response.json()
                                self.rag_config = data.get("config", {})
                                self.rag_config_timestamp = time.time()

                                logger.info(f"RAG Server returned config: {self.rag_config}")

                                # Load RAG MCP tools
                                self.rag_tools = await self._load_rag_tools()
                                if self.rag_tools:
                                    logger.info(f"✅📚 Loaded {len(self.rag_tools)} RAG tools")
                                    logger.info(f"📋 RAG tool names: {[t.name for t in self.rag_tools]}")
                                    try:
                                        from ai_platform_engineering.utils.auth_mcp_tools import wrap_rag_tools_with_auth
                                        self.rag_tools = wrap_rag_tools_with_auth(self.rag_tools)
                                    except Exception as wrap_err:
                                        logger.warning(f"Failed to wrap RAG tools with auth: {wrap_err}")
                                else:
                                    logger.warning("No RAG tools loaded (empty list returned)")
                                break
                            else:
                                logger.warning(f"⚠️  RAG server returned status {response.status_code} on attempt {attempt}")
                    except Exception as e:
                        logger.warning(f"❌ RAG server connection attempt {attempt} failed: {e}")

                    # Wait before retry if not last attempt
                    if attempt < RAG_CONNECTIVITY_RETRIES:
                        logger.info(f"Retrying in {RAG_CONNECTIVITY_WAIT_SECONDS} seconds... ({attempt}/{RAG_CONNECTIVITY_RETRIES})")
                        await asyncio.sleep(RAG_CONNECTIVITY_WAIT_SECONDS)

                # If still not connected, disable RAG
                if self.rag_config is None:
                    logger.error(f"❌ Failed to connect to RAG server after {RAG_CONNECTIVITY_RETRIES} attempts. RAG disabled.")
                    self.rag_enabled = False

            except Exception as e:
                logger.error(f"Error during RAG setup: {e}")
                self.rag_enabled = False

        # Add RAG tools if loaded, wrapping fetch_document and search with per-query call caps.
        # Caps raise ToolInvocationError (is_error=True ToolMessage) to hard-stop the model.
        if self.rag_tools:
            wrapped_rag_tools = []
            for t in self.rag_tools:
                if t.name == "fetch_document":
                    wrapped_rag_tools.append(FetchDocumentCapWrapper.from_tool(t, max_calls=MAX_FETCH_DOCUMENT_CALLS))
                elif t.name == "search":
                    wrapped_rag_tools.append(SearchCapWrapper.from_tool(t, max_calls=MAX_SEARCH_CALLS))
                else:
                    wrapped_rag_tools.append(t)
            all_tools.extend(wrapped_rag_tools)
            logger.info(f"✅📚 Added {len(wrapped_rag_tools)} RAG tools (fetch_document capped at {MAX_FETCH_DOCUMENT_CALLS}, search capped at {MAX_SEARCH_CALLS})")

        # Build subagent definitions.
        # SubAgent dict format: {name, description, system_prompt, tools}
        # SubAgentMiddleware builds these with shared StateBackend, ensuring
        # filesystem state is accessible across all subagents.
        prompt_config = self._prompt_config
        subagent_defs = await self._create_subagent_defs(prompt_config)

        # Capture tool names per subagent for the /tools API
        subagent_tools_snapshot: Dict[str, List[str]] = {}
        for sd in subagent_defs:
            sa_name = sd.get("name")
            sa_tools = sd.get("tools", [])
            if sa_name and sa_tools:
                subagent_tools_snapshot[sa_name] = [t.name for t in sa_tools]
        self._subagent_tools = subagent_tools_snapshot

        # Build agents_for_prompt dict for generating system prompt
        agents_for_prompt = {}
        for subagent_def in subagent_defs:
            name = subagent_def.get("name")
            if name:
                agents_for_prompt[name] = {
                    "description": subagent_def.get("description", f"{name} agent")
                }

        # Add RAG to agents_for_prompt when RAG tools are loaded
        # This ensures the system prompt generator includes the RAG agent section
        # from prompt_config.yaml (routing instructions, source citation rules, etc.)
        if self.rag_tools:
            agents_for_prompt["rag"] = {
                "description": "RAG: knowledge base search, documentation, runbooks, architecture"
            }
            logger.info("📚 Added RAG to agents_for_prompt for system prompt generation")

        logger.info(f'🔧 Building with {len(all_tools)} tools and {len(subagent_defs)} subagents')
        logger.info(f'📦 Tools: {[t.name for t in all_tools]}')
        logger.info(f'🤖 Subagents: {list(agents_for_prompt.keys())}')

        # Build RAG instructions if RAG is enabled — use full instructions from prompt_config.rag.yaml
        rag_instructions = ""
        if self.rag_enabled and self.rag_tools:
            rag_instructions = get_rag_instructions(self.rag_config or {})

        # Generate system prompt dynamically using prompt_config.yaml
        # This ensures all subagents are included with proper routing instructions
        system_prompt = generate_platform_system_prompt(
            self._prompt_config,
            agents_for_prompt,
            use_structured_response=USE_STRUCTURED_RESPONSE,
        )

        # Append RAG instructions if RAG is enabled and tools are loaded
        if rag_instructions:
            system_prompt += f"\n\n## RAG Knowledge Base\n{rag_instructions}"

        # When structured response mode is enabled, add narration instruction so the
        # LLM writes brief status messages before each tool call ("I'll search the
        # knowledge base for..."). These stream to Slack/UI as polished waiting messages.
        # The [FINAL ANSWER] marker section is NOT needed — the ResponseFormat tool
        # handles clean final output via a structured LLM call.
        if USE_STRUCTURED_RESPONSE:
            system_prompt += (
                "\n\n**Before invoking any tool, write one brief natural-language sentence describing what you are about to do.** "
                "Describe the *intent* in plain English — NEVER mention internal tool names (search, fetch_document, curl, write_todos, task, etc.). "
                "For example: \"I'll search the knowledge base for information about X.\" or "
                "\"Let me look up the full documentation for more details.\" or "
                "\"I'll check with the GitHub agent for repository information.\"\n"
            )

        system_prompt += """

## Self-Service Workflows (CRITICAL)

**MANDATORY BEHAVIOR**: When a user requests an operation that matches one of the available
self-service workflows (listed at the end of this prompt), you MUST call
`invoke_self_service_task(task_name="<exact name>")` with the exact workflow name.
DO NOT try to perform these operations directly with subagents.

**Workflow Execution:**
1. When `invoke_self_service_task` is called, it triggers a multi-step workflow
2. The CAIPE subagent will present a HITL form to collect required user input
3. After user submits the form, subsequent steps execute automatically (GitHub, AWS, ArgoCD, etc.)
4. A notification is sent to the user via Webex upon completion

**DO NOT skip `invoke_self_service_task`** for these operations.

## Task Planning (write_todos format)

ALWAYS call `write_todos` first before starting any multi-step work to announce your execution plan. This applies to:
- Subagent delegation via `task` tool
- RAG knowledge base research (search + fetch_document)
- Any operation requiring more than one tool call

Each todo item's `content` MUST include the agent/tool name in square brackets, e.g.:
- `[Jira] Search for user's tickets`
- `[GitHub] List recent pull requests`
- `[RAG] Search knowledge base for deployment options`
- `[RAG] Fetch documentation for AGNTCY identity`

This format is required so the UI can display agent stickers next to each task.
"""

        logger.info(f"📝 Generated system prompt with {len(agents_for_prompt)} agent routing instructions")

        # Load skills catalog and build StateBackend files for SkillsMiddleware (FR-015)
        try:
            skills = get_merged_skills(include_content=True)
            self._skills_files, self._skills_sources = build_skills_files(skills)
            self._skills_loaded_count = len(skills)
            from datetime import datetime, timezone
            self._skills_merged_at = datetime.now(timezone.utc).isoformat()
            try:
                from ai_platform_engineering.skills_middleware.catalog import get_catalog_cache_generation
                self._last_built_catalog_generation = get_catalog_cache_generation()
            except Exception:
                pass
            logger.info(f"📚 Loaded {len(skills)} skills for supervisor ({len(self._skills_sources)} sources)")
        except Exception as e:
            logger.warning(f"Failed to load skills catalog: {e}")
            self._skills_files = {}
            self._skills_sources = []
            self._skills_loaded_count = 0

        # Build SkillsMiddleware with sources from catalog
        skills_middleware_list = []
        if self._skills_sources:
            skills_middleware_list.append(
                SkillsMiddleware(
                    backend=StateBackend,
                    sources=self._skills_sources,
                )
            )

        # Create the deep agent with middleware for deterministic task execution
        #
        # Middleware:
        # 1. SkillsMiddleware: Injects skills into system prompt (progressive disclosure)
        # 2. DeterministicTaskMiddleware:
        #    - before_model: Injects write_todos + task tool calls for next step
        #    - after_model: Updates todos, pops completed task, loops if more tasks
        #
        # Subagent state sharing:
        # - Using SubAgent dict format, SubAgentMiddleware builds subagents with shared StateBackend
        # - All subagents share filesystem state (read_file/write_file work across subagents)
        # - CAIPE's interrupt_on is defined in its subagent dict for HITL form handling
        #
        # Built-in deepagents tools (auto-attached):
        # - write_todos: From TodoListMiddleware
        # - task: From SubAgentMiddleware
        # - read_file, write_file, ls, grep, glob, edit_file: From FilesystemMiddleware
        # Build middleware list — each middleware can be toggled via env vars.
        # ENABLE_MIDDLEWARE=false disables all optional middleware at once.
        # ModelRetryMiddleware is always included (essential for error recovery).
        middleware_list = [
            ModelRetryMiddleware(max_retries=5, on_failure="continue", backoff_factor=2.0),
        ]

        _mw_flags = {
            "PolicyMiddleware": ENABLE_POLICY_MIDDLEWARE,
            "SkillsMiddleware": ENABLE_SKILLS_MIDDLEWARE,
            "DeterministicTaskMiddleware": ENABLE_DETERMINISTIC_MIDDLEWARE,
            "CallToolWithFileArgMiddleware": ENABLE_FILE_ARG_MIDDLEWARE,
            "SelfServiceWorkflowMiddleware": ENABLE_SELF_SERVICE_MIDDLEWARE,
        }
        if ENABLE_POLICY_MIDDLEWARE:
            middleware_list.append(PolicyMiddleware(agent_name="platform_engineer", agent_type="deep_agent"))
        if ENABLE_SKILLS_MIDDLEWARE:
            middleware_list.extend(skills_middleware_list)
        if ENABLE_DETERMINISTIC_MIDDLEWARE:
            middleware_list.append(DeterministicTaskMiddleware())
        if ENABLE_FILE_ARG_MIDDLEWARE:
            middleware_list.append(CallToolWithFileArgMiddleware())
        if ENABLE_SELF_SERVICE_MIDDLEWARE:
            middleware_list.append(SelfServiceWorkflowMiddleware())

        enabled = [k for k, v in _mw_flags.items() if v]
        disabled = [k for k, v in _mw_flags.items() if not v]
        logger.info(f"Middleware enabled: {enabled or '(none)'}")
        if disabled:
            logger.info(f"Middleware disabled: {disabled}")

        deep_agent_kwargs = dict(
            tools=all_tools,
            system_prompt=system_prompt,
            subagents=subagent_defs,
            model=base_model,
            middleware=middleware_list,
        )

        # Structured response mode: the LLM calls a ResponseFormat tool for its
        # final answer, producing a PlatformEngineerResponse with clean markdown
        # in the 'content' field.  The agent_executor already handles the
        # 'from_response_format_tool' event flag emitted by the graph.
        if USE_STRUCTURED_RESPONSE:
            from langchain.agents.structured_output import ToolStrategy
            deep_agent_kwargs["response_format"] = ToolStrategy(PlatformEngineerResponse)
            logger.info("Structured response mode enabled — ResponseFormat tool attached")
        else:
            logger.info("Using [FINAL ANSWER] marker mode for plain-text token streaming")

        # Attach cross-thread store for long-term memory (both modes)
        try:
            from ai_platform_engineering.utils.store import create_store
            store = create_store()
            if store is not None:
                deep_agent_kwargs["store"] = store
                logger.info("Cross-thread store attached to deep agent")
        except Exception as e:
            logger.warning(f"Failed to create cross-thread store: {e}")

        deep_agent = create_deep_agent(**deep_agent_kwargs)

        # Attach checkpointer -- persistent backend if available, else in-memory
        if not os.getenv("LANGGRAPH_DEV"):
            try:
                from ai_platform_engineering.utils.checkpointer import create_checkpointer
                deep_agent.checkpointer = create_checkpointer()
                logger.info("Persistent checkpointer attached to deep agent")
            except Exception as e:
                logger.warning(f"Failed to create persistent checkpointer, falling back to in-memory: {e}")
                deep_agent.checkpointer = InMemorySaver()

        # Update graph atomically
        self._graph = deep_agent
        self._graph_generation += 1

        logger.info(f"✅ Deep agent created (generation {self._graph_generation})")

    async def serve(
        self,
        prompt: str,
        user_email: str = "",
        user_name: Optional[str] = None,
        user_groups: Optional[List[str]] = None,
    ) -> str:
        """Process prompt and return response."""
        try:
            logger.debug(f"Received prompt: {prompt}")
            if not isinstance(prompt, str) or not prompt.strip():
                raise ValueError("Prompt must be a non-empty string.")

            # Ensure agent is initialized with MCP tools
            await self.ensure_initialized()

            # Auto-inject current date and user context
            from datetime import datetime
            current_date = datetime.now().strftime("%Y-%m-%d")
            current_datetime = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            context_parts = []
            if user_email:
                context_parts.append(f"Authenticated user email: {user_email}")
            context_parts.append(f"Current date: {current_date}, Current date/time: {current_datetime}")
            enhanced_prompt = f"{prompt}\n\n[{', '.join(context_parts)}]"

            graph = self.get_graph()
            state_dict: Dict[str, Any] = {"messages": [{"role": "user", "content": enhanced_prompt}]}
            if user_email:
                state_dict["user_email"] = user_email
            if user_name is not None:
                state_dict["user_name"] = user_name
            if user_groups is not None:
                state_dict["user_groups"] = user_groups
            # Inject skills files into state for SkillsMiddleware / StateBackend (FR-015)
            if getattr(self, "_skills_files", None):
                state_dict["files"] = dict(self._skills_files)
            result = await graph.ainvoke(
                state_dict,
                {"configurable": {"thread_id": uuid.uuid4()}}
            )

            messages = result.get("messages", [])
            if not messages:
                raise RuntimeError("No messages found in response.")

            for message in reversed(messages):
                if isinstance(message, AIMessage) and message.content.strip():
                    return message.content.strip()

            raise RuntimeError("No valid AIMessage found in response.")
        except Exception as e:
            logger.error(f"Error in serve: {e}")
            raise

    async def serve_stream(
        self,
        prompt: str,
        user_email: str = "",
        user_name: Optional[str] = None,
        user_groups: Optional[List[str]] = None,
    ):
        """Process prompt and stream responses."""
        try:
            logger.info(f"Received streaming prompt: {prompt}")
            if not isinstance(prompt, str) or not prompt.strip():
                raise ValueError("Prompt must be a non-empty string.")

            # Ensure agent is initialized with MCP tools
            await self.ensure_initialized()

            graph = self.get_graph()
            thread_id = str(uuid.uuid4())

            state_dict: Dict[str, Any] = {"messages": [{"role": "user", "content": prompt}]}
            if user_email:
                state_dict["user_email"] = user_email
            if user_name is not None:
                state_dict["user_name"] = user_name
            if user_groups is not None:
                state_dict["user_groups"] = user_groups
            # Inject skills files into state for SkillsMiddleware / StateBackend (FR-015)
            if getattr(self, "_skills_files", None):
                state_dict["files"] = dict(self._skills_files)

            async for event in graph.astream_events(
                state_dict,
                {"configurable": {"thread_id": thread_id}},
                version="v2"
            ):
                if event["event"] == "on_chat_model_stream":
                    chunk = event.get("data", {}).get("chunk")
                    if chunk and hasattr(chunk, "content") and chunk.content:
                        yield {"type": "content", "data": chunk.content}

                elif event["event"] == "on_tool_start":
                    tool_name = event.get("name", "unknown")
                    yield {"type": "tool_start", "tool": tool_name, "data": f"\n\n🔧 Calling {tool_name}...\n"}

                elif event["event"] == "on_tool_end":
                    tool_name = event.get("name", "unknown")
                    yield {"type": "tool_end", "tool": tool_name, "data": f"✅ {tool_name} completed\n"}

        except Exception as e:
            logger.error(f"Error in serve_stream: {e}")
            yield {"type": "error", "data": str(e)}


# Alias for backwards compatibility
AIPlatformEngineerMAS = PlatformEngineerDeepAgent
