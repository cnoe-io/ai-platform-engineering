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
from typing import Optional, Dict, Any, List, Annotated
import operator

from langchain_core.messages import AIMessage, ToolMessage
from langchain_core.tools import tool, StructuredTool, InjectedToolCallId
from langgraph.graph.state import CompiledStateGraph
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command
from cnoe_agent_utils import LLMFactory
from langchain_mcp_adapters.client import MultiServerMCPClient
from pydantic import BaseModel, Field
from langchain.tools.tool_node import InjectedState

# Official deepagents package (pip-installed, not vendored)
# The vendored deepagents/ in repo root is for multi-node mode
# Single-node uses the pip package which has different API (system_prompt, middleware)
import sys

# CRITICAL: Remove vendored deepagents from path BEFORE any imports can occur
# The vendored version at /app/deepagents (Docker) or ./deepagents (local) shadows the pip package
# We need to ensure the pip-installed version is used for single-node mode
def _setup_pip_deepagents_path():
    """Configure sys.path to use pip-installed deepagents, not vendored."""
    # Get the repo root directory (where vendored deepagents/ lives)
    # This file is at: ai_platform_engineering/multi_agents/platform_engineer/deep_agent_single.py
    # Repo root is 4 levels up
    current_file = os.path.abspath(__file__)
    repo_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(current_file))))
    
    # Paths that might contain the vendored deepagents
    vendored_paths = [
        '/app',  # Docker container path
        repo_root,  # Local development from repo root
        '',  # Current directory
        '.',  # Current directory (explicit)
        os.getcwd(),  # Current working directory
    ]
    
    # Remove any path that could shadow the pip-installed deepagents
    paths_to_remove = []
    for p in sys.path:
        # Check if this path contains the vendored deepagents
        vendored_deepagents = os.path.join(p, 'deepagents') if p else 'deepagents'
        if os.path.isdir(vendored_deepagents) and os.path.isfile(os.path.join(vendored_deepagents, '__init__.py')):
            # This path has a deepagents directory - check if it's the vendored one
            # The vendored version has sub_agent.py with "prompt" field, pip version has "system_prompt"
            sub_agent_file = os.path.join(vendored_deepagents, 'sub_agent.py')
            if os.path.isfile(sub_agent_file):
                try:
                    with open(sub_agent_file, 'r') as f:
                        content = f.read()
                        # Vendored version uses "prompt: str" in SubAgent TypedDict
                        # Pip version uses "system_prompt"
                        if 'prompt: str' in content and 'system_prompt' not in content:
                            paths_to_remove.append(p)
                except Exception:
                    pass
    
    # Also remove common vendored paths even if we couldn't verify
    for p in sys.path:
        abs_p = os.path.abspath(p) if p else os.getcwd()
        for vendored in vendored_paths:
            vendored_abs = os.path.abspath(vendored) if vendored else os.getcwd()
            if abs_p == vendored_abs and p not in paths_to_remove:
                # Check if this path has a deepagents folder
                if os.path.isdir(os.path.join(abs_p, 'deepagents')):
                    paths_to_remove.append(p)
    
    for p in paths_to_remove:
        if p in sys.path:
            sys.path.remove(p)
    
    # Clear any cached vendored module
    for key in list(sys.modules.keys()):
        if key == 'deepagents' or key.startswith('deepagents.'):
            del sys.modules[key]

_setup_pip_deepagents_path()

# Now import from pip package (vendored paths removed from sys.path)
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
from ai_platform_engineering.utils.deepagents_custom.tools import (
    tool_result_to_file,
    wait,
)
from ai_platform_engineering.utils.deepagents_custom.state import DeepAgentState

