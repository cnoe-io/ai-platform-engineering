"""Shared RBAC models for the RAG system."""
from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, Field


class Role:
  """
  Role definitions with hierarchical permissions.

  Hierarchy (higher level inherits lower level permissions):
  1. READONLY - Read-only access (GET, query, explore)
  2. INGESTONLY - Read + ingest data (POST ingest, manage jobs)
  3. ADMIN - Full access including deletions and bulk operations
  """

  READONLY = "readonly"
  INGESTONLY = "ingestonly"
  ADMIN = "admin"


class UserContext(BaseModel):
  """Authenticated identity context.

  Human resource authorization is resolved through OpenFGA using ``subject``.
  Static IdP groups, AD groups, and Keycloak realm roles are intentionally not
  carried in this model.
  """

  subject: Optional[str] = None
  email: str
  role: str
  is_authenticated: bool

  class Config:
    frozen = True  # Immutable for security


class UserInfoResponse(BaseModel):
  """Response model for user info endpoint"""

  email: str
  role: str
  is_authenticated: bool
  permissions: List[str]  # List of permissions: ["read", "ingest", "delete"]


class TeamKbOwnership(BaseModel):
    """
    Team/KB ownership metadata stored in MongoDB.

    Runtime RAG authorization decisions are made through OpenFGA relationships.
    """
    team_id: str
    tenant_id: str
    kb_ids: List[str] = Field(default_factory=list)
    allowed_datasource_ids: List[str] = Field(default_factory=list)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class TeamRagToolConfig(BaseModel):
    """
    Team-scoped RAG tool configuration stored in MongoDB.

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
