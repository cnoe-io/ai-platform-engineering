"""Dashboard data models."""

from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field


class DashboardSearchResult(BaseModel):
    """Dashboard search result."""
    id: int
    uid: str
    title: str
    uri: str
    url: str
    slug: str
    type: str
    tags: List[str] = Field(default_factory=list)
    isStarred: bool = False
    folderId: Optional[int] = None
    folderUid: Optional[str] = None
    folderTitle: Optional[str] = None
    folderUrl: Optional[str] = None


class Dashboard(BaseModel):
    """Dashboard model."""
    id: int
    uid: str
    title: str
    description: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    timezone: str = "browser"
    schemaVersion: int = 30
    version: int = 0
    refresh: Optional[str] = None
    time: Dict[str, Any] = Field(default_factory=dict)
    timepicker: Dict[str, Any] = Field(default_factory=dict)
    templating: Dict[str, Any] = Field(default_factory=dict)
    annotations: Dict[str, Any] = Field(default_factory=dict)
    panels: List[Dict[str, Any]] = Field(default_factory=list)
    links: List[Dict[str, Any]] = Field(default_factory=list)
    liveNow: bool = False
    editable: bool = True
    graphTooltip: int = 0
    created: Optional[str] = None
    createdBy: Optional[str] = None
    updated: Optional[str] = None
    updatedBy: Optional[str] = None
    gnetId: Optional[int] = None
    folderId: Optional[int] = None
    folderTitle: Optional[str] = None
    folderUrl: Optional[str] = None