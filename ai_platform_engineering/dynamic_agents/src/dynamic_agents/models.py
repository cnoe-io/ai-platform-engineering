"""Pydantic models for Dynamic Agents service."""

import logging
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

logger = logging.getLogger(__name__)


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
# User Context
# =============================================================================


class UserContext(BaseModel):
    """Authenticated user context.

    Only ``email`` is required.  Everything else is opaque — callers may
    pass arbitrary fields (``is_admin``, ``groups``, ``can_view_admin``,
    etc.) and they will be stored and accessible as attributes via
    Pydantic's ``extra="allow"``.

    The ``user_info`` tool dumps all fields so agents can see whatever
    the gateway or auth layer chose to include.
    """

    model_config = ConfigDict(extra="allow")

    email: str
    name: str | None = None
    groups: list[str] = []
    is_admin: bool = False
    raw_claims: dict[str, Any] = {}
    access_token: str | None = Field(default=None, repr=False)
    obo_jwt: str | None = Field(default=None, repr=False)


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
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

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


class WaitToolConfig(BaseModel):
    """Configuration for the wait built-in tool."""

    enabled: bool = Field(True, description="Whether the tool is enabled")
    max_seconds: int = Field(
        300,
        description="Maximum wait duration in seconds",
        ge=1,
        le=3600,
    )


class RequestUserInputToolConfig(BaseModel):
    """Configuration for the request_user_input built-in tool."""

    enabled: bool = Field(True, description="Whether the tool is enabled")


class SelfIdentityToolConfig(BaseModel):
    """Configuration for the self_identity built-in tool."""

    enabled: bool = Field(True, description="Whether the tool is enabled")


class BuiltinToolsConfig(BaseModel):
    """Configuration for built-in tools available to dynamic agents."""

    model_config = ConfigDict(populate_by_name=True)

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
    wait: WaitToolConfig | None = Field(
        None,
        description="Configuration for the wait tool (pauses execution)",
    )
    request_user_input: RequestUserInputToolConfig | None = Field(
        None,
        description="Configuration for the request_user_input tool (requests structured input from user)",
    )
    self_identity: SelfIdentityToolConfig | None = Field(
        None,
        alias="agent_info",
        description="Configuration for the self_identity tool (returns this agent's identity)",
    )

    @model_validator(mode="before")
    @classmethod
    def _migrate_sleep_to_wait(cls, data: Any) -> Any:
        """Backward-compat: migrate legacy ``sleep`` field to ``wait``.

        Existing MongoDB documents may still contain ``builtin_tools.sleep``
        from before the rename.  This validator transparently migrates them
        so the rest of the codebase only needs to know about ``wait``.
        """
        if isinstance(data, dict) and "sleep" in data:
            if "wait" not in data or data["wait"] is None:
                data["wait"] = data.pop("sleep")
                logger.warning("Migrated deprecated 'builtin_tools.sleep' → 'wait'")
            else:
                # Both present — drop the legacy field, keep explicit 'wait'
                data.pop("sleep")
                logger.warning("Dropped deprecated 'builtin_tools.sleep' (explicit 'wait' already set)")
        return data


# =============================================================================
# HITL Input Fields (for request_user_input tool)
# =============================================================================


class InputFieldType(str, Enum):
    """Field types for user input forms."""

    TEXT = "text"
    SELECT = "select"
    MULTISELECT = "multiselect"
    BOOLEAN = "boolean"
    NUMBER = "number"
    URL = "url"
    EMAIL = "email"


class InputField(BaseModel):
    """Definition of an input field for user forms.

    Used by the request_user_input tool to define form fields.
    Matches the InputField interface in the UI's MetadataInputForm component.
    """

    field_name: str = Field(..., description="Unique field identifier (snake_case)")
    field_label: str | None = Field(None, description="Display label (auto-generated from field_name if not provided)")
    field_description: str | None = Field(None, description="Help text shown below the field")
    field_type: InputFieldType = Field(InputFieldType.TEXT, description="Type of input control")
    field_values: list[str] | None = Field(None, description="Options for select/multiselect fields")
    required: bool = Field(False, description="Whether the field is required")
    default_value: str | None = Field(None, description="Pre-populated default value")
    placeholder: str | None = Field(None, description="Placeholder text for text inputs")
    value: str | None = Field(None, description="User-provided value (populated when form is submitted)")


# =============================================================================
# Agent UI Config
# =============================================================================


class AgentUIConfig(BaseModel):
    """UI configuration for dynamic agents."""

    gradient_theme: str | None = Field(
        None,
        description="Gradient theme ID for agent avatar (e.g., 'ocean', 'sunset'). None uses global theme.",
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
    ui: AgentUIConfig | None = Field(
        None,
        description="UI configuration (gradient theme, etc.)",
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
    ui: AgentUIConfig | None = None
    enabled: bool | None = None


class DynamicAgentConfig(DynamicAgentConfigBase):
    """Full dynamic agent config as stored in MongoDB."""

    id: str = Field(..., alias="_id", description="Unique ID")
    owner_id: str = Field(..., description="Creator's email")
    is_system: bool = Field(False, description="System-provided agent (non-deletable)")
    config_driven: bool = Field(False, description="Whether this agent was loaded from config.yaml")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    model_config = {"populate_by_name": True}


# =============================================================================
# Chat Request/Response
# =============================================================================


class ClientContext(BaseModel):
    """Opaque client context passed through to system prompt rendering.

    Only ``source`` is required. Clients send arbitrary extra fields
    (e.g. overthink, channel_type) which agent system prompts can
    reference via Jinja2 conditionals like ``{% if client_context.overthink %}``.
    """

    source: str = Field(..., description="Client identifier, e.g. 'slack', 'webui'")

    model_config = ConfigDict(extra="allow")


class ChatRequest(BaseModel):
    """Request to chat with a dynamic agent."""

    message: str = Field(..., description="User message")
    conversation_id: str = Field(..., description="Conversation/session ID")
    agent_id: str = Field(..., description="Dynamic agent config ID")
    protocol: str = Field("custom", pattern=r"^(custom|agui)$", description="Wire protocol: 'custom' or 'agui'")
    trace_id: str | None = Field(None, description="Optional trace ID for Langfuse tracing")
    client_context: ClientContext | None = Field(None, description="Opaque client context for system prompt rendering")


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
    obo_jwt: str | None = None


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
