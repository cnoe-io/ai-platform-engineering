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
from pathlib import Path
from typing import Optional, Dict, Any, List, NotRequired, Annotated, Literal
import operator

from langchain_core.messages import AIMessage, ToolMessage
from langchain_core.tools import tool, StructuredTool, InjectedToolCallId
from langgraph.graph.state import CompiledStateGraph
from langgraph.graph import MessagesState
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command
from cnoe_agent_utils import LLMFactory
from langchain_mcp_adapters.client import MultiServerMCPClient
from pydantic import BaseModel, Field
from langchain.agents import create_agent
from langchain.agents.middleware import HumanInTheLoopMiddleware
from langchain.tools.tool_node import InjectedState

# Official deepagents package
from deepagents import create_deep_agent, CompiledSubAgent
from deepagents.middleware import FilesystemMiddleware

# Custom middleware and utilities from our package
from ai_platform_engineering.utils.deepagents_custom.middleware import (
    QuickActionTasksAnnouncementMiddleware,
    SubAgentExecutionMiddleware,
    DeterministicTaskLoopGuardMiddleware,
)
from ai_platform_engineering.utils.deepagents_custom.state import file_reducer, DeepAgentState

# Import agent classes for subagent graph creation
# We use agent.get_subagent_graph() which handles MCP tool loading and FilesystemMiddleware
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
    write_workspace_file,
    read_workspace_file,
    list_workspace_files,
    clear_workspace,
    git,
    curl,
    wget,
    grep,
    glob_find,
    jq,
    yq,
    read_file as read_file_tool,
    write_file as write_file_tool,
    append_file,
    list_files,
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
    """Create the invoke_self_service_task tool that triggers QuickActionTasksAnnouncementMiddleware."""
    
    # Load available task names for the Literal type
    task_config = load_task_config()
    task_names = list(task_config.keys())
    
    @tool
    def invoke_self_service_task(
        task_name: str,
        state: Annotated[dict, InjectedState],
        tool_call_id: Annotated[str, InjectedToolCallId],
    ) -> Command:
        """
        Invoke a self-service workflow task defined in task_config.yaml.
        
        This tool triggers the QuickActionTasksAnnouncementMiddleware to execute
        the steps defined for the specified task.
        
        Args:
            task_name: Name of the task to invoke (e.g., "Create GitHub Repo", "Add Users to MyID Group")
        
        Returns:
            Command to update state with the task steps for execution.
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
        
        # Create todos from tasks
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
        
        # Return Command to update state with tasks
        # The QuickActionTasksAnnouncementMiddleware will pick up these tasks
        # and inject instructions for the LLM to execute them via the task tool
        return Command(
            update={
                "tasks": tasks,
                "todos": todos,
                "messages": [
                    ToolMessage(
                        content=f"Starting workflow: {task_name}\n\nThe following steps will be executed:\n{step_list}\n\nProceed with step 1 by calling the task tool.",
                        tool_call_id=tool_call_id,
                    )
                ],
            }
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
# Subagent Creation Functions - Using agent.get_subagent_graph()
# =============================================================================
# All subagents use agent.get_subagent_graph() which:
# - Loads MCP tools from the agent's MCP server
# - Adds FilesystemMiddleware for inter-subagent state sharing
# - Creates the graph with the agent's SYSTEM_INSTRUCTION

def create_caipe_subagent(model) -> CompiledSubAgent:
    """Create the CAIPE (user input collection) subagent with filesystem tools.
    
    CAIPE collects user input via forms and writes results to filesystem
    for downstream agents to consume.
    """
    caipe_response_tool = create_caipe_agent_response_tool()
    
    # Create with create_agent and FilesystemMiddleware for filesystem tools
    caipe_agent = create_agent(
        model=model,
        tools=[caipe_response_tool],
        system_prompt=CAIPE_SUBAGENT_PROMPT,
        middleware=[
            FilesystemMiddleware(),  # Adds: read_file, write_file, ls, grep, glob
            HumanInTheLoopMiddleware(interrupt_on={"CAIPEAgentResponse": True}),
        ],
        checkpointer=None,
        name="caipe",
    )
    
    return CompiledSubAgent(
        name="caipe",
        description="Collects user input via forms, writes to filesystem for downstream agents",
        runnable=caipe_agent,
    )


async def create_github_subagent(model) -> CompiledSubAgent:
    """Create GitHub subagent using agent.get_subagent_graph()."""
    agent = GitHubAgent()
    graph = await agent.get_subagent_graph(model)
    return CompiledSubAgent(
        name="github",
        description="GitHub: repository operations, workflows, PRs",
        runnable=graph,
    )


async def create_aigateway_subagent(model) -> CompiledSubAgent:
    """Create AIGateway subagent using agent.get_subagent_graph()."""
    agent = AIGatewayAgent()
    graph = await agent.get_subagent_graph(model)
    return CompiledSubAgent(
        name="aigateway",
        description="AIGateway: LLM API keys, usage tracking",
        runnable=graph,
    )


async def create_backstage_subagent(model) -> CompiledSubAgent:
    """Create Backstage subagent using agent.get_subagent_graph()."""
    agent = BackstageAgent()
    graph = await agent.get_subagent_graph(model)
    return CompiledSubAgent(
        name="backstage",
        description="Backstage: catalog queries, component management",
        runnable=graph,
    )


async def create_jira_subagent(model) -> CompiledSubAgent:
    """Create Jira subagent using agent.get_subagent_graph()."""
    agent = JiraAgent()
    graph = await agent.get_subagent_graph(model)
    return CompiledSubAgent(
        name="jira",
        description="Jira: ticket management, issue tracking",
        runnable=graph,
    )


async def create_webex_subagent(model) -> CompiledSubAgent:
    """Create Webex subagent using agent.get_subagent_graph()."""
    agent = WebexAgent()
    graph = await agent.get_subagent_graph(model)
    return CompiledSubAgent(
        name="webex",
        description="Webex: messaging, notifications",
        runnable=graph,
    )


async def create_argocd_subagent(model) -> CompiledSubAgent:
    """Create ArgoCD subagent using agent.get_subagent_graph()."""
    agent = ArgoCDAgent()
    graph = await agent.get_subagent_graph(model)
    return CompiledSubAgent(
        name="argocd",
        description="ArgoCD: application deployment, sync management",
        runnable=graph,
    )


async def create_aws_subagent(model, utility_tools=None) -> CompiledSubAgent:
    """Create AWS subagent using agent.get_subagent_graph().
    
    Args:
        model: The LLM model to use
        utility_tools: Ignored, kept for backwards compatibility
    """
    from ai_platform_engineering.agents.aws.agent_aws.agent_langgraph import AWSAgentLangGraph
    agent = AWSAgentLangGraph()
    graph = await agent.get_subagent_graph(model)
    return CompiledSubAgent(
        name="aws",
        description="AWS: EC2, EKS, S3 resource management",
        runnable=graph,
    )


async def create_pagerduty_subagent(model) -> CompiledSubAgent:
    """Create PagerDuty subagent using agent.get_subagent_graph()."""
    agent = PagerDutyAgent()
    graph = await agent.get_subagent_graph(model)
    return CompiledSubAgent(
        name="pagerduty",
        description="PagerDuty: on-call schedules, incident management",
        runnable=graph,
    )


async def create_slack_subagent(model) -> CompiledSubAgent:
    """Create Slack subagent using agent.get_subagent_graph()."""
    agent = SlackAgent()
    graph = await agent.get_subagent_graph(model)
    return CompiledSubAgent(
        name="slack",
        description="Slack: messaging, channel management",
        runnable=graph,
    )


async def create_splunk_subagent(model) -> CompiledSubAgent:
    """Create Splunk subagent using agent.get_subagent_graph()."""
    agent = SplunkAgent()
    graph = await agent.get_subagent_graph(model)
    return CompiledSubAgent(
        name="splunk",
        description="Splunk: log analysis, alerting",
        runnable=graph,
    )


async def create_komodor_subagent(model) -> CompiledSubAgent:
    """Create Komodor subagent using agent.get_subagent_graph()."""
    agent = KomodorAgent()
    graph = await agent.get_subagent_graph(model)
    return CompiledSubAgent(
        name="komodor",
        description="Komodor: Kubernetes monitoring, troubleshooting",
        runnable=graph,
    )


async def create_confluence_subagent(model) -> CompiledSubAgent:
    """Create Confluence subagent using agent.get_subagent_graph()."""
    agent = ConfluenceAgent()
    graph = await agent.get_subagent_graph(model)
    return CompiledSubAgent(
        name="confluence",
        description="Confluence: wiki documentation",
        runnable=graph,
    )


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
        
        # SubAgentExecutionMiddleware instance - for task execution
        self._subagent_exec_middleware: Optional[SubAgentExecutionMiddleware] = None
        
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
        task_list = yaml.safe_dump(task_config)
        
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
            write_workspace_file,
            read_workspace_file,
            list_workspace_files,
            clear_workspace,
            git,
            curl,
            wget,
            grep,
            glob_find,
            jq,
            yq,
            read_file_tool,
            write_file_tool,
            append_file,
            list_files,
        ]
        
        # Self-service task tools
        invoke_task_tool = create_invoke_self_service_task_tool()
        list_tasks_tool = create_list_self_service_tasks_tool()
        
        # All supervisor tools
        all_tools = utility_tools + [invoke_task_tool, list_tasks_tool]
        
        # Build subagent definitions (async to load MCP tools)
        logger.info("Loading subagent graphs with MCP tools...")
        
        # Load subagents in parallel - all use agent.get_subagent_graph()
        # Note: MyID operations are handled through task_config GitHub workflows
        mcp_subagent_results = await asyncio.gather(
            create_github_subagent(base_model),
            create_aigateway_subagent(base_model),
            create_backstage_subagent(base_model),
            create_jira_subagent(base_model),
            create_webex_subagent(base_model),
            create_argocd_subagent(base_model),
            create_aws_subagent(base_model, utility_tools),  # Still needs utility_tools for now
            create_pagerduty_subagent(base_model),
            create_slack_subagent(base_model),
            create_splunk_subagent(base_model),
            create_komodor_subagent(base_model),
            create_confluence_subagent(base_model),
            return_exceptions=True,
        )
        
        # Add sync subagent (CAIPE uses local tools, no MCP)
        caipe_subagent = create_caipe_subagent(base_model)
        
        # Filter out any failures and build final list
        subagent_defs = [caipe_subagent]  # CAIPE always succeeds (no MCP)
        for i, result in enumerate(mcp_subagent_results):
            if isinstance(result, Exception):
                logger.warning(f"Failed to create subagent: {result}")
            else:
                subagent_defs.append(result)
        
        # Build compiled subagent graphs for SubAgentExecutionMiddleware
        # All subagent creation functions now return CompiledSubAgent TypedDicts with 'runnable' key
        subagent_graphs = {}
        agents_for_prompt = {}  # For generating system prompt
        for subagent_def in subagent_defs:
            name = subagent_def.get("name")
            if name and "runnable" in subagent_def:
                subagent_graphs[name] = subagent_def["runnable"]
                # Build agent card dict for prompt generation
                agents_for_prompt[name] = {
                    "description": subagent_def.get("description", f"{name} agent")
                }
        
        logger.info(f'🔧 Building with {len(all_tools)} tools and {len(subagent_defs)} subagents')
        logger.info(f'🤖 Subagents: {list(subagent_graphs.keys())}')
        
        # Build RAG instructions if RAG is enabled
        rag_instructions = ""
        if self.rag_enabled:
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
            agents_for_prompt,
            rag_instructions=rag_instructions
        )
        
        # Append self-service workflow information
        system_prompt += f"""

