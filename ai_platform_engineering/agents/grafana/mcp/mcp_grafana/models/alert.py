"""Alert data models."""

from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field


class Alert(BaseModel):
    """Alert model."""
    id: int
    dashboardId: int
    dashboardUid: str
    dashboardSlug: str
    dashboardTitle: str
    panelId: int
    name: str
    state: str
    newStateDate: str
    prevStateDate: str
    evalDate: str
    evalData: Optional[Dict[str, Any]] = None
    executionError: Optional[str] = None
    url: str


class AlertRule(BaseModel):
    """Alert rule model."""
    id: int
    uid: str
    title: str
    condition: str
    data: List[Dict[str, Any]] = Field(default_factory=list)
    intervalSeconds: int
    maxDataPoints: int
    noDataState: str = "NoData"
    execErrState: str = "Alerting"
    forDuration: str = "0s"
    annotations: Dict[str, str] = Field(default_factory=dict)
    labels: Dict[str, str] = Field(default_factory=dict)
    isPaused: bool = False
    notificationSettings: Optional[Dict[str, Any]] = None
    created: Optional[str] = None
    updated: Optional[str] = None
    updatedBy: Optional[str] = None
    provenance: Optional[str] = None
    folderUid: Optional[str] = None
    folderTitle: Optional[str] = None