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
# Dynamic Agent Config
# =============================================================================


class DynamicAgentConfigBase(BaseModel):
    """Base fields for dynamic agent configuration."""

    name: str = Field(..., description="Display name")
    description: str | None = Field(None, description="Optional description")
    system_prompt: str = Field(..., description="Main system prompt / instructions")
    agents_md: str | None = Field(None, description="Optional AGENTS.md content")
    extension_prompt: str | None = Field(None, description="Platform extension prompt (uses default if not set)")
    allowed_tools: dict[str, list[str]] = Field(
        default_factory=dict,
        description="Map of server_id -> tool names (empty list = all tools)",
    )
    model_id: str | None = Field(None, description="LLM model override (uses default if not set)")
    visibility: VisibilityType = Field(VisibilityType.PRIVATE, description="Visibility scope")
    shared_with_teams: list[str] | None = Field(None, description="Team IDs when visibility=team")
    enabled: bool = Field(True, description="Whether the agent is active")


class DynamicAgentConfigCreate(DynamicAgentConfigBase):
    """Model for creating a dynamic agent config."""

    pass


class DynamicAgentConfigUpdate(BaseModel):
    """Model for updating a dynamic agent config."""

    name: str | None = None
    description: str | None = None
    system_prompt: str | None = None
    agents_md: str | None = None
    extension_prompt: str | None = None
    allowed_tools: dict[str, list[str]] | None = None
    model_id: str | None = None
    visibility: VisibilityType | None = None
    shared_with_teams: list[str] | None = None
    enabled: bool | None = None


class DynamicAgentConfig(DynamicAgentConfigBase):
    """Full dynamic agent config as stored in MongoDB."""

    id: str = Field(..., alias="_id", description="Unique ID")
    owner_id: str = Field(..., description="Creator's email")
    is_system: bool = Field(False, description="System-provided agent (non-deletable)")
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
