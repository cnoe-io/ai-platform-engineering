"""Pydantic models for Dynamic Agents service."""

from datetime import datetime
from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field


class TransportType(str, Enum):
    """MCP server transport types."""

    STDIO = "stdio"
    SSE = "sse"
    HTTP = "http"


class VisibilityType(str, Enum):
    """Agent visibility types."""

    PRIVATE = "private"
    TEAM = "team"
    GLOBAL = "global"


# =============================================================================
# MCP Server Config
# =============================================================================


class MCPServerConfigBase(BaseModel):
    """Base fields for MCP server configuration."""

    name: str = Field(..., description="Display name")
    description: str | None = Field(None, description="Optional description")
    transport: TransportType = Field(..., description="Transport type")
    endpoint: str | None = Field(None, description="Server URL for sse/http transports")
    command: str | None = Field(None, description="Command for stdio transport")
    args: list[str] | None = Field(None, description="Args for stdio transport")
    env: dict[str, str] | None = Field(None, description="Env vars for stdio transport")
    enabled: bool = Field(True, description="Whether the server is enabled")


class MCPServerConfigCreate(MCPServerConfigBase):
    """Model for creating an MCP server config."""

    id: str = Field(..., description="Unique slug ID (e.g., 'github')")


class MCPServerConfigUpdate(BaseModel):
    """Model for updating an MCP server config."""

    name: str | None = None
    description: str | None = None
    transport: TransportType | None = None
    endpoint: str | None = None
    command: str | None = None
    args: list[str] | None = None
    env: dict[str, str] | None = None
    enabled: bool | None = None


class MCPServerConfig(MCPServerConfigBase):
    """Full MCP server config as stored in MongoDB."""

    id: str = Field(..., alias="_id", description="Unique slug ID")
    config_driven: bool = Field(False, description="Whether this server was loaded from config.yaml")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    model_config = {"populate_by_name": True}


class MCPServerProbeResult(BaseModel):
    """Result from probing an MCP server for tools."""

    server_id: str
    success: bool
    tools: list[dict] | None = None  # List of tool metadata
    error: str | None = None


# =============================================================================
# SubAgent Reference
# =============================================================================


class SubAgentRef(BaseModel):
    """Reference to another dynamic agent to use as a subagent.

    When a dynamic agent has subagents configured, the deepagents framework
    automatically creates a `task` tool that the parent agent can use to
    delegate work. The LLM decides when to delegate based on the description.
    """

    agent_id: str = Field(..., description="MongoDB ObjectId of the subagent")
    name: str = Field(..., description="Routing identifier (e.g., 'code-reviewer')")
    description: str = Field(
        ...,
        description="Description for LLM routing decisions (e.g., 'Reviews code for bugs and best practices')",
    )


# =============================================================================
# Built-in Tools Config
# =============================================================================


class BuiltinToolConfigField(BaseModel):
    """Definition of a configurable field for a built-in tool."""

    name: str = Field(..., description="Field name (e.g., 'allowed_domains')")
    type: Literal["string", "number", "boolean"] = Field(..., description="Field type")
    label: str = Field(..., description="Display label for UI")
    description: str = Field(..., description="Help text for users")
    default: str | int | float | bool | None = Field(None, description="Default value")
    required: bool = Field(False, description="Whether the field is required")


class BuiltinToolDefinition(BaseModel):
    """Definition of a built-in tool for API discovery."""

    id: str = Field(..., description="Unique tool identifier (e.g., 'fetch_url')")
    name: str = Field(..., description="Display name")
    description: str = Field(..., description="What the tool does")
    enabled_by_default: bool = Field(True, description="Whether enabled by default for new agents")
    config_fields: list[BuiltinToolConfigField] = Field(
        default_factory=list,
        description="Configurable fields for this tool",
    )


class FetchUrlToolConfig(BaseModel):
    """Configuration for the fetch_url built-in tool."""

    enabled: bool = Field(False, description="Whether the tool is enabled")
    allowed_domains: str = Field(
        default="*",
        description=(
            "Comma-separated domain patterns. "
            "Use * for all, *.domain.com for subdomains, or exact domain. "
            "Empty string blocks all domains."
        ),
    )


class CurrentDatetimeToolConfig(BaseModel):
    """Configuration for the current_datetime built-in tool."""

    enabled: bool = Field(True, description="Whether the tool is enabled")


class UserInfoToolConfig(BaseModel):
    """Configuration for the user_info built-in tool."""

    enabled: bool = Field(True, description="Whether the tool is enabled")