# Import agent classes for subagent definition creation
# SubAgent dicts are built by SubAgentMiddleware with shared StateBackend for filesystem state sharing
from ai_platform_engineering.agents.github.agent_github.protocol_bindings.a2a_server.agent import GitHubAgent
from ai_platform_engineering.agents.backstage.agent_backstage.protocol_bindings.a2a_server.agent import BackstageAgent
from ai_platform_engineering.agents.jira.agent_jira.protocol_bindings.a2a_server.agent import JiraAgent
from ai_platform_engineering.agents.webex.agent_webex.protocol_bindings.a2a_server.agent import WebexAgent
from ai_platform_engineering.agents.argocd.agent_argocd.protocol_bindings.a2a_server.agent import ArgoCDAgent
from ai_platform_engineering.agents.aigateway.agent_aigateway.protocol_bindings.a2a_server.agent import AIGatewayAgent
from ai_platform_engineering.agents.pagerduty.agent_pagerduty.protocol_bindings.a2a_server.agent import PagerDutyAgent
from ai_platform_engineering.agents.slack.agent_slack.protocol_bindings.a2a_server.agent import SlackAgent
from ai_platform_engineering.agents.splunk.agent_splunk.protocol_bindings.a2a_server.agent import SplunkAgent
from ai_platform_engineering.agents.komodor.agent_komodor.protocol_bindings.a2a_server.agent import KomodorAgent
from ai_platform_engineering.agents.confluence.agent_confluence.protocol_bindings.a2a_server.agent import ConfluenceAgent

# Prompt configuration utilities
from ai_platform_engineering.utils.prompt_config import (
    load_platform_config,
    generate_platform_system_prompt,
)

