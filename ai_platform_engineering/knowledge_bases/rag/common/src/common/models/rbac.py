"""
Shared RBAC models for the RAG system.
"""
from typing import List
from pydantic import BaseModel


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
    """User authentication and authorization context"""
    email: str
    groups: List[str]
    role: str
    is_authenticated: bool
    
    class Config:
        frozen = True  # Immutable for security


class UserInfoResponse(BaseModel):
    """Response model for user info endpoint"""
    email: str
    role: str
    is_authenticated: bool
    groups: List[str]
    permissions: List[str]  # List of permissions: ["read", "ingest", "delete"]