class SleepToolConfig(BaseModel):
    """Configuration for the sleep built-in tool."""

    enabled: bool = Field(True, description="Whether the tool is enabled")
    max_seconds: int = Field(
        300,
        description="Maximum sleep duration in seconds",
        ge=1,
        le=3600,
    )


class BuiltinToolsConfig(BaseModel):
    """Configuration for built-in tools available to dynamic agents."""

    fetch_url: FetchUrlToolConfig | None = Field(
        None,
        description="Configuration for the fetch_url tool (fetches content from URLs)",
    )
    current_datetime: CurrentDatetimeToolConfig | None = Field(
        None,
        description="Configuration for the current_datetime tool (returns current date/time)",
    )
    user_info: UserInfoToolConfig | None = Field(
        None,
        description="Configuration for the user_info tool (returns info about the current user)",
    )
    sleep: SleepToolConfig | None = Field(
        None,
        description="Configuration for the sleep tool (pauses execution)",
    )


# =============================================================================
# Dynamic Agent Config
# =============================================================================


class DynamicAgentConfigBase(BaseModel):
    """Base fields for dynamic agent configuration."""

    name: str = Field(..., description="Display name")
    description: str | None = Field(None, description="Optional description")
    system_prompt: str = Field(..., description="Main system prompt / instructions")
    allowed_tools: dict[str, list[str]] = Field(
        default_factory=dict,
        description="Map of server_id -> tool names (empty list = all tools)",
    )
    model_id: str = Field(..., description="LLM model identifier (e.g., 'claude-sonnet-4-20250514')")
    model_provider: str = Field(
        ..., description="LLM provider (anthropic-claude, openai, azure-openai, aws-bedrock, etc.)"
    )
    visibility: VisibilityType = Field(VisibilityType.PRIVATE, description="Visibility scope")
    shared_with_teams: list[str] | None = Field(None, description="Team IDs when visibility=team")
    subagents: list[SubAgentRef] = Field(
        default_factory=list,
        description="Other dynamic agents that can be delegated to as subagents",
    )
    builtin_tools: BuiltinToolsConfig | None = Field(
        None,
        description="Configuration for built-in tools (fetch_url, etc.)",
    )
    enabled: bool = Field(True, description="Whether the agent is active")


class DynamicAgentConfigCreate(DynamicAgentConfigBase):
    """Model for creating a dynamic agent config."""

    pass


class DynamicAgentConfigUpdate(BaseModel):
    """Model for updating a dynamic agent config."""

    name: str | None = None
    description: str | None = None
    system_prompt: str | None = None
    allowed_tools: dict[str, list[str]] | None = None
    model_id: str | None = None
    model_provider: str | None = None
    visibility: VisibilityType | None = None
    shared_with_teams: list[str] | None = None
    subagents: list[SubAgentRef] | None = None
    builtin_tools: BuiltinToolsConfig | None = None
    enabled: bool | None = None


class DynamicAgentConfig(DynamicAgentConfigBase):
    """Full dynamic agent config as stored in MongoDB."""

    id: str = Field(..., alias="_id", description="Unique ID")
    owner_id: str = Field(..., description="Creator's email")
    is_system: bool = Field(False, description="System-provided agent (non-deletable)")
    config_driven: bool = Field(False, description="Whether this agent was loaded from config.yaml")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    model_config = {"populate_by_name": True}


# =============================================================================
# Chat Request/Response
# =============================================================================


class ChatRequest(BaseModel):
    """Request to chat with a dynamic agent."""

    message: str = Field(..., description="User message")
    conversation_id: str = Field(..., description="Conversation/session ID")
    agent_id: str = Field(..., description="Dynamic agent config ID")
    trace_id: str | None = Field(None, description="Optional trace ID for Langfuse tracing")


class ChatEvent(BaseModel):
    """SSE event from chat streaming."""

    type: Literal["content", "tool_start", "tool_end", "error", "done", "event"]
    data: str | dict | None = None


# =============================================================================
# Agent Context (passed to deepagents)
# =============================================================================


class AgentContext(BaseModel):
    """Context schema passed to deepagents via context_schema."""

    user_id: str
    user_name: str | None = None
    user_groups: list[str] = []
    agent_config_id: str
    session_id: str


# =============================================================================
# API Response Wrappers
# =============================================================================


class ApiResponse(BaseModel):
    """Standard API response wrapper."""

    success: bool = True
    data: dict | list | None = None
    error: str | None = None


class PaginatedResponse(BaseModel):
    """Paginated list response."""

    items: list
    total: int
    page: int
    limit: int
    total_pages: int