from ai_platform_engineering.multi_agents.tools import (
    reflect_on_output,
    format_markdown,
    fetch_url,
    get_current_date,
    jq,
    yq,
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Configuration
ENABLE_RAG = os.getenv("ENABLE_RAG", "false").lower() in ("true", "1", "yes")
RAG_SERVER_URL = os.getenv("RAG_SERVER_URL", "http://localhost:9446").strip("/")
RAG_CONNECTIVITY_RETRIES = 5
RAG_CONNECTIVITY_WAIT_SECONDS = 10


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
    metadata: Metadata = Field(description="Metadata containing input fields. When requesting input, populate field_name/field_description/required. When returning values, populate the value field.")


def create_caipe_agent_response_tool():
    """Create a tool from CAIPEAgentResponse schema for structured user input collection."""
    
    def caipe_agent_response(metadata: Metadata) -> str:
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
        
        # All required fields provided - return data
        result = ""
        for f in required_with_values:
            result += f"  {f.field_name}: {f.value}\n"
        
        if optional_with_values:
            for f in optional_with_values:
                result += f"  {f.field_name}: {f.value}\n"
        
        return result.strip()
    
    return StructuredTool.from_function(
        func=caipe_agent_response,
        name="CAIPEAgentResponse",
        description="Request user input when needed. Use this to collect structured input from users via forms.",
        args_schema=CAIPEAgentResponse,
    )


# =============================================================================
# Subagent Prompts
# =============================================================================
# Note: Main system prompt is generated dynamically from prompt_config.yaml
# via generate_platform_system_prompt() in _build_graph_async()

CAIPE_SUBAGENT_PROMPT = """You are the CAIPE (Cisco AI Platform Engineer) user input collection subagent. Your role is to gather required information from the user for self-service workflows.

CRITICAL RULES:
1. Use CAIPEAgentResponse tool to collect structured user input via forms
2. After calling CAIPEAgentResponse, your task is COMPLETE - stop immediately
3. Do NOT generate text asking for more input after the tool returns
4. Include ALL required fields in a single CAIPEAgentResponse call

When collecting input:
1. Determine what information is needed based on the workflow step
2. Create input_fields with clear field_name, field_description, and required=True for mandatory fields
3. Provide default_value when appropriate (e.g., common choices)
4. Use field_values to provide dropdown options when there are limited valid choices

Example fields for "Create GitHub Repo":
- field_name: "repo_name", field_description: "Repository name (lowercase, no spaces)", required: True
- field_name: "org_name", field_description: "GitHub organization", required: True, field_values: ["cisco-eti", "outshift-platform", "cisco-platform"]
- field_name: "description", field_description: "Brief description of the repository", required: False

Tools:
CAIPEAgentResponse
* Use this to request user input via a structured form
* Populate metadata.input_fields with the fields you need
* The tool will trigger a Human-in-the-Loop interrupt for user input

read_file / write_file
* Use these to read/write form data to the filesystem for downstream agents
"""


# =============================================================================
# Task Config Loading
# =============================================================================

def get_task_config_filename() -> str:
    """Get the task config filename path (in repo root)."""
    # Navigate from this file to repo root
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


def load_task_config() -> dict:
    """Load task configuration from task_config.yaml in repo root.
    
    Supports environment variable substitution using ${VAR_NAME} syntax.
    Required environment variables:
        GITHUB_ORGS              - Comma-separated list of allowed GitHub organizations
        WORKFLOWS_REPO           - Repository containing GitHub Actions workflows (org/repo)
        GROUPS_AUTOMATION_REPO   - Repository for group management automation (org/repo)
        DEFAULT_AWS_REGIONS      - Comma-separated list of allowed AWS regions
        EMAIL_DOMAIN             - Corporate email domain (e.g., company.com)
    """
    config_path = get_task_config_filename()
    try:
        with open(config_path, 'r') as f:
            content = f.read()
        
        # Substitute environment variables
        content = _substitute_env_vars(content)
        
        config = yaml.safe_load(content)
        logger.info(f"Loaded {len(config)} tasks from {config_path}")
        return config or {}
    except Exception as e:
        logger.error(f"Failed to load task config: {e}")
        return {}


def get_available_task_names() -> List[str]:
    """Get list of available task names from config."""
    config = load_task_config()
    return list(config.keys())


# =============================================================================
# Invoke Self-Service Task Tool
# =============================================================================

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
        config = load_task_config()
        
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
        todos = [
            {
                "id": task["id"],
                "content": task.get("display_text", f"Step {task['id'] + 1}"),
                "status": "pending",
            }
            for task in tasks
        ]
        
        logger.info(f"Invoking self-service task: {task_name} with {len(tasks)} steps")
        
        # Build step list for display
        step_list = "\n".join([f"{i+1}. {t.get('display_text', 'Step')}" for i, t in enumerate(tasks)])
        
        # Return Command that ONLY sets up state - no AIMessage injection!
        # The before_model hook will inject the task call and short-circuit
        return Command(
            update={
                "tasks": tasks,
                "todos": todos,
                "task_execution_pending": True,  # Signal for before_model
                "messages": [
                    ToolMessage(
                        content=f"Starting workflow: {task_name}\n\nThe following {len(tasks)} steps will be executed:\n{step_list}",
                        tool_call_id=tool_call_id,
                    ),
                ],
            },
            # NO goto - let it go back to model where before_model will intercept
        )
    
    return invoke_self_service_task


def create_list_self_service_tasks_tool():
    """Create a tool to list available self-service tasks."""
    
    @tool
    def list_self_service_tasks() -> str:
        """
        List all available self-service tasks that can be invoked.
        
        Returns:
            Formatted list of available tasks with descriptions.
        """
        config = load_task_config()
        
        if not config:
            return "No self-service tasks available."
        
        result = "## Available Self-Service Tasks\n\n"
        for task_name, task_def in config.items():
            steps = task_def.get("tasks", [])
            result += f"### {task_name}\n"
            result += f"Steps: {len(steps)}\n"
            for step in steps[:3]:  # Show first 3 steps
                result += f"  - {step.get('display_text', 'Step')}\n"
            if len(steps) > 3:
                result += f"  - ... and {len(steps) - 3} more steps\n"
            result += "\n"
        
        return result
    
    return list_self_service_tasks


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

def create_caipe_subagent_def() -> dict:
    """Create the CAIPE (user input collection) subagent definition.
    
    CAIPE collects user input via forms and writes results to filesystem
    for downstream agents to consume.
    
    Using SubAgent dict format allows SubAgentMiddleware to build it with 
    shared StateBackend for filesystem state sharing between all subagents.
    """
    caipe_response_tool = create_caipe_agent_response_tool()
    
    # Include utility tools for filesystem operations
    tools = [
        caipe_response_tool,
        tool_result_to_file,  # Save tool output to filesystem
        wait,  # Async sleep for waiting scenarios
    ]
    
    return {
        "name": "caipe",
        "description": "Collects user input via forms, writes to filesystem for downstream agents",
        "system_prompt": CAIPE_SUBAGENT_PROMPT,
        "tools": tools,
        # Use interrupt_on for HITL
        "interrupt_on": {"CAIPEAgentResponse": True},
        # PolicyMiddleware enforces tool call authorization
        # SubAgentMiddleware will also add FilesystemMiddleware with shared StateBackend
        "middleware": [
            PolicyMiddleware(agent_name="caipe", agent_type="subagent"),
        ],
    }


async def create_subagent_def(agent_instance, name: str, description: str, prompt_config: dict = None) -> dict:
    """Create a SubAgent dict for use with create_deep_agent.
    
    Using SubAgent dict format (instead of CompiledSubAgent) allows SubAgentMiddleware
    to build the subagent with shared StateBackend for filesystem state sharing.
    
    System prompts are loaded from prompt_config.yaml when available (via agent_prompts section),
    otherwise falls back to the agent's built-in SYSTEM_INSTRUCTION.
    
    Args:
        agent_instance: The agent instance with get_mcp_tools() and SYSTEM_INSTRUCTION
        name: Subagent name for routing
        description: Description for LLM routing decisions
        prompt_config: Optional prompt configuration dict with agent_prompts section
        
    Returns:
        SubAgent dict with name, description, system_prompt, tools, middleware
    """
    # Load MCP tools from the agent
    tools = await agent_instance._load_mcp_tools({})
    
    # Get additional tools from subclass
    additional_tools = agent_instance.get_additional_tools()
    if additional_tools:
        tools.extend(additional_tools)
    
    # Add utility tools available to all subagents
    # - tool_result_to_file: Save tool output to filesystem for downstream agents
    # - wait: Async sleep for polling/waiting scenarios
    # Note: FilesystemMiddleware provides read_file, write_file, etc. separately
    tools.extend([tool_result_to_file, wait])
    
    # Get system prompt - prefer prompt_config, fall back to agent's built-in
    system_prompt = None
    if prompt_config:
        agent_prompts = prompt_config.get("agent_prompts", {})
        agent_config = agent_prompts.get(name, {})
        system_prompt = agent_config.get("system_prompt")
        if system_prompt:
            logger.info(f"📝 Using prompt_config system_prompt for {name} subagent")
    
    if not system_prompt:
        system_prompt = agent_instance._get_system_instruction_with_date()
        logger.info(f"📝 Using built-in system_prompt for {name} subagent")
    
    logger.info(f"📦 Created SubAgent def for {name} with {len(tools)} tools (incl. utility tools) + PolicyMiddleware")
    
    return {
        "name": name,
        "description": description,
        "system_prompt": system_prompt,
        "tools": tools,
        # PolicyMiddleware enforces tool call authorization (read-only tools, self-service mode, etc.)
        # SubAgentMiddleware will also add FilesystemMiddleware with shared StateBackend
        "middleware": [
            PolicyMiddleware(agent_name=name, agent_type="subagent"),
        ],
    }


async def create_github_subagent_def(prompt_config: dict = None) -> dict:
    """Create GitHub subagent definition with shared filesystem."""
    agent = GitHubAgent()
    return await create_subagent_def(agent, "github", "GitHub: repository operations, workflows, PRs", prompt_config)


async def create_aigateway_subagent_def(prompt_config: dict = None) -> dict:
    """Create AIGateway subagent definition with shared filesystem."""
    agent = AIGatewayAgent()
    return await create_subagent_def(agent, "aigateway", "AIGateway: LLM API keys, usage tracking", prompt_config)


async def create_backstage_subagent_def(prompt_config: dict = None) -> dict:
    """Create Backstage subagent definition with shared filesystem."""
    agent = BackstageAgent()
    return await create_subagent_def(agent, "backstage", "Backstage: catalog queries, component management", prompt_config)


async def create_jira_subagent_def(prompt_config: dict = None) -> dict:
    """Create Jira subagent definition with shared filesystem."""
    agent = JiraAgent()
    return await create_subagent_def(agent, "jira", "Jira: ticket management, issue tracking", prompt_config)


async def create_webex_subagent_def(prompt_config: dict = None) -> dict:
    """Create Webex subagent definition with shared filesystem."""
    agent = WebexAgent()
    return await create_subagent_def(agent, "webex", "Webex: messaging, notifications", prompt_config)


async def create_argocd_subagent_def(prompt_config: dict = None) -> dict:
    """Create ArgoCD subagent definition with shared filesystem."""
    agent = ArgoCDAgent()
    return await create_subagent_def(agent, "argocd", "ArgoCD: application deployment, sync management", prompt_config)


async def create_aws_subagent_def(prompt_config: dict = None) -> dict:
    """Create AWS subagent definition with shared filesystem."""
    from ai_platform_engineering.agents.aws.agent_aws.agent_langgraph import AWSAgentLangGraph
    agent = AWSAgentLangGraph()
    return await create_subagent_def(agent, "aws", "AWS: EC2, EKS, S3 resource management", prompt_config)


async def create_pagerduty_subagent_def(prompt_config: dict = None) -> dict:
    """Create PagerDuty subagent definition with shared filesystem."""
    agent = PagerDutyAgent()
    return await create_subagent_def(agent, "pagerduty", "PagerDuty: on-call schedules, incident management", prompt_config)


async def create_slack_subagent_def(prompt_config: dict = None) -> dict:
    """Create Slack subagent definition with shared filesystem."""
    agent = SlackAgent()
    return await create_subagent_def(agent, "slack", "Slack: messaging, channel management", prompt_config)


async def create_splunk_subagent_def(prompt_config: dict = None) -> dict:
    """Create Splunk subagent definition with shared filesystem."""
    agent = SplunkAgent()
    return await create_subagent_def(agent, "splunk", "Splunk: log analysis, alerting", prompt_config)


async def create_komodor_subagent_def(prompt_config: dict = None) -> dict:
    """Create Komodor subagent definition with shared filesystem."""
    agent = KomodorAgent()
    return await create_subagent_def(agent, "komodor", "Komodor: Kubernetes monitoring, troubleshooting", prompt_config)


async def create_confluence_subagent_def(prompt_config: dict = None) -> dict:
    """Create Confluence subagent definition with shared filesystem."""
    agent = ConfluenceAgent()
    return await create_subagent_def(agent, "confluence", "Confluence: wiki documentation", prompt_config)


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
        self._initialized = False
        
        # RAG-related instance variables
        self.rag_enabled = ENABLE_RAG
        self.rag_config: Optional[Dict[str, Any]] = None
        self.rag_config_timestamp: Optional[float] = None
        self.rag_mcp_client: Optional[MultiServerMCPClient] = None
        self.rag_tools: List[Any] = []
        
        # Don't build graph in __init__ - use ensure_initialized() instead
        # This allows async MCP tool loading
        logger.info("PlatformEngineerDeepAgent created (not yet initialized)")
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
                "rag_enabled": self.rag_enabled,
                "rag_connected": self.rag_config is not None,
            }
            if self.rag_config_timestamp:
                status["rag_config_age_seconds"] = time.time() - self.rag_config_timestamp
            return status
    
    async def _load_rag_tools(self) -> List[Any]:
        """Load RAG MCP tools from the server."""
        if not self.rag_enabled or self.rag_config is None:
            return []
        
        try:
            if self.rag_mcp_client is None:
                logger.info(f"Initializing RAG MCP client for {RAG_SERVER_URL}/mcp")
                self.rag_mcp_client = MultiServerMCPClient({
                    "rag": {
                        "url": f"{RAG_SERVER_URL}/mcp",
                        "transport": "streamable_http",
                    }
                })
            
            tools = await self.rag_mcp_client.get_tools()
            logger.info(f"✅ Loaded {len(tools)} RAG tools: {[t.name for t in tools]}")
            return tools
        except Exception as e:
            logger.error(f"Error loading RAG tools: {e}")
            return []
    
    
    async def _build_graph_async(self) -> None:
        """Build the deep agent graph with subagents (async to load MCP tools)."""
        logger.info(f"Building deep agent (generation {self._graph_generation + 1})...")
        
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
            reflect_on_output,
            format_markdown,
            fetch_url,
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
        list_tasks_tool = create_list_self_service_tasks_tool()
        
        # All supervisor tools
        all_tools = utility_tools + [invoke_task_tool, list_tasks_tool]
        
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
        
        # Add RAG tools if loaded
        if self.rag_tools:
            all_tools.extend(self.rag_tools)
            logger.info(f"✅📚 Added {len(self.rag_tools)} RAG tools to supervisor: {[t.name for t in self.rag_tools]}")
        
        # Build subagent definitions (async to load MCP tools)
        # Using SubAgent dict format for state sharing:
        # SubAgentMiddleware builds these with shared StateBackend, ensuring
        # filesystem state is accessible across all subagents.
        # System prompts are loaded from prompt_config.yaml when available.
        logger.info("Loading subagent definitions with MCP tools...")
        
        # Pass prompt_config to use system prompts from prompt_config.yaml
        prompt_config = self._prompt_config
        
        # Load subagent definitions in parallel
        # Note: MyID operations are handled through task_config GitHub workflows
        mcp_subagent_results = await asyncio.gather(
            create_github_subagent_def(prompt_config),
            create_aigateway_subagent_def(prompt_config),
            create_backstage_subagent_def(prompt_config),
            create_jira_subagent_def(prompt_config),
            create_webex_subagent_def(prompt_config),
            create_argocd_subagent_def(prompt_config),
            create_aws_subagent_def(prompt_config),
            create_pagerduty_subagent_def(prompt_config),
            create_slack_subagent_def(prompt_config),
            create_splunk_subagent_def(prompt_config),
            create_komodor_subagent_def(prompt_config),
            create_confluence_subagent_def(prompt_config),
            return_exceptions=True,
        )
        
        # Add CAIPE subagent (uses local tools, no MCP)
        caipe_subagent = create_caipe_subagent_def()
        
        # Filter out any failures and build final list
        subagent_defs = [caipe_subagent]  # CAIPE always succeeds (no MCP)
        for i, result in enumerate(mcp_subagent_results):
            if isinstance(result, Exception):
                logger.warning(f"Failed to create subagent: {result}")
            else:
                subagent_defs.append(result)
        
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
        
        # Build RAG instructions if RAG is enabled
        rag_instructions = ""
        if self.rag_enabled and self.rag_tools:
            rag_instructions = """
When users ask questions about platform policies, procedures, or documentation:
1. Use the RAG tools to search the knowledge base first
2. Synthesize information from multiple sources when available
3. Cite sources when providing answers from the knowledge base
"""
        
        # Generate system prompt dynamically using prompt_config.yaml
        # This ensures all subagents are included with proper routing instructions
        system_prompt = generate_platform_system_prompt(
            self._prompt_config, 
            agents_for_prompt
        )
        
        # Append RAG instructions if RAG is enabled and tools are loaded
        if rag_instructions:
            system_prompt += f"\n\n## RAG Knowledge Base\n{rag_instructions}"
        
        # Build self-service workflow instructions with trigger patterns
        workflow_names = list(self._task_config.keys())
        workflow_examples = []
        for name in workflow_names:
            # Generate natural language trigger patterns from workflow names
            lower_name = name.lower()
            workflow_examples.append(f'- "{name}" or "{lower_name}"')
        
        # Append self-service workflow information with detailed routing instructions
        system_prompt += f"""

## Self-Service Workflows (CRITICAL)

**MANDATORY BEHAVIOR**: When a user requests any of the following operations, you MUST call `invoke_self_service_task` with the exact workflow name. These workflows use HITL forms to collect user input.

**Available Workflows:**
{chr(10).join(workflow_examples)}

**Trigger Pattern Examples:**
- User says "Create github repo" or "create a github repository" → call `invoke_self_service_task(task_name="Create GitHub Repo")`
- User says "create ec2 instance" or "spin up an ec2" → call `invoke_self_service_task(task_name="Create EC2 Instance")`
- User says "create eks cluster" → call `invoke_self_service_task(task_name="Create EKS Cluster")`
- User says "deploy to argocd" or "deploy app" → call `invoke_self_service_task(task_name="Deploy App to Common Cluster")`
- User says "create llm api key" or "get api key" → call `invoke_self_service_task(task_name="Create LLM API Key")`
- User says "add users to group" → call `invoke_self_service_task(task_name="Add Users to Group")`
- User says "invite to github org" → call `invoke_self_service_task(task_name="Invite Users to GitHub Org")`

**Workflow Execution:**
1. When `invoke_self_service_task` is called, it triggers a multi-step workflow
2. The CAIPE subagent will present a HITL form to collect required user input
3. After user submits the form, subsequent steps execute automatically (GitHub, AWS, ArgoCD, etc.)
4. A notification is sent to the user via Webex upon completion

**DO NOT skip `invoke_self_service_task`** for these operations. DO NOT try to perform these operations directly with subagents.

Use `list_self_service_tasks` to see detailed information about all available workflows.
"""
        
        logger.info(f"📝 Generated system prompt with {len(agents_for_prompt)} agent routing instructions")
        
        # Create the deep agent with middleware for deterministic task execution
        # 
        # Middleware:
        # 1. DeterministicTaskMiddleware: 
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
        deep_agent = create_deep_agent(
            tools=all_tools,
            system_prompt=system_prompt,
            subagents=subagent_defs,
            model=base_model,
            middleware=[
                PolicyMiddleware(agent_name="platform_engineer", agent_type="deep_agent"),
                DeterministicTaskMiddleware(),
                CallToolWithFileArgMiddleware(),  # Auto-substitute file paths with contents
            ],
        )
        
        # Attach checkpointer if not in dev mode
        if not os.getenv("LANGGRAPH_DEV"):
            deep_agent.checkpointer = InMemorySaver()
        
        # Update graph atomically
        self._graph = deep_agent
        self._graph_generation += 1
        
        logger.info(f"✅ Deep agent created (generation {self._graph_generation})")
    
    async def serve(self, prompt: str, user_email: str = "") -> str:
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
            state_dict = {"messages": [{"role": "user", "content": enhanced_prompt}]}
            if user_email:
                state_dict["user_email"] = user_email
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
    
    async def serve_stream(self, prompt: str, user_email: str = ""):
        """Process prompt and stream responses."""
        try:
            logger.info(f"Received streaming prompt: {prompt}")
            if not isinstance(prompt, str) or not prompt.strip():
                raise ValueError("Prompt must be a non-empty string.")
            
            # Ensure agent is initialized with MCP tools
            await self.ensure_initialized()
            
            graph = self.get_graph()
            thread_id = str(uuid.uuid4())
            
            state_dict = {"messages": [{"role": "user", "content": prompt}]}
            if user_email:
                state_dict["user_email"] = user_email
            
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
