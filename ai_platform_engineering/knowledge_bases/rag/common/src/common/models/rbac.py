"""
Shared RBAC models for the RAG system.

Includes legacy role-based models (Role, UserContext) and 098 Enterprise RBAC
models (TeamKbOwnership, TeamRagToolConfig) for team-scoped RAG tool management.
"""
from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, Field


class KeycloakRole:
    """Realm role name constants used in Keycloak JWT ``roles`` claim (098 Enterprise RBAC)."""

    ADMIN = "admin"
    KB_ADMIN = "kb_admin"
    TEAM_MEMBER = "team_member"
    CHAT_USER = "chat_user"
    DENIED = "denied"


class KbPermission(BaseModel):
    """Per-knowledge-base permission parsed from realm roles such as ``kb_reader:my-kb``."""

    kb_id: str
    scope: str

    class Config:
        frozen = True


class Role:
    """
    Role definitions with hierarchical permissions.
    
    Hierarchy (higher level inherits lower level permissions):
    0. ANONYMOUS - No access (unauthenticated users)
    1. READONLY - Read-only access (GET, query, explore)
    2. INGESTONLY - Read + ingest data (POST ingest, manage jobs)
    3. ADMIN - Full access including deletions and bulk operations
    """
    ANONYMOUS = "anonymous"
    READONLY = "readonly"
    INGESTONLY = "ingestonly"
    ADMIN = "admin"


class UserContext(BaseModel):
    """User authentication and authorization context"""
    email: str
    groups: List[str]
    role: str
    is_authenticated: bool
    kb_permissions: List[KbPermission] = Field(default_factory=list)
    realm_roles: List[str] = Field(default_factory=list)

    class Config:
        frozen = True  # Immutable for security


class UserInfoResponse(BaseModel):
    """Response model for user info endpoint"""
    email: str
    role: str
    is_authenticated: bool
    groups: List[str]
    permissions: List[str]  # List of permissions: ["read", "ingest", "delete"]
    in_trusted_network: bool


# ============================================================================
# 098 Enterprise RBAC — Team-scoped RAG models (data-model.md)
# ============================================================================


class TeamKbOwnership(BaseModel):
    """
    Team/KB ownership assignment stored in MongoDB (FR-009, FR-015).

    Defines which knowledge bases and datasources a team is permitted to access.
    The ``keycloak_role`` field links this assignment to the Keycloak realm role
    that gates access (e.g. ``team_member(team-a)``).
    """
    team_id: str
    tenant_id: str
    kb_ids: List[str] = Field(default_factory=list)
    allowed_datasource_ids: List[str] = Field(default_factory=list)
    keycloak_role: str
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class TeamRagToolConfig(BaseModel):
    """
    Team-scoped RAG tool configuration stored in MongoDB (FR-009).

    Validation rules:
    - ``datasource_ids`` must be a subset of the owning team's
      ``allowed_datasource_ids`` (enforced on create/update).
    - ``team_id`` is immutable after creation.
    """
    tool_id: str
    tenant_id: str
    team_id: str
    name: str
    datasource_ids: List[str] = Field(default_factory=list)
    created_by: str
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    description: Optional[str] = None
    status: str = "active"
