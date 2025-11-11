"""User and team data models."""

from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field


class User(BaseModel):
    """User model."""
    id: int
    login: str
    email: str
    name: str
    avatarUrl: Optional[str] = None
    isAdmin: bool = False
    isDisabled: bool = False
    lastSeenAt: Optional[str] = None
    lastSeenAtAge: Optional[str] = None
    authLabels: List[str] = Field(default_factory=list)
    isGrafanaAdmin: bool = False
    isExternal: bool = False
    isGrafanaUser: bool = True
    authModule: Optional[str] = None
    teams: List[Dict[str, Any]] = Field(default_factory=list)
    orgs: List[Dict[str, Any]] = Field(default_factory=list)


class Team(BaseModel):
    """Team model."""
    id: int
    orgId: int
    name: str
    email: Optional[str] = None
    avatarUrl: Optional[str] = None
    memberCount: int = 0
    permission: int = 0
    accessControl: Optional[Dict[str, Any]] = None
    created: Optional[str] = None
    updated: Optional[str] = None
    members: List[Dict[str, Any]] = Field(default_factory=list)