## Available Self-Service Workflows

Use `invoke_self_service_task` to trigger any of these workflows:

{list(self._task_config.keys())}

Use `list_self_service_tasks` to see detailed information about available tasks.
"""
        
        logger.info(f"📝 Generated system prompt with {len(agents_for_prompt)} agent routing instructions")
        
        # Create SubAgentExecutionMiddleware with the compiled graphs
        # This middleware executes pending task tool calls by invoking subagents
        subagent_exec_middleware = SubAgentExecutionMiddleware(subagent_graphs=subagent_graphs)
        
        # Store reference to middleware for later tool updates
        self._subagent_exec_middleware = subagent_exec_middleware
        
        # Create the deep agent with middleware (including HITL for CAIPEAgentResponse)
        # Middleware order is important:
        # 1. QuickActionTasksAnnouncementMiddleware: Injects task tool call, sets pending_task_tool_call_id
        # 2. SubAgentExecutionMiddleware: Executes pending task by invoking subagent, returns result
        # 3. DeterministicTaskLoopGuardMiddleware: Ensures task queue is fully processed
        # 4. HumanInTheLoopMiddleware: Handles HITL for CAIPEAgentResponse
        deep_agent = create_deep_agent(
            tools=all_tools,
            system_prompt=system_prompt,
            subagents=subagent_defs,
            model=base_model,
            context_schema=ParentState,
            middleware=[
                QuickActionTasksAnnouncementMiddleware(),
                subagent_exec_middleware,
                DeterministicTaskLoopGuardMiddleware(),
                HumanInTheLoopMiddleware(interrupt_on={"CAIPEAgentResponse": True}),
            ],
        )
        
        # Attach checkpointer if not in dev mode
        if not os.getenv("LANGGRAPH_DEV"):
            deep_agent.checkpointer = InMemorySaver()
        
        # Update graph atomically
        self._graph = deep_agent
        self._graph_generation += 1
        
        logger.info(f"✅ Deep agent created (generation {self._graph_generation})")
    
    async def serve(self, prompt: str) -> str:
        """Process prompt and return response."""
        try:
            logger.debug(f"Received prompt: {prompt}")
            if not isinstance(prompt, str) or not prompt.strip():
                raise ValueError("Prompt must be a non-empty string.")
            
            # Ensure agent is initialized with MCP tools
            await self.ensure_initialized()
            
            # Auto-inject current date
            from datetime import datetime
            current_date = datetime.now().strftime("%Y-%m-%d")
            current_datetime = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            enhanced_prompt = f"{prompt}\n\n[Current date: {current_date}, Current date/time: {current_datetime}]"
            
            graph = self.get_graph()
            result = await graph.ainvoke(
                {"messages": [{"role": "user", "content": enhanced_prompt}]},
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
    
    async def serve_stream(self, prompt: str):
        """Process prompt and stream responses."""
        try:
            logger.info(f"Received streaming prompt: {prompt}")
            if not isinstance(prompt, str) or not prompt.strip():
                raise ValueError("Prompt must be a non-empty string.")
            
            # Ensure agent is initialized with MCP tools
            await self.ensure_initialized()
            
            graph = self.get_graph()
            thread_id = str(uuid.uuid4())
            
            async for event in graph.astream_events(
                {"messages": [{"role": "user", "content": prompt}]},
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
