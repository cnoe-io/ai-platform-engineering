"""Datasource data models."""

from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field


class Datasource(BaseModel):
    """Datasource model."""
    id: int
    uid: str
    orgId: int
    name: str
    type: str
    typeName: str
    typeLogoUrl: str
    access: str
    url: str
    password: Optional[str] = None
    user: Optional[str] = None
    database: Optional[str] = None
    basicAuth: bool = False
    basicAuthUser: Optional[str] = None
    basicAuthPassword: Optional[str] = None
    withCredentials: bool = False
    isDefault: bool = False
    jsonData: Dict[str, Any] = Field(default_factory=dict)
    secureJsonData: Optional[Dict[str, Any]] = None
    version: int = 0
    readOnly: bool = False
    editable: bool = True
    created: Optional[str] = None
    updated: Optional[str] = None
    updatedBy: Optional[str] = None
    withCredentials: bool = False
    secureJsonFields: Dict[str, bool] = Field(default_factory=dict)
    health: Optional[str] = None
    healthError: Optional[str] = None